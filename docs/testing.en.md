# Testing

[English](testing.en.md) · [한국어](testing.ko.md) · [日本語](testing.ja.md)

Previous: [Deployment](deployment.en.md) · [Guidebook](guide.en.md) · Next: [Known limitations →](known-limitations.en.md)

## Automated

```sh
cd $CLAUDEX_WORKHOUSE_ROOT/app
pnpm check
pnpm test
pnpm build
pnpm test:e2e:docker
```

`test:e2e:docker` runs the tests against the already-running service at
`http://127.0.0.1:3410`. It uses the version-pinned Playwright image so DSM does
not need GTK/ATK browser libraries. Pass normal Playwright arguments after `--`,
for example `pnpm test:e2e:docker -- --project=mobile-360`. Override the target
with `CLAUDEX_WORKHOUSE_E2E_BASE_URL` when necessary.

hosts without the local runtime are unchanged.

Vitest covers exact project allowlisting/path escape rejection, output sanitization, cx JSON success/failure contracts, SQLite WAL/SHM, task persistence, and idempotency claims. Playwright covers 360x800, 412x915, and 800x1280 list/detail/modal/PWA flows and horizontal overflow.

Streaming fixtures verify Codex and Claude message deltas, command output, file-change lifecycle, web search, terminal events, stop, server-restart replay, `Last-Event-ID`, wrong-Origin/unauthenticated rejection, per-task connection limits, mobile delta batching, and service-worker exclusion.

Screenshots are under `app/test-results`. Test authentication is enabled only for a loopback test server with `CLAUDEX_WORKHOUSE_AUTH_MODE=test CLAUDEX_WORKHOUSE_TEST_MODE=1`.

## Integration results

- Codex: create, pending registration, list/detail, explicit-thread follow-up, noninteractive fork, targeted stop, browser/server disconnect survival passed.
- Claude owned: create, session-ID capture, detail, resume, fork, process-identity checked stop passed.
- Claude external: list/detail passed; stop rejected as designed.
- Same UUID create submission produced one cx job and one persisted response.
- Claudex Workhouse server restart left the active cx worker alive; the recovered task was visible and stoppable.
- Killing only the Fastify child changed server PID while supervisor PID and the fourteen cx core checks remained unchanged; five pre-existing dead-broker checks still fail.

### Codex full-session fixtures (2026-07-11)

- Paginated app-server metadata indexed 721 non-archived threads, including native `cli` and `vscode` sources.
- Existing Codex rows migrated to 8 proven `claudex-workhouse` and 5 `external-cx` records.
- Detached worker create, restart survival, transcript turn paging, external CLI/VS Code resume, and external CLI/VS Code fork passed.
- Parent archive/unarchive did not affect a fork child. Parent delete did not delete fork children; a repeated delete returned native not-found.
- Running worker delete returned 409, verified worker stop returned 200, and delete after stop returned 200.
- `gpt-5.4/high/priority` was accepted for a fixture. Unsupported Fast, effort, and permission combinations were rejected. Effective settings remained unknown because the runtime did not report them.
- Destructive fixtures are identified by `CLAUDEX_WORKHOUSE_FIXTURE_20260711` in their names or first prompts.
- Claude regression fixture `dc1dfc2a-6dca-48cf-a75c-8b3c81fb2cb2` passed create/resume, fork created `7082a5f9-a8f0-4840-a684-9b0df81a74cd`, and external stop remained HTTP 403. These native Claude fixture transcripts remain because this release deliberately has no Claude history-delete interface.

## Failure checks

Verified: missing auth, wrong Origin, missing mutation guard, unknown project/task, invalid IDs, empty/oversized prompt validation, reused idempotency key, external Claude stop, cx missing job JSON, and Access configuration missing. Creation timeouts are not retried; pending tasks reconcile to real state or `unknown`.
