# Codex full-session migration audit — 2026-07-11

Migration version 2 extends `tasks` with nullable/defaulted provenance, worker, and requested/effective setting columns. It creates `codex_threads`, `provider_cache`, and `schema_migrations`. The migration runs in `BEGIN IMMEDIATE`; failure rolls back the schema transaction. Full transcripts are not stored.

Before migration: 22 tasks, 51 audit rows, 22 idempotency rows. These counts were unchanged immediately after migration. Project configuration was not modified.

The legacy boolean `owned` was not trusted. Successful `create`, `message`, or `fork` audit records were matched to task IDs. Of 13 existing Codex rows, eight had Claudex Workhouse provenance and became `ownership=claudex-workhouse`; five cx job rows lacked creation evidence and became `ownership=external-cx`. The compatibility boolean remains but authorization and UI use `ownership`.

Source is separate from ownership. A resumed external thread remains externally owned even though its new turn is executed by an Claudex Workhouse worker. A newly forked thread is Claudex Workhouse-owned because the fork creates a new thread ID.

Rollback is restoration of the SQLite backup at `$CLAUDEX_WORKHOUSE_ROOT/backups/20260711-144127-codex-full-session-management/claudex-workhouse.sqlite` while Claudex Workhouse is stopped. This avoids an unsafe column-dropping down migration and restores WAL-consistent pre-change data.
