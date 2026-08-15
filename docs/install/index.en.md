# Install Claudex Workhouse

[Guidebook](../guide.en.md) · [한국어](index.md) · [日本語](index.ja.md)

**Install the main server on a Linux or Linux-based NAS Docker host.** That is
the only released path. **Every Windows target is in development and is not
released** — the portable server, the native Worker, and Docker Desktop plus a
Worker alike. On Windows, run the main server on a Linux host or NAS and reach
it from the browser (PWA).

| Target | Main server | Worker | Recommended path |
|---|---|---|---|
| Synology DSM 7 | Supported | Optional | Docker Compose |
| Linux x64/arm64 | Supported | Supported | Docker Compose or current-user Worker |
| Other Docker NAS | General Docker path | Optional | Docker Compose |
| Windows 11 x64 | **In development** | **In development** | Not released; use the browser |

The [Windows support policy](../windows-support-policy.md) records what is
still outstanding for Windows.

## Installation sequence

1. Choose the device and storage location.
2. Download a release whose manifest and signature have been verified.
3. Run `install.sh` on the NAS/Linux host and open the owner-claim URL.
4. Connect provider runtimes and complete the built-in diagnostics.
5. Open **Settings → Server and execution devices → Main server → External access**.
6. Choose [Tailscale](tailscale.en.md) or [Cloudflare Tunnel and Access](cloudflare.en.md), review the immutable plan, apply it, and run connection tests.

The installer does not request a NAS administrator password, SSH private key,
provider credential, or Docker socket access. Platform-specific privilege work
is displayed as a separate operator action.

## Platform guides

- [Docker](../docker.en.md)
- [Deployment and NAS auto-start](../deployment.en.md)
- [Desktop Worker](../desktop-worker.en.md)
- Detailed Korean guides: [Synology](synology.md), [Linux](linux.md), [Node install (npm)](node.md), [Windows Docker Desktop + Worker](windows.md) (in development), [Windows Worker](windows-worker.md) (in development), [local network](local-network.md)

Release packages are selected by the signed manifest, not by an unpinned
`latest` tag. Installation stops on signature, expiry, or downgrade failure.
See [release verification](../release/verification.md).

Previous: [Introduction](../introduction.en.md) · Next: [Tailscale](tailscale.en.md) or [Cloudflare Tunnel and Access](cloudflare.en.md) · [Guidebook](../guide.en.md)
