#!/usr/bin/env python3
import json
import os
import sqlite3
import sys
import traceback

db_path = sys.argv[1]
db = sqlite3.connect(db_path, timeout=5, isolation_level=None)
db.row_factory = sqlite3.Row
db.execute("PRAGMA journal_mode=WAL")
db.execute("PRAGMA foreign_keys=ON")
db.execute("PRAGMA busy_timeout=5000")

db.executescript("""
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL,
  description TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  native_id TEXT NOT NULL,
  thread_id TEXT,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  result TEXT,
  error TEXT,
  log TEXT NOT NULL DEFAULT '',
  owned INTEGER NOT NULL DEFAULT 1,
  pid INTEGER,
  pgid INTEGER,
  process_start TEXT,
  command_marker TEXT,
  parent_thread_id TEXT
);
CREATE INDEX IF NOT EXISTS tasks_updated_idx ON tasks(updated_at DESC);
CREATE INDEX IF NOT EXISTS tasks_history_cursor_idx ON tasks(updated_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS tasks_native_idx ON tasks(provider, native_id);
CREATE INDEX IF NOT EXISTS tasks_thread_idx ON tasks(provider,thread_id);
CREATE INDEX IF NOT EXISTS tasks_active_status_idx ON tasks(status,updated_at DESC) WHERE status IN ('pending','queued','running','waiting','unknown');
CREATE TABLE IF NOT EXISTS task_search_documents (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  workspace_id TEXT,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  title_folded TEXT NOT NULL,
  prompt_folded TEXT NOT NULL,
  result_folded TEXT NOT NULL,
  error_folded TEXT NOT NULL,
  normalizer_version INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS task_search_provider_cursor_idx ON task_search_documents(provider,updated_at DESC,task_id DESC);
CREATE INDEX IF NOT EXISTS task_search_workspace_cursor_idx ON task_search_documents(workspace_id,updated_at DESC,task_id DESC);
CREATE INDEX IF NOT EXISTS task_search_status_cursor_idx ON task_search_documents(status,updated_at DESC,task_id DESC);
CREATE INDEX IF NOT EXISTS task_search_cursor_idx ON task_search_documents(updated_at DESC,task_id DESC);
CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT NOT NULL,
  action TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  state TEXT NOT NULL,
  response_json TEXT,
  owner_token TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(key, action)
);
CREATE INDEX IF NOT EXISTS idempotency_updated_idx ON idempotency(updated_at);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  provider TEXT,
  task_id TEXT,
  project_id TEXT,
  outcome TEXT NOT NULL,
  detail TEXT
);
CREATE TABLE IF NOT EXISTS codex_threads (
  thread_id TEXT PRIMARY KEY,
  session_id TEXT,
  project_id TEXT,
  cwd TEXT,
  title TEXT NOT NULL DEFAULT '',
  preview TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'unknown',
  ownership TEXT NOT NULL DEFAULT 'unknown',
  status TEXT NOT NULL DEFAULT 'unknown',
  archived INTEGER NOT NULL DEFAULT 0,
  parent_thread_id TEXT,
  forked_from_id TEXT,
  model_provider TEXT,
  requested_model TEXT,
  effective_model TEXT,
  requested_reasoning_effort TEXT,
  effective_reasoning_effort TEXT,
  requested_service_tier TEXT,
  effective_service_tier TEXT,
  permission_profile TEXT,
  settings_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS codex_threads_updated_idx ON codex_threads(updated_at DESC, thread_id);
CREATE INDEX IF NOT EXISTS codex_threads_filter_idx ON codex_threads(archived,project_id,source,ownership,status,updated_at DESC);
CREATE TABLE IF NOT EXISTS codex_thread_search_documents (
  thread_id TEXT PRIMARY KEY REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
  workspace_id TEXT,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  title_folded TEXT NOT NULL,
  preview_folded TEXT NOT NULL,
  normalizer_version INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS codex_thread_search_cursor_idx ON codex_thread_search_documents(updated_at DESC,thread_id DESC);
CREATE INDEX IF NOT EXISTS codex_thread_search_workspace_cursor_idx ON codex_thread_search_documents(workspace_id,updated_at DESC,thread_id DESC);
CREATE INDEX IF NOT EXISTS codex_thread_search_status_cursor_idx ON codex_thread_search_documents(status,updated_at DESC,thread_id DESC);
CREATE TABLE IF NOT EXISTS provider_cache (
  cache_key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  version TEXT
);
CREATE TABLE IF NOT EXISTS execution_hosts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('local','worker')),
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  architecture TEXT NOT NULL,
  operating_system_version TEXT,
  worker_version TEXT,
  status TEXT NOT NULL DEFAULT 'unknown',
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  disabled_at TEXT,
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS worker_credentials (
  host_id TEXT PRIMARY KEY REFERENCES execution_hosts(id) ON DELETE CASCADE,
  credential_hash TEXT NOT NULL,
  credential_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  rotated_at TEXT,
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS bootstrap_enrollments (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK(scope IN ('server-owner','worker')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  intended_roles_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS bootstrap_enrollments_scope_idx ON bootstrap_enrollments(scope,consumed_at,expires_at);
CREATE TABLE IF NOT EXISTS workspace_roots (
  id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL REFERENCES execution_hosts(id),
  display_name TEXT NOT NULL,
  canonical_path TEXT NOT NULL,
  allow_create INTEGER NOT NULL DEFAULT 0,
  allow_register INTEGER NOT NULL DEFAULT 1,
  allow_clone INTEGER NOT NULL DEFAULT 0,
  allow_delete INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  verified_at TEXT,
  disabled_at TEXT,
  UNIQUE(host_id,canonical_path)
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  default_provider TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  host_id TEXT NOT NULL REFERENCES execution_hosts(id),
  root_id TEXT NOT NULL REFERENCES workspace_roots(id),
  relative_path TEXT NOT NULL,
  canonical_path TEXT NOT NULL,
  display_name TEXT NOT NULL,
  workspace_type TEXT NOT NULL,
  git_remote TEXT,
  default_branch TEXT,
  last_known_commit TEXT,
  last_git_status_json TEXT,
  last_verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  UNIQUE(host_id,canonical_path)
);
CREATE INDEX IF NOT EXISTS workspaces_project_idx ON workspaces(project_id,host_id,archived_at);
CREATE TABLE IF NOT EXISTS work_chains (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  root_session_id TEXT,
  active_session_id TEXT,
  board_visible INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  board_status TEXT NOT NULL DEFAULT 'queued',
  priority TEXT NOT NULL DEFAULT 'normal',
  workspace_id TEXT,
  target_branch TEXT,
  roles_json TEXT NOT NULL DEFAULT '{}',
  automation_json TEXT NOT NULL DEFAULT '{}',
  last_activity_at TEXT,
  completed_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS work_chain_events (
  id TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL REFERENCES work_chains(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  task_id TEXT,
  collaboration_session_id TEXT,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  dedupe_key TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(chain_id,dedupe_key)
);
CREATE INDEX IF NOT EXISTS work_chain_events_chain_idx ON work_chain_events(chain_id,created_at,id);
CREATE TABLE IF NOT EXISTS handoff_artifacts (
  id TEXT PRIMARY KEY,
  source_session_id TEXT,
  source_task_id TEXT,
  source_host_id TEXT NOT NULL,
  source_workspace_id TEXT NOT NULL,
  target_host_id TEXT NOT NULL,
  target_workspace_id TEXT NOT NULL,
  source_provider TEXT NOT NULL,
  target_provider TEXT NOT NULL,
  target_execution_json TEXT,
  source_commit TEXT,
  target_commit_at_creation TEXT,
  source_branch TEXT,
  dirty_state TEXT,
  markdown_path TEXT NOT NULL,
  patch_path TEXT,
  manifest_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  checksum TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS managed_artifacts (
  id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  device_id TEXT,
  inode_id TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  verified_at TEXT,
  removed_at TEXT
);
CREATE INDEX IF NOT EXISTS managed_artifacts_workspace_idx ON managed_artifacts(workspace_id,host_id,status,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS managed_artifacts_task_kind_idx ON managed_artifacts(task_id,kind,path);
CREATE TABLE IF NOT EXISTS session_links (
  id TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL REFERENCES work_chains(id),
  source_session_id TEXT NOT NULL,
  target_session_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  handoff_artifact_id TEXT REFERENCES handoff_artifacts(id),
  source_host_id TEXT NOT NULL,
  target_host_id TEXT NOT NULL,
  source_provider TEXT NOT NULL,
  target_provider TEXT NOT NULL,
  source_commit TEXT,
  target_commit TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS session_links_chain_idx ON session_links(chain_id,created_at);
CREATE TABLE IF NOT EXISTS workspace_leases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  chain_id TEXT,
  session_id TEXT,
  host_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('write','read')),
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  released_at TEXT
);
CREATE INDEX IF NOT EXISTS workspace_leases_active_idx ON workspace_leases(workspace_id,released_at,expires_at);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  endpoint_hash TEXT NOT NULL UNIQUE,
  encrypted_json TEXT NOT NULL,
  browser_label TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  disabled_at TEXT
);
CREATE TABLE IF NOT EXISTS system_settings (
  setting_key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS external_access_profiles (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider IN ('local','tailscale','cloudflare')),
  desired_mode TEXT NOT NULL,
  configuration_json TEXT NOT NULL DEFAULT '{}',
  configuration_source TEXT NOT NULL,
  managed_resources_json TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS external_access_profiles_provider_idx ON external_access_profiles(provider);
CREATE TABLE IF NOT EXISTS external_access_operations (
  id TEXT PRIMARY KEY,
  profile_id TEXT REFERENCES external_access_profiles(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK(provider IN ('local','tailscale','cloudflare')),
  action TEXT NOT NULL,
  plan_digest TEXT NOT NULL,
  status TEXT NOT NULL,
  stage TEXT NOT NULL,
  safe_error_code TEXT,
  started_at TEXT,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  rollback_status TEXT,
  interrupted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS external_access_operations_provider_idx ON external_access_operations(provider,updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS external_access_operations_active_idx ON external_access_operations(provider) WHERE status IN ('pending','awaiting_approval','running','verifying','rolling_back');
CREATE TABLE IF NOT EXISTS external_access_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT REFERENCES external_access_operations(id) ON DELETE CASCADE,
  profile_id TEXT REFERENCES external_access_profiles(id) ON DELETE CASCADE,
  check_code TEXT NOT NULL,
  status TEXT NOT NULL,
  safe_detail TEXT NOT NULL,
  checked_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS external_access_checks_operation_idx ON external_access_checks(operation_id,checked_at,id);
CREATE TABLE IF NOT EXISTS proton_upload_operations (
  id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  source_relative_path TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_size INTEGER NOT NULL,
  source_sha256 TEXT NOT NULL,
  remote_path TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('prepared','running','verifying','completed','failed','cancelled','delivery-uncertain')),
  stage TEXT NOT NULL,
  safe_error_code TEXT,
  cli_version TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  interrupted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS proton_upload_operations_updated_idx ON proton_upload_operations(updated_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS proton_upload_operations_task_idx ON proton_upload_operations(task_id,updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS proton_upload_operations_active_idx ON proton_upload_operations(host_id) WHERE status IN ('running','verifying');
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  format_version INTEGER NOT NULL,
  logical_key TEXT,
  kind TEXT NOT NULL,
  origin TEXT NOT NULL,
  state TEXT NOT NULL,
  relative_path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  file_count INTEGER NOT NULL DEFAULT 0,
  verification TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  protected_reason TEXT,
  trashed_at TEXT,
  purge_after TEXT,
  last_error TEXT,
  manifest_digest TEXT
);
CREATE INDEX IF NOT EXISTS snapshots_state_created_idx ON snapshots(state,created_at DESC);
CREATE TABLE IF NOT EXISTS application_update_attempts (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK(state IN ('staging','applying','verifying','completed','rollback-running','rolled-back','failed')),
  source_version TEXT NOT NULL,
  target_version TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  install_method TEXT NOT NULL,
  platform TEXT NOT NULL,
  architecture TEXT NOT NULL,
  snapshot_id TEXT,
  request_path TEXT,
  rollback_performed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS application_update_attempts_created_idx ON application_update_attempts(created_at DESC,id);
CREATE UNIQUE INDEX IF NOT EXISTS application_update_attempts_one_active_idx ON application_update_attempts((1)) WHERE state IN ('staging','applying','verifying','rollback-running');
CREATE TABLE IF NOT EXISTS session_message_queue (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider IN ('codex','claude','deepseek','ollama','antigravity','grok')),
  thread_id TEXT NOT NULL,
  source_task_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','dispatching','delivery-uncertain','sent','failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  dispatched_task_id TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS session_message_queue_pending_idx ON session_message_queue(provider,thread_id,status,created_at,id);
CREATE TABLE IF NOT EXISTS quota_task_reservations (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider IN ('codex','claude')),
  project_id TEXT NOT NULL,
  execution_host_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  title TEXT,
  request_json TEXT NOT NULL,
  permission_snapshot_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('waiting-quota','claiming','starting','started','cancelled','failed')),
  criterion TEXT NOT NULL CHECK(criterion='next-five-hour-reset'),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  next_check_at TEXT NOT NULL,
  last_quota_check_at TEXT,
  last_quota_status TEXT,
  claim_started_at TEXT,
  task_id TEXT,
  error TEXT,
  quota_check_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS quota_task_reservations_pending_idx ON quota_task_reservations(status,next_check_at,created_at);
CREATE TABLE IF NOT EXISTS task_recovery_attempts (
  source_task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  attempt_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('claiming','started','failed')),
  prompt_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resumed_task_id TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS task_recovery_attempts_status_idx ON task_recovery_attempts(status,updated_at);
CREATE TABLE IF NOT EXISTS collaboration_sessions (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('parallel','review','assist','debate')), status TEXT NOT NULL,
  outcome TEXT, primary_participant_id TEXT, max_calls INTEGER NOT NULL,
  current_call_count INTEGER NOT NULL DEFAULT 0, current_step TEXT NOT NULL,
  max_turns_per_participant INTEGER, current_turn_counts_json TEXT NOT NULL DEFAULT '{"claude":0,"codex":0}',
  timeout_at TEXT NOT NULL, controller_generation INTEGER NOT NULL DEFAULT 1,
  work_chain_id TEXT, source_task_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  completed_at TEXT, cancelled_at TEXT, archived_at TEXT, metadata_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS collaboration_sessions_updated_idx ON collaboration_sessions(updated_at DESC);
CREATE TABLE IF NOT EXISTS collaboration_participants (
  id TEXT PRIMARY KEY, collaboration_session_id TEXT NOT NULL REFERENCES collaboration_sessions(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('codex','claude','deepseek','ollama','antigravity','grok')), role TEXT NOT NULL,
  execution_host_id TEXT NOT NULL, workspace_id TEXT NOT NULL, provider_session_id TEXT,
  source_task_id TEXT, permission_mode TEXT NOT NULL CHECK(permission_mode IN ('read','plan','write')),
  status TEXT NOT NULL, session_generation INTEGER NOT NULL DEFAULT 1,
  capability_snapshot_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, archived_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS collaboration_participants_active_provider_idx
ON collaboration_participants(collaboration_session_id,provider,role) WHERE archived_at IS NULL;
CREATE TABLE IF NOT EXISTS collaboration_runs (
  id TEXT PRIMARY KEY, collaboration_session_id TEXT NOT NULL REFERENCES collaboration_sessions(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES collaboration_participants(id), round INTEGER NOT NULL,
  sequence INTEGER NOT NULL, attempt INTEGER NOT NULL, purpose TEXT NOT NULL,
  source_participant_id TEXT, target_participant_id TEXT, provider_task_id TEXT,
  status TEXT NOT NULL, deadline_at TEXT NOT NULL, input_checksum TEXT NOT NULL,
  relay_artifact_id TEXT, generation INTEGER NOT NULL, last_event_sequence INTEGER NOT NULL DEFAULT 0,
  error_category TEXT, started_at TEXT, completed_at TEXT, failed_at TEXT, cancelled_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(collaboration_session_id,participant_id,sequence,generation)
);
CREATE INDEX IF NOT EXISTS collaboration_runs_session_idx ON collaboration_runs(collaboration_session_id,sequence,created_at);
CREATE TABLE IF NOT EXISTS collaboration_messages (
  id TEXT PRIMARY KEY, collaboration_session_id TEXT NOT NULL REFERENCES collaboration_sessions(id) ON DELETE CASCADE,
  participant_id TEXT, run_id TEXT, round INTEGER NOT NULL, message_type TEXT NOT NULL,
  source_message_id TEXT, provider_message_id TEXT, provider_task_id TEXT, content_kind TEXT NOT NULL,
  content_ref TEXT NOT NULL, checksum TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS collaboration_messages_session_idx ON collaboration_messages(collaboration_session_id,created_at,id);
CREATE TABLE IF NOT EXISTS relay_artifacts (
  id TEXT PRIMARY KEY, collaboration_session_id TEXT NOT NULL REFERENCES collaboration_sessions(id) ON DELETE CASCADE,
  source_participant_id TEXT, target_participant_id TEXT NOT NULL, source_run_id TEXT,
  source_provider TEXT NOT NULL, target_provider TEXT NOT NULL, source_session_id TEXT, source_task_id TEXT,
  source_commit TEXT, source_branch TEXT, dirty INTEGER NOT NULL DEFAULT 0,
  changed_files_json TEXT NOT NULL DEFAULT '[]', diff_checksum TEXT, permission_mode TEXT NOT NULL,
  path TEXT NOT NULL, checksum TEXT NOT NULL, size_bytes INTEGER NOT NULL, schema_version INTEGER NOT NULL,
  status TEXT NOT NULL, created_at TEXT NOT NULL, delivered_at TEXT, expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS relay_artifacts_expiry_idx ON relay_artifacts(expires_at,status);
CREATE TABLE IF NOT EXISTS collaboration_avatar_state (
  collaboration_session_id TEXT NOT NULL REFERENCES collaboration_sessions(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES collaboration_participants(id) ON DELETE CASCADE,
  source_run_id TEXT NOT NULL, generation INTEGER NOT NULL, utterance_type TEXT NOT NULL,
  line TEXT NOT NULL, emotion TEXT NOT NULL, activity TEXT NOT NULL, source TEXT NOT NULL,
  priority INTEGER NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, expires_at TEXT,
  PRIMARY KEY(collaboration_session_id,participant_id)
);
CREATE TABLE IF NOT EXISTS collaboration_workspace_leases (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, collaboration_session_id TEXT NOT NULL,
  participant_id TEXT NOT NULL, owner_run_id TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('read','write')),
  lease_generation INTEGER NOT NULL, heartbeat_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  acquired_at TEXT NOT NULL, released_at TEXT, status TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS collaboration_leases_active_idx ON collaboration_workspace_leases(workspace_id,released_at,expires_at,status);
""")

# SQLite cannot alter a CHECK constraint in place. Rebuild only the parent
# table for existing v5 databases while foreign-key enforcement is paused;
# child tables continue to reference the recreated canonical table name.
collaboration_session_sql=(db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='collaboration_sessions'").fetchone() or [""])[0] or ""
if "'debate'" not in collaboration_session_sql:
    db.execute("PRAGMA foreign_keys=OFF")
    try:
        db.executescript("""
BEGIN IMMEDIATE;
CREATE TABLE collaboration_sessions_v6 (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('parallel','review','assist','debate')), status TEXT NOT NULL,
  outcome TEXT, primary_participant_id TEXT, max_calls INTEGER NOT NULL,
  current_call_count INTEGER NOT NULL DEFAULT 0, current_step TEXT NOT NULL,
  max_turns_per_participant INTEGER, current_turn_counts_json TEXT NOT NULL DEFAULT '{"claude":0,"codex":0}',
  timeout_at TEXT NOT NULL, controller_generation INTEGER NOT NULL DEFAULT 1,
  work_chain_id TEXT, source_task_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  completed_at TEXT, cancelled_at TEXT, archived_at TEXT, metadata_json TEXT NOT NULL DEFAULT '{}'
);
INSERT INTO collaboration_sessions_v6(
  id,project_id,title,mode,status,outcome,primary_participant_id,max_calls,current_call_count,current_step,
  timeout_at,controller_generation,work_chain_id,source_task_id,created_at,updated_at,completed_at,cancelled_at,archived_at,metadata_json
)
SELECT id,project_id,title,mode,status,outcome,primary_participant_id,max_calls,current_call_count,current_step,
  timeout_at,controller_generation,work_chain_id,source_task_id,created_at,updated_at,completed_at,cancelled_at,archived_at,metadata_json
FROM collaboration_sessions;
DROP TABLE collaboration_sessions;
ALTER TABLE collaboration_sessions_v6 RENAME TO collaboration_sessions;
CREATE INDEX collaboration_sessions_updated_idx ON collaboration_sessions(updated_at DESC);
COMMIT;
""")
    except Exception:
        if db.in_transaction: db.execute("ROLLBACK")
        raise
    finally:
        db.execute("PRAGMA foreign_keys=ON")
    if list(db.execute("PRAGMA foreign_key_check")): raise RuntimeError("Collaboration v6 foreign-key validation failed")

# Conversation participants now use the same provider identity domain as
# tasks. Rebuild the table because SQLite cannot widen a CHECK constraint.
collaboration_participant_sql=(db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='collaboration_participants'").fetchone() or [""])[0] or ""
if "'grok'" not in collaboration_participant_sql:
    db.execute("PRAGMA foreign_keys=OFF")
    try:
        db.executescript("""
BEGIN IMMEDIATE;
CREATE TABLE collaboration_participants_v16 (
  id TEXT PRIMARY KEY, collaboration_session_id TEXT NOT NULL REFERENCES collaboration_sessions(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('codex','claude','deepseek','ollama','antigravity','grok')), role TEXT NOT NULL,
  execution_host_id TEXT NOT NULL, workspace_id TEXT NOT NULL, provider_session_id TEXT,
  source_task_id TEXT, permission_mode TEXT NOT NULL CHECK(permission_mode IN ('read','plan','write')),
  status TEXT NOT NULL, session_generation INTEGER NOT NULL DEFAULT 1,
  capability_snapshot_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, archived_at TEXT
);
INSERT INTO collaboration_participants_v16 SELECT * FROM collaboration_participants;
DROP TABLE collaboration_participants;
ALTER TABLE collaboration_participants_v16 RENAME TO collaboration_participants;
CREATE UNIQUE INDEX collaboration_participants_active_provider_idx ON collaboration_participants(collaboration_session_id,provider,role) WHERE archived_at IS NULL;
COMMIT;
""")
    except Exception:
        if db.in_transaction: db.execute("ROLLBACK")
        raise
    finally:
        db.execute("PRAGMA foreign_keys=ON")
    if list(db.execute("PRAGMA foreign_key_check")): raise RuntimeError("Collaboration participant v16 foreign-key validation failed")

# A dispatch can cross the provider boundary immediately before the server
# exits. Preserve that ambiguity instead of silently retrying and possibly
# delivering the same prompt twice.
session_message_queue_sql=(db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='session_message_queue'").fetchone() or [""])[0] or ""
if "'delivery-uncertain'" not in session_message_queue_sql or "'grok'" not in session_message_queue_sql:
    db.execute("PRAGMA foreign_keys=OFF")
    try:
        db.executescript("""
BEGIN IMMEDIATE;
CREATE TABLE session_message_queue_v17 (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider IN ('codex','claude','deepseek','ollama','antigravity','grok')),
  thread_id TEXT NOT NULL,
  source_task_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','dispatching','delivery-uncertain','sent','failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  dispatched_task_id TEXT,
  error TEXT
);
INSERT INTO session_message_queue_v17(id,provider,thread_id,source_task_id,prompt,status,created_at,updated_at,dispatched_task_id,error)
SELECT id,provider,thread_id,source_task_id,prompt,status,created_at,updated_at,dispatched_task_id,error
FROM session_message_queue;
DROP TABLE session_message_queue;
ALTER TABLE session_message_queue_v17 RENAME TO session_message_queue;
CREATE INDEX session_message_queue_pending_idx ON session_message_queue(provider,thread_id,status,created_at,id);
COMMIT;
""")
    except Exception:
        if db.in_transaction: db.execute("ROLLBACK")
        raise
    finally:
        db.execute("PRAGMA foreign_keys=ON")
    if list(db.execute("PRAGMA foreign_key_check")): raise RuntimeError("Session message queue v17 foreign-key validation failed")

def ensure_column(table, name, declaration):
    columns={row[1] for row in db.execute(f"PRAGMA table_info({table})")}
    if name not in columns: db.execute(f"ALTER TABLE {table} ADD COLUMN {name} {declaration}")

SEARCH_NORMALIZER_VERSION=1
SEARCH_FOLD_EXPANSIONS={"ß":"ss","ς":"σ","ſ":"s","ﬀ":"ff","ﬁ":"fi","ﬂ":"fl","ﬃ":"ffi","ﬄ":"ffl","ﬅ":"st","ﬆ":"st"}
def fold_search_text(value):
    return str(value or "").lower().translate(str.maketrans(SEARCH_FOLD_EXPANSIONS))

db.execute("BEGIN IMMEDIATE")
try:
    for name,declaration in [
      ("job_id","TEXT"),("ownership","TEXT NOT NULL DEFAULT 'unknown'"),("source","TEXT NOT NULL DEFAULT 'unknown'"),
      ("cwd","TEXT"),("last_seen_at","TEXT"),("requested_model","TEXT"),("effective_model","TEXT"),
      ("requested_reasoning_effort","TEXT"),("effective_reasoning_effort","TEXT"),("requested_service_tier","TEXT"),
      ("effective_service_tier","TEXT"),("permission_profile","TEXT"),("settings_updated_at","TEXT"),
      ("metadata_json","TEXT NOT NULL DEFAULT '{}'"),("execution_host_id","TEXT"),("workspace_id","TEXT"),
      ("remote_worker_id","TEXT"),("host_task_id","TEXT"),("provider_session_id","TEXT"),
      ("source_session_id","TEXT"),("work_chain_id","TEXT")
    ]: ensure_column("tasks",name,declaration)
    def backfill_search_documents_if_needed():
        search_migration_applied=db.execute("SELECT 1 FROM schema_migrations WHERE version=14").fetchone() is not None
        search_document_counts=db.execute("""SELECT
          (SELECT COUNT(*) FROM tasks WHERE ownership='claudex-workhouse' OR owned=1),
          (SELECT COUNT(*) FROM task_search_documents),
          (SELECT COUNT(*) FROM task_search_documents WHERE normalizer_version<>?)""",(SEARCH_NORMALIZER_VERSION,)).fetchone()
        search_document_mismatch=db.execute("""SELECT 1 FROM tasks t LEFT JOIN task_search_documents s ON s.task_id=t.id
          WHERE (t.ownership='claudex-workhouse' OR t.owned=1) AND (s.task_id IS NULL OR s.provider<>t.provider OR s.workspace_id IS NOT t.workspace_id OR s.status<>t.status OR s.updated_at<>t.updated_at)
          UNION ALL SELECT 1 FROM task_search_documents s LEFT JOIN tasks t ON t.id=s.task_id
          WHERE t.id IS NULL OR NOT (t.ownership='claudex-workhouse' OR t.owned=1) LIMIT 1""").fetchone()
        if search_migration_applied and search_document_counts[0]==search_document_counts[1] and not search_document_counts[2] and search_document_mismatch is None: return
        search_upsert="""INSERT INTO task_search_documents(task_id,provider,workspace_id,status,updated_at,title_folded,prompt_folded,result_folded,error_folded,normalizer_version)
                           VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET
                           provider=excluded.provider,workspace_id=excluded.workspace_id,status=excluded.status,updated_at=excluded.updated_at,
                           title_folded=excluded.title_folded,prompt_folded=excluded.prompt_folded,result_folded=excluded.result_folded,
                           error_folded=excluded.error_folded,normalizer_version=excluded.normalizer_version"""
        last_id=""
        while True:
            search_rows=db.execute("""SELECT id,provider,workspace_id,status,updated_at,title,prompt,result,error FROM tasks
              WHERE (ownership='claudex-workhouse' OR owned=1) AND id>? ORDER BY id LIMIT 100""",(last_id,)).fetchall()
            if not search_rows: break
            db.executemany(search_upsert,[(row["id"],row["provider"],row["workspace_id"],row["status"],row["updated_at"],fold_search_text(row["title"]),fold_search_text(row["prompt"]),fold_search_text(row["result"]),fold_search_text(row["error"]),SEARCH_NORMALIZER_VERSION) for row in search_rows])
            last_id=search_rows[-1]["id"]
        db.execute("DELETE FROM task_search_documents WHERE task_id NOT IN (SELECT id FROM tasks WHERE ownership='claudex-workhouse' OR owned=1)")
    def backfill_codex_thread_search_documents_if_needed():
        migration_applied=db.execute("SELECT 1 FROM schema_migrations WHERE version=15").fetchone() is not None
        counts=db.execute("SELECT (SELECT COUNT(*) FROM codex_threads),(SELECT COUNT(*) FROM codex_thread_search_documents),(SELECT COUNT(*) FROM codex_thread_search_documents WHERE normalizer_version<>?)",(SEARCH_NORMALIZER_VERSION,)).fetchone()
        mismatch=db.execute("""SELECT 1 FROM codex_threads c LEFT JOIN codex_thread_search_documents s ON s.thread_id=c.thread_id
          WHERE s.thread_id IS NULL OR s.workspace_id IS NOT c.workspace_id OR s.status<>c.status OR s.updated_at<>c.updated_at
          UNION ALL SELECT 1 FROM codex_thread_search_documents s LEFT JOIN codex_threads c ON c.thread_id=s.thread_id WHERE c.thread_id IS NULL LIMIT 1""").fetchone()
        if migration_applied and counts[0]==counts[1] and not counts[2] and mismatch is None: return
        upsert="""INSERT INTO codex_thread_search_documents(thread_id,workspace_id,status,updated_at,title_folded,preview_folded,normalizer_version)
          VALUES(?,?,?,?,?,?,?) ON CONFLICT(thread_id) DO UPDATE SET workspace_id=excluded.workspace_id,status=excluded.status,updated_at=excluded.updated_at,
          title_folded=excluded.title_folded,preview_folded=excluded.preview_folded,normalizer_version=excluded.normalizer_version"""
        last_id=""
        while True:
            rows=db.execute("SELECT thread_id,workspace_id,status,updated_at,title,preview FROM codex_threads WHERE thread_id>? ORDER BY thread_id LIMIT 100",(last_id,)).fetchall()
            if not rows: break
            db.executemany(upsert,[(row["thread_id"],row["workspace_id"],row["status"],row["updated_at"],fold_search_text(row["title"]),fold_search_text(row["preview"]),SEARCH_NORMALIZER_VERSION) for row in rows])
            last_id=rows[-1]["thread_id"]
        db.execute("DELETE FROM codex_thread_search_documents WHERE thread_id NOT IN (SELECT thread_id FROM codex_threads)")
    # History search reads newest owned rows in cursor order. These partial
    # indexes avoid the provider/thread index plus a temporary sort, while
    # excluding external mirrors that the search contract never returns.
    db.execute("CREATE INDEX IF NOT EXISTS tasks_history_owned_cursor_idx ON tasks(updated_at DESC,id DESC) WHERE ownership='claudex-workhouse' OR owned=1")
    db.execute("CREATE INDEX IF NOT EXISTS tasks_history_owned_provider_cursor_idx ON tasks(provider,updated_at DESC,id DESC) WHERE ownership='claudex-workhouse' OR owned=1")
    db.execute("CREATE INDEX IF NOT EXISTS tasks_history_owned_workspace_cursor_idx ON tasks(workspace_id,updated_at DESC,id DESC) WHERE ownership='claudex-workhouse' OR owned=1")
    db.execute("CREATE INDEX IF NOT EXISTS tasks_history_owned_status_cursor_idx ON tasks(status,updated_at DESC,id DESC) WHERE ownership='claudex-workhouse' OR owned=1")
    for name,declaration in [("execution_host_id","TEXT"),("workspace_id","TEXT"),("work_chain_id","TEXT")]: ensure_column("codex_threads",name,declaration)
    for name,declaration in [("host_id","TEXT"),("workspace_id","TEXT")]: ensure_column("audit_log",name,declaration)
    ensure_column("idempotency","owner_token","TEXT")
    ensure_column("collaboration_sessions","max_turns_per_participant","INTEGER")
    ensure_column("collaboration_sessions","current_turn_counts_json","TEXT NOT NULL DEFAULT '{\"claude\":0,\"codex\":0}'")
    ensure_column("collaboration_sessions","revision","INTEGER NOT NULL DEFAULT 1")
    ensure_column("handoff_artifacts","target_execution_json","TEXT")
    for name,declaration in [
      ("board_visible","INTEGER NOT NULL DEFAULT 0"),("description","TEXT NOT NULL DEFAULT ''"),
      ("board_status","TEXT NOT NULL DEFAULT 'queued'"),("priority","TEXT NOT NULL DEFAULT 'normal'"),
      ("workspace_id","TEXT"),("target_branch","TEXT"),("roles_json","TEXT NOT NULL DEFAULT '{}'"),
      ("automation_json","TEXT NOT NULL DEFAULT '{}'"),
      ("last_activity_at","TEXT"),("completed_at","TEXT"),("revision","INTEGER NOT NULL DEFAULT 1")
    ]: ensure_column("work_chains",name,declaration)
    db.execute("""CREATE TABLE IF NOT EXISTS work_chain_events(
      id TEXT PRIMARY KEY,chain_id TEXT NOT NULL REFERENCES work_chains(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,task_id TEXT,collaboration_session_id TEXT,actor_type TEXT NOT NULL,
      actor_id TEXT,dedupe_key TEXT,payload_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,
      UNIQUE(chain_id,dedupe_key))""")
    db.execute("CREATE INDEX IF NOT EXISTS work_chain_events_chain_idx ON work_chain_events(chain_id,created_at,id)")
    participant_index_sql=(db.execute("SELECT sql FROM sqlite_master WHERE type='index' AND name='collaboration_participants_active_provider_idx'").fetchone() or [""])[0] or ""
    if "provider,role" not in participant_index_sql.replace(" ","").lower():
        db.execute("DROP INDEX IF EXISTS collaboration_participants_active_provider_idx")
        db.execute("CREATE UNIQUE INDEX collaboration_participants_active_provider_idx ON collaboration_participants(collaboration_session_id,provider,role) WHERE archived_at IS NULL")
    ensure_column("quota_task_reservations","quota_check_count","INTEGER NOT NULL DEFAULT 0")
    product="claudex-workhouse"
    previous_product="agent"+"-"+"deck"
    new_root=os.path.dirname(os.path.dirname(os.path.abspath(sys.argv[1])))
    previous_workspace=db.execute("SELECT canonical_path FROM workspaces WHERE project_id=? ORDER BY created_at LIMIT 1",(previous_product,)).fetchone()
    previous_root=previous_workspace[0] if previous_workspace and previous_workspace[0] else os.path.join(os.path.dirname(new_root),previous_product)
    if not db.execute("SELECT 1 FROM schema_migrations WHERE version=10").fetchone():
        # Rename operational identity and filesystem references without
        # rewriting historical prompts, results, audit details, or user data.
        previous_name="Agent"+" Deck"
        previous_slug=previous_product.replace("-","_")
        product_slug=product.replace("-","_")
        db.execute("INSERT OR IGNORE INTO projects(id,name,slug,description,default_provider,created_at,updated_at,archived_at) SELECT ?,?,?,description,default_provider,created_at,updated_at,archived_at FROM projects WHERE id=?",(product,"Claudex Workhouse",product,previous_product))
        for table in ["audit_log","codex_threads","collaboration_sessions","tasks","work_chains","workspace_leases","workspaces"]:
            db.execute(f"UPDATE {table} SET project_id=? WHERE project_id=?",(product,previous_product))
        db.execute("DELETE FROM projects WHERE id=?",(previous_product,))
        db.execute("UPDATE tasks SET ownership=? WHERE ownership=?",(product,previous_product))
        db.execute("UPDATE tasks SET source=? WHERE source=?",(product,previous_product))
        db.execute("UPDATE codex_threads SET ownership=? WHERE ownership=?",(product,previous_product))
        db.execute("UPDATE codex_threads SET source=? WHERE source=?",(product,previous_product))
        db.execute("UPDATE tasks SET command_marker=REPLACE(command_marker,?,?) WHERE command_marker LIKE ?",(previous_product,product,f"{previous_product}%"))
        db.execute("UPDATE projects SET name=REPLACE(REPLACE(name,?,?),?,?),slug=REPLACE(slug,?,?) WHERE name LIKE ? OR name LIKE ? OR slug LIKE ?",(previous_name,"Claudex Workhouse",previous_product,product,previous_product,product,f"%{previous_name}%",f"%{previous_product}%",f"%{previous_product}%"))
        db.execute("UPDATE workspaces SET display_name=REPLACE(display_name,?,?) WHERE display_name LIKE ?",(previous_name,"Claudex Workhouse",f"%{previous_name}%"))
        db.execute("UPDATE workspace_roots SET display_name=REPLACE(display_name,?,?) WHERE display_name LIKE ?",(previous_name,"Claudex Workhouse",f"%{previous_name}%"))
        for table,column in [("tasks","cwd"),("codex_threads","cwd"),("workspaces","canonical_path"),("workspace_roots","canonical_path")]:
            db.execute(f"UPDATE {table} SET {column}=?||substr({column},?) WHERE {column}=? OR {column} LIKE ?",(new_root,len(previous_root)+1,previous_root,f"{previous_root}/%"))
        db.execute("UPDATE workspaces SET last_git_status_json=REPLACE(last_git_status_json,?,?) WHERE last_git_status_json IS NOT NULL",(previous_root,new_root))
        for table,column in [("handoff_artifacts","markdown_path"),("handoff_artifacts","patch_path"),("handoff_artifacts","manifest_path"),("relay_artifacts","path")]:
            db.execute(f"UPDATE {table} SET {column}=REPLACE(REPLACE({column},?,?),?,?) WHERE {column} IS NOT NULL",(previous_root,new_root,previous_product,product))
        for table,column in [
          ("tasks","title"),("tasks","prompt"),("tasks","result"),("tasks","error"),("tasks","log"),("tasks","metadata_json"),
          ("codex_threads","title"),("codex_threads","preview"),("codex_threads","metadata_json"),
          ("collaboration_sessions","title"),("collaboration_sessions","outcome"),("collaboration_sessions","metadata_json"),
          ("collaboration_messages","content_ref"),("audit_log","detail"),("idempotency","response_json")
        ]:
            db.execute(f"UPDATE {table} SET {column}=REPLACE(REPLACE(REPLACE(REPLACE({column},?,?),?,?),?,?),?,?) WHERE {column} IS NOT NULL",(previous_root,new_root,previous_product,product,previous_name,"Claudex Workhouse",previous_slug,product_slug))
        db.execute("INSERT INTO schema_migrations(version,applied_at,description) VALUES(10,datetime('now'),'Claudex Workhouse canonical identity and root migration')")
    # The install root may move again after a verified staging run. Reconcile
    # generated paths on every startup before updating the protected workspace.
    current_workspace=db.execute("SELECT canonical_path FROM workspaces WHERE project_id=? ORDER BY created_at LIMIT 1",(product,)).fetchone()
    current_root=current_workspace[0] if current_workspace and current_workspace[0] else new_root
    if current_root!=new_root:
        for table,column in [
          ("tasks","title"),("tasks","prompt"),("tasks","result"),("tasks","error"),("tasks","log"),("tasks","metadata_json"),("tasks","cwd"),
          ("codex_threads","title"),("codex_threads","preview"),("codex_threads","metadata_json"),("codex_threads","cwd"),
          ("collaboration_sessions","metadata_json"),("collaboration_messages","content_ref"),("audit_log","detail"),("idempotency","response_json"),
          ("handoff_artifacts","markdown_path"),("handoff_artifacts","patch_path"),("handoff_artifacts","manifest_path"),("relay_artifacts","path"),
          ("workspaces","last_git_status_json")
        ]:
            db.execute(f"UPDATE {table} SET {column}=REPLACE({column},?,?) WHERE {column} IS NOT NULL",(current_root,new_root))
        db.execute("UPDATE workspace_roots SET canonical_path=REPLACE(canonical_path,?,?) WHERE canonical_path=? OR canonical_path LIKE ?",(current_root,new_root,current_root,f"{current_root}/%"))
    db.execute("UPDATE workspaces SET last_git_status_json=REPLACE(last_git_status_json,?,?) WHERE last_git_status_json IS NOT NULL",(previous_root,new_root))
    db.execute("UPDATE tasks SET cwd=? WHERE project_id=? AND cwd IS NOT NULL",(new_root,product))
    db.execute("UPDATE codex_threads SET cwd=? WHERE project_id=? AND cwd IS NOT NULL",(new_root,product))
    db.execute("UPDATE workspaces SET canonical_path=?,relative_path='.',display_name='Claudex Workhouse' WHERE project_id=?",(new_root,product))
    db.execute("INSERT OR IGNORE INTO schema_migrations(version,applied_at,description) VALUES(2,datetime('now'),'Codex full session management')")
    db.execute("INSERT OR IGNORE INTO schema_migrations(version,applied_at,description) VALUES(3,datetime('now'),'Execution hosts, workspaces, handoff and work chains')")
    db.execute("INSERT OR IGNORE INTO schema_migrations(version,applied_at,description) VALUES(4,datetime('now'),'Push subscriptions and installation settings')")
    db.execute("INSERT OR IGNORE INTO schema_migrations(version,applied_at,description) VALUES(5,datetime('now'),'Collaboration sessions, immutable relay references and writer leases')")
    db.execute("INSERT OR IGNORE INTO schema_migrations(version,applied_at,description) VALUES(6,datetime('now'),'Debate turns, limits and participant counters')")
    db.execute("INSERT OR IGNORE INTO schema_migrations(version,applied_at,description) VALUES(7,datetime('now'),'Queued follow-up messages for active provider sessions')")
    db.execute("INSERT OR IGNORE INTO schema_migrations(version,applied_at,description) VALUES(8,datetime('now'),'Preserve uncertain provider deliveries across failures')")
    db.execute("INSERT OR IGNORE INTO schema_migrations(version,applied_at,description) VALUES(9,datetime('now'),'Managed recovery snapshots and trash lifecycle')")
    db.execute("INSERT OR IGNORE INTO schema_migrations(version,applied_at,description) VALUES(11,datetime('now'),'Owner claim bootstrap enrollments')")
    db.execute("INSERT OR IGNORE INTO schema_migrations(version,applied_at,description) VALUES(12,datetime('now'),'Signed application update attempts')")
    db.execute("INSERT OR IGNORE INTO schema_migrations(version,applied_at,description) VALUES(13,datetime('now'),'Isolated indexed history search')")
    backfill_search_documents_if_needed()
    db.execute("INSERT OR IGNORE INTO schema_migrations(version,applied_at,description) VALUES(14,datetime('now'),'Materialized normalized task history search')")
    backfill_codex_thread_search_documents_if_needed()
    db.execute("INSERT OR IGNORE INTO schema_migrations(version,applied_at,description) VALUES(15,datetime('now'),'Materialized cached Codex thread history search')")
    db.execute("INSERT OR IGNORE INTO schema_migrations(version,applied_at,description) VALUES(16,datetime('now'),'Five-provider conversation participants')")
    db.execute("INSERT OR IGNORE INTO schema_migrations(version,applied_at,description) VALUES(17,datetime('now'),'Workspace-scoped managed artifact provenance')")
    db.execute("INSERT OR IGNORE INTO schema_migrations(version,applied_at,description) VALUES(18,datetime('now'),'External access profiles, operations and checks')")
    db.execute("INSERT OR IGNORE INTO schema_migrations(version,applied_at,description) VALUES(19,datetime('now'),'Persist handoff target execution selection')")
    db.execute("INSERT OR IGNORE INTO schema_migrations(version,applied_at,description) VALUES(20,datetime('now'),'Allow same-provider independent Assist roles')")
    db.execute("INSERT OR IGNORE INTO schema_migrations(version,applied_at,description) VALUES(21,datetime('now'),'Proton Drive upload operation lifecycle')")
    db.execute("INSERT OR IGNORE INTO schema_migrations(version,applied_at,description) VALUES(22,datetime('now'),'Collaboration Board work-chain metadata and events')")
    db.execute("COMMIT")
except Exception:
    db.execute("ROLLBACK")
    raise

TASK_COLUMNS = ["id","provider","native_id","thread_id","project_id","title","prompt","status","created_at","updated_at","result","error","log","owned","pid","pgid","process_start","command_marker","parent_thread_id","job_id","ownership","source","cwd","last_seen_at","requested_model","effective_model","requested_reasoning_effort","effective_reasoning_effort","requested_service_tier","effective_service_tier","permission_profile","settings_updated_at","metadata_json","execution_host_id","workspace_id","remote_worker_id","host_task_id","provider_session_id","source_session_id","work_chain_id"]

FIELD_MAP={"native_id":"nativeId","thread_id":"threadId","project_id":"projectId","created_at":"createdAt","updated_at":"updatedAt","process_start":"processStart","command_marker":"commandMarker","parent_thread_id":"parentThreadId","job_id":"jobId","last_seen_at":"lastSeenAt","requested_model":"requestedModel","effective_model":"effectiveModel","requested_reasoning_effort":"requestedReasoningEffort","effective_reasoning_effort":"effectiveReasoningEffort","requested_service_tier":"requestedServiceTier","effective_service_tier":"effectiveServiceTier","permission_profile":"permissionProfile","settings_updated_at":"settingsUpdatedAt","metadata_json":"metadata","execution_host_id":"executionHostId","workspace_id":"workspaceId","remote_worker_id":"remoteWorkerId","host_task_id":"hostTaskId","provider_session_id":"providerSessionId","source_session_id":"sourceSessionId","work_chain_id":"workChainId"}

def task_values(task):
    values=[]
    for c in TASK_COLUMNS:
        value=task.get(FIELD_MAP.get(c,c))
        if c=="ownership" and value is None: value="claudex-workhouse" if task.get("owned",True) else "unknown"
        if c=="source" and value is None: value="claudex-workhouse" if task.get("owned",True) else "unknown"
        if c=="metadata_json": value=json.dumps(value or {},ensure_ascii=False)
        values.append(value)
    return values

def task_row(row):
    if row is None: return None
    x=dict(row)
    return {"id":x["id"],"provider":x["provider"],"nativeId":x["native_id"],"threadId":x["thread_id"],"projectId":x["project_id"],"title":x["title"],"prompt":x["prompt"],"status":x["status"],"createdAt":x["created_at"],"updatedAt":x["updated_at"],"result":x["result"],"error":x["error"],"log":x["log"],"owned":bool(x["owned"]),"pid":x["pid"],"pgid":x["pgid"],"processStart":x["process_start"],"commandMarker":x["command_marker"],"parentThreadId":x["parent_thread_id"],"jobId":x["job_id"],"ownership":x["ownership"],"source":x["source"],"cwd":x["cwd"],"lastSeenAt":x["last_seen_at"],"requestedModel":x["requested_model"],"effectiveModel":x["effective_model"],"requestedReasoningEffort":x["requested_reasoning_effort"],"effectiveReasoningEffort":x["effective_reasoning_effort"],"requestedServiceTier":x["requested_service_tier"],"effectiveServiceTier":x["effective_service_tier"],"permissionProfile":x["permission_profile"],"settingsUpdatedAt":x["settings_updated_at"],"metadata":json.loads(x["metadata_json"] or "{}"),"executionHostId":x["execution_host_id"],"workspaceId":x["workspace_id"],"remoteWorkerId":x["remote_worker_id"],"hostTaskId":x["host_task_id"],"providerSessionId":x["provider_session_id"],"sourceSessionId":x["source_session_id"],"workChainId":x["work_chain_id"]}

SEARCH_DOCUMENT_UPSERT="""INSERT INTO task_search_documents(task_id,provider,workspace_id,status,updated_at,title_folded,prompt_folded,result_folded,error_folded,normalizer_version)
  VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET
  provider=excluded.provider,workspace_id=excluded.workspace_id,status=excluded.status,updated_at=excluded.updated_at,
  title_folded=excluded.title_folded,prompt_folded=excluded.prompt_folded,result_folded=excluded.result_folded,
  error_folded=excluded.error_folded,normalizer_version=excluded.normalizer_version"""
def sync_task_search_document(task_id):
    row=db.execute("SELECT id,provider,workspace_id,status,updated_at,title,prompt,result,error,ownership,owned FROM tasks WHERE id=?",(task_id,)).fetchone()
    if row is None or not (row["ownership"]=="claudex-workhouse" or row["owned"]):
        db.execute("DELETE FROM task_search_documents WHERE task_id=?",(task_id,));return
    db.execute(SEARCH_DOCUMENT_UPSERT,(row["id"],row["provider"],row["workspace_id"],row["status"],row["updated_at"],fold_search_text(row["title"]),fold_search_text(row["prompt"]),fold_search_text(row["result"]),fold_search_text(row["error"]),SEARCH_NORMALIZER_VERSION))

def sync_codex_thread_search_document(thread_id):
    row=db.execute("SELECT thread_id,workspace_id,status,updated_at,title,preview FROM codex_threads WHERE thread_id=?",(thread_id,)).fetchone()
    if row is None: return
    db.execute("""INSERT INTO codex_thread_search_documents(thread_id,workspace_id,status,updated_at,title_folded,preview_folded,normalizer_version) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(thread_id) DO UPDATE SET workspace_id=excluded.workspace_id,status=excluded.status,updated_at=excluded.updated_at,
      title_folded=excluded.title_folded,preview_folded=excluded.preview_folded,normalizer_version=excluded.normalizer_version""",
      (row["thread_id"],row["workspace_id"],row["status"],row["updated_at"],fold_search_text(row["title"]),fold_search_text(row["preview"]),SEARCH_NORMALIZER_VERSION))

def folded_literal_bounds(value,query,folded_value=None):
    needle=fold_search_text(query);folded_value=fold_search_text(value) if folded_value is None else folded_value;offset=folded_value.find(needle)
    if not needle or offset<0: return None
    if fold_search_text(value)!=folded_value: return None
    folded_offset=0;start=None
    for index,char in enumerate(value):
        next_offset=folded_offset+len(fold_search_text(char))
        if start is None and next_offset>offset: start=index
        if next_offset>=offset+len(needle): return (index if start is None else start),index+1
        folded_offset=next_offset
    return None

def thread_row(row):
    if row is None: return None
    x=dict(row)
    return {"threadId":x["thread_id"],"sessionId":x["session_id"],"projectId":x["project_id"],"cwd":x["cwd"],"title":x["title"],"preview":x["preview"],"source":x["source"],"ownership":x["ownership"],"status":x["status"],"archived":bool(x["archived"]),"parentThreadId":x["parent_thread_id"],"forkedFromId":x["forked_from_id"],"modelProvider":x["model_provider"],"requestedModel":x["requested_model"],"effectiveModel":x["effective_model"],"requestedReasoningEffort":x["requested_reasoning_effort"],"effectiveReasoningEffort":x["effective_reasoning_effort"],"requestedServiceTier":x["requested_service_tier"],"effectiveServiceTier":x["effective_service_tier"],"permissionProfile":x["permission_profile"],"settingsUpdatedAt":x["settings_updated_at"],"createdAt":x["created_at"],"updatedAt":x["updated_at"],"lastSeenAt":x["last_seen_at"],"metadata":json.loads(x["metadata_json"] or "{}"),"executionHostId":x["execution_host_id"],"workspaceId":x["workspace_id"],"workChainId":x["work_chain_id"]}

def preserve_newer_thread_settings(thread):
    existing=thread_row(db.execute("SELECT * FROM codex_threads WHERE thread_id=?",(thread["threadId"],)).fetchone())
    if not existing: return thread
    existing_at=existing.get("settingsUpdatedAt") or ""
    incoming_at=thread.get("settingsUpdatedAt") or ""
    if not existing_at or (incoming_at and incoming_at>=existing_at): return thread
    protected=dict(thread)
    for key in ["requestedModel","requestedReasoningEffort","requestedServiceTier","permissionProfile","settingsUpdatedAt"]:
        protected[key]=existing.get(key)
    metadata=dict(protected.get("metadata") or {})
    existing_metadata=existing.get("metadata") or {}
    for key in ["workMode","automationLevel"]:
        if key in existing_metadata: metadata[key]=existing_metadata[key]
        else: metadata.pop(key,None)
    protected["metadata"]=metadata
    return protected

def host_row(row):
    if row is None: return None
    x=dict(row)
    return {"id":x["id"],"type":x["type"],"name":x["name"],"displayName":x["display_name"],"platform":x["platform"],"architecture":x["architecture"],"operatingSystemVersion":x["operating_system_version"],"workerVersion":x["worker_version"],"status":x["status"],"capabilities":json.loads(x["capabilities_json"] or "{}"),"lastSeenAt":x["last_seen_at"],"createdAt":x["created_at"],"updatedAt":x["updated_at"],"disabledAt":x["disabled_at"],"revokedAt":x["revoked_at"]}

def root_row(row):
    if row is None: return None
    x=dict(row)
    return {"id":x["id"],"hostId":x["host_id"],"displayName":x["display_name"],"canonicalPath":x["canonical_path"],"allowCreate":bool(x["allow_create"]),"allowRegister":bool(x["allow_register"]),"allowClone":bool(x["allow_clone"]),"allowDelete":bool(x["allow_delete"]),"createdAt":x["created_at"],"verifiedAt":x["verified_at"],"disabledAt":x["disabled_at"]}

def project_row(row):
    if row is None: return None
    x=dict(row)
    return {"id":x["id"],"name":x["name"],"slug":x["slug"],"description":x["description"],"defaultProvider":x["default_provider"],"createdAt":x["created_at"],"updatedAt":x["updated_at"],"archivedAt":x["archived_at"]}

def workspace_row(row):
    if row is None: return None
    x=dict(row)
    return {"id":x["id"],"projectId":x["project_id"],"hostId":x["host_id"],"rootId":x["root_id"],"relativePath":x["relative_path"],"canonicalPath":x["canonical_path"],"displayName":x["display_name"],"workspaceType":x["workspace_type"],"gitRemote":x["git_remote"],"defaultBranch":x["default_branch"],"lastKnownCommit":x["last_known_commit"],"lastGitStatus":json.loads(x["last_git_status_json"]) if x["last_git_status_json"] else None,"lastVerifiedAt":x["last_verified_at"],"createdAt":x["created_at"],"updatedAt":x["updated_at"],"archivedAt":x["archived_at"]}

def object_row(row, json_fields=()):
    if row is None: return None
    result={}
    for key,value in dict(row).items():
        normalized=key[:-5] if key.endswith("_json") else key
        parts=normalized.split("_")
        name=parts[0]+"".join(x[:1].upper()+x[1:] for x in parts[1:])
        result[name]=json.loads(value) if key in json_fields and value else value
    return result

def board_transition(status, kind):
    if status in ("starting","running"): return "started"
    if status=="completed": return "completed"
    if status in ("failed","stopped","cancelled","stop-unconfirmed"): return "failed"
    if status in ("waiting","waiting-user","waiting-approval","partial"): return "waiting"
    return None

def record_board_status_event(kind, entity_id, chain_id, previous_status, status, created_at):
    transition=board_transition(status,kind)
    if not chain_id or not transition or previous_status==status: return False
    chain=db.execute("SELECT id FROM work_chains WHERE id=? AND board_visible=1",(chain_id,)).fetchone()
    if chain is None: return False
    dedupe_key=f"{kind}:{entity_id}:{transition}"
    event_id=f"auto:{dedupe_key}"
    task_id=entity_id if kind=="task" else None
    collaboration_id=entity_id if kind=="collaboration" else None
    inserted=db.execute("INSERT OR IGNORE INTO work_chain_events(id,chain_id,event_type,task_id,collaboration_session_id,actor_type,actor_id,dedupe_key,payload_json,created_at) VALUES(?,?,?,?,?,'system',NULL,?,?,?)",
      (event_id,chain_id,f"{kind}.{transition}",task_id,collaboration_id,dedupe_key,json.dumps({"previousStatus":previous_status,"status":status},ensure_ascii=False),created_at)).rowcount==1
    if inserted: db.execute("UPDATE work_chains SET last_activity_at=?,updated_at=? WHERE id=?",(created_at,created_at,chain_id))
    return inserted

COLLAB_SPECS={
  "collaboration_sessions": (["id","project_id","title","mode","status","outcome","primary_participant_id","max_calls","current_call_count","current_step","max_turns_per_participant","current_turn_counts_json","timeout_at","controller_generation","work_chain_id","source_task_id","created_at","updated_at","completed_at","cancelled_at","archived_at","metadata_json","revision"],{"current_turn_counts_json","metadata_json"}),
  "collaboration_participants": (["id","collaboration_session_id","provider","role","execution_host_id","workspace_id","provider_session_id","source_task_id","permission_mode","status","session_generation","capability_snapshot_json","created_at","updated_at","archived_at"],{"capability_snapshot_json"}),
  "collaboration_runs": (["id","collaboration_session_id","participant_id","round","sequence","attempt","purpose","source_participant_id","target_participant_id","provider_task_id","status","deadline_at","input_checksum","relay_artifact_id","generation","last_event_sequence","error_category","started_at","completed_at","failed_at","cancelled_at","created_at","updated_at"],set()),
  "collaboration_messages": (["id","collaboration_session_id","participant_id","run_id","round","message_type","source_message_id","provider_message_id","provider_task_id","content_kind","content_ref","checksum","status","created_at"],set()),
  "relay_artifacts": (["id","collaboration_session_id","source_participant_id","target_participant_id","source_run_id","source_provider","target_provider","source_session_id","source_task_id","source_commit","source_branch","dirty","changed_files_json","diff_checksum","permission_mode","path","checksum","size_bytes","schema_version","status","created_at","delivered_at","expires_at"],{"changed_files_json"}),
  "collaboration_avatar_state": (["collaboration_session_id","participant_id","source_run_id","generation","utterance_type","line","emotion","activity","source","priority","version","created_at","expires_at"],set())
}

def collab_key(column):
    normalized=column[:-5] if column.endswith("_json") else column
    parts=normalized.split("_")
    return parts[0]+"".join(x[:1].upper()+x[1:] for x in parts[1:])

def collab_values(table, value):
    columns,json_fields=COLLAB_SPECS[table]; result=[]
    for column in columns:
        item=value.get(collab_key(column))
        if table=="collaboration_sessions" and column=="revision" and item is None: item=1
        if column in json_fields: item=json.dumps(item if item is not None else ({} if column.endswith("snapshot_json") or column=="metadata_json" else []),ensure_ascii=False)
        if column=="dirty": item=1 if item else 0
        result.append(item)
    return columns,result,json_fields

def upsert_collab(table, value, conflict_columns=("id",)):
    columns,values,json_fields=collab_values(table,value)
    updates=",".join((f"revision={table}.revision+1" if table=="collaboration_sessions" and c=="revision" else f"{c}=excluded.{c}") for c in columns if c not in conflict_columns)
    db.execute(f"INSERT INTO {table}({','.join(columns)}) VALUES({','.join('?' for _ in columns)}) ON CONFLICT({','.join(conflict_columns)}) DO UPDATE SET {updates}",values)
    where=" AND ".join(f"{c}=?" for c in conflict_columns)
    args=[value[collab_key(c)] for c in conflict_columns]
    return object_row(db.execute(f"SELECT * FROM {table} WHERE {where}",args).fetchone(),json_fields)

def bump_collaboration_revision(collaboration_id):
    row=db.execute("UPDATE collaboration_sessions SET revision=revision+1 WHERE id=? RETURNING revision",(collaboration_id,)).fetchone()
    if row is None: raise ValueError("Collaboration not found")
    return int(row["revision"])

def upsert_collab_child(table,value,conflict_columns=("id",)):
    try:
        db.execute("BEGIN IMMEDIATE")
        result=upsert_collab(table,value,conflict_columns)
        result["revision"]=bump_collaboration_revision(value["collaborationSessionId"])
        db.execute("COMMIT")
        return result
    except Exception:
        if db.in_transaction: db.execute("ROLLBACK")
        raise

def quota_reservation_row(row):
    if row is None: return None
    value=dict(row)
    value["projectId"]=value.pop("project_id")
    value["executionHostId"]=value.pop("execution_host_id")
    value["workspaceId"]=value.pop("workspace_id")
    value["request"]=json.loads(value.pop("request_json"))
    value["permissionSnapshot"]=json.loads(value.pop("permission_snapshot_json"))
    value["idempotencyKey"]=value.pop("idempotency_key")
    value["createdAt"]=value.pop("created_at")
    value["updatedAt"]=value.pop("updated_at")
    value["nextCheckAt"]=value.pop("next_check_at")
    value["lastQuotaCheckAt"]=value.pop("last_quota_check_at")
    value["lastQuotaStatus"]=value.pop("last_quota_status")
    value["claimStartedAt"]=value.pop("claim_started_at")
    value["taskId"]=value.pop("task_id")
    value["quotaCheckCount"]=value.pop("quota_check_count")
    return value

def task_recovery_row(row):
    if row is None: return None
    value=dict(row)
    value["sourceTaskId"]=value.pop("source_task_id")
    value["attemptId"]=value.pop("attempt_id")
    value["promptHash"]=value.pop("prompt_hash")
    value["createdAt"]=value.pop("created_at")
    value["updatedAt"]=value.pop("updated_at")
    value["resumedTaskId"]=value.pop("resumed_task_id")
    return value

def handle(op, p):
    if op == "ping": return {"journalMode": db.execute("PRAGMA journal_mode").fetchone()[0],"synchronous":db.execute("PRAGMA synchronous").fetchone()[0],"walAutocheckpoint":db.execute("PRAGMA wal_autocheckpoint").fetchone()[0]}
    if op == "list_tasks": return [task_row(r) for r in db.execute("SELECT * FROM tasks ORDER BY updated_at DESC LIMIT ?", (p.get("limit",500),))]
    if op == "search_history_local":
        query=str(p.get("query","")).strip()
        if not query: return {"results":[],"nextCursor":None}
        limit=max(1,min(100,int(p.get("limit",50))));needle=fold_search_text(query)
        task_clauses=["(instr(s.title_folded,?)>0 OR instr(s.prompt_folded,?)>0 OR instr(s.result_folded,?)>0 OR instr(s.error_folded,?)>0)"];task_args=[needle,needle,needle,needle]
        for key,column,operator in (("provider","s.provider","="),("workspaceId","s.workspace_id","="),("status","s.status","="),("from","s.updated_at",">="),("to","s.updated_at","<=")):
            if p.get(key): task_clauses.append(f"{column}{operator}?");task_args.append(p[key])
        if p.get("cursorUpdatedAt") and p.get("cursorKey"):
            task_clauses.append("(s.updated_at<? OR (s.updated_at=? AND ('task:'||s.task_id)<?))");task_args.extend([p["cursorUpdatedAt"],p["cursorUpdatedAt"],p["cursorKey"]])
        task_rows=db.execute(f"""SELECT t.id,t.provider,t.thread_id,t.project_id,t.workspace_id,t.title,t.prompt,t.status,t.updated_at,t.result,t.error,
                    s.title_folded,s.prompt_folded,s.result_folded,s.error_folded,'task:'||s.task_id AS sort_key
               FROM task_search_documents s JOIN tasks t ON t.id=s.task_id WHERE {' AND '.join(task_clauses)}
               ORDER BY s.updated_at DESC,sort_key DESC LIMIT ?""",[*task_args,limit+1]).fetchall()
        results=[]
        for row in task_rows:
            found=None
            for field in ("title","prompt","result","error"):
                if needle not in (row[f"{field}_folded"] or ""): continue
                value=row[field] or "";bounds=folded_literal_bounds(value,query,row[f"{field}_folded"] or "")
                if bounds is None: continue
                match_start,match_end=bounds;start=max(0,match_start-80);end=min(len(value),match_end+120)
                found={"matchField":field,"snippet":("…" if start else "")+value[start:end]+("…" if end<len(value) else ""),"before":("…" if start else "")+value[start:match_start],"match":value[match_start:match_end],"after":value[match_end:end]+("…" if end<len(value) else "")};break
            if found: results.append({"id":f"task:{row['id']}","sortKey":row["sort_key"],"source":"workhouse","provider":row["provider"],"taskId":row["id"],"threadId":row["thread_id"],"projectId":row["project_id"],"workspaceId":row["workspace_id"],"title":row["title"],"status":row["status"],"updatedAt":row["updated_at"],**found})
        thread_rows=[]
        if not p.get("provider") or p.get("provider")=="codex":
            thread_clauses=["c.ownership<>'claudex-workhouse'","(instr(s.title_folded,?)>0 OR instr(s.preview_folded,?)>0)","NOT EXISTS(SELECT 1 FROM tasks t WHERE t.provider='codex' AND t.thread_id=c.thread_id AND (t.ownership='claudex-workhouse' OR t.owned=1))"];thread_args=[needle,needle]
            for key,column,operator in (("workspaceId","s.workspace_id","="),("status","s.status","="),("from","s.updated_at",">="),("to","s.updated_at","<=")):
                if p.get(key): thread_clauses.append(f"{column}{operator}?");thread_args.append(p[key])
            if p.get("cursorUpdatedAt") and p.get("cursorKey"):
                thread_clauses.append("(s.updated_at<? OR (s.updated_at=? AND ('thread:codex:'||s.thread_id)<?))");thread_args.extend([p["cursorUpdatedAt"],p["cursorUpdatedAt"],p["cursorKey"]])
            thread_rows=db.execute(f"SELECT c.*,s.title_folded,s.preview_folded,'thread:codex:'||s.thread_id AS sort_key FROM codex_thread_search_documents s JOIN codex_threads c ON c.thread_id=s.thread_id WHERE {' AND '.join(thread_clauses)} ORDER BY s.updated_at DESC,sort_key DESC LIMIT ?",[*thread_args,limit+1]).fetchall()
            for row in thread_rows:
                title=row["title"] or "";preview=row["preview"] or "";field="title" if needle in row["title_folded"] else "provider" if needle in row["preview_folded"] else None
                if field is None: continue
                value=title if field=="title" else preview;bounds=folded_literal_bounds(value,query,row["title_folded"] if field=="title" else row["preview_folded"])
                if bounds is None: continue
                match_start,match_end=bounds;start=max(0,match_start-80);end=min(len(value),match_end+120)
                results.append({"id":f"codex:{row['thread_id']}","sortKey":row["sort_key"],"source":"codex","provider":"codex","taskId":None,"threadId":row["thread_id"],"projectId":row["project_id"],"workspaceId":row["workspace_id"],"title":title,"status":row["status"],"updatedAt":row["updated_at"],"matchField":field,"snippet":("…" if start else "")+value[start:end]+("…" if end<len(value) else ""),"before":("…" if start else "")+value[start:match_start],"match":value[match_start:match_end],"after":value[match_end:end]+("…" if end<len(value) else "")})
        results.sort(key=lambda item:(item["updatedAt"],item["sortKey"]),reverse=True);page=results[:limit];last=page[-1] if page else None
        has_more=len(task_rows)>limit or len(thread_rows)>limit or len(results)>limit
        raw_last=sorted([*task_rows,*thread_rows],key=lambda item:(item["updated_at"],item["sort_key"]),reverse=True)[0] if not last and has_more else None
        next_cursor=({"updatedAt":last["updatedAt"],"id":last["sortKey"]} if last else {"updatedAt":raw_last["updated_at"],"id":raw_last["sort_key"]} if raw_last else None) if has_more else None
        for item in page: item.pop("sortKey",None)
        return {"results":page,"nextCursor":next_cursor}
    if op == "search_history_tasks":
        query=str(p.get("query","")).strip()
        if not query: return {"results":[],"nextCursor":None,"scanned":0,"exhausted":True}
        limit=max(1,min(100,int(p.get("limit",50))))
        needle=fold_search_text(query);clauses=["(instr(s.title_folded,?)>0 OR instr(s.prompt_folded,?)>0 OR instr(s.result_folded,?)>0 OR instr(s.error_folded,?)>0)"];args=[needle,needle,needle,needle]
        if p.get("provider"): clauses.append("s.provider=?");args.append(p["provider"])
        if p.get("workspaceId"): clauses.append("s.workspace_id=?");args.append(p["workspaceId"])
        if p.get("status"): clauses.append("s.status=?");args.append(p["status"])
        if p.get("from"): clauses.append("s.updated_at>=?");args.append(p["from"])
        if p.get("to"): clauses.append("s.updated_at<=?");args.append(p["to"])
        if p.get("cursorUpdatedAt") and p.get("cursorId"):
            clauses.append("(s.updated_at<? OR (s.updated_at=? AND s.task_id<?))")
            args.extend([p["cursorUpdatedAt"],p["cursorUpdatedAt"],p["cursorId"]])
        sql=f"""SELECT t.id,t.provider,t.thread_id,t.project_id,t.workspace_id,t.title,t.prompt,t.status,t.updated_at,t.result,t.error,
                       s.title_folded,s.prompt_folded,s.result_folded,s.error_folded
                  FROM task_search_documents s JOIN tasks t ON t.id=s.task_id
                 WHERE {' AND '.join(clauses)}
                 ORDER BY s.updated_at DESC,s.task_id DESC LIMIT ?"""
        rows=db.execute(sql,[*args,limit+1]).fetchall();candidates=rows[:limit];results=[]
        for row in candidates:
            field=None;value="";bounds=None
            for candidate_field in ("title","prompt","result","error"):
                if needle not in row[f"{candidate_field}_folded"]: continue
                candidate_value=row[candidate_field] or "";candidate_bounds=folded_literal_bounds(candidate_value,query)
                if candidate_bounds is not None: field=candidate_field;value=candidate_value;bounds=candidate_bounds;break
            if field is None or bounds is None: continue
            match_start,match_end=bounds;start=max(0,match_start-80);end=min(len(value),match_end+120)
            results.append({"id":f"task:{row['id']}","source":"workhouse","provider":row["provider"],"taskId":row["id"],"threadId":row["thread_id"],"projectId":row["project_id"],"workspaceId":row["workspace_id"],"title":row["title"],"status":row["status"],"updatedAt":row["updated_at"],"matchField":field,"snippet":("…" if start else "")+value[start:end]+("…" if end<len(value) else ""),"before":("…" if start else "")+value[start:match_start],"match":value[match_start:match_end],"after":value[match_end:end]+("…" if end<len(value) else "")})
        exhausted=len(rows)<=limit;last=candidates[-1] if candidates else None
        return {"results":results,"nextCursor":None if exhausted or last is None else {"updatedAt":last["updated_at"],"id":last["id"]},"scanned":len(candidates),"exhausted":exhausted}
    if op == "list_push_tasks":
        task_ids=[str(value) for value in p.get("taskIds",[])[:1000]]
        active=("pending","queued","running","waiting","unknown")
        # Keep the indexed active-status lookup separate from tracked ids. An
        # OR between these predicates made SQLite scan every (large) task row
        # once per second, even when only one task was running.
        columns="id,provider,status,execution_host_id,updated_at"
        rows=list(db.execute(f"SELECT {columns} FROM tasks WHERE status IN (?,?,?,?,?) ORDER BY updated_at DESC",active))
        if task_ids:
            marks=','.join('?' for _ in task_ids)
            rows.extend(db.execute(f"SELECT {columns} FROM tasks WHERE id IN ({marks}) AND status NOT IN (?,?,?,?,?)",[*task_ids,*active]))
        rows.sort(key=lambda row: row["updated_at"] or "",reverse=True)
        return [{"id":r["id"],"provider":r["provider"],"status":r["status"],"executionHostId":r["execution_host_id"],"updatedAt":r["updated_at"]} for r in rows]
    if op == "get_task": return task_row(db.execute("SELECT * FROM tasks WHERE id=?", (p["id"],)).fetchone())
    if op == "get_native_task": return task_row(db.execute("SELECT * FROM tasks WHERE provider=? AND native_id=? ORDER BY updated_at DESC LIMIT 1", (p["provider"],p["nativeId"])).fetchone())
    if op == "list_provider_tasks":
        # `since` fetches only rows touched after a caller-held watermark. The
        # full row carries prompt/result/log, so a complete listing of a mature
        # table costs seconds on this host while a delta costs milliseconds.
        since=p.get("since")
        if since:
            return [task_row(r) for r in db.execute("SELECT * FROM tasks WHERE provider=? AND updated_at>? ORDER BY updated_at DESC LIMIT ?",(p["provider"],since,p.get("limit",5000)))]
        return [task_row(r) for r in db.execute("SELECT * FROM tasks WHERE provider=? ORDER BY updated_at DESC LIMIT ?",(p["provider"],p.get("limit",5000)))]
    if op == "list_provider_task_links_by_threads":
        thread_ids=[str(value) for value in p.get("threadIds",[])[:100] if value]
        if not thread_ids: return []
        marks=",".join("?" for _ in thread_ids)
        rows=db.execute(f"""SELECT id,thread_id,ownership,owned,command_marker,job_id,source,cwd,
                                  project_id,execution_host_id,workspace_id,status,created_at
                             FROM tasks WHERE provider=? AND thread_id IN ({marks})
                             ORDER BY updated_at DESC""",[p["provider"],*thread_ids])
        return [{"id":r["id"],"threadId":r["thread_id"],"ownership":r["ownership"],"owned":bool(r["owned"]),
                 "commandMarker":r["command_marker"],"jobId":r["job_id"],"source":r["source"],"cwd":r["cwd"],
                 "projectId":r["project_id"],"executionHostId":r["execution_host_id"],"workspaceId":r["workspace_id"],
                 "status":r["status"],"createdAt":r["created_at"]} for r in rows]
    if op == "list_provider_task_ids": return [r["id"] for r in db.execute("SELECT id FROM tasks WHERE provider=?",(p["provider"],))]
    if op == "list_provider_task_refresh_rows":
        rows=db.execute("""SELECT id,provider,thread_id,project_id,title,status,created_at,updated_at,owned,ownership,source,cwd,last_seen_at,
                                 command_marker,job_id,execution_host_id,workspace_id,provider_session_id,metadata_json
                            FROM tasks WHERE provider=?""",(p["provider"],))
        return [{"id":r["id"],"provider":r["provider"],"nativeId":r["id"],"threadId":r["thread_id"],"projectId":r["project_id"],"title":r["title"],"prompt":"","status":r["status"],"createdAt":r["created_at"],"updatedAt":r["updated_at"],"result":None,"error":None,"log":"","owned":bool(r["owned"]),"ownership":r["ownership"],"source":r["source"],"cwd":r["cwd"],"lastSeenAt":r["last_seen_at"],"commandMarker":r["command_marker"],"jobId":r["job_id"],"executionHostId":r["execution_host_id"],"workspaceId":r["workspace_id"],"providerSessionId":r["provider_session_id"],"metadata":json.loads(r["metadata_json"] or "{}")} for r in rows]
    # Callers polling for approvals/user-input/conflicts only care about tasks
    # that can still change. A handful of active rows is far cheaper to return
    # than the whole table, whose rows carry prompt/result/log payloads.
    if op == "list_active_tasks": return [task_row(r) for r in db.execute("SELECT * FROM tasks WHERE status IN ('pending','queued','starting','running','waiting','stopping','unknown') ORDER BY updated_at DESC")]
    if op == "upsert_task":
        marks=",".join("?" for _ in TASK_COLUMNS)
        updates=",".join(f"{c}=excluded.{c}" for c in TASK_COLUMNS if c != "id")
        try:
            db.execute("BEGIN IMMEDIATE")
            previous=db.execute("SELECT status,work_chain_id FROM tasks WHERE id=?",(p["task"]["id"],)).fetchone()
            db.execute(f"INSERT INTO tasks ({','.join(TASK_COLUMNS)}) VALUES ({marks}) ON CONFLICT(id) DO UPDATE SET {updates}", task_values(p["task"]))
            sync_task_search_document(p["task"]["id"])
            result=task_row(db.execute("SELECT * FROM tasks WHERE id=?",(p["task"]["id"],)).fetchone())
            record_board_status_event("task",result["id"],result.get("workChainId"),previous["status"] if previous else None,result["status"],result["updatedAt"])
            db.execute("COMMIT");return result
        except Exception:
            if db.in_transaction: db.execute("ROLLBACK")
            raise
    if op == "delete_external_task_mirror":
        result=db.execute("DELETE FROM tasks WHERE provider=? AND id=? AND thread_id=? AND owned=0 AND ownership='external'",(p["provider"],p["id"],p["threadId"]))
        return result.rowcount == 1
    if op == "delete_task_session":
        db.execute("DELETE FROM session_message_queue WHERE provider=? AND thread_id=?",(p["provider"],p["threadId"]))
        result=db.execute("DELETE FROM tasks WHERE provider=? AND thread_id=?",(p["provider"],p["threadId"]))
        return result.rowcount
    if op == "enqueue_session_message":
        x=p["item"]
        db.execute("INSERT INTO session_message_queue(id,provider,thread_id,source_task_id,prompt,status,created_at,updated_at,dispatched_task_id,error) VALUES(?,?,?,?,?,'queued',?,?,NULL,?)",(x["id"],x["provider"],x["threadId"],x["sourceTaskId"],x["prompt"],x["createdAt"],x["updatedAt"],x.get("error")))
        return object_row(db.execute("SELECT * FROM session_message_queue WHERE id=?",(x["id"],)).fetchone())
    if op == "update_session_message":
        result=db.execute("UPDATE session_message_queue SET prompt=?,updated_at=? WHERE id=? AND status='queued'",(p["prompt"],p["updatedAt"],p["id"]))
        if result.rowcount != 1: return None
        return object_row(db.execute("SELECT * FROM session_message_queue WHERE id=?",(p["id"],)).fetchone())
    if op == "list_session_messages":
        return [object_row(r) for r in db.execute("SELECT * FROM session_message_queue WHERE provider=? AND thread_id=? AND status IN ('queued','dispatching','delivery-uncertain','failed') ORDER BY created_at,id",(p["provider"],p["threadId"]))]
    if op == "list_queued_session_messages":
        return [object_row(r) for r in db.execute("SELECT * FROM session_message_queue WHERE status='queued' AND (error IS NULL OR error NOT LIKE 'paid-credit-consent-required:%') ORDER BY created_at,id LIMIT ?",(p.get("limit",100),))]
    if op == "list_credit_waiting_session_messages":
        return [object_row(r) for r in db.execute("SELECT * FROM session_message_queue WHERE status='queued' AND error LIKE 'paid-credit-consent-required:%' ORDER BY created_at,id LIMIT ?",(p.get("limit",100),))]
    if op == "defer_session_message_credit":
        db.execute("UPDATE session_message_queue SET updated_at=?,error=? WHERE id=? AND status='queued'",(p["updatedAt"],p["error"],p["id"]))
        return object_row(db.execute("SELECT * FROM session_message_queue WHERE id=?",(p["id"],)).fetchone())
    if op == "clear_session_message_credit_wait":
        db.execute("UPDATE session_message_queue SET updated_at=?,error=NULL WHERE id=? AND status='queued' AND error LIKE 'paid-credit-consent-required:%'",(p["updatedAt"],p["id"]))
        return object_row(db.execute("SELECT * FROM session_message_queue WHERE id=?",(p["id"],)).fetchone())
    if op == "get_session_message": return object_row(db.execute("SELECT * FROM session_message_queue WHERE id=?",(p["id"],)).fetchone())
    if op == "claim_session_message":
        try:
            db.execute("BEGIN IMMEDIATE")
            row=db.execute("SELECT * FROM session_message_queue WHERE id=? AND status='queued'",(p["id"],)).fetchone()
            if row is None: db.execute("COMMIT"); return None
            busy=db.execute("SELECT id FROM session_message_queue WHERE provider=? AND thread_id=? AND status IN ('dispatching','delivery-uncertain') LIMIT 1",(row["provider"],row["thread_id"])).fetchone()
            if busy is not None: db.execute("COMMIT"); return None
            db.execute("UPDATE session_message_queue SET status='dispatching',updated_at=?,error=NULL WHERE id=? AND status='queued'",(p["updatedAt"],p["id"]))
            claimed=object_row(db.execute("SELECT * FROM session_message_queue WHERE id=?",(p["id"],)).fetchone())
            db.execute("COMMIT"); return claimed
        except Exception:
            if db.in_transaction: db.execute("ROLLBACK")
            raise
    if op == "finish_session_message":
        db.execute("UPDATE session_message_queue SET status=?,updated_at=?,dispatched_task_id=?,error=? WHERE id=? AND status='dispatching'",(p["status"],p["updatedAt"],p.get("dispatchedTaskId"),p.get("error"),p["id"]))
        return object_row(db.execute("SELECT * FROM session_message_queue WHERE id=?",(p["id"],)).fetchone())
    if op == "retry_session_message":
        db.execute("UPDATE session_message_queue SET status='queued',updated_at=?,dispatched_task_id=NULL,error=NULL WHERE id=? AND status IN ('failed','delivery-uncertain')",(p["updatedAt"],p["id"]))
        return object_row(db.execute("SELECT * FROM session_message_queue WHERE id=?",(p["id"],)).fetchone())
    if op == "resolve_session_message_sent":
        db.execute("UPDATE session_message_queue SET status='sent',updated_at=?,error=COALESCE(error,'Manually marked delivered.') WHERE id=? AND status='delivery-uncertain'",(p["updatedAt"],p["id"]))
        return object_row(db.execute("SELECT * FROM session_message_queue WHERE id=?",(p["id"],)).fetchone())
    if op == "delete_session_message":
        result=db.execute("DELETE FROM session_message_queue WHERE id=? AND status IN ('queued','failed','delivery-uncertain')",(p["id"],)); return result.rowcount==1
    if op == "recover_session_messages":
        result=db.execute("UPDATE session_message_queue SET status='delivery-uncertain',updated_at=?,error='Server stopped while dispatching. Delivery could not be confirmed; automatic retry is blocked.' WHERE status='dispatching'",(p["updatedAt"],)); return result.rowcount
    if op == "create_quota_task_reservation":
        x=p["item"]
        db.execute("""INSERT INTO quota_task_reservations(
          id,provider,project_id,execution_host_id,workspace_id,title,request_json,permission_snapshot_json,status,criterion,idempotency_key,
          created_at,updated_at,next_check_at,last_quota_check_at,last_quota_status,claim_started_at,task_id,error
        ) VALUES(?,?,?,?,?,?,?,?,?,'next-five-hour-reset',?,?,?,?,?,?,?,?,?)""",(
          x["id"],x["provider"],x["projectId"],x["executionHostId"],x["workspaceId"],x.get("title"),
          json.dumps(x["request"],ensure_ascii=False),json.dumps(x["permissionSnapshot"],ensure_ascii=False),x["status"],x["idempotencyKey"],
          x["createdAt"],x["updatedAt"],x["nextCheckAt"],x.get("lastQuotaCheckAt"),x.get("lastQuotaStatus"),x.get("claimStartedAt"),x.get("taskId"),x.get("error")
        ))
        return quota_reservation_row(db.execute("SELECT * FROM quota_task_reservations WHERE id=?",(x["id"],)).fetchone())
    if op == "get_quota_task_reservation":
        return quota_reservation_row(db.execute("SELECT * FROM quota_task_reservations WHERE id=?",(p["id"],)).fetchone())
    if op == "list_quota_task_reservations":
        clauses=[];args=[]
        if not p.get("includeTerminal",True):
            clauses.append("status IN ('waiting-quota','claiming','starting','failed')" if p.get("includeFailed") else "status IN ('waiting-quota','claiming','starting')")
        if p.get("provider"): clauses.append("provider=?");args.append(p["provider"])
        where=(" WHERE "+" AND ".join(clauses)) if clauses else ""
        return [quota_reservation_row(r) for r in db.execute(f"SELECT * FROM quota_task_reservations{where} ORDER BY CASE WHEN status IN ('waiting-quota','claiming','starting') THEN 0 WHEN status='failed' THEN 1 ELSE 2 END,created_at DESC LIMIT ?",(*args,p.get("limit",200)))]
    if op == "list_due_quota_task_reservations":
        return [quota_reservation_row(r) for r in db.execute("SELECT * FROM quota_task_reservations WHERE status='waiting-quota' AND next_check_at<=? ORDER BY next_check_at,created_at LIMIT ?",(p["now"],p.get("limit",100)))]
    if op == "claim_quota_task_reservation":
        row=db.execute("UPDATE quota_task_reservations SET status='claiming',claim_started_at=?,updated_at=?,last_quota_check_at=?,last_quota_status=? WHERE id=? AND status='waiting-quota' RETURNING *",(p["now"],p["now"],p["now"],p["quotaStatus"],p["id"])).fetchone()
        return quota_reservation_row(row)
    if op == "reschedule_quota_task_reservation":
        row=db.execute("UPDATE quota_task_reservations SET updated_at=?,next_check_at=?,last_quota_check_at=?,last_quota_status=?,error=NULL,quota_check_count=quota_check_count+1 WHERE id=? AND status='waiting-quota' RETURNING *",(p["now"],p["nextCheckAt"],p["lastQuotaCheckAt"],p["lastQuotaStatus"],p["id"])).fetchone()
        return quota_reservation_row(row)
    if op == "mark_quota_task_reservation_starting":
        row=db.execute("UPDATE quota_task_reservations SET status='starting',updated_at=?,task_id=?,error=NULL WHERE id=? AND status='claiming' RETURNING *",(p["now"],p["taskId"],p["id"])).fetchone()
        return quota_reservation_row(row)
    if op == "mark_quota_task_reservation_started":
        row=db.execute("UPDATE quota_task_reservations SET status='started',updated_at=?,task_id=?,error=NULL WHERE id=? AND status='starting' RETURNING *",(p["now"],p["taskId"],p["id"])).fetchone()
        return quota_reservation_row(row)
    if op == "fail_quota_task_reservation":
        row=db.execute("UPDATE quota_task_reservations SET status='failed',updated_at=?,task_id=NULL,error=? WHERE id=? AND status IN ('claiming','starting') RETURNING *",(p["now"],p["error"],p["id"])).fetchone()
        return quota_reservation_row(row)
    if op == "retry_quota_task_reservation":
        row=db.execute("UPDATE quota_task_reservations SET status='waiting-quota',updated_at=?,next_check_at=?,claim_started_at=NULL,task_id=NULL,error=NULL,quota_check_count=0 WHERE id=? AND status='failed' AND task_id IS NULL RETURNING *",(p["now"],p["now"],p["id"])).fetchone()
        return quota_reservation_row(row)
    if op == "cancel_quota_task_reservation":
        row=db.execute("UPDATE quota_task_reservations SET status='cancelled',updated_at=?,error=NULL WHERE id=? AND status='waiting-quota' RETURNING *",(p["now"],p["id"])).fetchone()
        return quota_reservation_row(row)
    if op == "recover_quota_task_reservations":
        clauses=["status IN ('claiming','starting')"];args=[]
        if p.get("staleBefore"): clauses.append("updated_at<=?");args.append(p["staleBefore"])
        rows=db.execute(f"SELECT * FROM quota_task_reservations WHERE {' AND '.join(clauses)}",args).fetchall()
        recovered=[]
        for row in rows:
            if row["task_id"] and db.execute("SELECT 1 FROM tasks WHERE id=?",(row["task_id"],)).fetchone():
                db.execute("UPDATE quota_task_reservations SET status='started',updated_at=?,error=NULL WHERE id=?",(p["now"],row["id"]))
            elif row["status"]=="starting":
                db.execute("UPDATE quota_task_reservations SET status='failed',updated_at=?,task_id=NULL,error=? WHERE id=?",(p["now"],"Provider launch began, but task creation could not be confirmed. Automatic retry is blocked to prevent duplicate execution.",row["id"]))
            else:
                db.execute("UPDATE quota_task_reservations SET status='waiting-quota',updated_at=?,next_check_at=?,claim_started_at=NULL,error=? WHERE id=?",(p["now"],p["now"],"Recovered after server restart before task creation was confirmed.",row["id"]))
            recovered.append(quota_reservation_row(db.execute("SELECT * FROM quota_task_reservations WHERE id=?",(row["id"],)).fetchone()))
        return recovered
    if op == "get_task_recovery_attempt":
        return task_recovery_row(db.execute("SELECT * FROM task_recovery_attempts WHERE source_task_id=?",(p["sourceTaskId"],)).fetchone())
    if op == "claim_task_recovery":
        try:
            db.execute("BEGIN IMMEDIATE")
            existing=db.execute("SELECT * FROM task_recovery_attempts WHERE source_task_id=?",(p["sourceTaskId"],)).fetchone()
            if existing is not None:
                db.execute("COMMIT")
                return {"claimed":False,"attempt":task_recovery_row(existing)}
            db.execute("INSERT INTO task_recovery_attempts(source_task_id,attempt_id,status,prompt_hash,created_at,updated_at,resumed_task_id,error) VALUES(?,?,'claiming',?,?,?,NULL,NULL)",(p["sourceTaskId"],p["attemptId"],p["promptHash"],p["now"],p["now"]))
            created=db.execute("SELECT * FROM task_recovery_attempts WHERE source_task_id=?",(p["sourceTaskId"],)).fetchone()
            db.execute("COMMIT")
            return {"claimed":True,"attempt":task_recovery_row(created)}
        except Exception:
            if db.in_transaction: db.execute("ROLLBACK")
            raise
    if op == "finish_task_recovery":
        row=db.execute("UPDATE task_recovery_attempts SET status=?,updated_at=?,resumed_task_id=?,error=? WHERE source_task_id=? AND attempt_id=? AND status='claiming' RETURNING *",(p["status"],p["now"],p.get("resumedTaskId"),p.get("error"),p["sourceTaskId"],p["attemptId"])).fetchone()
        return task_recovery_row(row)
    if op == "release_task_recovery_claim":
        result=db.execute("DELETE FROM task_recovery_attempts WHERE source_task_id=? AND attempt_id=? AND status='claiming'",(p["sourceTaskId"],p["attemptId"]))
        return result.rowcount == 1
    if op == "recover_task_recovery_attempts":
        attempts=db.execute("SELECT * FROM task_recovery_attempts WHERE status='claiming'").fetchall()
        recovered=[]
        for attempt in attempts:
            resumed=None
            for task in db.execute("SELECT id,metadata_json FROM tasks WHERE id<>?",(attempt["source_task_id"],)).fetchall():
                try: metadata=json.loads(task["metadata_json"] or "{}")
                except Exception: metadata={}
                if metadata.get("recoveredFromTaskId")==attempt["source_task_id"] and metadata.get("recoveryAttemptId")==attempt["attempt_id"]:
                    resumed=task["id"]
                    break
            if resumed is None:
                source=db.execute("SELECT id,metadata_json FROM tasks WHERE id=?",(attempt["source_task_id"],)).fetchone()
                if source is not None:
                    try: metadata=json.loads(source["metadata_json"] or "{}")
                    except Exception: metadata={}
                    if metadata.get("recoveredFromTaskId")==attempt["source_task_id"] and metadata.get("recoveryAttemptId")==attempt["attempt_id"]: resumed=source["id"]
            if resumed is not None:
                db.execute("UPDATE task_recovery_attempts SET status='started',updated_at=?,resumed_task_id=?,error=NULL WHERE source_task_id=? AND attempt_id=? AND status='claiming'",(p["now"],resumed,attempt["source_task_id"],attempt["attempt_id"]))
            else:
                db.execute("UPDATE task_recovery_attempts SET status='failed',updated_at=?,error=? WHERE source_task_id=? AND attempt_id=? AND status='claiming'",(p["now"],"Server restarted after Provider recovery launch may have begun. Automatic retry is blocked to prevent duplicate execution.",attempt["source_task_id"],attempt["attempt_id"]))
            recovered.append(task_recovery_row(db.execute("SELECT * FROM task_recovery_attempts WHERE source_task_id=?",(attempt["source_task_id"],)).fetchone()))
        return recovered
    if op == "latest_thread_task": return task_row(db.execute("SELECT * FROM tasks WHERE provider=? AND thread_id=? ORDER BY created_at DESC,updated_at DESC LIMIT 1",(p["provider"],p["threadId"])).fetchone())
    if op == "claim_idempotency":
        now=p["now"]
        try:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM idempotency WHERE state IN ('completed','failed') AND updated_at<?",(p.get("pruneBefore","1970-01-01T00:00:00.000Z"),))
            row=db.execute("SELECT * FROM idempotency WHERE key=? AND action=?",(p["key"],p["action"])).fetchone()
            if row:
                stale=row["state"]=="pending" and row["updated_at"]<p.get("staleBefore",now) and row["owner_token"]!=p.get("ownerToken")
                if stale:
                    db.execute("UPDATE idempotency SET request_hash=?,state='pending',response_json=NULL,owner_token=?,updated_at=? WHERE key=? AND action=?",(p["requestHash"],p.get("ownerToken"),now,p["key"],p["action"]))
                    db.execute("COMMIT")
                    return {"claimed":True,"state":"pending","requestHash":p["requestHash"],"response":None}
                db.execute("COMMIT")
                return {"claimed":False,"state":row["state"],"requestHash":row["request_hash"],"response":json.loads(row["response_json"]) if row["response_json"] else None}
            db.execute("INSERT INTO idempotency(key,action,request_hash,state,response_json,owner_token,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",(p["key"],p["action"],p["requestHash"],"pending",None,p.get("ownerToken"),now,now))
            db.execute("COMMIT")
            return {"claimed":True,"state":"pending","requestHash":p["requestHash"],"response":None}
        except Exception:
            db.execute("ROLLBACK")
            raise
    if op == "finish_idempotency":
        result=db.execute("UPDATE idempotency SET state=?,response_json=?,updated_at=? WHERE key=? AND action=? AND (owner_token=? OR (owner_token IS NULL AND ? IS NULL))",(p["state"],json.dumps(p.get("response"),ensure_ascii=False),p["now"],p["key"],p["action"],p.get("ownerToken"),p.get("ownerToken")))
        return result.rowcount==1
    if op == "append_audit":
        db.execute("INSERT INTO audit_log(created_at,actor,action,provider,task_id,project_id,outcome,detail,host_id,workspace_id) VALUES(?,?,?,?,?,?,?,?,?,?)",(p["createdAt"],p["actor"],p["action"],p.get("provider"),p.get("taskId"),p.get("projectId"),p["outcome"],p.get("detail"),p.get("hostId"),p.get("workspaceId")))
        return True
    if op == "proven_task_ids": return [r[0] for r in db.execute("SELECT DISTINCT task_id FROM audit_log WHERE outcome='success' AND action IN ('create','message','fork','codex-message','codex-fork') AND task_id IS NOT NULL")]
    if op == "upsert_codex_thread":
        t=preserve_newer_thread_settings(p["thread"])
        columns=["thread_id","session_id","project_id","cwd","title","preview","source","ownership","status","archived","parent_thread_id","forked_from_id","model_provider","requested_model","effective_model","requested_reasoning_effort","effective_reasoning_effort","requested_service_tier","effective_service_tier","permission_profile","settings_updated_at","created_at","updated_at","last_seen_at","metadata_json","execution_host_id","workspace_id","work_chain_id"]
        keys={"thread_id":"threadId","session_id":"sessionId","project_id":"projectId","parent_thread_id":"parentThreadId","forked_from_id":"forkedFromId","model_provider":"modelProvider","requested_model":"requestedModel","effective_model":"effectiveModel","requested_reasoning_effort":"requestedReasoningEffort","effective_reasoning_effort":"effectiveReasoningEffort","requested_service_tier":"requestedServiceTier","effective_service_tier":"effectiveServiceTier","permission_profile":"permissionProfile","settings_updated_at":"settingsUpdatedAt","created_at":"createdAt","updated_at":"updatedAt","last_seen_at":"lastSeenAt","metadata_json":"metadata","execution_host_id":"executionHostId","workspace_id":"workspaceId","work_chain_id":"workChainId"}
        values=[]
        for col in columns:
            value=t.get(keys.get(col,col))
            if col=="metadata_json": value=json.dumps(value or {},ensure_ascii=False)
            if col=="archived": value=1 if value else 0
            values.append(value)
        marks=",".join("?" for _ in columns)
        # Once Claudex Workhouse has proven ownership of a thread, an app-server list
        # snapshot must not downgrade it to an external VS Code/CLI session.
        # Such a downgrade removes the composer and leaves the session
        # read-only until a refresh/restart repairs it.
        updates=[]
        for c in columns:
            if c=="thread_id": continue
            if c=="ownership": updates.append("ownership=CASE WHEN codex_threads.ownership='claudex-workhouse' THEN codex_threads.ownership ELSE COALESCE(excluded.ownership,codex_threads.ownership) END")
            elif c=="source": updates.append("source=CASE WHEN codex_threads.ownership='claudex-workhouse' THEN codex_threads.source ELSE COALESCE(excluded.source,codex_threads.source) END")
            elif c in ["requested_model","requested_reasoning_effort","requested_service_tier","permission_profile","settings_updated_at"]: updates.append(f"{c}=excluded.{c}")
            else: updates.append(f"{c}=COALESCE(excluded.{c},{c})")
        updates=",".join(updates)
        db.execute(f"INSERT INTO codex_threads({','.join(columns)}) VALUES({marks}) ON CONFLICT(thread_id) DO UPDATE SET {updates}",values)
        sync_codex_thread_search_document(t["threadId"])
        return thread_row(db.execute("SELECT * FROM codex_threads WHERE thread_id=?",(t["threadId"],)).fetchone())
    if op == "apply_task_thread_settings":
        tasks=p.get("tasks") or []
        t=p["thread"]
        columns=["thread_id","session_id","project_id","cwd","title","preview","source","ownership","status","archived","parent_thread_id","forked_from_id","model_provider","requested_model","effective_model","requested_reasoning_effort","effective_reasoning_effort","requested_service_tier","effective_service_tier","permission_profile","settings_updated_at","created_at","updated_at","last_seen_at","metadata_json","execution_host_id","workspace_id","work_chain_id"]
        keys={"thread_id":"threadId","session_id":"sessionId","project_id":"projectId","parent_thread_id":"parentThreadId","forked_from_id":"forkedFromId","model_provider":"modelProvider","requested_model":"requestedModel","effective_model":"effectiveModel","requested_reasoning_effort":"requestedReasoningEffort","effective_reasoning_effort":"effectiveReasoningEffort","requested_service_tier":"requestedServiceTier","effective_service_tier":"effectiveServiceTier","permission_profile":"permissionProfile","settings_updated_at":"settingsUpdatedAt","created_at":"createdAt","updated_at":"updatedAt","last_seen_at":"lastSeenAt","metadata_json":"metadata","execution_host_id":"executionHostId","workspace_id":"workspaceId","work_chain_id":"workChainId"}
        try:
            db.execute("BEGIN IMMEDIATE")
            t=preserve_newer_thread_settings(t)
            task_marks=",".join("?" for _ in TASK_COLUMNS)
            task_updates=",".join(f"{c}=excluded.{c}" for c in TASK_COLUMNS if c != "id")
            for task in tasks:
                db.execute(f"INSERT INTO tasks ({','.join(TASK_COLUMNS)}) VALUES ({task_marks}) ON CONFLICT(id) DO UPDATE SET {task_updates}",task_values(task))
                sync_task_search_document(task["id"])
            values=[]
            for col in columns:
                value=t.get(keys.get(col,col))
                if col=="metadata_json": value=json.dumps(value or {},ensure_ascii=False)
                if col=="archived": value=1 if value else 0
                values.append(value)
            marks=",".join("?" for _ in columns)
            updates=[]
            for col in columns:
                if col=="thread_id": continue
                if col=="ownership": updates.append("ownership=CASE WHEN codex_threads.ownership='claudex-workhouse' THEN codex_threads.ownership ELSE COALESCE(excluded.ownership,codex_threads.ownership) END")
                elif col=="source": updates.append("source=CASE WHEN codex_threads.ownership='claudex-workhouse' THEN codex_threads.source ELSE COALESCE(excluded.source,codex_threads.source) END")
                elif col in ["requested_model","requested_reasoning_effort","requested_service_tier","permission_profile","settings_updated_at"]: updates.append(f"{col}=excluded.{col}")
                else: updates.append(f"{col}=COALESCE(excluded.{col},{col})")
            db.execute(f"INSERT INTO codex_threads({','.join(columns)}) VALUES({marks}) ON CONFLICT(thread_id) DO UPDATE SET {','.join(updates)}",values)
            sync_codex_thread_search_document(t["threadId"])
            db.execute("COMMIT")
            return {"tasks":[task_row(db.execute("SELECT * FROM tasks WHERE id=?",(task["id"],)).fetchone()) for task in tasks],"thread":thread_row(db.execute("SELECT * FROM codex_threads WHERE thread_id=?",(t["threadId"],)).fetchone())}
        except Exception:
            if db.in_transaction: db.execute("ROLLBACK")
            raise
    if op == "get_codex_thread": return thread_row(db.execute("SELECT * FROM codex_threads WHERE thread_id=?",(p["threadId"],)).fetchone())
    if op == "list_codex_threads": return [thread_row(r) for r in db.execute("SELECT * FROM codex_threads WHERE archived=? ORDER BY updated_at DESC,thread_id LIMIT ?",(1 if p.get("archived") else 0,p.get("limit",100)))]
    if op == "list_codex_threads_by_ids":
        thread_ids=[str(value) for value in p.get("threadIds",[])[:100] if value]
        if not thread_ids: return []
        marks=",".join("?" for _ in thread_ids)
        return [thread_row(r) for r in db.execute(f"SELECT * FROM codex_threads WHERE thread_id IN ({marks})",thread_ids)]
    if op == "delete_codex_thread": db.execute("DELETE FROM codex_threads WHERE thread_id=?",(p["threadId"],)); return True
    if op == "put_cache": db.execute("INSERT INTO provider_cache VALUES(?,?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET value_json=excluded.value_json,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at,version=excluded.version",(p["key"],json.dumps(p["value"],ensure_ascii=False),p["fetchedAt"],p["expiresAt"],p.get("version"))); return True
    if op == "get_cache":
        row=db.execute("SELECT * FROM provider_cache WHERE cache_key=?",(p["key"],)).fetchone()
        return None if row is None else {"value":json.loads(row["value_json"]),"fetchedAt":row["fetched_at"],"expiresAt":row["expires_at"],"version":row["version"]}
    if op == "list_push_subscriptions": return [object_row(r) for r in db.execute("SELECT * FROM push_subscriptions WHERE disabled_at IS NULL ORDER BY last_used_at DESC")]
    if op == "upsert_push_subscription":
        x=p["subscription"]
        db.execute("INSERT INTO push_subscriptions(id,endpoint_hash,encrypted_json,browser_label,created_at,last_used_at,disabled_at) VALUES(?,?,?,?,?,?,NULL) ON CONFLICT(endpoint_hash) DO UPDATE SET encrypted_json=excluded.encrypted_json,browser_label=excluded.browser_label,last_used_at=excluded.last_used_at,disabled_at=NULL",(x["id"],x["endpointHash"],x["encryptedJson"],x.get("browserLabel"),x["createdAt"],x["lastUsedAt"]))
        return True
    if op == "disable_push_subscription": db.execute("UPDATE push_subscriptions SET disabled_at=? WHERE id=? OR endpoint_hash=?",(p["disabledAt"],p.get("id"),p.get("endpointHash"))); return True
    if op == "disable_all_push_subscriptions": db.execute("UPDATE push_subscriptions SET disabled_at=? WHERE disabled_at IS NULL",(p["disabledAt"],)); return True
    if op == "list_external_access_profiles": return [object_row(r,{"configuration_json","managed_resources_json"}) for r in db.execute("SELECT * FROM external_access_profiles ORDER BY provider")]
    if op == "get_external_access_profile": return object_row(db.execute("SELECT * FROM external_access_profiles WHERE id=?",(p["id"],)).fetchone(),{"configuration_json","managed_resources_json"})
    if op == "upsert_external_access_profile":
        x=p["profile"]
        try:
            db.execute("BEGIN IMMEDIATE")
            current=db.execute("SELECT * FROM external_access_profiles WHERE provider=?",(x["provider"],)).fetchone()
            if current is not None and p.get("expectedRevision") is not None and current["revision"]!=p["expectedRevision"]:
                db.execute("COMMIT"); return {"updated":False,"current":object_row(current,{"configuration_json","managed_resources_json"})}
            revision=(current["revision"]+1) if current is not None else 1
            identity=current["id"] if current is not None else x["id"]
            created=current["created_at"] if current is not None else x["createdAt"]
            db.execute("INSERT INTO external_access_profiles(id,provider,desired_mode,configuration_json,configuration_source,managed_resources_json,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET desired_mode=excluded.desired_mode,configuration_json=excluded.configuration_json,configuration_source=excluded.configuration_source,managed_resources_json=excluded.managed_resources_json,revision=excluded.revision,updated_at=excluded.updated_at",(identity,x["provider"],x["desiredMode"],json.dumps(x.get("configuration") or {},ensure_ascii=False),x["configurationSource"],json.dumps(x.get("managedResources") or [],ensure_ascii=False),revision,created,x["updatedAt"]))
            row=db.execute("SELECT * FROM external_access_profiles WHERE provider=?",(x["provider"],)).fetchone();db.execute("COMMIT")
            return {"updated":True,"current":object_row(row,{"configuration_json","managed_resources_json"})}
        except Exception:
            if db.in_transaction: db.execute("ROLLBACK")
            raise
    if op == "delete_external_access_profile": return db.execute("DELETE FROM external_access_profiles WHERE id=? AND revision=?",(p["id"],p["revision"])).rowcount==1
    if op == "create_external_access_operation":
        x=p["operation"]
        db.execute("INSERT INTO external_access_operations(id,profile_id,provider,action,plan_digest,status,stage,safe_error_code,started_at,updated_at,finished_at,rollback_status,interrupted) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",(x["id"],x.get("profileId"),x["provider"],x["action"],x["planDigest"],x["status"],x["stage"],x.get("safeErrorCode"),x.get("startedAt"),x["updatedAt"],x.get("finishedAt"),x.get("rollbackStatus"),bool(x.get("interrupted"))))
        return object_row(db.execute("SELECT * FROM external_access_operations WHERE id=?",(x["id"],)).fetchone())
    if op == "update_external_access_operation":
        x=p["operation"]
        db.execute("UPDATE external_access_operations SET profile_id=?,status=?,stage=?,safe_error_code=?,started_at=?,updated_at=?,finished_at=?,rollback_status=?,interrupted=? WHERE id=?",(x.get("profileId"),x["status"],x["stage"],x.get("safeErrorCode"),x.get("startedAt"),x["updatedAt"],x.get("finishedAt"),x.get("rollbackStatus"),bool(x.get("interrupted")),x["id"]))
        return object_row(db.execute("SELECT * FROM external_access_operations WHERE id=?",(x["id"],)).fetchone())
    if op == "get_external_access_operation": return object_row(db.execute("SELECT * FROM external_access_operations WHERE id=?",(p["id"],)).fetchone())
    if op == "list_external_access_checks": return [object_row(r) for r in db.execute("SELECT * FROM external_access_checks WHERE operation_id=? ORDER BY checked_at,id",(p["operationId"],))]
    if op == "append_external_access_check":
        x=p["check"];db.execute("INSERT INTO external_access_checks(operation_id,profile_id,check_code,status,safe_detail,checked_at) VALUES(?,?,?,?,?,?)",(x.get("operationId"),x.get("profileId"),x["code"],x["status"],x["detail"],x["checkedAt"]));return True
    if op == "reconcile_external_access_operations": return db.execute("UPDATE external_access_operations SET status='interrupted',stage='interrupted',safe_error_code='SERVER_RESTARTED',interrupted=1,updated_at=?,finished_at=? WHERE status IN ('pending','awaiting_approval','running','verifying','rolling_back')",(p["now"],p["now"])).rowcount
    if op == "create_proton_upload_operation":
        x=p["operation"]
        db.execute("INSERT INTO proton_upload_operations(id,host_id,task_id,workspace_id,source_relative_path,source_name,source_size,source_sha256,remote_path,status,stage,safe_error_code,cli_version,created_at,started_at,updated_at,finished_at,interrupted) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",(x["id"],x["hostId"],x["taskId"],x["workspaceId"],x["sourceRelativePath"],x["sourceName"],x["sourceSize"],x["sourceSha256"],x["remotePath"],x["status"],x["stage"],x.get("safeErrorCode"),x.get("cliVersion"),x["createdAt"],x.get("startedAt"),x["updatedAt"],x.get("finishedAt"),bool(x.get("interrupted"))))
        return object_row(db.execute("SELECT * FROM proton_upload_operations WHERE id=?",(x["id"],)).fetchone())
    if op == "update_proton_upload_operation":
        x=p["operation"]
        db.execute("UPDATE proton_upload_operations SET status=?,stage=?,safe_error_code=?,cli_version=?,started_at=?,updated_at=?,finished_at=?,interrupted=? WHERE id=?",(x["status"],x["stage"],x.get("safeErrorCode"),x.get("cliVersion"),x.get("startedAt"),x["updatedAt"],x.get("finishedAt"),bool(x.get("interrupted")),x["id"]))
        return object_row(db.execute("SELECT * FROM proton_upload_operations WHERE id=?",(x["id"],)).fetchone())
    if op == "get_proton_upload_operation": return object_row(db.execute("SELECT * FROM proton_upload_operations WHERE id=?",(p["id"],)).fetchone())
    if op == "list_proton_upload_operations": return [object_row(row) for row in db.execute("SELECT * FROM proton_upload_operations ORDER BY updated_at DESC,id DESC LIMIT ?",(max(1,min(int(p.get("limit",50)),200)),)).fetchall()]
    if op == "reconcile_proton_upload_operations": return db.execute("UPDATE proton_upload_operations SET status='delivery-uncertain',stage='delivery-uncertain',safe_error_code='SERVER_RESTARTED',interrupted=1,updated_at=?,finished_at=? WHERE status IN ('running','verifying')",(p["now"],p["now"])).rowcount
    if op == "put_system_setting": db.execute("INSERT INTO system_settings(setting_key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(setting_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",(p["key"],json.dumps(p["value"],ensure_ascii=False),p["updatedAt"])); return True
    if op == "put_system_setting_if_updated":
        try:
            db.execute("BEGIN IMMEDIATE")
            row=db.execute("SELECT value_json,updated_at FROM system_settings WHERE setting_key=?",(p["key"],)).fetchone()
            current=None if row is None else {"value":json.loads(row["value_json"]),"updatedAt":row["updated_at"]}
            if (None if row is None else row["updated_at"])!=p.get("expectedUpdatedAt"):
                db.execute("COMMIT");return{"updated":False,"current":current}
            db.execute("INSERT INTO system_settings(setting_key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(setting_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",(p["key"],json.dumps(p["value"],ensure_ascii=False),p["updatedAt"]))
            db.execute("COMMIT");return{"updated":True,"current":{"value":p["value"],"updatedAt":p["updatedAt"]}}
        except Exception:
            if db.in_transaction: db.execute("ROLLBACK")
            raise
    if op == "get_system_setting":
        row=db.execute("SELECT value_json,updated_at FROM system_settings WHERE setting_key=?",(p["key"],)).fetchone(); return None if row is None else {"value":json.loads(row["value_json"]),"updatedAt":row["updated_at"]}
    if op == "update_application_update_attempt": pass
    if op in ("create_application_update_attempt","update_application_update_attempt"):
        x=p["attempt"]
        columns=["id","state","source_version","target_version","manifest_sha256","install_method","platform","architecture","snapshot_id","request_path","rollback_performed","error","created_at","updated_at","completed_at"]
        keys={"source_version":"sourceVersion","target_version":"targetVersion","manifest_sha256":"manifestSha256","install_method":"installMethod","snapshot_id":"snapshotId","request_path":"requestPath","rollback_performed":"rollbackPerformed","created_at":"createdAt","updated_at":"updatedAt","completed_at":"completedAt"}
        values=[]
        for column in columns:
            value=x.get(keys.get(column,column))
            if column=="rollback_performed": value=1 if value else 0
            values.append(value)
        if op=="create_application_update_attempt":
            db.execute(f"INSERT INTO application_update_attempts({','.join(columns)}) VALUES({','.join('?' for _ in columns)})",values)
        else:
            updates=",".join(f"{column}=?" for column in columns if column not in ("id","created_at"))
            update_values=[values[index] for index,column in enumerate(columns) if column not in ("id","created_at")]+[x["id"]]
            if db.execute(f"UPDATE application_update_attempts SET {updates} WHERE id=?",update_values).rowcount!=1: raise ValueError("Application update attempt not found")
        result=object_row(db.execute("SELECT * FROM application_update_attempts WHERE id=?",(x["id"],)).fetchone());result["rollbackPerformed"]=bool(result["rollbackPerformed"]);return result
    if op == "get_active_application_update_attempt":
        row=db.execute("SELECT * FROM application_update_attempts WHERE state IN ('staging','applying','verifying','rollback-running') ORDER BY created_at DESC LIMIT 1").fetchone()
        if row is None:return None
        result=object_row(row);result["rollbackPerformed"]=bool(result["rollbackPerformed"]);return result
    if op == "get_application_update_attempt":
        row=db.execute("SELECT * FROM application_update_attempts WHERE id=?",(p["id"],)).fetchone()
        if row is None:return None
        result=object_row(row);result["rollbackPerformed"]=bool(result["rollbackPerformed"]);return result
    if op == "list_application_update_attempts":
        limit=max(1,min(int(p.get("limit",10)),100));rows=db.execute("SELECT * FROM application_update_attempts ORDER BY created_at DESC,id DESC LIMIT ?",(limit,)).fetchall();result=[]
        for row in rows:
            item=object_row(row);item["rollbackPerformed"]=bool(item["rollbackPerformed"]);result.append(item)
        return result
    if op == "accept_release_state":
        key="deployment.release-state.v1";x=p["state"]
        try:
            db.execute("BEGIN IMMEDIATE")
            row=db.execute("SELECT value_json FROM system_settings WHERE setting_key=?",(key,)).fetchone()
            current=json.loads(row["value_json"]) if row else None
            valid=lambda value:isinstance(value,dict) and value.get("schemaVersion")==1 and isinstance(value.get("channel"),str) and 0<len(value.get("channel"))<=32 and value.get("channel")[0].islower() and all(c.islower() or c.isdigit() or c=="-" for c in value.get("channel")) and type(value.get("releaseSequence")) is int and value.get("releaseSequence")>0 and isinstance(value.get("manifestSha256"),str) and len(value.get("manifestSha256"))==64 and all(c in "0123456789abcdef" for c in value.get("manifestSha256"))
            if not valid(x):
                db.execute("ROLLBACK");return {"accepted":False,"reason":"invalid-state","current":current}
            if current is not None and not valid(current):
                db.execute("ROLLBACK");return {"accepted":False,"reason":"invalid-state","current":current}
            if current is not None and current["channel"]!=x["channel"]:
                db.execute("ROLLBACK");return {"accepted":False,"reason":"channel-mismatch","current":current}
            if current is not None and x["releaseSequence"]<current["releaseSequence"]:
                db.execute("ROLLBACK");return {"accepted":False,"reason":"downgrade","current":current}
            if current is not None and x["releaseSequence"]==current["releaseSequence"] and x["manifestSha256"]!=current["manifestSha256"]:
                db.execute("ROLLBACK");return {"accepted":False,"reason":"equivocation","current":current}
            reused=current is not None and x["releaseSequence"]==current["releaseSequence"] and x["manifestSha256"]==current["manifestSha256"]
            db.execute("INSERT INTO system_settings(setting_key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(setting_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",(key,json.dumps(x,ensure_ascii=False),p["updatedAt"]))
            db.execute("COMMIT");return {"accepted":True,"reused":reused,"current":x}
        except Exception:
            if db.in_transaction: db.execute("ROLLBACK")
            raise
    if op == "upsert_snapshot":
        x=p["snapshot"]
        columns=["id","format_version","logical_key","kind","origin","state","relative_path","created_at","updated_at","size_bytes","file_count","verification","pinned","protected_reason","trashed_at","purge_after","last_error","manifest_digest"]
        keys={"format_version":"formatVersion","logical_key":"logicalKey","relative_path":"relativePath","created_at":"createdAt","updated_at":"updatedAt","size_bytes":"sizeBytes","file_count":"fileCount","protected_reason":"protectedReason","trashed_at":"trashedAt","purge_after":"purgeAfter","last_error":"lastError","manifest_digest":"manifestDigest"}
        values=[]
        for column in columns:
            value=x.get(keys.get(column,column))
            if column=="pinned": value=1 if value else 0
            values.append(value)
        updates=",".join(f"{column}=excluded.{column}" for column in columns if column not in ("id","created_at"))
        db.execute(f"INSERT INTO snapshots({','.join(columns)}) VALUES({','.join('?' for _ in columns)}) ON CONFLICT(id) DO UPDATE SET {updates}",values)
        row=db.execute("SELECT * FROM snapshots WHERE id=?",(x["id"],)).fetchone()
        result=object_row(row); result["pinned"]=bool(result["pinned"]); return result
    if op == "get_snapshot":
        row=db.execute("SELECT * FROM snapshots WHERE id=?",(p["id"],)).fetchone()
        if row is None: return None
        result=object_row(row); result["pinned"]=bool(result["pinned"]); return result
    if op == "list_snapshots":
        rows=db.execute("SELECT * FROM snapshots ORDER BY created_at DESC,id").fetchall()
        result=[]
        for row in rows:
            item=object_row(row); item["pinned"]=bool(item["pinned"]); result.append(item)
        return result
    if op == "list_hosts": return [host_row(r) for r in db.execute("SELECT * FROM execution_hosts ORDER BY type,name")]
    if op == "get_host": return host_row(db.execute("SELECT * FROM execution_hosts WHERE id=?",(p["id"],)).fetchone())
    if op == "upsert_host":
        h=p["host"]; now=h.get("updatedAt") or h.get("createdAt")
        db.execute("""INSERT INTO execution_hosts(id,type,name,display_name,platform,architecture,operating_system_version,worker_version,status,capabilities_json,last_seen_at,created_at,updated_at,disabled_at,revoked_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,display_name=excluded.display_name,platform=excluded.platform,architecture=excluded.architecture,operating_system_version=excluded.operating_system_version,worker_version=excluded.worker_version,status=excluded.status,capabilities_json=excluded.capabilities_json,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at,disabled_at=excluded.disabled_at,revoked_at=excluded.revoked_at""",
        (h["id"],h.get("type","worker"),h.get("name",h["id"]),h.get("displayName",h.get("name",h["id"])),h.get("platform","unknown"),h.get("architecture","unknown"),h.get("operatingSystemVersion"),h.get("workerVersion"),h.get("status","unknown"),json.dumps(h.get("capabilities") or {}),h.get("lastSeenAt"),h.get("createdAt",now),now,h.get("disabledAt"),h.get("revokedAt")))
        return host_row(db.execute("SELECT * FROM execution_hosts WHERE id=?",(h["id"],)).fetchone())
    if op == "put_worker_credential":
        db.execute("INSERT INTO worker_credentials(host_id,credential_hash,credential_version,created_at,last_used_at,rotated_at,revoked_at) VALUES(?,?,?,?,?,?,NULL) ON CONFLICT(host_id) DO UPDATE SET credential_hash=excluded.credential_hash,credential_version=excluded.credential_version,rotated_at=excluded.rotated_at,revoked_at=NULL",(p["hostId"],p["credentialHash"],p.get("credentialVersion",1),p["createdAt"],p.get("lastUsedAt"),p.get("rotatedAt")))
        return True
    if op == "get_worker_credential": return object_row(db.execute("SELECT * FROM worker_credentials WHERE host_id=?",(p["hostId"],)).fetchone())
    if op == "revoke_worker_credential": db.execute("UPDATE worker_credentials SET revoked_at=? WHERE host_id=?",(p["revokedAt"],p["hostId"])); return True
    if op == "create_bootstrap_enrollment":
        x=p["enrollment"]
        db.execute("INSERT INTO bootstrap_enrollments(id,scope,token_hash,expires_at,consumed_at,created_at,intended_roles_json) VALUES(?,?,?,?,?,?,?)",
        (x["id"],x["scope"],x["tokenHash"],x["expiresAt"],x.get("consumedAt"),x["createdAt"],json.dumps(x.get("intendedRoles") or [],ensure_ascii=False)))
        return object_row(db.execute("SELECT * FROM bootstrap_enrollments WHERE id=?",(x["id"],)).fetchone(),{"intended_roles_json"})
    if op == "replace_bootstrap_enrollment":
        x=p["enrollment"]
        try:
            db.execute("BEGIN IMMEDIATE")
            db.execute("UPDATE bootstrap_enrollments SET consumed_at=? WHERE scope=? AND consumed_at IS NULL",(x["createdAt"],x["scope"]))
            db.execute("INSERT INTO bootstrap_enrollments(id,scope,token_hash,expires_at,consumed_at,created_at,intended_roles_json) VALUES(?,?,?,?,?,?,?)",
            (x["id"],x["scope"],x["tokenHash"],x["expiresAt"],x.get("consumedAt"),x["createdAt"],json.dumps(x.get("intendedRoles") or [],ensure_ascii=False)))
            row=db.execute("SELECT * FROM bootstrap_enrollments WHERE id=?",(x["id"],)).fetchone()
            db.execute("COMMIT")
            return object_row(row,{"intended_roles_json"})
        except Exception:
            if db.in_transaction: db.execute("ROLLBACK")
            raise
    if op == "get_bootstrap_enrollment":
        return object_row(db.execute("SELECT * FROM bootstrap_enrollments WHERE id=?",(p["id"],)).fetchone(),{"intended_roles_json"})
    if op == "get_active_bootstrap_enrollment":
        row=db.execute("SELECT * FROM bootstrap_enrollments WHERE scope=? AND consumed_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1",(p["scope"],p["now"])).fetchone()
        return object_row(row,{"intended_roles_json"})
    if op == "consume_owner_bootstrap_enrollment":
        try:
            db.execute("BEGIN IMMEDIATE")
            row=db.execute("SELECT * FROM bootstrap_enrollments WHERE id=? AND scope='server-owner' AND token_hash=? AND consumed_at IS NULL AND expires_at>?",(p["id"],p["tokenHash"],p["now"])).fetchone()
            if row is None:
                db.execute("COMMIT")
                return None
            db.execute("UPDATE bootstrap_enrollments SET consumed_at=? WHERE id=? AND consumed_at IS NULL",(p["now"],p["id"]))
            db.execute("INSERT INTO system_settings(setting_key,value_json,updated_at) VALUES('owner.claim',?,?) ON CONFLICT(setting_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",(json.dumps(p["owner"],ensure_ascii=False),p["now"]))
            consumed=db.execute("SELECT * FROM bootstrap_enrollments WHERE id=?",(p["id"],)).fetchone()
            db.execute("COMMIT")
            return object_row(consumed,{"intended_roles_json"})
        except Exception:
            if db.in_transaction: db.execute("ROLLBACK")
            raise
    if op == "recover_owner_bootstrap_enrollment":
        x=p["enrollment"]
        try:
            db.execute("BEGIN IMMEDIATE")
            db.execute("UPDATE bootstrap_enrollments SET consumed_at=? WHERE scope='server-owner' AND consumed_at IS NULL",(x["createdAt"],))
            db.execute("INSERT INTO bootstrap_enrollments(id,scope,token_hash,expires_at,consumed_at,created_at,intended_roles_json) VALUES(?,?,?,?,?,?,?)",
            (x["id"],"server-owner",x["tokenHash"],x["expiresAt"],None,x["createdAt"],json.dumps(x.get("intendedRoles") or [],ensure_ascii=False)))
            db.execute("INSERT INTO system_settings(setting_key,value_json,updated_at) VALUES('owner.claim',?,?) ON CONFLICT(setting_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",(json.dumps(p["recovery"],ensure_ascii=False),x["createdAt"]))
            row=db.execute("SELECT * FROM bootstrap_enrollments WHERE id=?",(x["id"],)).fetchone()
            db.execute("COMMIT")
            return object_row(row,{"intended_roles_json"})
        except Exception:
            if db.in_transaction: db.execute("ROLLBACK")
            raise
    if op == "list_workspace_roots":
        sql="SELECT * FROM workspace_roots"; args=[]
        if p.get("hostId"): sql+=" WHERE host_id=?"; args.append(p["hostId"])
        return [root_row(r) for r in db.execute(sql+" ORDER BY display_name",args)]
    if op == "upsert_workspace_root":
        r=p["root"]
        # A root is identified by (host_id, canonical_path) as well as by id, and
        # callers derive ids from several different historical schemes. Inserting
        # a freshly derived id for a path that is already registered used to raise
        # a UNIQUE violation, which crashed the server on startup. Treat the path
        # as the real identity: update the existing row and report its id back so
        # the caller links workspaces to a root that actually exists.
        existing=db.execute("SELECT * FROM workspace_roots WHERE host_id=? AND canonical_path=?",(r["hostId"],r["canonicalPath"])).fetchone()
        if existing is not None and existing["id"]!=r["id"]:
            db.execute("""UPDATE workspace_roots SET display_name=?,allow_create=?,allow_register=?,allow_clone=?,allow_delete=?,verified_at=?,disabled_at=? WHERE id=?""",
            (r["displayName"],bool(r.get("allowCreate")),bool(r.get("allowRegister",True)),bool(r.get("allowClone")),bool(r.get("allowDelete")),r.get("verifiedAt"),r.get("disabledAt"),existing["id"]))
            return root_row(db.execute("SELECT * FROM workspace_roots WHERE id=?",(existing["id"],)).fetchone())
        db.execute("""INSERT INTO workspace_roots(id,host_id,display_name,canonical_path,allow_create,allow_register,allow_clone,allow_delete,created_at,verified_at,disabled_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,canonical_path=excluded.canonical_path,allow_create=excluded.allow_create,allow_register=excluded.allow_register,allow_clone=excluded.allow_clone,allow_delete=excluded.allow_delete,verified_at=excluded.verified_at,disabled_at=excluded.disabled_at""",
        (r["id"],r["hostId"],r["displayName"],r["canonicalPath"],bool(r.get("allowCreate")),bool(r.get("allowRegister",True)),bool(r.get("allowClone")),bool(r.get("allowDelete")),r["createdAt"],r.get("verifiedAt"),r.get("disabledAt")))
        return root_row(db.execute("SELECT * FROM workspace_roots WHERE id=?",(r["id"],)).fetchone())
    if op == "list_projects": return [project_row(r) for r in db.execute("SELECT * FROM projects ORDER BY name")]
    if op == "upsert_project":
        x=p["project"]
        db.execute("INSERT INTO projects(id,name,slug,description,default_provider,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,slug=excluded.slug,description=excluded.description,default_provider=excluded.default_provider,updated_at=excluded.updated_at,archived_at=excluded.archived_at",(x["id"],x["name"],x.get("slug",x["id"]),x.get("description"),x.get("defaultProvider"),x["createdAt"],x["updatedAt"],x.get("archivedAt")))
        return project_row(db.execute("SELECT * FROM projects WHERE id=?",(x["id"],)).fetchone())
    if op == "list_workspaces":
        clauses=[];args=[]
        if p.get("hostId"): clauses.append("host_id=?");args.append(p["hostId"])
        if p.get("projectId"): clauses.append("project_id=?");args.append(p["projectId"])
        if not p.get("includeArchived"): clauses.append("archived_at IS NULL")
        return [workspace_row(r) for r in db.execute("SELECT * FROM workspaces"+(" WHERE "+" AND ".join(clauses) if clauses else "")+" ORDER BY display_name",args)]
    if op == "get_workspace": return workspace_row(db.execute("SELECT * FROM workspaces WHERE id=?",(p["id"],)).fetchone())
    if op == "upsert_workspace":
        x=p["workspace"]
        # Same identity problem as workspace_roots: (host_id, canonical_path) is
        # unique, but callers derive ids from several schemes. Update the row that
        # already owns the path and return it, rather than raising a UNIQUE error
        # that crashes startup.
        existing=db.execute("SELECT * FROM workspaces WHERE host_id=? AND canonical_path=?",(x["hostId"],x["canonicalPath"])).fetchone()
        if existing is not None and existing["id"]!=x["id"]:
            db.execute("""UPDATE workspaces SET project_id=?,root_id=?,relative_path=?,display_name=?,workspace_type=?,git_remote=?,default_branch=?,last_known_commit=?,last_git_status_json=?,last_verified_at=?,updated_at=?,archived_at=? WHERE id=?""",
            (x["projectId"],x["rootId"],x["relativePath"],x["displayName"],x.get("workspaceType","existing"),x.get("gitRemote"),x.get("defaultBranch"),x.get("lastKnownCommit"),json.dumps(x.get("lastGitStatus")) if x.get("lastGitStatus") is not None else None,x.get("lastVerifiedAt"),x["updatedAt"],x.get("archivedAt"),existing["id"]))
            return workspace_row(db.execute("SELECT * FROM workspaces WHERE id=?",(existing["id"],)).fetchone())
        db.execute("""INSERT INTO workspaces(id,project_id,host_id,root_id,relative_path,canonical_path,display_name,workspace_type,git_remote,default_branch,last_known_commit,last_git_status_json,last_verified_at,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,host_id=excluded.host_id,root_id=excluded.root_id,relative_path=excluded.relative_path,canonical_path=excluded.canonical_path,display_name=excluded.display_name,workspace_type=excluded.workspace_type,git_remote=excluded.git_remote,default_branch=excluded.default_branch,last_known_commit=excluded.last_known_commit,last_git_status_json=excluded.last_git_status_json,last_verified_at=excluded.last_verified_at,updated_at=excluded.updated_at,archived_at=excluded.archived_at""",
        (x["id"],x["projectId"],x["hostId"],x["rootId"],x["relativePath"],x["canonicalPath"],x["displayName"],x.get("workspaceType","existing"),x.get("gitRemote"),x.get("defaultBranch"),x.get("lastKnownCommit"),json.dumps(x.get("lastGitStatus")) if x.get("lastGitStatus") is not None else None,x.get("lastVerifiedAt"),x["createdAt"],x["updatedAt"],x.get("archivedAt")))
        return workspace_row(db.execute("SELECT * FROM workspaces WHERE id=?",(x["id"],)).fetchone())
    if op == "archive_workspace": db.execute("UPDATE workspaces SET archived_at=?,updated_at=? WHERE id=?",(p["archivedAt"],p["archivedAt"],p["id"])); return True
    def work_chain_row(row):
        value=object_row(row,{"roles_json","automation_json"})
        if value is not None: value["boardVisible"]=bool(value["boardVisible"])
        return value
    def work_chain_event_row(row): return object_row(row,{"payload_json"})
    if op == "upsert_work_chain":
        x=p["chain"]
        current=db.execute("SELECT * FROM work_chains WHERE id=?",(x["id"],)).fetchone()
        value=lambda camel_name,column,default=None: x[camel_name] if camel_name in x else (current[column] if current is not None else default)
        db.execute("""INSERT INTO work_chains(id,project_id,title,root_session_id,active_session_id,board_visible,description,board_status,priority,workspace_id,target_branch,roles_json,automation_json,last_activity_at,completed_at,revision,created_at,updated_at,archived_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,root_session_id=COALESCE(excluded.root_session_id,root_session_id),active_session_id=excluded.active_session_id,
          board_visible=excluded.board_visible,description=excluded.description,board_status=excluded.board_status,priority=excluded.priority,workspace_id=excluded.workspace_id,target_branch=excluded.target_branch,
          roles_json=excluded.roles_json,automation_json=excluded.automation_json,last_activity_at=excluded.last_activity_at,completed_at=excluded.completed_at,updated_at=excluded.updated_at,archived_at=excluded.archived_at""",
          (x["id"],x["projectId"],x["title"],value("rootSessionId","root_session_id"),value("activeSessionId","active_session_id"),1 if value("boardVisible","board_visible",False) else 0,
           value("description","description","") or "",value("boardStatus","board_status","queued"),value("priority","priority","normal"),value("workspaceId","workspace_id"),value("targetBranch","target_branch"),
           json.dumps(value("roles","roles_json",{})) if "roles" in x or current is None else current["roles_json"],json.dumps(value("automation","automation_json",{})) if "automation" in x or current is None else current["automation_json"],value("lastActivityAt","last_activity_at"),value("completedAt","completed_at"),
           value("revision","revision",1),x["createdAt"],x["updatedAt"],value("archivedAt","archived_at")))
        return work_chain_row(db.execute("SELECT * FROM work_chains WHERE id=?",(x["id"],)).fetchone())
    if op == "get_work_chain": return work_chain_row(db.execute("SELECT * FROM work_chains WHERE id=?",(p["id"],)).fetchone())
    if op == "list_board_cards":
        clauses=["board_visible=1"]; args=[]
        if p.get("projectId"): clauses.append("project_id=?"); args.append(p["projectId"])
        if p.get("workspaceId"): clauses.append("workspace_id=?"); args.append(p["workspaceId"])
        if not p.get("includeArchived"): clauses.append("archived_at IS NULL")
        return [work_chain_row(row) for row in db.execute("SELECT * FROM work_chains WHERE "+" AND ".join(clauses)+" ORDER BY COALESCE(last_activity_at,updated_at) DESC,id",args)]
    if op == "update_board_card":
        x=p["card"]
        db.execute("BEGIN IMMEDIATE")
        try:
            result=db.execute("""UPDATE work_chains SET title=?,description=?,board_status=?,priority=?,workspace_id=?,target_branch=?,roles_json=?,automation_json=?,board_visible=?,last_activity_at=?,completed_at=?,archived_at=?,updated_at=?,revision=revision+1
              WHERE id=? AND revision=?""",(x["title"],x["description"],x["boardStatus"],x["priority"],x.get("workspaceId"),x.get("targetBranch"),json.dumps(x.get("roles",{})),json.dumps(x.get("automation",{})),1 if x.get("boardVisible",True) else 0,x.get("lastActivityAt"),x.get("completedAt"),x.get("archivedAt"),x["updatedAt"],x["id"],p["expectedRevision"]))
            current=work_chain_row(db.execute("SELECT * FROM work_chains WHERE id=?",(x["id"],)).fetchone()); db.execute("COMMIT")
            return {"updated":result.rowcount==1,"current":current}
        except Exception:
            db.execute("ROLLBACK"); raise
    if op == "append_work_chain_event":
        x=p["event"]
        db.execute("BEGIN IMMEDIATE")
        try:
            result=db.execute("INSERT OR IGNORE INTO work_chain_events(id,chain_id,event_type,task_id,collaboration_session_id,actor_type,actor_id,dedupe_key,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",(x["id"],x["chainId"],x["eventType"],x.get("taskId"),x.get("collaborationSessionId"),x["actorType"],x.get("actorId"),x.get("dedupeKey"),json.dumps(x.get("payload",{})),x["createdAt"]))
            row=db.execute("SELECT * FROM work_chain_events WHERE id=?" if result.rowcount==1 else "SELECT * FROM work_chain_events WHERE chain_id=? AND dedupe_key=?",(x["id"],) if result.rowcount==1 else (x["chainId"],x.get("dedupeKey"))).fetchone()
            if result.rowcount==1: db.execute("UPDATE work_chains SET last_activity_at=?,updated_at=? WHERE id=?",(x["createdAt"],x["createdAt"],x["chainId"]))
            db.execute("COMMIT"); return {"inserted":result.rowcount==1,"event":work_chain_event_row(row)}
        except Exception:
            db.execute("ROLLBACK"); raise
    if op == "list_work_chain_events":
        limit=max(1,min(int(p.get("limit",200)),1000)); rows=db.execute("SELECT * FROM work_chain_events WHERE chain_id=? ORDER BY created_at,id LIMIT ?",(p["chainId"],limit))
        return [work_chain_event_row(row) for row in rows]
    if op == "attach_board_session":
        db.execute("BEGIN IMMEDIATE")
        try:
            chain=db.execute("SELECT * FROM work_chains WHERE id=? AND board_visible=1",(p["chainId"],)).fetchone()
            if chain is None: db.execute("COMMIT"); return {"attached":False,"reason":"not-found","chain":None}
            targets=[("tasks",p.get("taskId")),("collaboration_sessions",p.get("collaborationSessionId"))]
            for table,target_id in targets:
                if not target_id: continue
                row=db.execute(f"SELECT work_chain_id FROM {table} WHERE id=?",(target_id,)).fetchone()
                if row is None: db.execute("COMMIT"); return {"attached":False,"reason":"not-found","chain":work_chain_row(chain)}
                if row["work_chain_id"] not in (None,p["chainId"]): db.execute("COMMIT"); return {"attached":False,"reason":"conflict","chain":work_chain_row(chain)}
            for table,target_id in targets:
                if target_id: db.execute(f"UPDATE {table} SET work_chain_id=? WHERE id=?",(p["chainId"],target_id))
            event=None
            if p.get("event"):
                x=p["event"]
                inserted=db.execute("INSERT OR IGNORE INTO work_chain_events(id,chain_id,event_type,task_id,collaboration_session_id,actor_type,actor_id,dedupe_key,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",(x["id"],p["chainId"],x["eventType"],x.get("taskId"),x.get("collaborationSessionId"),x["actorType"],x.get("actorId"),x.get("dedupeKey"),json.dumps(x.get("payload",{})),x["createdAt"])).rowcount==1
                event_row=db.execute("SELECT * FROM work_chain_events WHERE id=?" if inserted else "SELECT * FROM work_chain_events WHERE chain_id=? AND dedupe_key=?",(x["id"],) if inserted else (p["chainId"],x.get("dedupeKey"))).fetchone()
                event=work_chain_event_row(event_row)
                if inserted: db.execute("UPDATE work_chains SET last_activity_at=?,updated_at=? WHERE id=?",(x["createdAt"],x["createdAt"],p["chainId"]))
            current=work_chain_row(db.execute("SELECT * FROM work_chains WHERE id=?",(p["chainId"],)).fetchone())
            db.execute("COMMIT"); return {"attached":True,"chain":current,"event":event}
        except Exception:
            db.execute("ROLLBACK"); raise
    if op == "list_session_links": return [object_row(r) for r in db.execute("SELECT * FROM session_links WHERE chain_id=? ORDER BY created_at",(p["chainId"],))]
    if op == "upsert_session_link":
        x=p["link"]; cols=["id","chain_id","source_session_id","target_session_id","relation_type","handoff_artifact_id","source_host_id","target_host_id","source_provider","target_provider","source_commit","target_commit","status","created_at"]
        vals=[x.get({"chain_id":"chainId","source_session_id":"sourceSessionId","target_session_id":"targetSessionId","relation_type":"relationType","handoff_artifact_id":"handoffArtifactId","source_host_id":"sourceHostId","target_host_id":"targetHostId","source_provider":"sourceProvider","target_provider":"targetProvider","source_commit":"sourceCommit","target_commit":"targetCommit","created_at":"createdAt"}.get(c,c)) for c in cols]
        db.execute(f"INSERT INTO session_links({','.join(cols)}) VALUES({','.join('?' for _ in cols)}) ON CONFLICT(id) DO UPDATE SET status=excluded.status,target_commit=excluded.target_commit",vals); return object_row(db.execute("SELECT * FROM session_links WHERE id=?",(x["id"],)).fetchone())
    if op == "upsert_handoff_artifact":
        x=p["artifact"]; cols=[r[1] for r in db.execute("PRAGMA table_info(handoff_artifacts)")]; mapping={"source_session_id":"sourceSessionId","source_task_id":"sourceTaskId","source_host_id":"sourceHostId","source_workspace_id":"sourceWorkspaceId","target_host_id":"targetHostId","target_workspace_id":"targetWorkspaceId","source_provider":"sourceProvider","target_provider":"targetProvider","target_execution_json":"targetExecutionJson","source_commit":"sourceCommit","target_commit_at_creation":"targetCommitAtCreation","source_branch":"sourceBranch","dirty_state":"dirtyState","markdown_path":"markdownPath","patch_path":"patchPath","manifest_path":"manifestPath","size_bytes":"sizeBytes","created_at":"createdAt","delivered_at":"deliveredAt","expires_at":"expiresAt"}; vals=[x.get(mapping.get(c,c)) for c in cols]
        updates=','.join(f"{c}=excluded.{c}" for c in cols if c != "id")
        db.execute(f"INSERT INTO handoff_artifacts({','.join(cols)}) VALUES({','.join('?' for _ in cols)}) ON CONFLICT(id) DO UPDATE SET {updates}",vals); return object_row(db.execute("SELECT * FROM handoff_artifacts WHERE id=?",(x["id"],)).fetchone())
    if op == "get_handoff_artifact": return object_row(db.execute("SELECT * FROM handoff_artifacts WHERE id=?",(p["id"],)).fetchone())
    if op == "upsert_managed_artifact":
        x=p["artifact"]; cols=[r[1] for r in db.execute("PRAGMA table_info(managed_artifacts)")]; mapping={"host_id":"hostId","workspace_id":"workspaceId","task_id":"taskId","device_id":"deviceId","inode_id":"inodeId","size_bytes":"sizeBytes","created_at":"createdAt","verified_at":"verifiedAt","removed_at":"removedAt"}; vals=[x.get(mapping.get(c,c)) for c in cols]
        updates=','.join(f"{c}=excluded.{c}" for c in cols if c not in ("id","created_at"))
        db.execute(f"INSERT INTO managed_artifacts({','.join(cols)}) VALUES({','.join('?' for _ in cols)}) ON CONFLICT(id) DO UPDATE SET {updates}",vals); return object_row(db.execute("SELECT * FROM managed_artifacts WHERE id=?",(x["id"],)).fetchone())
    if op == "upsert_managed_artifacts":
        items=p.get("artifacts",[])[:10000];cols=[r[1] for r in db.execute("PRAGMA table_info(managed_artifacts)")];mapping={"host_id":"hostId","workspace_id":"workspaceId","task_id":"taskId","device_id":"deviceId","inode_id":"inodeId","size_bytes":"sizeBytes","created_at":"createdAt","verified_at":"verifiedAt","removed_at":"removedAt"};updates=','.join(f"{c}=excluded.{c}" for c in cols if c not in ("id","created_at"));sql=f"INSERT INTO managed_artifacts({','.join(cols)}) VALUES({','.join('?' for _ in cols)}) ON CONFLICT(id) DO UPDATE SET {updates}"
        try:
            db.execute("BEGIN IMMEDIATE")
            for x in items: db.execute(sql,[x.get(mapping.get(c,c)) for c in cols])
            db.execute("COMMIT");return len(items)
        except Exception:
            if db.in_transaction: db.execute("ROLLBACK")
            raise
    if op == "list_managed_artifacts":
        limit=max(1,min(int(p.get("limit",5000)),10000)); return [object_row(row) for row in db.execute("SELECT * FROM managed_artifacts ORDER BY created_at DESC,id LIMIT ?",(limit,))]
    if op == "list_workspace_leases": return [object_row(r) for r in db.execute("SELECT * FROM workspace_leases WHERE workspace_id=? AND released_at IS NULL ORDER BY acquired_at",(p["workspaceId"],))]
    if op == "upsert_workspace_lease":
        x=p["lease"]; db.execute("INSERT INTO workspace_leases(id,project_id,workspace_id,chain_id,session_id,host_id,mode,acquired_at,expires_at,released_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at,released_at=excluded.released_at",(x["id"],x["projectId"],x["workspaceId"],x.get("chainId"),x.get("sessionId"),x["hostId"],x["mode"],x["acquiredAt"],x["expiresAt"],x.get("releasedAt"))); return object_row(db.execute("SELECT * FROM workspace_leases WHERE id=?",(x["id"],)).fetchone())
    if op == "release_workspace_lease": db.execute("UPDATE workspace_leases SET released_at=? WHERE id=?",(p["releasedAt"],p["id"])); return True
    if op == "upsert_collaboration_session":
        x=p["session"]
        try:
            db.execute("BEGIN IMMEDIATE")
            previous=db.execute("SELECT status,work_chain_id FROM collaboration_sessions WHERE id=?",(x["id"],)).fetchone()
            result=upsert_collab("collaboration_sessions",x)
            record_board_status_event("collaboration",result["id"],result.get("workChainId"),previous["status"] if previous else None,result["status"],result["updatedAt"])
            db.execute("COMMIT"); return result
        except Exception:
            if db.in_transaction: db.execute("ROLLBACK")
            raise
    if op == "get_collaboration_session": return object_row(db.execute("SELECT * FROM collaboration_sessions WHERE id=?",(p["id"],)).fetchone(),{"current_turn_counts_json","metadata_json"})
    if op == "get_collaboration_detail_snapshot":
        collaboration_id=p["id"]
        try:
            db.execute("BEGIN")
            result={
                "session":object_row(db.execute("SELECT * FROM collaboration_sessions WHERE id=?",(collaboration_id,)).fetchone(),{"current_turn_counts_json","metadata_json"}),
                "participants":[object_row(r,{"capability_snapshot_json"}) for r in db.execute("SELECT * FROM collaboration_participants WHERE collaboration_session_id=? ORDER BY created_at,id",(collaboration_id,))],
                "runs":[object_row(r) for r in db.execute("SELECT * FROM collaboration_runs WHERE collaboration_session_id=? ORDER BY sequence,created_at,id",(collaboration_id,))],
                "messages":[object_row(r) for r in db.execute("SELECT * FROM collaboration_messages WHERE collaboration_session_id=? ORDER BY created_at,id",(collaboration_id,))],
                "avatarStates":[object_row(r) for r in db.execute("SELECT * FROM collaboration_avatar_state WHERE collaboration_session_id=? ORDER BY priority DESC,created_at",(collaboration_id,))],
            }
            db.execute("COMMIT")
            return result
        except Exception:
            if db.in_transaction: db.execute("ROLLBACK")
            raise
    if op == "list_collaboration_sessions":
        sql="SELECT * FROM collaboration_sessions"+("" if p.get("includeArchived") else " WHERE archived_at IS NULL")+" ORDER BY updated_at DESC"
        return [object_row(r,{"current_turn_counts_json","metadata_json"}) for r in db.execute(sql)]
    if op == "delete_collaboration_session":
        try:
            db.execute("BEGIN IMMEDIATE")
            artifact_paths=[r["path"] for r in db.execute("SELECT path FROM relay_artifacts WHERE collaboration_session_id=?",(p["id"],))]
            db.execute("DELETE FROM collaboration_workspace_leases WHERE collaboration_session_id=?",(p["id"],))
            result=db.execute("DELETE FROM collaboration_sessions WHERE id=?",(p["id"],))
            db.execute("COMMIT")
            return {"deleted":result.rowcount==1,"artifactPaths":artifact_paths}
        except Exception:
            if db.in_transaction: db.execute("ROLLBACK")
            raise
    if op == "upsert_collaboration_participant": return upsert_collab_child("collaboration_participants",p["participant"])
    if op == "list_collaboration_participants": return [object_row(r,{"capability_snapshot_json"}) for r in db.execute("SELECT * FROM collaboration_participants WHERE collaboration_session_id=? ORDER BY created_at,id",(p["collaborationSessionId"],))]
    if op == "upsert_collaboration_run": return upsert_collab_child("collaboration_runs",p["run"])
    if op == "create_collaboration_run":
        x=p["run"].copy()
        try:
            db.execute("BEGIN IMMEDIATE")
            session=db.execute("SELECT status,mode,max_calls,current_call_count,max_turns_per_participant,current_turn_counts_json FROM collaboration_sessions WHERE id=?",(x["collaborationSessionId"],)).fetchone()
            if session is None: raise ValueError("Collaboration not found")
            if session["status"] in ("cancel-requested","cancelled","stop-unconfirmed","archived") or session["current_call_count"]>=session["max_calls"]: raise ValueError("Collaboration call limit or cancellation prevents a new run")
            participant=db.execute("SELECT id,provider FROM collaboration_participants WHERE id=? AND collaboration_session_id=? AND archived_at IS NULL",(x["participantId"],x["collaborationSessionId"])).fetchone()
            if participant is None: raise ValueError("Collaboration participant not found")
            turn_count=db.execute("SELECT COUNT(*) AS count FROM collaboration_runs WHERE collaboration_session_id=? AND participant_id=? AND purpose IN ('debate-turn','conversation-turn')",(x["collaborationSessionId"],x["participantId"])).fetchone()["count"]
            if session["mode"]=="debate" and x["purpose"] in ("debate-turn","conversation-turn") and (turn_count>=100 or (session["max_turns_per_participant"] is not None and turn_count>=session["max_turns_per_participant"])): raise ValueError("Conversation participant turn limit prevents a new run")
            previous=db.execute("SELECT COALESCE(MAX(generation),0) AS generation FROM collaboration_runs WHERE collaboration_session_id=? AND participant_id=?",(x["collaborationSessionId"],x["participantId"])).fetchone()
            x["generation"]=previous["generation"]+1
            columns,values,_=collab_values("collaboration_runs",x)
            db.execute(f"INSERT INTO collaboration_runs({','.join(columns)}) VALUES({','.join('?' for _ in columns)})",values)
            db.execute("UPDATE collaboration_participants SET session_generation=?,updated_at=? WHERE id=?",(x["generation"],x["updatedAt"],x["participantId"]))
            counts=json.loads(session["current_turn_counts_json"] or '{}')
            if session["mode"]=="debate" and x["purpose"] in ("debate-turn","conversation-turn"): counts[participant["provider"]]=turn_count+1
            revision=bump_collaboration_revision(x["collaborationSessionId"])
            db.execute("UPDATE collaboration_sessions SET current_call_count=current_call_count+1,current_turn_counts_json=?,current_step=?,status='running',updated_at=? WHERE id=?",(json.dumps(counts,ensure_ascii=False),x["purpose"],x["updatedAt"],x["collaborationSessionId"]))
            row=object_row(db.execute("SELECT * FROM collaboration_runs WHERE id=?",(x["id"],)).fetchone())
            row["revision"]=revision
            db.execute("COMMIT"); return row
        except Exception:
            if db.in_transaction: db.execute("ROLLBACK")
            raise
    if op == "get_collaboration_run": return object_row(db.execute("SELECT * FROM collaboration_runs WHERE id=?",(p["id"],)).fetchone())
    if op == "list_collaboration_runs": return [object_row(r) for r in db.execute("SELECT * FROM collaboration_runs WHERE collaboration_session_id=? ORDER BY sequence,created_at,id",(p["collaborationSessionId"],))]
    if op == "insert_collaboration_message":
        try:
            db.execute("BEGIN IMMEDIATE")
            columns,values,_=collab_values("collaboration_messages",p["message"]); db.execute(f"INSERT INTO collaboration_messages({','.join(columns)}) VALUES({','.join('?' for _ in columns)})",values)
            result=object_row(db.execute("SELECT * FROM collaboration_messages WHERE id=?",(p["message"]["id"],)).fetchone());result["revision"]=bump_collaboration_revision(p["message"]["collaborationSessionId"])
            db.execute("COMMIT");return result
        except Exception:
            if db.in_transaction: db.execute("ROLLBACK")
            raise
    if op == "list_collaboration_messages": return [object_row(r) for r in db.execute("SELECT * FROM collaboration_messages WHERE collaboration_session_id=? ORDER BY created_at,id",(p["collaborationSessionId"],))]
    if op == "insert_relay_artifact":
        columns,values,json_fields=collab_values("relay_artifacts",p["artifact"]); db.execute(f"INSERT INTO relay_artifacts({','.join(columns)}) VALUES({','.join('?' for _ in columns)})",values)
        return object_row(db.execute("SELECT * FROM relay_artifacts WHERE id=?",(p["artifact"]["id"],)).fetchone(),json_fields)
    if op == "get_relay_artifact": return object_row(db.execute("SELECT * FROM relay_artifacts WHERE id=?",(p["id"],)).fetchone(),{"changed_files_json"})
    if op == "update_relay_artifact_status":
        db.execute("UPDATE relay_artifacts SET status=?,delivered_at=COALESCE(?,delivered_at) WHERE id=?",(p["status"],p.get("deliveredAt"),p["id"]))
        return object_row(db.execute("SELECT * FROM relay_artifacts WHERE id=?",(p["id"],)).fetchone(),{"changed_files_json"})
    if op == "upsert_collaboration_avatar_state": return upsert_collab("collaboration_avatar_state",p["state"],("collaboration_session_id","participant_id"))
    if op == "list_collaboration_avatar_states": return [object_row(r) for r in db.execute("SELECT * FROM collaboration_avatar_state WHERE collaboration_session_id=? ORDER BY priority DESC,created_at",(p["collaborationSessionId"],))]
    if op == "acquire_collaboration_lease":
        x=p["lease"]
        try:
            db.execute("BEGIN IMMEDIATE")
            # A workspace is an orchestration target, not a single-writer editor.
            # Read/read, read/write and write/write all acquire; the leases that
            # are already active are returned as advisory observation data so the
            # caller can warn and instruct instead of refusing to run.
            concurrent=[object_row(r) for r in db.execute("SELECT id,workspace_id,collaboration_session_id,participant_id,owner_run_id,mode,acquired_at,expires_at FROM collaboration_workspace_leases WHERE workspace_id=? AND released_at IS NULL AND expires_at>? AND status='active' AND id<>? ORDER BY acquired_at",(x["workspaceId"],x["acquiredAt"],x["id"]))]
            db.execute("INSERT INTO collaboration_workspace_leases(id,workspace_id,collaboration_session_id,participant_id,owner_run_id,mode,lease_generation,heartbeat_at,expires_at,acquired_at,released_at,status) VALUES(?,?,?,?,?,?,?,?,?,?,NULL,'active')",(x["id"],x["workspaceId"],x["collaborationSessionId"],x["participantId"],x["ownerRunId"],x["mode"],x["leaseGeneration"],x["heartbeatAt"],x["expiresAt"],x["acquiredAt"]))
            db.execute("COMMIT"); return {"acquired":True,"lease":object_row(db.execute("SELECT * FROM collaboration_workspace_leases WHERE id=?",(x["id"],)).fetchone()),"concurrent":concurrent}
        except Exception:
            if db.in_transaction: db.execute("ROLLBACK")
            raise
    if op == "heartbeat_collaboration_lease":
        result=db.execute("UPDATE collaboration_workspace_leases SET heartbeat_at=?,expires_at=? WHERE id=? AND owner_run_id=? AND lease_generation=? AND released_at IS NULL AND status='active' AND expires_at>?",(p["heartbeatAt"],p["expiresAt"],p["id"],p["ownerRunId"],p["leaseGeneration"],p["heartbeatAt"])); return result.rowcount==1
    if op == "release_collaboration_leases":
        clauses=["released_at IS NULL"];args=[]
        for column,key in [("collaboration_session_id","collaborationSessionId"),("owner_run_id","ownerRunId"),("workspace_id","workspaceId")]:
            if p.get(key): clauses.append(column+"=?");args.append(p[key])
        args.extend([p["releasedAt"],p.get("status","released")])
        result=db.execute(f"UPDATE collaboration_workspace_leases SET released_at=?,status=? WHERE {' AND '.join(clauses)}",args[-2:]+args[:-2]); return result.rowcount
    if op == "list_collaboration_leases":
        sql="SELECT * FROM collaboration_workspace_leases";args=[]
        if p.get("workspaceId"): sql+=" WHERE workspace_id=?";args.append(p["workspaceId"])
        return [object_row(r) for r in db.execute(sql+" ORDER BY acquired_at",args)]
    if op == "backfill_local_assignments":
        try:
            db.execute("BEGIN IMMEDIATE");changed_tasks=0;changed_threads=0
            for item in p.get("projects",[]):
                changed=db.execute("UPDATE tasks SET execution_host_id=COALESCE(execution_host_id,?),workspace_id=COALESCE(workspace_id,?) WHERE project_id=? AND (execution_host_id IS NULL OR workspace_id IS NULL) RETURNING id",(p["hostId"],item["workspaceId"],item["projectId"])).fetchall();changed_tasks+=len(changed)
                for row in changed: sync_task_search_document(row["id"])
                changed=db.execute("UPDATE codex_threads SET execution_host_id=COALESCE(execution_host_id,?),workspace_id=COALESCE(workspace_id,?) WHERE project_id=? AND (execution_host_id IS NULL OR workspace_id IS NULL) RETURNING thread_id",(p["hostId"],item["workspaceId"],item["projectId"])).fetchall();changed_threads+=len(changed)
                for row in changed: sync_codex_thread_search_document(row["thread_id"])
            db.execute("COMMIT");return {"tasks":changed_tasks,"threads":changed_threads}
        except Exception:
            if db.in_transaction: db.execute("ROLLBACK")
            raise
    if op == "list_unassigned_locations":
        return [object_row(r) for r in db.execute("""
          SELECT project_id AS projectId,cwd FROM tasks WHERE execution_host_id IS NULL OR workspace_id IS NULL
          UNION
          SELECT project_id AS projectId,cwd FROM codex_threads WHERE execution_host_id IS NULL OR workspace_id IS NULL
        """)]
    if op == "backfill_local_locations":
        try:
            db.execute("BEGIN IMMEDIATE");changed_tasks=0;changed_threads=0
            for item in p.get("locations",[]):
                project_id=item.get("projectId");cwd=item.get("cwd");workspace_id=item["workspaceId"]
                if project_id is None: task_where="project_id IS NULL AND COALESCE(cwd,'')=COALESCE(?, '')";task_args=(cwd,)
                else: task_where="project_id=? AND COALESCE(cwd,'')=COALESCE(?, '')";task_args=(project_id,cwd)
                changed=db.execute(f"UPDATE tasks SET execution_host_id=COALESCE(execution_host_id,?),workspace_id=COALESCE(workspace_id,?) WHERE {task_where} AND (execution_host_id IS NULL OR workspace_id IS NULL) RETURNING id",(p["hostId"],workspace_id,*task_args)).fetchall();changed_tasks+=len(changed)
                for row in changed: sync_task_search_document(row["id"])
                changed=db.execute(f"UPDATE codex_threads SET execution_host_id=COALESCE(execution_host_id,?),workspace_id=COALESCE(workspace_id,?) WHERE {task_where} AND (execution_host_id IS NULL OR workspace_id IS NULL) RETURNING thread_id",(p["hostId"],workspace_id,*task_args)).fetchall();changed_threads+=len(changed)
                for row in changed: sync_codex_thread_search_document(row["thread_id"])
            db.execute("COMMIT");return {"tasks":changed_tasks,"threads":changed_threads}
        except Exception:
            if db.in_transaction: db.execute("ROLLBACK")
            raise
    raise ValueError("unsupported db operation: "+op)

for line in sys.stdin:
    try:
        request=json.loads(line)
        result=handle(request["op"],request.get("params",{}))
        print(json.dumps({"id":request["id"],"ok":True,"result":result},ensure_ascii=False),flush=True)
    except Exception as error:
        print(json.dumps({"id":request.get("id") if 'request' in locals() else None,"ok":False,"error":str(error)},ensure_ascii=False),flush=True)

db.close()
