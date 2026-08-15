# Claudex Workhouse Desktop Worker

[English](desktop-worker.en.md) · [한국어](desktop-worker.ko.md) · [日本語](desktop-worker.ja.md)

The Worker requires Node.js 20 or newer and supports Windows x64, Linux x64/arm64 and macOS arm64 as a platform-neutral package. It runs as the current desktop user and opens only an outbound WSS connection.

## Windows portable UI (in development, not released)

> The Windows Worker is not released. Hook execution, Codex CLI installation
> and live session progress are not yet reliable, so what follows is a
> development reference. See the
> [Windows support policy](windows-support-policy.md).

Build the portable folder and ZIP on the Claudex Workhouse server:

```sh
cd app
pnpm run worker:portable
```

The output is `packages/claudex-workhouse-worker-windows-portable.zip`. Extract it on the desktop and double-click `Start Claudex Workhouse Worker.vbs`. No pairing command needs to be typed. The local setup screen provides:

- Claudex Workhouse URL and one-time pairing code entry
- native folder selection for Workspace Roots
- connection and auto-start state
- provider/runtime diagnostics
- disconnect and local configuration controls

The management screen binds to a random `127.0.0.1` port, requires an in-memory 256-bit token, sends `no-store` responses, and does not expose the Worker credential. The Worker connection itself remains outbound-only.

The portable ZIP expects Node.js 20 or newer on the desktop. To make a self-contained internal ZIP, point `CLAUDEX_WORKHOUSE_WINDOWS_NODE_EXE` at a trusted official Windows `node.exe` while packaging; it will be placed beside the launcher. Code signing remains a separate release step.

## CLI install and pair (advanced)

Build the package on the Claudex Workhouse server:

```sh
cd app
pnpm run worker:pack
```

Install the resulting archive on the desktop. In Claudex Workhouse, open Global Settings → Execution Hosts → New desktop. Then run the displayed command:

```sh
claudex-workhouse-worker pair --url https://agent.example.com --code ABCD-EFGH-IJKL --name Desktop-PC
```

After a global npm installation, `claudex-workhouse-worker-ui` opens the same no-terminal setup screen.

If Cloudflare Access also gates `/worker/*`, set a dedicated service token in the Worker process environment with `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`. These headers only pass the edge gate. Worker identity is still the challenge-authenticated Worker credential.

## Roots and provider login

Add a deliberately narrow project root locally. Do not register a drive root or the entire home directory.

```sh
claudex-workhouse-worker roots add "D:\Projects" --name Projects
claudex-workhouse-worker roots list
```

Disk deletion remains disabled. A local operator must explicitly opt a Root into it with `--allow-delete`; the web UI still requires a second typed confirmation and refuses deletion while a task is active or unconfirmed.

Log in with the official tools as the same OS user that runs Worker:

```sh
claude auth login
codex login
```

Claudex Workhouse reads only official status output/App Server account state. It never reads or uploads credential files.

The current Worker package reports per-host authentication state, but starts login through the official CLI on the desktop itself. The NAS provider-login PTY/device-code bridge has not been generalized to remote Workers; public packages must not imply that the NAS connection button logs a remote host in.

## Run and service install

Use `claudex-workhouse-worker run` in the foreground or `claudex-workhouse-worker install-service` for current-user auto-start. Windows uses a current-user logon task, Linux a `systemd --user` service, and macOS a user LaunchAgent. Root service installation is rejected on Unix.

## Diagnose, disconnect and remove

```sh
claudex-workhouse-worker status
claudex-workhouse-worker diagnose
claudex-workhouse-worker unpair
claudex-workhouse-worker uninstall-service
```

`unpair` leaves projects intact. Revoke the host in Claudex Workhouse as well. For full removal, stop/uninstall the service, revoke the host, remove the package, then delete `~/.claudex-workhouse-worker` only after confirming no Worker-owned task is alive.

Diagnostic output excludes credentials, provider tokens, emails, full environment variables and URL queries. Root paths are reduced to display names/basenames in copied diagnostics.
