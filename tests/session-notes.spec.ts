import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { CallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as notes from '../src/session-notes.ts'

const roots: string[] = []
const signal = new AbortController().signal
let callCounter = 0

afterAll(async () => {
  await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })))
})

function agentFor(session: Session): Agent {
  return { id: session.id, session } as unknown as Agent
}

async function setup(root: string, config: Partial<notes.Config> = {}) {
  const ctx = new Context()
  const fibers = [
    await ctx.plugin(Storage),
    await ctx.plugin(StorageJson, { root }),
    await ctx.plugin(StorageDomain, { backend: 'json' }),
    await ctx.plugin(SystemPrompt),
    await ctx.plugin(ToolRuntime),
    await ctx.plugin(notes.SessionNotesService, config),
  ]
  return {
    ctx,
    async dispose() {
      for (const fiber of fibers.reverse()) await fiber.dispose()
    },
  }
}

async function call(ctx: Context, name: string, args: unknown, session: Session) {
  return ctx.tools.execute({
    signal,
    callId: CallId(`notes-${++callCounter}`),
    name,
    arguments: args,
    agent: agentFor(session),
  })
}

describe('scratch session notes plugin', () => {
  it('keeps the namespace-plugin export shape expected by Loader', () => {
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(notes) as Record<string, unknown>
    expect('default' in notes).toBe(true)
    expect(unwrapped).toBe(notes.SessionNotesService)
    expect(notes.SessionNotesService.inject).toEqual(['tools', 'storageDomain'])
  })

  it('registers tools and persists notes in an independent storage unit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-session-notes-'))
    roots.push(root)
    const { ctx, dispose } = await setup(root)
    const session = Session.create(SessionId('notes-one'))

    expect(ctx.tools.schemas().map(schema => schema.name).sort()).toEqual(['note_delete', 'note_list', 'note_write'])
    const write = await call(ctx, 'note_write', { key: 'goal', content: 'Understand the plugin architecture.' }, session)
    expect(write.isError).toBe(false)
    const list = await call(ctx, 'note_list', {}, session)
    expect(list.isError).toBe(false)
    if (!list.isError) {
      expect(list.value.notes).toHaveLength(1)
      expect(list.value.notes[0]?.content).toBe('Understand the plugin architecture.')
      expect(list.value.notes[0]?.storedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/)
      expect(list.value.notes[0]).not.toHaveProperty('createdAt')
      expect(list.value.notes[0]).not.toHaveProperty('updatedAt')
    }
    expect(session.events).toEqual([])

    const medium = JSON.parse(await readFile(join(root, 'session_notes.json'), 'utf8')) as {
      unit: { name: string }
      tables: { sessions: Record<string, unknown> }
    }
    expect(medium.unit.name).toBe('session_notes')
    expect(medium.tables.sessions['notes-one']).toBeDefined()
    await dispose()
  })

  it('reopens the sidecar and restores notes without touching Session history', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-session-notes-reopen-'))
    roots.push(root)
    const session = Session.create(SessionId('notes-reopen'))
    const first = await setup(root)
    const firstWrite = await call(first.ctx, 'note_write', { key: 'answer', content: 'Use a storage domain.' }, session)
    expect(firstWrite.isError).toBe(false)
    await first.dispose()

    const second = await setup(root)
    const list = await call(second.ctx, 'note_list', {}, session)
    expect(list.isError).toBe(false)
    if (!list.isError) expect(list.value.notes).toEqual([
      expect.objectContaining({ key: 'answer', content: 'Use a storage domain.' }),
    ])
    expect(session.events).toEqual([])
    await second.dispose()
  })

  it('serializes updates, scopes notes by SessionId, and enforces byte/count limits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-session-notes-limits-'))
    roots.push(root)
    const { ctx, dispose } = await setup(root, { maxNoteBytes: 4, maxNotesPerSession: 1 })
    const first = Session.create(SessionId('notes-a'))
    const second = Session.create(SessionId('notes-b'))

    const writes = await Promise.all([
      call(ctx, 'note_write', { key: 'a', content: 'one' }, first),
      call(ctx, 'note_write', { key: 'a', content: 'two' }, first),
    ])
    expect(writes.every(result => !result.isError)).toBe(true)

    const full = await call(ctx, 'note_write', { key: 'b', content: 'x' }, first)
    expect(full.isError).toBe(true)
    const tooLarge = await call(ctx, 'note_write', { key: 'ééé', content: 'x' }, second)
    expect(tooLarge.isError).toBe(true)
    const otherList = await call(ctx, 'note_list', {}, second)
    expect(otherList.isError).toBe(false)
    if (!otherList.isError) expect(otherList.value.notes).toEqual([])

    await dispose()
  })

  it('refreshes one readable storage time when a note is replaced', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-session-notes-time-'))
    roots.push(root)
    const { ctx, dispose } = await setup(root)
    const session = Session.create(SessionId('notes-time'))
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-16T10:00:00.000Z'))
      await call(ctx, 'note_write', { key: 'status', content: 'first' }, session)
      vi.setSystemTime(new Date('2026-08-16T11:30:00.000Z'))
      await call(ctx, 'note_write', { key: 'status', content: 'replaced' }, session)
      const list = await call(ctx, 'note_list', {}, session)
      expect(list.isError).toBe(false)
      if (!list.isError) {
        expect(list.value.notes).toEqual([{
          key: 'status',
          content: 'replaced',
          storedAt: '2026-08-16 11:30:00 UTC',
        }])
      }
    } finally {
      vi.useRealTimers()
      await dispose()
    }
  })
})
