/** Browser half of the Session Notes plugin. */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import sessionNotesRemote from '../remote.ts'
import type { SessionNotesRemote } from '../remote.ts'
import { SessionNotesCard } from './SessionNotesCard.tsx'
import { en, zh, type SessionNotesKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    sessionNotes: SessionNotesKey
  }
}

/** Locale namespace owned by this client plugin. */
const NS = 'sessionNotes'

/** Services required by the card, slot, locale, and generated Remote mount. */
export const inject = ['slots', 'remote', 'locale']

/**
 * Mount the package's generated Remote contribution and register its dock.
 * @param ctx - browser client root context.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  const remote = ctx.remote as ClientContext['remote'] & { sessionNotes: SessionNotesRemote }
  const disposeRemote = await remote.$mount(sessionNotesRemote)
  const sessionNotes = ctx.get('remote.sessionNotes') as SessionNotesRemote
  ctx.effect(() => async () => { await disposeRemote() }, 'session-notes.client.remote')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-notes.client.locale')

  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'session-notes',
    order: 15,
    locale: NS,
    inject: (sessionId: SessionId) => ({
      list: () => sessionNotes.list(sessionId),
      write: (request: { key: string; content: string }) => sessionNotes.write(sessionId, request),
      delete: (key: string) => sessionNotes.delete(sessionId, key),
    }),
  }, SessionNotesCard))
}
