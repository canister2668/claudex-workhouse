# Claudex Workhouse

[README](../README.md) · [한국어](introduction.ko.md) · [日本語](introduction.ja.md)

[Guidebook](guide.en.md) · Next: [Installation →](install/index.en.md)

Claudex Workhouse is a self-hosted, mobile-first workbench for operating Codex, Claude, Gemini, DeepSeek, Ollama, and Grok. It is designed for a personal operator who wants one dependable place to start long-running work, follow it remotely, inspect the result, and continue through the provider's supported session path.

## Screenshots

<p align="center">
  <img src="images/home.en.png" width="48%" alt="Claudex Workhouse home dashboard">
  <img src="images/sessions.en.png" width="48%" alt="Claudex Workhouse provider session list">
</p>
<p align="center">
  <img src="images/task-session.en.png" width="48%" alt="Claudex Workhouse active task session">
  <img src="images/settings.en.png" width="48%" alt="Claudex Workhouse display and notification settings">
</p>
<p align="center">
  <img src="images/conversation-tablet.en.png" width="62%" alt="Claudex Workhouse four-provider conversation on a tablet">
  <img src="images/conversation-mobile.en.png" width="30%" alt="Claudex Workhouse four-provider conversation on a phone">
</p>

<p align="center"><sub>Sanitized demo data rendered by the current Claudex Workhouse UI. No operator paths, accounts, credentials, or private session content are included.</sub></p>

## What it provides

- One task and session view for Codex, Claude, Gemini, DeepSeek, Ollama, and Grok, without hiding which provider owns the work.
- A persistent Collaboration Board with implementer and reviewer roles, linked sessions, a durable timeline, manual state changes, and bounded implementation-review-revision automation that still stops for owner approval.
- Live, sequenced progress with reconnect and replay support for long-running jobs.
- Consistent final-output cards for every provider, with changed-file and artifact context, plus explicit recovery of bounded earlier Claude transcript turns.
- Safe workspace, changed-file, Git, log, and terminal-result inspection from the browser.
- Explicit resume, follow-up, fork, stop, archive, and handoff flows where the provider supports them.
- A guided multi-provider conversation mode that preserves multiple emotion scenes, accepts user input, and can produce a Markdown conclusion.
- Responsive desktop, tablet, and mobile layouts with installable PWA behavior.
- Outbound-only Desktop Workers for mapping one logical project to workspaces on multiple machines.
- A built-in Emotion MCP and bundled artwork, with no separate emotion service required.
- Role-scoped external HTTP MCP settings for supported providers, with HTTPS enforcement, write-only secrets, and an explicit read-only operator attestation.

## Why I built it

The starting point was simple: checking Codex and Claude Code work from a phone by zooming and panning around the VS Code interface was far too uncomfortable. I wanted the work to run on a NAS or PC while a dedicated mobile interface made it easy to follow progress and review the result. The official AI apps I was using also made it difficult to connect my MCP-based emotion images and character expressions to the working flow.

I am not a professional developer, and before building this I barely knew any Linux commands. I did not set out to design a multi-provider orchestration platform; I removed the obstacles I hit while actually using the thing, one at a time. Mobile task management, long-running sessions, reconnect and recovery, file and Git inspection, cross-provider review and handoff, connections to several execution hosts, and conversation mode were all added that way, as each need appeared.

Only after creating the basic task and session management framework did I discover that tools with similar goals already existed. At first, I wondered whether continuing a separate project was worthwhile.

This project does not claim to pioneer a new field or to be better than existing tools. I am publishing the tool I actually use so that people with similar needs have one more option.

<details>
<summary>How I first put a working environment together</summary>

Before Workhouse, the path that got me to Claude Code and Codex looked roughly like this:

- SSH into a Synology NAS.
- Ask web Claude how to install the CLI, one step at a time, and paste the commands it gave me into the terminal.
- When a command failed, show the error back to web Claude and get the next command — which is how the Claude Code CLI eventually got installed.
- Set up a VS Code Tunnel so I could work from outside, and use Claude Code inside VS Code.
- Install the Codex CLI afterwards. A VS Code configuration problem kept Codex sessions from being created, so for a while I worked around it by having Claude Code start background Codex sessions to review the work.
- On mobile, VS Code text was too small to read, so I screenshotted the screen and asked web Claude or GPT to read it back to me.

In short: `NAS SSH → ask a web AI for commands → install the CLI → VS Code Tunnel → Claude Code/Codex → work around session problems → read screenshots on mobile`. Removing the friction in that path, step by step, is what produced the current feature list.

</details>

## Why provider connection comes first

For a beginner, the biggest early barrier is not Linux, Docker, or Git knowledge itself — it is reaching the state where the AI can actually touch workspace files and run commands. I could build Workhouse not because I learned the commands myself, but because once Claude Code and Codex had access to a real working environment, I could hand work over in plain language: "build this feature", "find the cause of this error and fix it", "have Codex review what Claude implemented".

So the goal of the installation experience is not to teach every piece of system administration through a UI, but to get the user in front of a working Claude Code or Codex as quickly as possible. The intended flow is `install Workhouse → check provider readiness → install or detect Claude Code/Codex → official sign-in → choose a workspace → first successful natural-language task`. That is the direction the current installation work is heading, not a finished state.

For the parts whose complexity varies most by environment — remote access, Cloudflare, Tailscale, Docker details — providing diagnosis and guidance, and letting the user ask the already-connected Claude or Codex for help in plain language, seems more realistic than trying to automate everything. Non-developers may well be able to operate an AI working environment this way, but no claim is made that every environment problem disappears. For the actual procedure, see [Installation](install/index.en.md).

## Provider-native by design

Claudex Workhouse does not merge its six Providers into an anonymous generic agent. Provider identity, model and permission choices, task ownership, and resumable session IDs stay visible. Gemini uses the Antigravity agent, the Vertex Direct response engine, or Vertex Agent (the official Gemini CLI on the same Vertex project); DeepSeek, Ollama, and Grok use their configured runtimes or endpoints. Existing external sessions remain externally owned until the operator explicitly creates a Workhouse-controlled continuation through the provider's supported path.

The web service is also separate from active provider workers. Restarting the Workhouse UI and supervisor is designed not to terminate Codex or Claude jobs that are already running.

## Personal, self-hosted operation

The project is intended for a trusted personal deployment rather than a multi-user SaaS control plane. Projects are selected from a server-side allowlist, workspace paths are validated on the host, and remote publication can be placed behind Cloudflare Access. The service uses a local SQLite database and can run directly on a NAS or another Node.js host.

Authentication remains specific to each execution backend. Codex and Claude use their official runtimes, Gemini uses an Antigravity Google session or Vertex service account, and DeepSeek, Ollama, and Grok use operator-configured runtimes, endpoints, and secrets where required. A one-time Claude authorization code may pass through the local server only to reach the CLI and is not persisted. One installation must not be shared by several people to use one provider account. See [Provider authentication](provider-authentication.en.md).

## Multi-user support

Claudex Workhouse is a single-user tool for a trusted personal environment.

A multi-user environment would need to securely isolate projects, workspaces, provider accounts, execution permissions, Workers, credentials, and session history for each user. The current architecture does not provide those security boundaries, so team and organizational use is not supported.

Adding a simple login screen and sharing one installation among several users would not be safe. Multi-user support is not currently within the project's scope.

For installation and operations, continue with:

- [Deployment](deployment.en.md)
- [Docker installation](docker.en.md)
- [Desktop Worker installation](desktop-worker.en.md)
- [Multi-host architecture](multi-host.en.md)
- [Security model](security.en.md)
- [Provider authentication](provider-authentication.en.md)
- [Testing](testing.en.md)
- [Known limitations](known-limitations.en.md)

## License

Claudex Workhouse is licensed under `AGPL-3.0-only`. See the [English license guide](license.en.md), the authoritative [LICENSE](../LICENSE), and [NOTICE.md](../NOTICE.md).
