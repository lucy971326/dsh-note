# dsh-note

Session-scoped notes for DeepSeek Harness. The plugin provides three model-facing tools and a Web UI:

- `note_write` saves or replaces a note by key.
- `note_list` reads notes for the current Session.
- `note_delete` removes one note.
- The Web UI provides a compact notes control in the conversation composer.

Notes are stored in the independent `session_notes` storage domain. The JSON backend writes that domain to one `session_notes.json` unit file, with Session IDs as record keys; the original Session event log is not modified.

Each note has a stable `key`, its `content`, and one readable `storedAt` time such as `2026-08-16 11:30:00 UTC`. Replacing a note counts as a new storage operation and refreshes `storedAt`; the note does not keep separate creation and update timestamps.

## Install

Install the package into a Web profile:

```powershell
dsh plugin --profile web add github:lucy971326/dsh-note
dsh --profile web --port 3000
```

For local development from a checkout:

```powershell
dsh plugin --profile web add .\dsh-note
```

The package is intentionally independent of the DSH core repository. It contributes its own bundle patch, Host loader entry, generated Typert Remote artifacts, and Web Client bundle without modifying `packages/`.

## Development

```powershell
pnpm install
pnpm build
pnpm test
```

The published package includes the built `lib/` artifacts required by DSH. The Web half is available only in profile installation form, where DSH scans the package's `dsh.client` manifest.
