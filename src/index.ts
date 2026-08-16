/** Host entry for the installable Session Notes bundle. */

export { Config, SessionNotesService, name, inject } from './session-notes.ts'
export { SessionNotesRemoteService } from './remote-service.ts'
export type {
  Config as SessionNotesConfig,
  SessionNote,
  SessionNoteDeleteResult,
  SessionNoteWriteRequest,
  SessionNoteWriteResult,
  SessionNotesListResult,
} from './session-notes.ts'
export type * from './types.ts'
export { default } from './remote-service.ts'
