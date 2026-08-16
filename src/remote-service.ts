/** Protocol adapter that exposes the shared Session Notes service as Remote methods. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import { Remote } from '@deepseek-ai/dsh-typert-protocol'
import {
  SessionNotesService,
  type SessionNoteDeleteResult,
  type SessionNoteWriteRequest,
  type SessionNoteWriteResult,
  type SessionNotesListResult,
} from './session-notes.ts'

type RemoteInitializer = (this: object) => void
const remoteInitializers: RemoteInitializer[] = []

/** Apply one standard Remote decorator without leaving decorator syntax in lib/index.js. */
function installRemote<This extends object, Args extends unknown[], Result>(
  method: (this: This, ...args: Args) => Result,
  methodName: string,
  exportName: string,
): void {
  const decorator = Remote(exportName)
  decorator(method, {
    kind: 'method',
    name: methodName,
    static: false,
    private: false,
    access: {
      has: () => true,
      get: () => method,
    },
    metadata: undefined,
    addInitializer(initializer) {
      remoteInitializers.push(function (this: object): void {
        initializer.call(this as This)
      })
    },
  } as unknown as ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>)
}

/** Host class discovered by the Loader; business state remains in its parent service. */
export class SessionNotesRemoteService extends SessionNotesService {
  /** Construct the shared service and install its runtime Remote markers. */
  constructor(...args: ConstructorParameters<typeof SessionNotesService>) {
    super(...args)
    for (const initializer of remoteInitializers) initializer.call(this)
  }

  /** Expose listing through the generated sessionNotes/list endpoint. */
  remoteList(agent: Agent): Promise<SessionNotesListResult> {
    return this.list(agent)
  }

  /** Expose writing through the generated sessionNotes/write endpoint. */
  remoteWrite(agent: Agent, request: SessionNoteWriteRequest): Promise<SessionNoteWriteResult> {
    return this.write(agent, request)
  }

  /** Expose deletion through the generated sessionNotes/delete endpoint. */
  remoteDelete(agent: Agent, key: string): Promise<SessionNoteDeleteResult> {
    return this.delete(agent, key)
  }
}

installRemote(SessionNotesRemoteService.prototype.remoteList, 'remoteList', 'list')
installRemote(SessionNotesRemoteService.prototype.remoteWrite, 'remoteWrite', 'write')
installRemote(SessionNotesRemoteService.prototype.remoteDelete, 'remoteDelete', 'delete')

export default SessionNotesRemoteService
