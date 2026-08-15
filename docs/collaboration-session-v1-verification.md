# CollaborationSession v1 verification

Verified on 2026-07-15 (Asia/Seoul) on branch `feature/collaboration-session-v1`.

## Preserved backup

- Pre-migration backup: `data/backups/20260715-060544`
- Backup directory mode: `0700`
- SQLite and configuration file modes: `0600`

## Automated checks

- `pnpm test`: 37 files, 135 tests passed.
- `pnpm check`: 0 errors and 0 warnings; server TypeScript check passed.
- TypeScript unused-local/unused-parameter check passed.
- `pnpm build`: production client and server build passed.
- `git diff --check`: passed.
- SQLite `PRAGMA quick_check`: `ok` after migration 6.
- Migration-from-v5 fixture preserved the existing collaboration row, added the two Debate columns, and passed integrity/foreign-key checks.

## Real provider smoke test

- Collaboration: `b71194db-2bbd-4d4a-b2db-4e02730d7608`
- Mode: Debate, discussion, read-only, one utterance per provider.
- Result: `completed`, outcome `turn-limit`.
- Counts: Codex 1, Claude 1.
- Codex task/session: `codex:deck:aa82f9b2-b3e6-404f-8df8-ce34d8045081` / `019f6281-2c9b-70c0-8e76-aff32f3b7335`.
- Claude task/session: `claude:0a355d22-27de-4a13-868b-0def8fb888c9` / `ebe0932c-c35b-4edf-ad3e-18f620a26e6d`.
- Both provider results remained independently stored.
- The delivered RelayArtifact exists with mode `0600`; its file size and SHA-256 checksum match the database record.
- The smoke test exposed a terminal-avatar rollback (`completed` to `listening`). The guard was added and covered by the integration test before the final build.

## Deployment and load check

- The final production bundle is `index-CZjrRePi.js` with `index-Dm_N04HL.css`.
- Claudex Workhouse was restarted after the final build; provider workers were explicitly left untouched by the restart command.
- The new server answered `/api/health/live` with `{"ok":true,"status":"live"}`.
- No warning, error, or HTTP 429 was recorded for the final server PID during the post-restart check.
- Collaboration SSE replay refreshes are coalesced, and the fallback session/task refresh interval is 8 seconds.

## Inline emotion asset smoke test

- Collaboration: `1c7455a5-fd6d-4a54-9866-beb21fd20738`.
- Topic: feedback on showing one or two large emotion assets inside each provider output.
- Result: `completed`, outcome `turn-limit`; Codex 1 and Claude 1.
- Both outputs were shorter than 600 characters and therefore selected exactly one inline asset.
- The selected Codex asset was `chu` and the selected Claude asset was `thinking`; both public WebP responses returned HTTP 200.
- Every configured outfit currently exposes 41 catalogued assets. Variant files such as `thinking_2` and `thinking_3` share the `thinking` emotion group and cannot appear together in one output.

## Not verified

- Playwright mobile runs at 360, 412, and 800 px could not launch Chromium because the host lacks `libatk-1.0.so.0`. These cases are not reported as passed.
