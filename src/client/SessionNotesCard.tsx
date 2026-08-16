/** Compact session-note button and its session-scoped popover editor. */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  SessionNote,
  SessionNoteDeleteResult,
  SessionNoteWriteRequest,
  SessionNoteWriteResult,
  SessionNotesListResult,
} from '../types.ts'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import css from './SessionNotesCard.module.css'

/** Remote verbs injected by the session-scoped slot registration. */
export interface SessionNotesDockActions {
  list: () => Promise<RemoteResult<SessionNotesListResult>>
  write: (request: SessionNoteWriteRequest) => Promise<RemoteResult<SessionNoteWriteResult>>
  delete: (key: string) => Promise<RemoteResult<SessionNoteDeleteResult>>
}

/** Full props of the session-scoped input dock entry. */
export type SessionNotesCardProps =
  PropsRuntime<'conversation.input.right'>
  & PropsLocale<'sessionNotes'>
  & SessionNotesDockActions

type EditorState = { key: string; content: string; originalKey?: string }

/** Convert a Remote failure into copy suitable for the inline error label. */
function failureText<T>(result: RemoteResult<T>): string | undefined {
  return result.ok ? undefined : `${result.error.message} (${result.error.code})`
}

/** Render the notes affordance inside the composer tool row. */
export function SessionNotesCard({ sessionId, list, write, delete: deleteNote, t }: SessionNotesCardProps) {
  const [notes, setNotes] = useState<readonly SessionNote[]>([])
  const [expanded, setExpanded] = useState(false)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busyRef = useRef(false)
  const refreshSequence = useRef(0)

  const refresh = useCallback(async (showLoading = true): Promise<boolean> => {
    const sequence = ++refreshSequence.current
    if (showLoading) setLoading(true)
    try {
      const result = await list()
      if (sequence !== refreshSequence.current) return false
      const failure = failureText(result)
      if (failure !== undefined) {
        setError(failure)
        setLoading(false)
        return false
      }
      setNotes(result.value.notes)
      setError(null)
      setLoading(false)
      return true
    } catch (cause) {
      if (sequence !== refreshSequence.current) return false
      setError(cause instanceof Error ? cause.message : t('error'))
      setLoading(false)
      return false
    }
  }, [list, t])

  useEffect(() => {
    refreshSequence.current += 1
    setNotes([])
    setEditor(null)
    setExpanded(false)
    setError(null)
    void refresh()
    const timer = window.setInterval(() => { void refresh(false) }, 2500)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh(false)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      refreshSequence.current += 1
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh, sessionId])

  const runMutation = useCallback(async (operation: () => Promise<RemoteResult<unknown>>): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await operation()
      const failure = failureText(result)
      if (failure !== undefined) {
        setError(failure)
        return
      }
      setEditor(null)
      await refresh(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('error'))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [refresh, t])

  const openEditor = useCallback((note?: SessionNote) => {
    setExpanded(true)
    setError(null)
    setEditor(note === undefined
      ? { key: '', content: '' }
      : { key: note.key, content: note.content, originalKey: note.key })
  }, [])

  const save = useCallback(() => {
    if (editor === null) return
    const request = { key: editor.key.trim(), content: editor.content.trim() }
    if (request.key.length === 0 || request.content.length === 0) {
      setError(t('required'))
      return
    }
    void runMutation(() => write(request))
  }, [editor, runMutation, t, write])

  return (
    <div className={css.anchor} data-session-notes data-session-id={sessionId}>
      <button
        type="button"
        className={css.trigger}
        aria-expanded={expanded}
        aria-label={expanded ? t('collapse') : t('expand')}
        onClick={() => { setExpanded(value => !value); setError(null) }}
      >
        <span className={css.triggerLabel}>{t('title')}</span>
        <span className={css.badge}>{loading ? '…' : notes.length}</span>
      </button>

      {expanded && (
        <section className={css.popover} aria-label={t('title')}>
          <div className={css.header}>
            <div>
              <div className={css.title}>{t('title')}</div>
              <div className={css.subtitle}>{loading ? t('loading') : `${notes.length} ${t('count')}`}</div>
            </div>
            <button type="button" className={`${css.textButton} ${css.primary}`} onClick={() => { openEditor() }} disabled={busy}>
              {t('add')}
            </button>
          </div>

          {editor !== null && (
            <div className={css.editor}>
              <label className={css.field}>
                {t('key')}
                <input className={css.input} value={editor.key} disabled={editor.originalKey !== undefined || busy} onChange={event => { setEditor(value => value === null ? value : { ...value, key: event.target.value }) }} />
              </label>
              <label className={css.field}>
                {t('content')}
                <textarea className={css.textarea} value={editor.content} disabled={busy} onChange={event => { setEditor(value => value === null ? value : { ...value, content: event.target.value }) }} />
              </label>
              <div className={css.formActions}>
                <button type="button" className={css.textButton} onClick={() => { setEditor(null) }} disabled={busy}>{t('cancel')}</button>
                <button type="button" className={`${css.textButton} ${css.primary}`} onClick={save} disabled={busy}>{t('save')}</button>
              </div>
            </div>
          )}

          {!loading && notes.length === 0 && editor === null && <div className={css.state}>{t('empty')}</div>}
          {!loading && notes.length > 0 && (
            <div className={css.notes}>
              {notes.map(note => (
                <article className={css.note} key={note.key}>
                  <div className={css.noteTop}>
                    <span className={css.noteKey}>{note.key}</span>
                    <div className={css.noteActions}>
                      <button type="button" className={css.iconButton} onClick={() => { openEditor(note) }} disabled={busy}>{t('edit')}</button>
                      <button type="button" className={`${css.iconButton} ${css.danger}`} onClick={() => { void runMutation(() => deleteNote(note.key)) }} disabled={busy}>{t('delete')}</button>
                    </div>
                  </div>
                  <div className={css.noteBody}>{note.content}</div>
                  <div className={css.noteTime}>{t('storedAt')}: {note.storedAt}</div>
                </article>
              ))}
            </div>
          )}
          {error !== null && <div className={css.error} role="alert">{error}</div>}
        </section>
      )}
    </div>
  )
}
