# Claudex Workhouse guidebook

[README](../README.md) · [한국어](guide.ko.md) · [日本語](guide.ja.md)

Follow the pages in order. Platform-specific pages are branches that return to
this main route.

1. [Introduction](introduction.en.md) — understand the product and personal-operator boundary.
2. [Installation](install/index.en.md) — consider the recommended Linux/NAS Docker host first and complete first start.
3. Choose external access: [Tailscale](install/tailscale.en.md) or [Cloudflare Tunnel and Access](install/cloudflare.en.md).
4. [Connectivity troubleshooting](install/connectivity-troubleshooting.en.md) — verify health, DNS, TLS, authentication, and streaming.
5. [Provider authentication](provider-authentication.en.md) — connect Codex, Claude, Gemini, DeepSeek, Ollama, and Grok safely.
6. [Security](security.en.md) — review trust boundaries, secrets, and remote-access assumptions.
7. [Manage durable work](#manage-durable-work) — coordinate implementation, review, revision, and approval on the Collaboration Board.
8. [Create tasks and move files](#create-tasks-and-move-files) — use the redesigned task panel and Proton Drive safely.
9. [Deployment and operations](deployment.en.md) — build, start, restart, update, and recover the service.
10. [Testing](testing.en.md) — run checks and browser verification.
11. [Known limitations](known-limitations.en.md) — understand what remains manual or unsupported.
12. [License](license.en.md) — licensing and corresponding-source information.

## Manage durable work

The **Collaboration Board** keeps a work item separate from any one provider session. Create a card, choose its Workspace and target branch, assign implementer and reviewer roles, and either start new sessions or attach existing ones. The card keeps its state, linked sessions, and timeline across restarts. Manual controls cover implementation, review, revision, resume, completion, reopen, and archive.

Optional board automation advances only through the configured implementation and review stages. It can pause after a stage, stop when a reviewer requests changes, and always leaves final approval to the owner. A completed provider session or a model's wording never marks the board card approved by itself.

Task detail uses a shared final-output card across providers. Claude transcript pages initially load a bounded recent window and explicitly offer earlier turns when more history is available, so a truncated initial view is visible rather than silent.

## Create tasks and move files

The new-task panel has three tabs: **Single**, **Review**, and **Conversation**.
Read each label above its control, then check the filled summary blocks before
starting. Review and Conversation show each selected participant on an accent
rail. Full-access choices also show a hazard banner; treat that banner as the
final warning that the task can make changes that are difficult to undo. In a
Conversation, open each participant's sheet to keep that participant's global
tone or choose a tone for this session only. A session-only choice does not
change the global preset.

Proton Drive is configured once in global settings. Enable it, sign in through
the official CLI, and set a remote root; browsing, imports, and uploads stay
below that root.

- To attach a file already in Drive, open **Attach from Proton Drive** beside
  the task prompt, browse the configured root, and pick the file. Listing a
  filename or path in the prompt cannot start a download: only that explicit
  pick calls `GET /api/proton-drive/inbox` and then
  `POST /api/proton-drive/imports`. The server downloads directly into its
  attachment storage, rather than receiving browser multipart data, so the
  90 MiB total browser upload limit does not apply (a 60,379,017-byte file has been
  verified). The file is attached only after its downloaded size and SHA-1
  match Proton's metadata.
- Remote paths are resolved to the spelling Proton actually stores. Letter-case
  or Unicode-composition differences in the requested path can therefore match
  the stored entry. If two entries differ only by letter case, Workhouse
  reports the ambiguity and refuses to guess.
- To send a completed local task artifact to Drive, choose **Upload to Proton**
  on the completed task, select a regular Workspace-relative file, and prepare
  the review. Check the displayed source path, size, SHA-256, and destination,
  then explicitly confirm the upload. Task completion never uploads by itself,
  and this integration does not create a public share link.

## Platform branches

- [Docker](docker.en.md)
- [Desktop Worker](desktop-worker.en.md)
- [Multi-host architecture](multi-host.en.md)
- Detailed Korean operator notes: [Synology](install/synology.md), [Linux](install/linux.md), [Windows Docker Desktop + Worker](install/windows.md), [Windows Worker](install/windows-worker.md), and [local network](install/local-network.md)

Next: [Introduction →](introduction.en.md)
