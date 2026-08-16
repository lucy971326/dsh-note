/** A note stored for one conversation Session. */
export interface SessionNote {
  readonly key: string
  readonly content: string
  readonly storedAt: string
}

export interface SessionNotesListResult {
  readonly notes: readonly SessionNote[]
}

export interface SessionNoteWriteRequest {
  readonly key: string
  readonly content: string
}

export interface SessionNoteWriteResult {
  readonly note: SessionNote
  readonly replaced: boolean
}

export interface SessionNoteDeleteResult {
  readonly key: string
  readonly deleted: boolean
}

export declare const name: 'tool-session-notes'
export declare const inject: readonly ['tools', 'storageDomain']
