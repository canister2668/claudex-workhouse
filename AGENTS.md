# Claudex Workhouse agent instructions

This file is read first by coding agents (Claude Code, Codex, and others) that
open this repository. Read the section that matches what you were asked to do.

## If you were asked to install Claudex Workhouse

The repository is the source tree, not the installer. Packaged installation —
the Windows single EXE and the Linux/NAS Docker quick-start bundle — is
described in `docs/install/index.md` and is the path an operator should prefer.
Only install from this checkout when the operator asked for exactly that.

Installing from this checkout, in order:

1. Confirm the host has Docker Engine and Docker Compose v2. If it does not,
   stop and tell the operator; do not install a container runtime on their
   machine without asking.
2. Build and start from the repository root:

   ```sh
   docker compose up -d --build
   ```

   The `--build` is required. `docker-compose.yml` names a placeholder image
   reference, so `docker compose up -d` on its own fails with a pull error
   rather than starting anything.

3. Wait for readiness and confirm it:

   ```sh
   curl -fsS http://127.0.0.1:3410/api/health/ready
   ```

4. Open `http://127.0.0.1:3410` and complete administrator registration, then
   the in-app first-run setup.

`docker-compose.yml` is the development configuration and publishes the port to
loopback only, so the server is not reachable from a phone or another machine on
the LAN. Tell the operator this explicitly instead of reporting a finished
mobile install. Changing the published binding, the external origin, and the
remote-access method (LAN, Tailscale, or Cloudflare) is an operator decision —
see `docs/install/local-network.md`, `docs/install/tailscale.md`, and
`docs/install/cloudflare.md`.

Running from Node instead of Docker needs Node 22, pnpm (the version pinned by
`app/package.json`), and `python3`, and it needs configuration that this
repository does not contain: `config/claudex-workhouse.json` and
`config/projects.json` are ignored by Git, and only the container entrypoint
(`bin/container-init.mjs`) generates them. Without them the server exits while
loading its configuration. Copy `config/*.example.json` to the real names and
edit them before starting. The Docker path avoids all of this.

The last steps are deliberately not automatable from a terminal:

- Installing and signing in to a provider CLI (Claude Code, Codex, and the
  others) happens through the in-app setup flow and each provider's own
  official login. Never ask the operator for provider credentials, and never
  read, copy, or relocate provider credential files.
- Registering a workspace folder and running the first read-only task happens
  in the web UI.

Report exactly which of these steps you completed and which the operator still
has to do. "The container is healthy" is not "the install works".

## If you were asked to change the code

- Before build, deployment, restart, database, or live-environment work, read
  `docs/WORKSPACE_RUNBOOK.md` and verify its commands against the current tree.
- Preserve unrelated dirty-worktree changes and keep edits narrowly scoped.
- Never put secrets in prompts, task metadata, logs, commits, or documentation.
- Do not change reverse proxies, tunnels, access control, external ports, or
  container infrastructure unless the operator explicitly places that resource
  in scope.
- Commit, push, tag, publish, and release are separate actions, and each one
  requires explicit authorization.

Build and test:

```sh
cd app
pnpm install
pnpm check
pnpm test
pnpm build
```

## Definition of done

- Documentation-, comment-, and test-only changes do not require a restart.
- For runtime-affecting server, web, worker, route, migration, or configuration
  changes, follow the runbook's ordered build, restart, and verification chain.
- Restart only after the intended build succeeds and the operator has not
  prohibited a restart. Consider other running work before interrupting the
  web/SSE control plane.
- If restart or live verification is unsafe, unauthorized, blocked, or skipped,
  do not claim deployment completion. Report `restart pending` or
  `live verification pending` with the concrete reason.
- Health endpoints prove liveness and readiness, not the changed behavior.
  Verify the affected behavior directly and report which checks you ran.

## Safety

- Back up live SQLite state before schema migrations, direct database edits, or
  destructive fixtures, and verify the backup before mutating anything.
- A server restart must leave provider workers and their native sessions
  untouched. Do not stop them as part of a routine deployment.
- One installation is a single-operator personal deployment. Do not set it up as
  a shared service through which several people use one provider account.
