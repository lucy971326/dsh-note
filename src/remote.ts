/** Development copy of the generated Host-for-Client Remote contribution. */

import { z } from 'zod'
import type {
  RemoteResult,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import type {
  SessionNoteDeleteResult,
  SessionNoteWriteRequest,
  SessionNoteWriteResult,
  SessionNotesListResult,
} from './types.ts'

/** Client-facing Remote signatures for the session notes namespace. */
export interface SessionNotesRemote {
  list: (sessionId: string) => Promise<RemoteResult<SessionNotesListResult>>
  write: (sessionId: string, request: SessionNoteWriteRequest) => Promise<RemoteResult<SessionNoteWriteResult>>
  delete: (sessionId: string, key: string) => Promise<RemoteResult<SessionNoteDeleteResult>>
}

const sessionIdSchema = z.string().min(1)
const noteSchema = z.object({
  key: z.string().min(1),
  content: z.string().min(1),
  storedAt: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/),
}).readonly()
const listResultSchema = z.object({ notes: z.array(noteSchema).readonly() }).readonly()
const writeRequestSchema = z.object({ key: z.string().min(1), content: z.string().min(1) }).readonly()
const writeResultSchema = z.object({ note: noteSchema, replaced: z.boolean() }).readonly()
const deleteResultSchema = z.object({ key: z.string().min(1), deleted: z.boolean() }).readonly()

const TYPERT_REMOTE: TypertRemoteContribution = {
  package: 'dsh-session-notes',
  descriptors: [
    {
      id: 'dsh-session-notes#sessionNotes/delete',
      service: 'sessionNotes',
      namespace: 'sessionNotes',
      method: 'delete',
      implementation: 'remoteDelete',
      invocation: { kind: 'direct' },
      scope: { context: 'agent', wire: 'agentId' },
      parameters: [
        {
          name: 'agent',
          wire: 'agentId',
          source: 'lookup',
          lookup: 'agent',
          codec: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-session/types#SessionId', schema: sessionIdSchema },
        },
        {
          name: 'key',
          wire: 'key',
          source: 'json',
          codec: { mode: 'strict', typeSymbol: 'dsh-session-notes#string', schema: z.string().min(1) },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-session-notes#SessionNoteDeleteResult',
        schema: deleteResultSchema,
      },
    },
    {
      id: 'dsh-session-notes#sessionNotes/list',
      service: 'sessionNotes',
      namespace: 'sessionNotes',
      method: 'list',
      implementation: 'remoteList',
      invocation: { kind: 'direct' },
      scope: { context: 'agent', wire: 'agentId' },
      parameters: [
        {
          name: 'agent',
          wire: 'agentId',
          source: 'lookup',
          lookup: 'agent',
          codec: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-session/types#SessionId', schema: sessionIdSchema },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-session-notes#SessionNotesListResult',
        schema: listResultSchema,
      },
    },
    {
      id: 'dsh-session-notes#sessionNotes/write',
      service: 'sessionNotes',
      namespace: 'sessionNotes',
      method: 'write',
      implementation: 'remoteWrite',
      invocation: { kind: 'direct' },
      scope: { context: 'agent', wire: 'agentId' },
      parameters: [
        {
          name: 'agent',
          wire: 'agentId',
          source: 'lookup',
          lookup: 'agent',
          codec: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-session/types#SessionId', schema: sessionIdSchema },
        },
        {
          name: 'request',
          wire: 'request',
          source: 'json',
          codec: { mode: 'strict', typeSymbol: 'dsh-session-notes#SessionNoteWriteRequest', schema: writeRequestSchema },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-session-notes#SessionNoteWriteResult',
        schema: writeResultSchema,
      },
    },
  ],
}

export default TYPERT_REMOTE
