# File Manifest

## Existing files changed

- `$HOME/.local/share/codex-mobile/cx.mjs`
- `$HOME/.local/share/codex-mobile/README.md`

Both pre-change versions are in the canonical backup listed in `audit-20260711.md`.

## Claudex Workhouse application

- `app/index.html`
- `app/package.json`
- `app/pnpm-lock.yaml`
- `app/playwright.config.ts`
- `app/tsconfig.json`
- `app/tsconfig.server.json`
- `app/vite.config.ts`
- `app/public/icons/icon-192.png`
- `app/public/icons/icon-512.png`
- `app/public/emoticons/<outfit>/*.{webp,png,gif}`
- `app/scripts/generate-icons.mjs`
- `app/src/server/claude-worker.ts`
- `app/src/server/config.ts`
- `app/src/server/db/client.ts`
- `app/src/server/db/sqlite-worker.py`
- `app/src/server/events.ts`
- `app/src/server/emotion.ts`
- `app/src/server/mcp-emotion.ts`
- `app/src/server/index.ts`
- `app/src/server/process.ts`
- `app/src/server/providers/claude.ts`
- `app/src/server/providers/codex.ts`
- `app/src/server/security/auth.ts`
- `app/src/server/supervisor.ts`
- `app/src/server/types.ts`
- `app/src/server/worker-emotion.ts`
- `app/src/web/App.svelte`
- `app/src/web/events.ts`
- `app/src/web/main.ts`
- `app/src/web/styles.css`
- `app/tests/e2e/mobile.spec.ts`
- `app/tests/integration/cx-json.test.ts`
- `app/tests/integration/db.test.ts`
- `app/tests/unit/config.test.ts`
- `app/tests/unit/events.test.ts`
- `app/tests/unit/emotion.test.ts`
- `app/tests/unit/process.test.ts`
- `hooks/emotion/emotion-match.mjs`
- `hooks/emotion/set-emotion.mjs`

Generated application artifacts are `app/node_modules`, `app/dist`, `app/dist-server`, the local `.pnpm-store`, and `app/test-results` (six screenshots plus Playwright metadata/traces from corrected test runs).

## Configuration and operations

- `config/claudex-workhouse.json`
- `config/projects.json`
- `bin/claudex-workhouse.mjs`
- `data/claudex-workhouse.sqlite`, `-wal`, `-shm`
- `data/claude-jobs/*.json` test/owned-worker state records
- `logs/claudex-workhouse.log` and rotated successors when needed
- `run/supervisor.pid` while running

## Documentation

- `README.md`
- `docs/architecture.md`
- `docs/introduction.{en,ko,ja}.md`
- `docs/license.md` and `docs/license.{en,ko,ja}.md`
- `docs/security.md` and `docs/security.{en,ko,ja}.md`
- `docs/deployment.md` and `docs/deployment.{en,ko,ja}.md`
- `docs/desktop-worker.md` and `docs/desktop-worker.{en,ko,ja}.md`
- `docs/docker.md` and `docs/docker.{en,ko,ja}.md`
- `docs/multi-host.md` and `docs/multi-host.{en,ko,ja}.md`
- `docs/cloudflare-access.md`
- `docs/testing.md` and `docs/testing.{en,ko,ja}.md`
- `docs/rollback.md`
- `docs/known-limitations.md` and `docs/known-limitations.{en,ko,ja}.md`
- `docs/storage-and-permissions.md`
- `docs/audit-20260711.md`
- `docs/file-manifest.md`

The protected backup copy under `backups/20260711-120455-claudex-workhouse` contains the previously recorded files and snapshots; it is not an application source tree.
