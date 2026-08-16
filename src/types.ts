/** Public wire types shared by the Host tools, Remote, and Web card. */

/** One durable note. */
export interface SessionNote {
  readonly key: string
  readonly content: string
  readonly storedAt: string
}

/** Result returned by list. */
export interface SessionNotesListResult {
  readonly notes: readonly SessionNote[]
}

/** Request accepted by write. */
export interface SessionNoteWriteRequest {
  readonly key: string
  readonly content: string
}

/** Result returned after write. */
export interface SessionNoteWriteResult {
  readonly note: SessionNote
  readonly replaced: boolean
}

/** Result returned after delete. */
export interface SessionNoteDeleteResult {
  readonly key: string
  readonly deleted: boolean
}
