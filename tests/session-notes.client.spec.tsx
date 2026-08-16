/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  SessionNote,
  SessionNoteDeleteResult,
  SessionNoteWriteResult,
  SessionNotesListResult,
} from '../src/session-notes.ts'
import { SessionNotesCard, type SessionNotesCardProps } from '../src/client/SessionNotesCard.tsx'
import { apply } from '../src/client/index.ts'

function success<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

function cardProps(
  sessionId: string,
  list: () => Promise<RemoteResult<SessionNotesListResult>>,
  write: (request: { key: string; content: string }) => Promise<RemoteResult<SessionNoteWriteResult>>,
  deleteNote: (key: string) => Promise<RemoteResult<SessionNoteDeleteResult>>,
): SessionNotesCardProps {
  return {
    sessionId,
    list,
    write,
    delete: deleteNote,
    t: key => key,
  } as unknown as SessionNotesCardProps
}

describe('Session Notes client card', () => {
  it('loads, edits, deletes, and refreshes notes through the injected Remote verbs', async () => {
    let stored: SessionNote[] = [{
      key: 'goal',
      content: 'first',
      storedAt: '2026-08-16 11:30:00 UTC',
    }]
    const list = vi.fn(async () => success({ notes: stored }))
    const write = vi.fn(async (request: { key: string; content: string }) => {
      stored = [{ ...stored[0]!, ...request, storedAt: '2026-08-16 11:31:00 UTC' }]
      return success({ note: stored[0]!, replaced: true })
    })
    const deleteNote = vi.fn(async (key: string) => {
      stored = stored.filter(note => note.key !== key)
      return success({ key, deleted: true })
    })

    render(<SessionNotesCard {...cardProps('one', list, write, deleteNote)} />)
    await waitFor(() => expect(screen.getByText('first')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'expand' }))
    fireEvent.click(screen.getByRole('button', { name: 'edit' }))
    fireEvent.change(screen.getByDisplayValue('first'), { target: { value: 'second' } })
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await waitFor(() => expect(write).toHaveBeenCalledWith({ key: 'goal', content: 'second' }))
    await waitFor(() => expect(screen.getByText('second')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'delete' }))
    await waitFor(() => expect(deleteNote).toHaveBeenCalledWith('goal'))
    await waitFor(() => expect(screen.getByText('empty')).toBeTruthy())
  })

  it('does not let an older session response overwrite a newly selected session', async () => {
    let resolveFirst: ((result: RemoteResult<SessionNotesListResult>) => void) | undefined
    const firstList = () => new Promise<RemoteResult<SessionNotesListResult>>(resolve => { resolveFirst = resolve })
    const secondList = async () => success({
      notes: [{ key: 'new', content: 'session two', storedAt: '2026-08-16 11:32:00 UTC' }],
    })
    const noopWrite = async () => success<SessionNoteWriteResult>({
      note: { key: 'x', content: 'x', storedAt: '2026-08-16 11:32:00 UTC' },
      replaced: false,
    })
    const noopDelete = async (key: string) => success<SessionNoteDeleteResult>({ key, deleted: false })
    const view = render(<SessionNotesCard {...cardProps('one', firstList, noopWrite, noopDelete)} />)
    view.rerender(<SessionNotesCard {...cardProps('two', secondList, noopWrite, noopDelete)} />)
    await waitFor(() => expect(screen.getByText('session two')).toBeTruthy())
    resolveFirst?.(success({ notes: [{ key: 'old', content: 'session one', storedAt: '2026-08-16 11:30:00 UTC' }] }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(screen.queryByText('session one')).toBeNull()
    expect(screen.getByText('session two')).toBeTruthy()
  })

  it('mounts the Remote contribution and registers the input dock entry', async () => {
    let slotFactory: (() => unknown) | undefined
    const register = vi.fn(() => vi.fn())
    const mount = vi.fn(async () => vi.fn())
    const remote = {
      $mount: mount,
      sessionNotes: {
        list: vi.fn(),
        write: vi.fn(),
        delete: vi.fn(),
      },
    }
    const ctx = {
      remote,
      effect: (setup: () => unknown) => setup(),
      locale: { register: vi.fn(() => vi.fn()) },
      slots: {
        inject: vi.fn((_name: string, factory: () => unknown) => { slotFactory = factory }),
        register,
      },
    } as unknown as ClientContext

    await apply(ctx)
    expect(mount).toHaveBeenCalledWith(expect.objectContaining({
      package: 'dsh-session-notes',
    }))
    expect(slotFactory).toBeTypeOf('function')
    slotFactory?.()
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      name: 'conversation.input.dock',
      id: 'session-notes',
      order: 15,
      locale: 'sessionNotes',
    }), SessionNotesCard)
  })
})
