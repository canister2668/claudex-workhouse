# External participant bridge

This private bridge lets a ChatGPT plugin or another external model work on a
registered **local** Workhouse workspace, or several registered workspaces through
a virtual collaboration folder, without a browser extension or an idle
model watcher. The server answers requests only when the participant calls a
tool. File-only grants do not start provider sessions. An optional, separate
execution grant can submit actual Workhouse provider tasks; it does not expose
an arbitrary-shell tool or edit Cloudflare/nginx.

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
  `writePaths`, optional `mounts`, optional `execution`, and optional ISO
  `expiresAt`. It returns the token **once**.
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
model. With a file-only grant, the owner starts subsequent work separately.

## Actual execution from dot

The existing private connection can also submit implementation and test work.
In **Settings → External participants**, select the Board Workspace and enable
**Allow dot or another external model to submit execution tasks** before creating
the grant. Choose Codex or Claude Code and either file/command execution (`auto`)
or read/review (`read`). This is permission to execute in the **whole selected
workspace**, independently of the narrower file mounts. It does not grant
execution in other mounted workspaces. Existing grants remain file-only; create
a new grant explicitly rather than silently upgrading one.

The owner API's optional `execution` object is:

```json
{"provider":"codex","automationLevel":"auto","maxActiveTasks":1}
```

The provider uses the owner's global delegation model, reasoning, and Codex
service-tier settings. The participant cannot choose a model, change provider,
change workspace, request full access, or bypass existing paid-credit gates.
Revocation prevents further API access and new turns; already running provider
tasks remain running and must be managed in Workhouse if they need to stop.

The additional MCP tools are:

| Tool | Behavior |
| --- | --- |
| `get_capabilities` | Read workspace and optional execution grant |
| `create_task` | Submit a prompt/title and UUID idempotency key |
| `list_tasks` | List up to 50 recent tasks created by this grant |
| `get_task` | Refresh status and read a bounded, redacted result |
| `resume_task` | Submit a follow-up to a terminal task with a confirmed thread |

The corresponding bearer-authenticated routes are `GET capabilities`,
`GET/POST tasks`, `GET tasks/:taskId`, and `POST tasks/:taskId/messages` under
`/external-participants/v1/`. Creation and follow-up bodies contain an
`idempotencyKey` UUID. Task results expose task/thread/provider/workspace identity,
status, model, timestamps, and up to 60,000 result characters, but never internal
metadata, capabilities, or raw execution logs. These are provider reports;
the bridge does not independently certify every reported test or deployment.

Keep the original request key on retries. A key/body mismatch is a conflict.
An unresolved submission is never automatically repeated or taken over after a
timeout: inspect `list_tasks` and Workhouse before submitting anything new.
The existing database idempotency retention policy still applies. The default
limit is one active task per grant (owner API supports one through four), and
follow-ups reject running tasks or changed workspace/access identity. A provider
execution request uses Workhouse's existing task, worker, workspace instruction,
model validation, and thread-turn gate paths; no detached CLI session is created.

Suggested dot instruction:

> Use the connected Workhouse MCP. Check get_capabilities, then submit my task
> with create_task. Keep the returned task ID and original request UUID. While
> work is active, use get_task to check progress; do not create a replacement.
> Read the terminal result, distinguish changes, tests and deployment, and use
> resume_task only when further work is within my request. Report blockers and
> unresolved submissions instead of claiming completion.

This remains a separately connected MCP server. Installing or updating a
skills-only plugin does not register a tunnel or authorize execution. A dot's
local-computer access is another supported execution surface, but is not
required by this bridge. Account rollout, app connection, and a real dot-side
tool invocation must be verified separately; local MCP tests do not prove them.

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
