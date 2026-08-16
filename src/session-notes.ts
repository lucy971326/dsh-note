/**
 * Session-scoped notes stored in an independent storage-domain sidecar.
 * @module dsh-session-notes/session-notes
 */

import { Buffer } from 'node:buffer'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session/types'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  SessionNote,
  SessionNoteDeleteResult,
  SessionNoteWriteRequest,
  SessionNoteWriteResult,
  SessionNotesListResult,
} from './types.ts'

export type {
  SessionNote,
  SessionNoteDeleteResult,
  SessionNoteWriteRequest,
  SessionNoteWriteResult,
  SessionNotesListResult,
} from './types.ts'

/** Configures limits for one Session's notes. */
export interface Config {
  /** Maximum UTF-8 byte length of one note's key or content. */
  readonly maxNoteBytes: number
  /** Maximum number of distinct note keys stored for one Session. */
  readonly maxNotesPerSession: number
}

/** Schemastery configuration for this plugin. */
export const Config: z<Config> = z.object({
  maxNoteBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(8_192),
  maxNotesPerSession: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(128),
})

const nonNegativeSafeInteger = zod.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

/** The durable row stored under one SessionId. */
const sessionNotesRowSchema = zod.object({
  session: zod.object({
    id: zod.string().min(1),
    // This lifecycle fence is internal storage metadata, not a note field.
    createdAt: nonNegativeSafeInteger,
    cwd: zod.string().optional(),
  }),
  notes: zod.array(zod.object({
    key: zod.string().refine(value => value.trim().length > 0),
    content: zod.string().refine(value => value.trim().length > 0),
    storedAt: zod.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/),
  })).superRefine((notes, ctx) => {
    const keys = new Set<string>()
    notes.forEach((note, index) => {
      if (keys.has(note.key)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'key'],
          message: `duplicate session note key '${note.key}'`,
        })
      }
      keys.add(note.key)
    })
  }),
})

type SessionNotesRow = zod.infer<typeof sessionNotesRowSchema>

/** The single storage unit owned by this plugin. */
const sessionNotesDomainSpec = defineDomain({
  name: 'session_notes',
  version: 0,
  tables: {
    sessions: domainTable<SessionId, SessionNotesRow>(sessionNotesRowSchema),
  },
})

/** Public plugin name used by raw Loader overlays. */
export const name = 'tool-session-notes'

/** Services needed before the Host half can start. */
export const inject = ['tools', 'storageDomain']

type NotesTable = KvTable<SessionId, SessionNotesRow>

/** Copy a Session identity into the sidecar row. */
function sessionIdentity(header: SessionHeader): SessionNotesRow['session'] {
  return {
    id: header.id,
    createdAt: header.createdAt,
    ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
  }
}

/** Refuse a stale row when a Session id is reused for a new lifecycle. */
function sameSession(row: SessionNotesRow, header: SessionHeader): boolean {
  return row.session.id === header.id
    && row.session.createdAt === header.createdAt
    && row.session.cwd === header.cwd
}

/** Copy one note before returning it across a tool or Remote boundary. */
function copyNote(note: SessionNote): SessionNote {
  return { key: note.key, content: note.content, storedAt: note.storedAt }
}

/** Copy a durable row before replacing it in the storage domain. */
function copyRow(header: SessionHeader, notes: readonly SessionNote[]): SessionNotesRow {
  return { session: sessionIdentity(header), notes: notes.map(copyNote) }
}

/** Check a deployment limit at the plugin boundary as well as in Schemastery. */
function resolveLimit(label: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`tool-session-notes: ${label} must be a positive safe integer`)
  }
  return value
}

/** Count UTF-8 bytes, rather than JavaScript UTF-16 code units. */
function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

/** Format one write time for humans and models, without epoch milliseconds. */
function formatStoredAt(): string {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
}

/** Require a real agent because notes belong to its current Session. */
function requireAgent(exec: { agent?: Agent }): Agent {
  if (exec.agent === undefined) throw new Error('session notes require an owning agent session')
  return exec.agent
}

/**
 * Shared Session Notes business service. Both model tools and generated Remote
 * methods call these methods, so they cannot drift into separate stores.
 */
export class SessionNotesService extends TypertRemoteService {
  static inject = ['tools', 'storageDomain']
  static Config = Config

  private readonly maxNoteBytes: number
  private readonly maxNotesPerSession: number
  private table?: NotesTable
  private readonly operationTails = new Map<SessionId, Promise<void>>()
  private mutationAdmissionOpen = true

  /**
   * @param ctx - Host context carrying the tool and storage capabilities.
   * @param config - validated note limits.
   */
  constructor(ctx: Context, config: Config = { maxNoteBytes: 8_192, maxNotesPerSession: 128 }) {
    super(ctx, 'sessionNotes')
    this.maxNoteBytes = resolveLimit('maxNoteBytes', config.maxNoteBytes)
    this.maxNotesPerSession = resolveLimit('maxNotesPerSession', config.maxNotesPerSession)
  }

  /** Open and own the independent durable sidecar. */
  protected async [Service.init](): Promise<void> {
    const domain: Domain<typeof sessionNotesDomainSpec> = await this.ctx.storageDomain.open(sessionNotesDomainSpec)
    this.table = domain.table('sessions')
    this.ctx.effect(() => async () => {
      this.mutationAdmissionOpen = false
      await Promise.all(this.operationTails.values())
      await domain.close()
    }, 'tool-session-notes.domainClose')
    this.registerTools()
  }

  /** List notes for the owning Agent's current Session. */
  list(agent: Agent): Promise<SessionNotesListResult> {
    const session = agent.session
    return this.enqueue(session.header.id, async () => ({
      notes: (this.currentRow(session)?.notes ?? []).map(copyNote),
    }))
  }

  /** Save or replace one note for the owning Agent's current Session. */
  write(agent: Agent, request: SessionNoteWriteRequest): Promise<SessionNoteWriteResult> {
    const session = agent.session
    const key = this.resolveText('key', request.key)
    const content = this.resolveText('content', request.content)
    return this.enqueue(session.header.id, async () => {
      const row = this.currentRow(session)
      const notes = row?.notes ?? []
      const index = notes.findIndex(note => note.key === key)
      const existing = index === -1 ? undefined : notes[index]
      if (existing === undefined && notes.length >= this.maxNotesPerSession) {
        throw new Error(`session already has the maximum of ${this.maxNotesPerSession} notes`)
      }
      const note: SessionNote = { key, content, storedAt: formatStoredAt() }
      const nextNotes = [...notes]
      if (index === -1) nextNotes.push(note)
      else nextNotes[index] = note
      await this.requireTable().put(session.header.id, copyRow(session.header, nextNotes))
      return { note: copyNote(note), replaced: existing !== undefined }
    })
  }

  /** Delete one note for the owning Agent's current Session. */
  delete(agent: Agent, key: string): Promise<SessionNoteDeleteResult> {
    const session = agent.session
    const resolvedKey = this.resolveText('key', key)
    return this.enqueue(session.header.id, async () => {
      const row = this.currentRow(session)
      const index = row?.notes.findIndex(note => note.key === resolvedKey) ?? -1
      if (row === undefined || index === -1) return { key: resolvedKey, deleted: false }
      const nextNotes = row.notes.filter((_note, noteIndex) => noteIndex !== index)
      if (nextNotes.length === 0) await this.requireTable().delete(session.header.id)
      else await this.requireTable().put(session.header.id, copyRow(session.header, nextNotes))
      return { key: resolvedKey, deleted: true }
    })
  }

  /** Register model tools as thin adapters over the shared service methods. */
  private registerTools(): void {
    this.ctx.tools.register(defineTool({
      name: 'note_write',
      description: 'Save or replace one short note for the current conversation. Use a stable key when updating a note you already saved.',
      parameters: {
        key: { type: 'string', required: true, description: 'A short stable name for the note.' },
        content: { type: 'string', required: true, description: 'The note content to save.' },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            note: {
              type: 'object', required: true, additionalProperties: false,
              properties: {
                key: { type: 'string', required: true },
                content: { type: 'string', required: true },
                storedAt: { type: 'string', required: true },
              },
            },
            replaced: { type: 'boolean', required: true },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: `${value.replaced ? 'Updated' : 'Saved'} note '${value.note.key}'.`,
        }],
      },
      execute: (args, exec) => this.write(requireAgent(exec), args),
      presentCall: args => ({ card: 'generic', title: 'Save session note', kind: 'other', rawInput: args }),
    }))

    this.ctx.tools.register(defineTool({
      name: 'note_list',
      description: 'List the notes saved for the current conversation. Use this when earlier context needs to be restored.',
      parameters: {},
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            notes: {
              type: 'array', required: true, items: {
                type: 'object', additionalProperties: false,
                properties: {
                  key: { type: 'string', required: true },
                  content: { type: 'string', required: true },
                  storedAt: { type: 'string', required: true },
                },
              },
            },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.notes.length === 0
            ? 'No session notes.'
            : value.notes.map(note => `[${note.storedAt}] ${note.key}: ${note.content}`).join('\n'),
        }],
      },
      execute: (_args, exec) => this.list(requireAgent(exec)),
    }))

    this.ctx.tools.register(defineTool({
      name: 'note_delete',
      description: 'Delete one saved note from the current conversation when it is no longer useful.',
      parameters: {
        key: { type: 'string', required: true, description: 'The stable key of the note to delete.' },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            key: { type: 'string', required: true },
            deleted: { type: 'boolean', required: true },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.deleted ? `Deleted note '${value.key}'.` : `Note '${value.key}' was not found.`,
        }],
      },
      execute: (args, exec) => this.delete(requireAgent(exec), args.key),
    }))
  }

  /** Validate and normalize a note field once at the shared service boundary. */
  private resolveText(label: string, value: string): string {
    const text = value.trim()
    if (text.length === 0) throw new Error(`note ${label} must contain a non-whitespace character`)
    if (utf8Bytes(text) > this.maxNoteBytes) throw new Error(`note ${label} exceeds ${this.maxNoteBytes} UTF-8 bytes`)
    return text
  }

  /** Read the current row, hiding a row from an older Session lifecycle. */
  private currentRow(session: Agent['session']): SessionNotesRow | undefined {
    const row = this.requireTable().get(session.header.id)
    return row !== undefined && sameSession(row, session.header) ? row : undefined
  }

  /** Serialize a complete read/modify/write operation for one Session. */
  private enqueue<T>(sessionId: SessionId, operation: () => Promise<T>): Promise<T> {
    if (!this.mutationAdmissionOpen) return Promise.reject(new Error('tool-session-notes: service is disposing'))
    const previous = this.operationTails.get(sessionId) ?? Promise.resolve()
    const result = previous.then(operation)
    const tail = result.then(() => undefined, () => undefined)
    this.operationTails.set(sessionId, tail)
    return result.finally(() => {
      if (this.operationTails.get(sessionId) === tail) this.operationTails.delete(sessionId)
    })
  }

  /** Resolve the initialized durable table or fail a broken service lifecycle. */
  private requireTable(): NotesTable {
    if (this.table === undefined) throw new Error('tool-session-notes: durable domain is not initialized')
    return this.table
  }
}

export default SessionNotesService
