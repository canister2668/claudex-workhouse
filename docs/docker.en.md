# Docker installation

[English](docker.en.md) · [한국어](docker.ko.md) · [日本語](docker.ja.md)

For the main server, a Linux or Linux-based NAS Docker host is recommended.
The Windows instructions below are an alternative for operators who cannot use
a Linux host.

On Windows 11 x64, the default path combines a Docker Desktop main server with
a current-user Windows Worker. Use **Windows + Docker Desktop** on the installer
page to obtain a PowerShell bootstrap bound to the signed manifest and exact
image digest. The container runs the web UI and database; the Worker retains
the Windows user's Claude Code and Codex logins plus local Workspace access.
See the [detailed Windows guide](install/windows.md).

1. Copy `.env.example` to `.env` and configure the external URL.
2. Start the service with `docker compose up -d --build`.
3. For security, the default port binds only to `127.0.0.1`, and `local` authentication works only for a loopback origin. Before publishing externally, configure Cloudflare Access and switch to `cloudflare` mode.
4. Do not place Claude Code or Codex runtimes in the image together with credentials. Put official installations in the `claudex-workhouse-runtime` volume or connect a Desktop Worker.

The container runs as UID/GID 10001, with no capabilities and with `no-new-privileges`. Provider authentication is separate for each execution host and is never copied to another host.

Configuration, database, runtime, and workspace data are retained in separate named volumes. Container startup applies `umask 077`, so configuration, Push keys, SQLite, and WAL files are created with mode `0600`. The default Compose port is exposed only on loopback, and `local` authentication permits only a loopback origin. Before exposing the service to a LAN or the internet, configure `CLAUDEX_WORKHOUSE_EXTERNAL_ORIGIN` and Cloudflare Access, or another verified reverse-proxy authentication layer.

The release workflow builds amd64 and arm64 images and publishes OCI provenance, an SBOM, and the image digest. Use `docker compose build` for a local build, then verify startup with `docker compose up -d` and `/api/health/live`.
