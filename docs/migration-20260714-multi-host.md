# Multi-host migration and rollback

Migration version 3 adds execution hosts, Worker credential hashes, Workspace roots, Projects, Workspaces, Handoff artifacts, WorkChains, SessionLinks and Workspace leases. It adds nullable host/Workspace/session relation columns to existing task and Codex thread tables.

On startup Claudex Workhouse creates or updates the `local` host, imports configured projects without deleting the config source, creates a verified local Workspace per configured project, and backfills only null host/Workspace columns on existing tasks and Codex threads. Historical external paths are attached to disabled, archived, exact-path Workspace tombstones; they remain navigable as history but cannot be selected for a new task. The production migration completed with zero unassigned tasks and zero unassigned Codex threads.

The pre-migration online SQLite and configuration backup is `backups/20260714-110728-multi-host-foundation/`.

Rollback:

1. stop Claudex Workhouse through `bin/claudex-workhouse.mjs stop`;
2. retain the current database for forensics;
3. restore `claudex-workhouse.sqlite`, `claudex-workhouse.json` and `projects.json` from the backup with their original owner and mode;
4. switch source back to baseline commit `154d068`;
5. rebuild and start Claudex Workhouse;
6. verify `/api/health/live`, local Claude/Codex creation, session discovery and SSE.

Version 3 tables are additive. Older code ignores them, but restoring the database is preferred because older code does not understand the added task attribution columns.
