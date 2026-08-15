# Multi-host execution architecture

[English](multi-host.en.md) · [한국어](multi-host.ko.md) · [日本語](multi-host.ja.md)

Claudex Workhouse treats the NAS as the immutable `local` execution host and each paired computer as a `worker` host. A Project is a logical name; a Workspace is one verified directory for that Project on one host. A provider session is always attributed to a provider, host and Workspace. Missing `executionHostId`/`workspaceId` in an older request resolves to the legacy NAS mapping.

## Trust boundaries

- Browser mutations continue to require Cloudflare Access, same-origin, `X-Claudex-Workhouse-Request: 1`, a UUID idempotency key and rate limits.
- `/worker/*` does not use browser cookies or a Cloudflare user identity. Pairing uses a 10-minute one-time code. Connected Workers authenticate a random challenge with a key derived from their 256-bit credential.
- The server stores only the credential-derived hash. The Worker stores the original credential in its OS-user config with mode `0600` (and a current-user ACL on Windows).
- Cloudflare service-token headers may be supplied by Worker environment variables only as a transport gate. They are not accepted as Worker identity.
- The protocol accepts a fixed typed command list. There is no shell, executable or argv RPC. Prompts and Markdown are passed only as provider input or files and are never interpreted by a shell.
- Every message carries a connection generation and increasing sequence. A newer authenticated connection replaces the older generation. Messages are limited to 1 MiB.

## Workspace boundary

Local roots come from `workspaceRoots` in `config/claudex-workhouse.json`. If absent, Claudex Workhouse creates `workspaces/` under its install root. Legacy projects outside those roots receive an exact-path, registration-only root; their broad parent directory is not implicitly trusted.

Worker roots can only be added from the local Worker CLI. The web UI can select existing roots, not submit a new absolute root. Directory browsing returns HMAC-signed entry IDs. Registration and creation re-check lexical containment and `realpath`; symlinks are not traversed. Windows Workers use the same real-path containment model and reject reserved names; junction/reparse-point validation must still be exercised on a real Windows test host before release.

Git clone permits HTTPS or host-configured SSH only, forces `protocol.file.allow=never` and `protocol.ext.allow=never`, uses `shell:false`, and never accepts extra Git arguments. Failed clones only remove an empty directory created for that clone.

## Remote task convergence

The Worker starts the same compiled Claude and Codex worker runners used locally. Task state and an 8 MiB/24-hour NDJSON event spool live under the Worker OS user. On disconnect the server exposes the host as offline and keeps active tasks as `unknown` with their last known state; it does not mark them failed. After challenge authentication, the Worker sends an authoritative snapshot and replays unsent event IDs. The server rejects stale connection generations and de-duplicates recently seen event IDs.

Owned processes are recorded with a marker and platform process identity. Linux verifies PID, start time, executable, command line and process group. macOS verifies PID, start time and the owned marker. Windows verifies PID, CIM creation time, executable and command marker before allowing a process-tree stop. External CLI/VS Code processes are listed but are never stopped by Worker commands.

## Handoff and WorkChain

Handoff never moves process memory or a provider session ID. It creates a new target session and stores a `SessionLink` inside a `WorkChain`.

Artifacts are stored per project in `data/handoffs/<project>/<artifact>/` with directory mode `0700` and file mode `0600`: deterministic `handoff.md`, non-executable `manifest.json` with checksums, and an optional `git diff --binary` patch capped at 8 MiB.

Remote patch generation and delivery use typed, checksum-verified 512 KiB chunks so no Worker message exceeds the 1 MiB protocol limit. A Worker can only read a patch it just generated for a registered Workspace; this is not a generic file-download RPC.

The patch is never applied automatically. Secret-like filenames stop patch creation. Target validation compares Project, host availability, Git remote, commit, dirty state and active Workspace leases. Commit mismatch does not trigger checkout, pull or branch changes. Continue handoffs release the source write lease and acquire a target write lease; reviews acquire a read lease. Artifacts expire after seven days. Artifact content and patch bytes are not copied into audit records.

## Operational disclosures

- Provider authentication is separate on every execution host; Claudex Workhouse never copies provider credentials between hosts.
- Multiple web viewers still share the provider accounts of each host OS user. This is not multi-tenant isolation.
- If a Worker is offline, Claudex Workhouse cannot confirm the current task state or stop outcome.
- “Unregister Workspace” removes the database mapping and leaves files intact.
- Disk deletion is a separate operation, disabled per Root by default, blocked by active/unknown tasks, and requires the Workspace name to be typed again.
- A cross-provider review sends the selected handoff material and relevant code context to the other provider.
- Remote provider status is available in host diagnostics. Provider login can always be performed with the official CLI on that host; remote login bridging should not be enabled on an unverified Worker platform.
