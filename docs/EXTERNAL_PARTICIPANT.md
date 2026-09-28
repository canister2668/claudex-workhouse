# External participant bridge

This private bridge lets a ChatGPT plugin or another external model work on a
registered **local** Workhouse workspace, or several registered workspaces through
a virtual collaboration folder, without a browser extension or an idle
model watcher. The server answers requests only when the participant calls a
tool. It does not start provider sessions, edit Cloudflare/nginx, or grant shell
access.

## Current connection boundary

The owner must first have ChatGPT Plugins access and a usable Secure MCP Tunnel.
Seeing **Developer mode** alone does not establish Tunnel access. The owner also
needs a Platform `tunnel_id`, tunnel permissions, and a runtime API key. Do not
configure a tunnel or put credentials in this repository until those are
available. The official setup is
[Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
and [Connect and test a plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt).

When access is available, the tunnel's stdio MCP command should run
`node bin/openai-participant-mcp.mjs /absolute/path/to/participant-token-file`.
The wrapper accepts only an owner-owned regular token file with mode `0600`,
passes only the participant token and loopback origin to the MCP child, and
does not pass the tunnel's Platform API key to that child. Keep the token file
outside Git; never put its contents in a command line, plugin description,
prompt, URL, or tunnel metadata. The MCP child calls only the local Workhouse
HTTP origin (`http://127.0.0.1:3410`).

On this NAS, the official Linux amd64 `tunnel-client` binary and a profile for
`tunnel_6ab48df576e481918299ce2b6c4ae9df` are under
`runtime/openai-tunnel-client/`. The profile uses two separate owner-only files
under `secrets/openai-participant/`: `tunnel-runtime.key` for the Platform
runtime API key, and `participant.token` for the Workhouse grant. Neither file
exists until the owner provisions it. The Workhouse Infrastructure screen has
an External model collaboration folder panel that creates a scoped grant,
stores its token in the private file, and accepts a masked Platform runtime
API key. The management API also exposes `GET
/api/external-participants/tunnel-status` and authenticated `PUT` routes for
`tunnel-key` and `tunnel-token`; those routes never return stored secrets.
Once both files exist, run the client's
`doctor --profile workhouse-participant --profile-dir
<installation root>/runtime/openai-tunnel-client/profiles --explain`
before starting its managed runtime. A prepared profile is not a live tunnel.

## Owner grant

The authenticated owner API manages grants:

- `GET /api/external-participants/grants` lists grant metadata without secrets.
- `POST /api/external-participants/grants` accepts `workspaceId`, `readPaths`,
  `writePaths`, optional `mounts`, and optional ISO `expiresAt`. It returns the
  token **once**.
- `POST /api/external-participants/grants/:id/revoke` revokes a grant.

For a virtual collaboration folder, each mount has an `alias`, a registered
local `workspaceId`, an optional workspace-relative `rootPath`, and its own
`readPaths` and `writePaths` relative to that root. For example, `risu/docs`
can be a read-only documentation mount while `shared/outbox` can be writable.
`list_files` with directory `.` discovers the aliases. A `.` scope explicitly
allows the whole selected mount root; prefer narrower paths for source trees.
Write paths must lie within read paths. The grant's top-level `workspaceId`
remains the collaboration-board scope, not blanket access to that workspace.
Legacy single-workspace grants retain their original paths. Use one grant per
external participant and revoke it when no longer needed. This bridge does
not register RisuAI or NAI workspaces, infer their live storage locations, or
silently grant access to files outside an explicitly selected mount.
On this NAS, `data/collaboration/inbox` and `data/collaboration/outbox` are
prepared as an owner-only staging area. The Infrastructure form suggests
read-only documentation mounts for the registered Workhouse, RisuAI, and NAI
Studio workspaces plus a `shared` mount whose `outbox` is writable. These are
suggestions only: the owner must review and create the grant before an external
participant receives any access. No live database or generation queue is mounted.

The participant can list assigned collaboration-board cards, list an allowed
directory, read UTF-8 files up to 256 KiB, create new Markdown/HTML, and edit
existing text using an expected SHA-256 revision. A mismatch returns conflict
without overwriting the newer content. It can attach a note, review, or handoff
to a board card; these reports are events, not automatic commands to another
model. The owner remains responsible for approving or starting subsequent work.

The bearer token is a high-entropy secret stored server-side as a hash. The
bridge denies `.git`, symlink traversal in file reads and edits, and common
credential filenames. It records grant and file/report activity in the audit
log. It does not interpret the contents of a document as instructions from the
owner. Review any external model's proposed changes before publishing or
running them.

The stdio tunnel profile uses one owner grant, not per-ChatGPT-user OAuth.
Do not share this private developer-mode connection with an untrusted ChatGPT
workspace member. Mounts do not expose live RisuAI or NAI database APIs;
changes to those systems still require their own controlled deployment path.

## Validation and deployment

Run `pnpm check`, `pnpm test`, and `pnpm build` from `app/`. Follow
`docs/WORKSPACE_RUNBOOK.md` before restarting the service; check active tasks
first. Validate the bearer-token denial, scoped read/write, stale-revision
conflict, and MCP discovery/calls locally before pairing ChatGPT. A healthy
Workhouse endpoint does not prove ChatGPT is connected.
