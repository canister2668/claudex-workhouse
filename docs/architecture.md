# Architecture

```text
PWA browser
  -> Cloudflare Access (exact email policy)
  -> remotely managed Cloudflare Tunnel
  -> 127.0.0.1:3410 Fastify server
       -> CodexProvider -> Codex app-server (thread metadata/transcript/lifecycle)
                        -> /usr/local/bin/cx (existing job status/targeted stop)
                        -> detached Claudex Workhouse Codex workers (new/resume turns)
       -> ClaudeProvider -> detached Claudex Workhouse worker -> Claude CLI
       -> Python NDJSON worker -> SQLite WAL
```

The Fastify API and Svelte 5 static app share one loopback listener. Polling refreshes list metadata; owned active-task details use authenticated SSE. Agent output is rendered as text, never injected as HTML.

Detached Codex and Claude workers own their provider output connection and append sanitized, sequenced events to `data/stream-events/<task-hash>.ndjson`. Files are mode 0600 under a mode 0700 directory, rotate at 8 MiB, and expire after 24 hours. Fastify tails these bounded spools, supports `Last-Event-ID` replay, emits a resync instruction when the retained window is exceeded, and never stores the stream in SQLite. Confirmed transcripts remain provider-owned source of truth.

`AgentProvider` defines list, create, detail, message, fork, stop, and health boundaries. Provider-specific states map to `pending`, `queued`, `running`, `waiting`, `completed`, `failed`, `stopped`, or `unknown`.

Codex native session state remains authoritative in app-server and existing cx job state remains authoritative in cx. Claudex Workhouse stores a rebuildable metadata index, provenance, requested settings, and worker state, but never copies complete transcripts or writes the native Codex database. A thread ID is the session merge key; a cx job ID is a secondary execution key. Threadless cancelled jobs remain separate cards.

App-server list pages are at most 100 threads and browser cursors are short-lived server-side tokens. Transcript pages use experimental `thread/turns/list`; `thread/items/list` is not used because Codex 0.144.1 reports it unsupported. Search uses experimental `thread/search` with a bounded Claudex Workhouse metadata fallback. Experimental feature failure does not disable cx or Claude.

Ownership and source are independent. Ownership is `claudex-workhouse`, `external-cx`, `external`, or `unknown`; source preserves Claudex Workhouse, cx, CLI, VS Code, exec, app-server, or unknown provenance. Prefixes and app-server source alone never prove ownership.

The Python worker exposes a fixed NDJSON operation set. It is not an arbitrary SQL endpoint. Claudex Workhouse stores UI metadata, requests/results, process identity, audit records, and idempotency responses; it does not write either provider's native database.

## Agent events and built-in Emotion MCP

`AgentEvent` is the provider-to-UI compatibility boundary. Codex JSON-RPC notifications and owned Claude `stream-json` records are normalized to task, turn, message, command, file, tool, approval, compaction, terminal, MCP, or unknown events. Unknown provider notifications remain safe text events.

Claudex Workhouse owns a loopback-only Streamable HTTP Emotion MCP at `/mcp` for Claude and `/mcp/codex` for Codex. The tools are `express_emotion`, `set_emotion`, `set_outfit`, `get_emotion`, and `list_emotions`. Runtime state lives under `data/emotion`; artwork is bundled under `app/public/emoticons` and served from the Claudex Workhouse origin. No separate MCP process, checkout, container, asset host, or state directory is required.

The web client receives a server-generated asset catalog and constructs only same-origin, encoded outfit/file URLs. The browser never accepts an asset filesystem path, MCP server address, or arbitrary MCP registration. Casual collaboration scenes use validated provider-authored `[[e:...]]` markers and the same bundled allowlisted catalog; they do not execute MCP output or infer a tool call from ordinary assistant text.

Emotion remains an optional presentation layer. MCP failure, malformed output, or a missing image must not block task list, create, detail, resume, fork, stop, provider health, or the independent provider runtime. MCP-shaped task events continue to render as sanitized generic tool cards; only validated emotion state and catalog entries drive the avatar.
