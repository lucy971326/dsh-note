import { Buffer } from "node:buffer";
import { Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { z as z$1 } from "zod";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
//#region src/session-notes.ts
/**
* Session-scoped notes stored in an independent storage-domain sidecar.
* @module dsh-session-notes/session-notes
*/
/** Schemastery configuration for this plugin. */
const Config = z.object({
	maxNoteBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(8192),
	maxNotesPerSession: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(128)
});
const nonNegativeSafeInteger = z$1.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
/** The single storage unit owned by this plugin. */
const sessionNotesDomainSpec = defineDomain({
	name: "session_notes",
	version: 0,
	tables: { sessions: domainTable(z$1.object({
		session: z$1.object({
			id: z$1.string().min(1),
			createdAt: nonNegativeSafeInteger,
			cwd: z$1.string().optional()
		}),
		notes: z$1.array(z$1.object({
			key: z$1.string().refine((value) => value.trim().length > 0),
			content: z$1.string().refine((value) => value.trim().length > 0),
			storedAt: z$1.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/)
		})).superRefine((notes, ctx) => {
			const keys = /* @__PURE__ */ new Set();
			notes.forEach((note, index) => {
				if (keys.has(note.key)) ctx.addIssue({
					code: "custom",
					path: [index, "key"],
					message: `duplicate session note key '${note.key}'`
				});
				keys.add(note.key);
			});
		})
	})) }
});
/** Public plugin name used by raw Loader overlays. */
const name = "tool-session-notes";
/** Services needed before the Host half can start. */
const inject = ["tools", "storageDomain"];
/** Copy a Session identity into the sidecar row. */
function sessionIdentity(header) {
	return {
		id: header.id,
		createdAt: header.createdAt,
		...header.cwd === void 0 ? {} : { cwd: header.cwd }
	};
}
/** Refuse a stale row when a Session id is reused for a new lifecycle. */
function sameSession(row, header) {
	return row.session.id === header.id && row.session.createdAt === header.createdAt && row.session.cwd === header.cwd;
}
/** Copy one note before returning it across a tool or Remote boundary. */
function copyNote(note) {
	return {
		key: note.key,
		content: note.content,
		storedAt: note.storedAt
	};
}
/** Copy a durable row before replacing it in the storage domain. */
function copyRow(header, notes) {
	return {
		session: sessionIdentity(header),
		notes: notes.map(copyNote)
	};
}
/** Check a deployment limit at the plugin boundary as well as in Schemastery. */
function resolveLimit(label, value) {
	if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`tool-session-notes: ${label} must be a positive safe integer`);
	return value;
}
/** Count UTF-8 bytes, rather than JavaScript UTF-16 code units. */
function utf8Bytes(value) {
	return Buffer.byteLength(value, "utf8");
}
/** Format one write time for humans and models, without epoch milliseconds. */
function formatStoredAt() {
	return (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}
/** Require a real agent because notes belong to its current Session. */
function requireAgent(exec) {
	if (exec.agent === void 0) throw new Error("session notes require an owning agent session");
	return exec.agent;
}
/**
* Shared Session Notes business service. Both model tools and generated Remote
* methods call these methods, so they cannot drift into separate stores.
*/
var SessionNotesService = class extends TypertRemoteService {
	static inject = ["tools", "storageDomain"];
	static Config = Config;
	maxNoteBytes;
	maxNotesPerSession;
	table;
	operationTails = /* @__PURE__ */ new Map();
	mutationAdmissionOpen = true;
	/**
	* @param ctx - Host context carrying the tool and storage capabilities.
	* @param config - validated note limits.
	*/
	constructor(ctx, config = {
		maxNoteBytes: 8192,
		maxNotesPerSession: 128
	}) {
		super(ctx, "sessionNotes");
		this.maxNoteBytes = resolveLimit("maxNoteBytes", config.maxNoteBytes);
		this.maxNotesPerSession = resolveLimit("maxNotesPerSession", config.maxNotesPerSession);
	}
	/** Open and own the independent durable sidecar. */
	async [Service.init]() {
		const domain = await this.ctx.storageDomain.open(sessionNotesDomainSpec);
		this.table = domain.table("sessions");
		this.ctx.effect(() => async () => {
			this.mutationAdmissionOpen = false;
			await Promise.all(this.operationTails.values());
			await domain.close();
		}, "tool-session-notes.domainClose");
		this.registerTools();
	}
	/** List notes for the owning Agent's current Session. */
	list(agent) {
		const session = agent.session;
		return this.enqueue(session.header.id, async () => ({ notes: (this.currentRow(session)?.notes ?? []).map(copyNote) }));
	}
	/** Save or replace one note for the owning Agent's current Session. */
	write(agent, request) {
		const session = agent.session;
		const key = this.resolveText("key", request.key);
		const content = this.resolveText("content", request.content);
		return this.enqueue(session.header.id, async () => {
			const notes = this.currentRow(session)?.notes ?? [];
			const index = notes.findIndex((note) => note.key === key);
			const existing = index === -1 ? void 0 : notes[index];
			if (existing === void 0 && notes.length >= this.maxNotesPerSession) throw new Error(`session already has the maximum of ${this.maxNotesPerSession} notes`);
			const note = {
				key,
				content,
				storedAt: formatStoredAt()
			};
			const nextNotes = [...notes];
			if (index === -1) nextNotes.push(note);
			else nextNotes[index] = note;
			await this.requireTable().put(session.header.id, copyRow(session.header, nextNotes));
			return {
				note: copyNote(note),
				replaced: existing !== void 0
			};
		});
	}
	/** Delete one note for the owning Agent's current Session. */
	delete(agent, key) {
		const session = agent.session;
		const resolvedKey = this.resolveText("key", key);
		return this.enqueue(session.header.id, async () => {
			const row = this.currentRow(session);
			const index = row?.notes.findIndex((note) => note.key === resolvedKey) ?? -1;
			if (row === void 0 || index === -1) return {
				key: resolvedKey,
				deleted: false
			};
			const nextNotes = row.notes.filter((_note, noteIndex) => noteIndex !== index);
			if (nextNotes.length === 0) await this.requireTable().delete(session.header.id);
			else await this.requireTable().put(session.header.id, copyRow(session.header, nextNotes));
			return {
				key: resolvedKey,
				deleted: true
			};
		});
	}
	/** Register model tools as thin adapters over the shared service methods. */
	registerTools() {
		this.ctx.tools.register(defineTool({
			name: "note_write",
			description: "Save or replace one short note for the current conversation. Use a stable key when updating a note you already saved.",
			parameters: {
				key: {
					type: "string",
					required: true,
					description: "A short stable name for the note."
				},
				content: {
					type: "string",
					required: true,
					description: "The note content to save."
				}
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						note: {
							type: "object",
							required: true,
							additionalProperties: false,
							properties: {
								key: {
									type: "string",
									required: true
								},
								content: {
									type: "string",
									required: true
								},
								storedAt: {
									type: "string",
									required: true
								}
							}
						},
						replaced: {
							type: "boolean",
							required: true
						}
					}
				},
				render: (_args, value) => [{
					type: "text",
					text: `${value.replaced ? "Updated" : "Saved"} note '${value.note.key}'.`
				}]
			},
			execute: (args, exec) => this.write(requireAgent(exec), args),
			presentCall: (args) => ({
				card: "generic",
				title: "Save session note",
				kind: "other",
				rawInput: args
			})
		}));
		this.ctx.tools.register(defineTool({
			name: "note_list",
			description: "List the notes saved for the current conversation. Use this when earlier context needs to be restored.",
			parameters: {},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: { notes: {
						type: "array",
						required: true,
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								key: {
									type: "string",
									required: true
								},
								content: {
									type: "string",
									required: true
								},
								storedAt: {
									type: "string",
									required: true
								}
							}
						}
					} }
				},
				render: (_args, value) => [{
					type: "text",
					text: value.notes.length === 0 ? "No session notes." : value.notes.map((note) => `[${note.storedAt}] ${note.key}: ${note.content}`).join("\n")
				}]
			},
			execute: (_args, exec) => this.list(requireAgent(exec))
		}));
		this.ctx.tools.register(defineTool({
			name: "note_delete",
			description: "Delete one saved note from the current conversation when it is no longer useful.",
			parameters: { key: {
				type: "string",
				required: true,
				description: "The stable key of the note to delete."
			} },
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						key: {
							type: "string",
							required: true
						},
						deleted: {
							type: "boolean",
							required: true
						}
					}
				},
				render: (_args, value) => [{
					type: "text",
					text: value.deleted ? `Deleted note '${value.key}'.` : `Note '${value.key}' was not found.`
				}]
			},
			execute: (args, exec) => this.delete(requireAgent(exec), args.key)
		}));
	}
	/** Validate and normalize a note field once at the shared service boundary. */
	resolveText(label, value) {
		const text = value.trim();
		if (text.length === 0) throw new Error(`note ${label} must contain a non-whitespace character`);
		if (utf8Bytes(text) > this.maxNoteBytes) throw new Error(`note ${label} exceeds ${this.maxNoteBytes} UTF-8 bytes`);
		return text;
	}
	/** Read the current row, hiding a row from an older Session lifecycle. */
	currentRow(session) {
		const row = this.requireTable().get(session.header.id);
		return row !== void 0 && sameSession(row, session.header) ? row : void 0;
	}
	/** Serialize a complete read/modify/write operation for one Session. */
	enqueue(sessionId, operation) {
		if (!this.mutationAdmissionOpen) return Promise.reject(/* @__PURE__ */ new Error("tool-session-notes: service is disposing"));
		const result = (this.operationTails.get(sessionId) ?? Promise.resolve()).then(operation);
		const tail = result.then(() => void 0, () => void 0);
		this.operationTails.set(sessionId, tail);
		return result.finally(() => {
			if (this.operationTails.get(sessionId) === tail) this.operationTails.delete(sessionId);
		});
	}
	/** Resolve the initialized durable table or fail a broken service lifecycle. */
	requireTable() {
		if (this.table === void 0) throw new Error("tool-session-notes: durable domain is not initialized");
		return this.table;
	}
};
//#endregion
//#region src/remote-service.ts
const remoteInitializers = [];
/** Apply one standard Remote decorator without leaving decorator syntax in lib/index.js. */
function installRemote(method, methodName, exportName) {
	Remote(exportName)(method, {
		kind: "method",
		name: methodName,
		static: false,
		private: false,
		access: {
			has: () => true,
			get: () => method
		},
		metadata: void 0,
		addInitializer(initializer) {
			remoteInitializers.push(function() {
				initializer.call(this);
			});
		}
	});
}
/** Host class discovered by the Loader; business state remains in its parent service. */
var SessionNotesRemoteService = class extends SessionNotesService {
	/** Construct the shared service and install its runtime Remote markers. */
	constructor(...args) {
		super(...args);
		for (const initializer of remoteInitializers) initializer.call(this);
	}
	/** Expose listing through the generated sessionNotes/list endpoint. */
	remoteList(agent) {
		return this.list(agent);
	}
	/** Expose writing through the generated sessionNotes/write endpoint. */
	remoteWrite(agent, request) {
		return this.write(agent, request);
	}
	/** Expose deletion through the generated sessionNotes/delete endpoint. */
	remoteDelete(agent, key) {
		return this.delete(agent, key);
	}
};
installRemote(SessionNotesRemoteService.prototype.remoteList, "remoteList", "list");
installRemote(SessionNotesRemoteService.prototype.remoteWrite, "remoteWrite", "write");
installRemote(SessionNotesRemoteService.prototype.remoteDelete, "remoteDelete", "delete");
//#endregion
export { Config, SessionNotesRemoteService, SessionNotesRemoteService as default, SessionNotesService, inject, name };
