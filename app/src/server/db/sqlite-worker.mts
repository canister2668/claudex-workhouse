import fs from"node:fs";
import path from"node:path";
import readline from"node:readline";
import{fileURLToPath}from"node:url";
import Database from"better-sqlite3";

type Row=Record<string,any>;
const dbPath=process.argv[2];
if(!dbPath)throw new Error("Database path is required.");
const db=new Database(dbPath,{timeout:5000});
db.pragma("journal_mode = WAL");
db.pragma("synchronous = FULL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

// The build extracts this file from the Linux worker's canonical schema and
// fails if that source contract is no longer recognizable. Windows startup
// therefore reads SQL data, never Python source code or a Python runtime.
const schema=fs.readFileSync(fileURLToPath(new URL("./sqlite-schema.sql",import.meta.url)),"utf8");
if(!schema.trim())throw new Error("Canonical SQLite schema is unavailable.");
db.exec(schema);

const normalize=(values:any[]=[])=>values.map(value=>value===undefined?null:typeof value==="boolean"?(value?1:0):value);
const one=(sql:string,values:any[]=[])=>db.prepare(sql).get(...normalize(values)) as Row|undefined;
const all=(sql:string,values:any[]=[])=>db.prepare(sql).all(...normalize(values)) as Row[];
const run=(sql:string,values:any[]=[])=>db.prepare(sql).run(...normalize(values));
const json=(value:any,fallback:any={})=>{try{return value?JSON.parse(value):fallback;}catch{return fallback;}};
const stringify=(value:any,fallback:any={})=>JSON.stringify(value??fallback);
const SEARCH_NORMALIZER_VERSION=1;
const SEARCH_FOLD_EXPANSIONS:Record<string,string>={"ß":"ss","ς":"σ","ſ":"s","ﬀ":"ff","ﬁ":"fi","ﬂ":"fl","ﬃ":"ffi","ﬄ":"ffl","ﬅ":"st","ﬆ":"st"};
const caseFoldCharacter=(character:string)=>{const lowered=character.toLowerCase();return SEARCH_FOLD_EXPANSIONS[lowered]??lowered;};
const foldSearchText=(value:unknown)=>String(value??"").toLowerCase().replace(/[ßςſﬀﬁﬂﬃﬄﬅﬆ]/g,character=>SEARCH_FOLD_EXPANSIONS[character]??character);
const camel=(name:string)=>{const plain=name.endsWith("_json")?name.slice(0,-5):name;return plain.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase());};
const objectRow=(row:Row|undefined,jsonFields=new Set<string>())=>{
  if(!row)return null;
  return Object.fromEntries(Object.entries(row).map(([key,value])=>[camel(key),jsonFields.has(key)&&value?json(value):value]));
};
const transaction=<T,>(operation:()=>T,mode:"DEFERRED"|"IMMEDIATE"="IMMEDIATE")=>{
  db.exec(`BEGIN ${mode}`);
  try{const result=operation();db.exec("COMMIT");return result;}
  catch(error){if(db.inTransaction)db.exec("ROLLBACK");throw error;}
};

// SQLite cannot alter CHECK constraints. Keep the two legacy rebuilds in
// lockstep with sqlite-worker.py so a database moved from Linux to Windows is
// upgraded before any request can observe it.
const rebuildLegacyTable=(sql:string,errorMessage:string)=>{
  db.pragma("foreign_keys = OFF");
  try{db.exec(sql);}
  catch(error){if(db.inTransaction)db.exec("ROLLBACK");throw error;}
  finally{db.pragma("foreign_keys = ON");}
  if(all("PRAGMA foreign_key_check").length)throw new Error(errorMessage);
};
const collaborationSessionSql=String(one("SELECT sql FROM sqlite_master WHERE type='table' AND name='collaboration_sessions'")?.sql??"");
if(!collaborationSessionSql.includes("'debate'"))rebuildLegacyTable(`
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
`,"Collaboration v6 foreign-key validation failed");

const collaborationParticipantSql=String(one("SELECT sql FROM sqlite_master WHERE type='table' AND name='collaboration_participants'")?.sql??"");
if(!collaborationParticipantSql.includes("'grok'"))rebuildLegacyTable(`
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
`,"Collaboration participant v16 foreign-key validation failed");

const sessionMessageQueueSql=String(one("SELECT sql FROM sqlite_master WHERE type='table' AND name='session_message_queue'")?.sql??"");
if(!sessionMessageQueueSql.includes("'delivery-uncertain'")||!sessionMessageQueueSql.includes("'grok'"))rebuildLegacyTable(`
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
`,"Session message queue v17 foreign-key validation failed");

const ensureColumn=(table:string,name:string,declaration:string)=>{
  if(!all(`PRAGMA table_info(${table})`).some(row=>row.name===name))db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${declaration}`);
};
transaction(()=>{
for(const[name,declaration]of[
  ["job_id","TEXT"],["ownership","TEXT NOT NULL DEFAULT 'unknown'"],["source","TEXT NOT NULL DEFAULT 'unknown'"],
  ["cwd","TEXT"],["last_seen_at","TEXT"],["requested_model","TEXT"],["effective_model","TEXT"],
  ["requested_reasoning_effort","TEXT"],["effective_reasoning_effort","TEXT"],["requested_service_tier","TEXT"],
  ["effective_service_tier","TEXT"],["permission_profile","TEXT"],["settings_updated_at","TEXT"],
  ["metadata_json","TEXT NOT NULL DEFAULT '{}'"],["execution_host_id","TEXT"],["workspace_id","TEXT"],
  ["remote_worker_id","TEXT"],["host_task_id","TEXT"],["provider_session_id","TEXT"],["source_session_id","TEXT"],["work_chain_id","TEXT"]
]as const)ensureColumn("tasks",name,declaration);
for(const[name,declaration]of[["execution_host_id","TEXT"],["workspace_id","TEXT"],["work_chain_id","TEXT"]]as const)ensureColumn("codex_threads",name,declaration);
db.exec(`CREATE TABLE IF NOT EXISTS codex_thread_search_documents(
  thread_id TEXT PRIMARY KEY REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
  workspace_id TEXT,status TEXT NOT NULL,updated_at TEXT NOT NULL,title_folded TEXT NOT NULL,preview_folded TEXT NOT NULL,normalizer_version INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS codex_thread_search_cursor_idx ON codex_thread_search_documents(updated_at DESC,thread_id DESC);
CREATE INDEX IF NOT EXISTS codex_thread_search_workspace_cursor_idx ON codex_thread_search_documents(workspace_id,updated_at DESC,thread_id DESC);
CREATE INDEX IF NOT EXISTS codex_thread_search_status_cursor_idx ON codex_thread_search_documents(status,updated_at DESC,thread_id DESC);`);
for(const[name,declaration]of[["host_id","TEXT"],["workspace_id","TEXT"]]as const)ensureColumn("audit_log",name,declaration);
ensureColumn("idempotency","owner_token","TEXT");
ensureColumn("collaboration_sessions","max_turns_per_participant","INTEGER");
ensureColumn("collaboration_sessions","current_turn_counts_json","TEXT NOT NULL DEFAULT '{\"claude\":0,\"codex\":0}'");
ensureColumn("collaboration_sessions","revision","INTEGER NOT NULL DEFAULT 1");
ensureColumn("handoff_artifacts","target_execution_json","TEXT");
for(const[name,declaration]of[
  ["board_visible","INTEGER NOT NULL DEFAULT 0"],["description","TEXT NOT NULL DEFAULT ''"],
  ["board_status","TEXT NOT NULL DEFAULT 'queued'"],["priority","TEXT NOT NULL DEFAULT 'normal'"],
  ["workspace_id","TEXT"],["target_branch","TEXT"],["roles_json","TEXT NOT NULL DEFAULT '{}'"],
  ["automation_json","TEXT NOT NULL DEFAULT '{}'"],
  ["last_activity_at","TEXT"],["completed_at","TEXT"],["revision","INTEGER NOT NULL DEFAULT 1"]
]as const)ensureColumn("work_chains",name,declaration);
db.exec(`CREATE TABLE IF NOT EXISTS work_chain_events(
  id TEXT PRIMARY KEY,chain_id TEXT NOT NULL REFERENCES work_chains(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,task_id TEXT,collaboration_session_id TEXT,actor_type TEXT NOT NULL,
  actor_id TEXT,dedupe_key TEXT,payload_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,
  UNIQUE(chain_id,dedupe_key));
CREATE INDEX IF NOT EXISTS work_chain_events_chain_idx ON work_chain_events(chain_id,created_at,id);`);
const participantIndexSql=String(one("SELECT sql FROM sqlite_master WHERE type='index' AND name='collaboration_participants_active_provider_idx'")?.sql??"").replace(/\s/g,"").toLowerCase();
if(!participantIndexSql.includes("provider,role")){run("DROP INDEX IF EXISTS collaboration_participants_active_provider_idx");run("CREATE UNIQUE INDEX collaboration_participants_active_provider_idx ON collaboration_participants(collaboration_session_id,provider,role) WHERE archived_at IS NULL");}
ensureColumn("quota_task_reservations","quota_check_count","INTEGER NOT NULL DEFAULT 0");
const backfillSearchDocumentsIfNeeded=()=>{
  const searchMigrationApplied=Boolean(one("SELECT 1 FROM schema_migrations WHERE version=14"));
  const searchDocumentCounts=one(`SELECT
    (SELECT COUNT(*) FROM tasks WHERE ownership='claudex-workhouse' OR owned=1) AS task_count,
    (SELECT COUNT(*) FROM task_search_documents) AS document_count,
    (SELECT COUNT(*) FROM task_search_documents WHERE normalizer_version<>?) AS stale_count`,[SEARCH_NORMALIZER_VERSION])!;
  const searchDocumentMismatch=one(`SELECT 1 FROM tasks t LEFT JOIN task_search_documents s ON s.task_id=t.id
    WHERE (t.ownership='claudex-workhouse' OR t.owned=1) AND (s.task_id IS NULL OR s.provider<>t.provider OR s.workspace_id IS NOT t.workspace_id OR s.status<>t.status OR s.updated_at<>t.updated_at)
    UNION ALL SELECT 1 FROM task_search_documents s LEFT JOIN tasks t ON t.id=s.task_id
    WHERE t.id IS NULL OR NOT (t.ownership='claudex-workhouse' OR t.owned=1) LIMIT 1`);
  if(searchMigrationApplied&&searchDocumentCounts.task_count===searchDocumentCounts.document_count&&!searchDocumentCounts.stale_count&&!searchDocumentMismatch)return;
  const searchBackfill=db.prepare(`INSERT INTO task_search_documents(task_id,provider,workspace_id,status,updated_at,title_folded,prompt_folded,result_folded,error_folded,normalizer_version)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET
    provider=excluded.provider,workspace_id=excluded.workspace_id,status=excluded.status,updated_at=excluded.updated_at,
    title_folded=excluded.title_folded,prompt_folded=excluded.prompt_folded,result_folded=excluded.result_folded,
    error_folded=excluded.error_folded,normalizer_version=excluded.normalizer_version`);
  let lastId="";
  for(;;){
    const rows=all("SELECT id,provider,workspace_id,status,updated_at,title,prompt,result,error FROM tasks WHERE (ownership='claudex-workhouse' OR owned=1) AND id>? ORDER BY id LIMIT 100",[lastId]);
    if(!rows.length)break;
    for(const row of rows)searchBackfill.run(...normalize([row.id,row.provider,row.workspace_id,row.status,row.updated_at,foldSearchText(row.title),foldSearchText(row.prompt),foldSearchText(row.result),foldSearchText(row.error),SEARCH_NORMALIZER_VERSION]));
    lastId=String(rows.at(-1)!.id);
  }
  run("DELETE FROM task_search_documents WHERE task_id NOT IN (SELECT id FROM tasks WHERE ownership='claudex-workhouse' OR owned=1)");
};
const backfillCodexThreadSearchDocumentsIfNeeded=()=>{
  const applied=Boolean(one("SELECT 1 FROM schema_migrations WHERE version=15")),counts=one(`SELECT (SELECT COUNT(*) FROM codex_threads) AS thread_count,
    (SELECT COUNT(*) FROM codex_thread_search_documents) AS document_count,(SELECT COUNT(*) FROM codex_thread_search_documents WHERE normalizer_version<>?) AS stale_count`,[SEARCH_NORMALIZER_VERSION])!;
  const mismatch=one(`SELECT 1 FROM codex_threads c LEFT JOIN codex_thread_search_documents s ON s.thread_id=c.thread_id
    WHERE s.thread_id IS NULL OR s.workspace_id IS NOT c.workspace_id OR s.status<>c.status OR s.updated_at<>c.updated_at
    UNION ALL SELECT 1 FROM codex_thread_search_documents s LEFT JOIN codex_threads c ON c.thread_id=s.thread_id WHERE c.thread_id IS NULL LIMIT 1`);
  if(applied&&counts.thread_count===counts.document_count&&!counts.stale_count&&!mismatch)return;
  const upsert=db.prepare(`INSERT INTO codex_thread_search_documents(thread_id,workspace_id,status,updated_at,title_folded,preview_folded,normalizer_version)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(thread_id) DO UPDATE SET workspace_id=excluded.workspace_id,status=excluded.status,updated_at=excluded.updated_at,
    title_folded=excluded.title_folded,preview_folded=excluded.preview_folded,normalizer_version=excluded.normalizer_version`);
  let lastId="";for(;;){const rows=all("SELECT thread_id,workspace_id,status,updated_at,title,preview FROM codex_threads WHERE thread_id>? ORDER BY thread_id LIMIT 100",[lastId]);if(!rows.length)break;for(const row of rows)upsert.run(...normalize([row.thread_id,row.workspace_id,row.status,row.updated_at,foldSearchText(row.title),foldSearchText(row.preview),SEARCH_NORMALIZER_VERSION]));lastId=String(rows.at(-1)!.thread_id);}
  run("DELETE FROM codex_thread_search_documents WHERE thread_id NOT IN (SELECT thread_id FROM codex_threads)");
};
run("CREATE INDEX IF NOT EXISTS tasks_history_owned_cursor_idx ON tasks(updated_at DESC,id DESC) WHERE ownership='claudex-workhouse' OR owned=1");
run("CREATE INDEX IF NOT EXISTS tasks_history_owned_provider_cursor_idx ON tasks(provider,updated_at DESC,id DESC) WHERE ownership='claudex-workhouse' OR owned=1");
run("CREATE INDEX IF NOT EXISTS tasks_history_owned_workspace_cursor_idx ON tasks(workspace_id,updated_at DESC,id DESC) WHERE ownership='claudex-workhouse' OR owned=1");
run("CREATE INDEX IF NOT EXISTS tasks_history_owned_status_cursor_idx ON tasks(status,updated_at DESC,id DESC) WHERE ownership='claudex-workhouse' OR owned=1");

const replaceValue=(table:string,column:string,from:string,to:string,where="")=>{
  run(`UPDATE ${table} SET ${column}=REPLACE(${column},?,?) WHERE ${column} IS NOT NULL${where}`,[from,to]);
};
const product="claudex-workhouse",previousProduct="agent-deck";
const newRoot=path.dirname(path.dirname(path.resolve(dbPath)));
const previousWorkspace=one("SELECT canonical_path FROM workspaces WHERE project_id=? ORDER BY created_at LIMIT 1",[previousProduct]);
const previousRoot=String(previousWorkspace?.canonical_path||path.join(path.dirname(newRoot),previousProduct));
const storedSeparator=(value:string)=>value.includes("/")?"/":"\\";
const previousSeparator=storedSeparator(previousRoot);
  if(!one("SELECT 1 FROM schema_migrations WHERE version=10")){
    const previousName="Agent Deck",previousSlug="agent_deck",productSlug="claudex_workhouse";
    run("INSERT OR IGNORE INTO projects(id,name,slug,description,default_provider,created_at,updated_at,archived_at) SELECT ?,?,?,description,default_provider,created_at,updated_at,archived_at FROM projects WHERE id=?",[product,"Claudex Workhouse",product,previousProduct]);
    for(const table of["audit_log","codex_threads","collaboration_sessions","tasks","work_chains","workspace_leases","workspaces"])run(`UPDATE ${table} SET project_id=? WHERE project_id=?`,[product,previousProduct]);
    run("DELETE FROM projects WHERE id=?",[previousProduct]);
    for(const table of["tasks","codex_threads"])for(const column of["ownership","source"])run(`UPDATE ${table} SET ${column}=? WHERE ${column}=?`,[product,previousProduct]);
    run("UPDATE tasks SET command_marker=REPLACE(command_marker,?,?) WHERE command_marker LIKE ?",[previousProduct,product,`${previousProduct}%`]);
    run("UPDATE projects SET name=REPLACE(REPLACE(name,?,?),?,?),slug=REPLACE(slug,?,?) WHERE name LIKE ? OR name LIKE ? OR slug LIKE ?",[previousName,"Claudex Workhouse",previousProduct,product,previousProduct,product,`%${previousName}%`,`%${previousProduct}%`,`%${previousProduct}%`]);
    run("UPDATE workspaces SET display_name=REPLACE(display_name,?,?) WHERE display_name LIKE ?",[previousName,"Claudex Workhouse",`%${previousName}%`]);
    run("UPDATE workspace_roots SET display_name=REPLACE(display_name,?,?) WHERE display_name LIKE ?",[previousName,"Claudex Workhouse",`%${previousName}%`]);
    for(const[table,column]of[["tasks","cwd"],["codex_threads","cwd"],["workspaces","canonical_path"],["workspace_roots","canonical_path"]]as const)run(`UPDATE ${table} SET ${column}=?||substr(${column},?) WHERE ${column}=? OR ${column} LIKE ?`,[newRoot,previousRoot.length+1,previousRoot,`${previousRoot}${previousSeparator}%`]);
    replaceValue("workspaces","last_git_status_json",previousRoot,newRoot);
    for(const[table,column]of[["handoff_artifacts","markdown_path"],["handoff_artifacts","patch_path"],["handoff_artifacts","manifest_path"],["relay_artifacts","path"]]as const){replaceValue(table,column,previousRoot,newRoot);replaceValue(table,column,previousProduct,product);}
    for(const[table,column]of[
      ["tasks","title"],["tasks","prompt"],["tasks","result"],["tasks","error"],["tasks","log"],["tasks","metadata_json"],
      ["codex_threads","title"],["codex_threads","preview"],["codex_threads","metadata_json"],
      ["collaboration_sessions","title"],["collaboration_sessions","outcome"],["collaboration_sessions","metadata_json"],
      ["collaboration_messages","content_ref"],["audit_log","detail"],["idempotency","response_json"]
    ]as const){replaceValue(table,column,previousRoot,newRoot);replaceValue(table,column,previousProduct,product);replaceValue(table,column,previousName,"Claudex Workhouse");replaceValue(table,column,previousSlug,productSlug);}
    run("INSERT INTO schema_migrations(version,applied_at,description) VALUES(10,datetime('now'),'Claudex Workhouse canonical identity and root migration')");
  }
  const currentWorkspace=one("SELECT canonical_path FROM workspaces WHERE project_id=? ORDER BY created_at LIMIT 1",[product]);
  const currentRoot=String(currentWorkspace?.canonical_path||newRoot);
  if(currentRoot!==newRoot){
    for(const[table,column]of[
      ["tasks","title"],["tasks","prompt"],["tasks","result"],["tasks","error"],["tasks","log"],["tasks","metadata_json"],["tasks","cwd"],
      ["codex_threads","title"],["codex_threads","preview"],["codex_threads","metadata_json"],["codex_threads","cwd"],
      ["collaboration_sessions","metadata_json"],["collaboration_messages","content_ref"],["audit_log","detail"],["idempotency","response_json"],
      ["handoff_artifacts","markdown_path"],["handoff_artifacts","patch_path"],["handoff_artifacts","manifest_path"],["relay_artifacts","path"],
      ["workspaces","last_git_status_json"]
    ]as const)replaceValue(table,column,currentRoot,newRoot);
    const currentSeparator=storedSeparator(currentRoot);
    run("UPDATE workspace_roots SET canonical_path=REPLACE(canonical_path,?,?) WHERE canonical_path=? OR canonical_path LIKE ?",[currentRoot,newRoot,currentRoot,`${currentRoot}${currentSeparator}%`]);
  }
  replaceValue("workspaces","last_git_status_json",previousRoot,newRoot);
  run("UPDATE tasks SET cwd=? WHERE project_id=? AND cwd IS NOT NULL",[newRoot,product]);
  run("UPDATE codex_threads SET cwd=? WHERE project_id=? AND cwd IS NOT NULL",[newRoot,product]);
  run("UPDATE workspaces SET canonical_path=?,relative_path='.',display_name='Claudex Workhouse' WHERE project_id=?",[newRoot,product]);

backfillSearchDocumentsIfNeeded();
backfillCodexThreadSearchDocumentsIfNeeded();
for(const[version,description]of[
  [2,"Codex full session management"],[3,"Execution hosts, workspaces, handoff and work chains"],
  [4,"Push subscriptions and installation settings"],[5,"Collaboration sessions, immutable relay references and writer leases"],
  [6,"Debate turns, limits and participant counters"],[7,"Queued follow-up messages for active provider sessions"],
  [8,"Preserve uncertain provider deliveries across failures"],[9,"Managed recovery snapshots and trash lifecycle"],
  [11,"Owner claim bootstrap enrollments"],[12,"Signed application update attempts"],[13,"Isolated indexed history search"],[14,"Materialized normalized task history search"],[15,"Materialized cached Codex thread history search"],[16,"Five-provider conversation participants"],[17,"Workspace-scoped managed artifact provenance"],[18,"External access profiles, operations and checks"],[19,"Persist handoff target execution selection"],[20,"Allow same-provider independent Assist roles"],[21,"Proton Drive upload operation lifecycle"],[22,"Collaboration Board work-chain metadata and events"]
]as const)run("INSERT OR IGNORE INTO schema_migrations(version,applied_at,description) VALUES(?,datetime('now'),?)",[version,description]);
});

const TASK_COLUMNS=["id","provider","native_id","thread_id","project_id","title","prompt","status","created_at","updated_at","result","error","log","owned","pid","pgid","process_start","command_marker","parent_thread_id","job_id","ownership","source","cwd","last_seen_at","requested_model","effective_model","requested_reasoning_effort","effective_reasoning_effort","requested_service_tier","effective_service_tier","permission_profile","settings_updated_at","metadata_json","execution_host_id","workspace_id","remote_worker_id","host_task_id","provider_session_id","source_session_id","work_chain_id"];
const TASK_FIELDS:Record<string,string>={native_id:"nativeId",thread_id:"threadId",project_id:"projectId",created_at:"createdAt",updated_at:"updatedAt",process_start:"processStart",command_marker:"commandMarker",parent_thread_id:"parentThreadId",job_id:"jobId",last_seen_at:"lastSeenAt",requested_model:"requestedModel",effective_model:"effectiveModel",requested_reasoning_effort:"requestedReasoningEffort",effective_reasoning_effort:"effectiveReasoningEffort",requested_service_tier:"requestedServiceTier",effective_service_tier:"effectiveServiceTier",permission_profile:"permissionProfile",settings_updated_at:"settingsUpdatedAt",metadata_json:"metadata",execution_host_id:"executionHostId",workspace_id:"workspaceId",remote_worker_id:"remoteWorkerId",host_task_id:"hostTaskId",provider_session_id:"providerSessionId",source_session_id:"sourceSessionId",work_chain_id:"workChainId"};
const taskValues=(task:Row)=>TASK_COLUMNS.map(column=>{
  let value=task[TASK_FIELDS[column]??column];
  if(column==="ownership"&&value==null)value=task.owned!==false?"claudex-workhouse":"unknown";
  if(column==="source"&&value==null)value=task.owned!==false?"claudex-workhouse":"unknown";
  if(column==="metadata_json")value=stringify(value);
  return value;
});
const taskRow=(row:Row|undefined)=>{
  if(!row)return null;
  const result:Row={};
  for(const column of TASK_COLUMNS)result[TASK_FIELDS[column]??column]=row[column];
  result.owned=Boolean(row.owned);result.metadata=json(row.metadata_json);
  return result;
};
const THREAD_COLUMNS=["thread_id","session_id","project_id","cwd","title","preview","source","ownership","status","archived","parent_thread_id","forked_from_id","model_provider","requested_model","effective_model","requested_reasoning_effort","effective_reasoning_effort","requested_service_tier","effective_service_tier","permission_profile","settings_updated_at","created_at","updated_at","last_seen_at","metadata_json","execution_host_id","workspace_id","work_chain_id"];
const THREAD_FIELDS:Record<string,string>={thread_id:"threadId",session_id:"sessionId",project_id:"projectId",parent_thread_id:"parentThreadId",forked_from_id:"forkedFromId",model_provider:"modelProvider",requested_model:"requestedModel",effective_model:"effectiveModel",requested_reasoning_effort:"requestedReasoningEffort",effective_reasoning_effort:"effectiveReasoningEffort",requested_service_tier:"requestedServiceTier",effective_service_tier:"effectiveServiceTier",permission_profile:"permissionProfile",settings_updated_at:"settingsUpdatedAt",created_at:"createdAt",updated_at:"updatedAt",last_seen_at:"lastSeenAt",metadata_json:"metadata",execution_host_id:"executionHostId",workspace_id:"workspaceId",work_chain_id:"workChainId"};
const threadValues=(thread:Row)=>THREAD_COLUMNS.map(column=>column==="metadata_json"?stringify(thread.metadata):column==="archived"?(thread.archived?1:0):thread[THREAD_FIELDS[column]??column]);
const threadRow=(row:Row|undefined)=>{
  if(!row)return null;
  const result:Row={};for(const column of THREAD_COLUMNS)result[THREAD_FIELDS[column]??column]=row[column];
  result.archived=Boolean(row.archived);result.metadata=json(row.metadata_json);return result;
};
const preserveNewerThreadSettings=(incoming:Row)=>{
  const existing=threadRow(one("SELECT * FROM codex_threads WHERE thread_id=?",[incoming.threadId]));
  if(!existing)return incoming;
  const existingAt=existing.settingsUpdatedAt??"",incomingAt=incoming.settingsUpdatedAt??"";
  if(!existingAt||(incomingAt&&incomingAt>=existingAt))return incoming;
  const result={...incoming},metadata={...(incoming.metadata??{})};
  for(const key of["requestedModel","requestedReasoningEffort","requestedServiceTier","permissionProfile","settingsUpdatedAt"])result[key]=existing[key];
  for(const key of["workMode","automationLevel"])if(key in(existing.metadata??{}))metadata[key]=existing.metadata[key];else delete metadata[key];
  return{...result,metadata};
};
const hostRow=(row:Row|undefined)=>row?{id:row.id,type:row.type,name:row.name,displayName:row.display_name,platform:row.platform,architecture:row.architecture,operatingSystemVersion:row.operating_system_version,workerVersion:row.worker_version,status:row.status,capabilities:json(row.capabilities_json),lastSeenAt:row.last_seen_at,createdAt:row.created_at,updatedAt:row.updated_at,disabledAt:row.disabled_at,revokedAt:row.revoked_at}:null;
const rootRow=(row:Row|undefined)=>row?{id:row.id,hostId:row.host_id,displayName:row.display_name,canonicalPath:row.canonical_path,allowCreate:Boolean(row.allow_create),allowRegister:Boolean(row.allow_register),allowClone:Boolean(row.allow_clone),allowDelete:Boolean(row.allow_delete),createdAt:row.created_at,verifiedAt:row.verified_at,disabledAt:row.disabled_at}:null;
const projectRow=(row:Row|undefined)=>row?{id:row.id,name:row.name,slug:row.slug,description:row.description,defaultProvider:row.default_provider,createdAt:row.created_at,updatedAt:row.updated_at,archivedAt:row.archived_at}:null;
const workspaceRow=(row:Row|undefined)=>row?{id:row.id,projectId:row.project_id,hostId:row.host_id,rootId:row.root_id,relativePath:row.relative_path,canonicalPath:row.canonical_path,displayName:row.display_name,workspaceType:row.workspace_type,gitRemote:row.git_remote,defaultBranch:row.default_branch,lastKnownCommit:row.last_known_commit,lastGitStatus:row.last_git_status_json?json(row.last_git_status_json,null):null,lastVerifiedAt:row.last_verified_at,createdAt:row.created_at,updatedAt:row.updated_at,archivedAt:row.archived_at}:null;
const quotaRow=(row:Row|undefined)=>{if(!row)return null;const result:any=objectRow(row);delete result.requestJson;delete result.permissionSnapshotJson;result.request=json(row.request_json);result.permissionSnapshot=json(row.permission_snapshot_json);return result;};
const recoveryRow=(row:Row|undefined)=>objectRow(row);
const boardTransition=(status:string)=>["starting","running"].includes(status)?"started":status==="completed"?"completed":["failed","stopped","cancelled","stop-unconfirmed"].includes(status)?"failed":["waiting","waiting-user","waiting-approval","partial"].includes(status)?"waiting":null;
const recordBoardStatusEvent=(kind:"task"|"collaboration",entityId:string,chainId:string|null|undefined,previousStatus:string|null|undefined,status:string,createdAt:string)=>{
  const transition=boardTransition(status);if(!chainId||!transition||previousStatus===status||!one("SELECT id FROM work_chains WHERE id=? AND board_visible=1",[chainId]))return false;
  const dedupeKey=`${kind}:${entityId}:${transition}`,eventId=`auto:${dedupeKey}`,result=run("INSERT OR IGNORE INTO work_chain_events(id,chain_id,event_type,task_id,collaboration_session_id,actor_type,actor_id,dedupe_key,payload_json,created_at) VALUES(?,?,?,?,?,'system',NULL,?,?,?)",[eventId,chainId,`${kind}.${transition}`,kind==="task"?entityId:null,kind==="collaboration"?entityId:null,dedupeKey,stringify({previousStatus,status}),createdAt]);
  if(result.changes===1)run("UPDATE work_chains SET last_activity_at=?,updated_at=? WHERE id=?",[createdAt,createdAt,chainId]);return result.changes===1;
};

const foldedLiteralBounds=(value:string,query:string,foldedValue=foldSearchText(value)):[number,number]|null=>{
  const needle=foldSearchText(query),offset=foldedValue.indexOf(needle);if(!needle||offset<0)return null;
  if(foldSearchText(value)!==foldedValue)return null;
  let foldedOffset=0,start=-1;for(let index=0;index<value.length;){const char=String.fromCodePoint(value.codePointAt(index)!),end=index+char.length,next=foldedOffset+caseFoldCharacter(char).length;if(start<0&&next>offset)start=index;if(next>=offset+needle.length)return[start<0?index:start,end];foldedOffset=next;index=end;}return null;
};
const SEARCH_DOCUMENT_UPSERT=`INSERT INTO task_search_documents(task_id,provider,workspace_id,status,updated_at,title_folded,prompt_folded,result_folded,error_folded,normalizer_version)
  VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET
  provider=excluded.provider,workspace_id=excluded.workspace_id,status=excluded.status,updated_at=excluded.updated_at,
  title_folded=excluded.title_folded,prompt_folded=excluded.prompt_folded,result_folded=excluded.result_folded,
  error_folded=excluded.error_folded,normalizer_version=excluded.normalizer_version`;
const syncTaskSearchDocument=(taskId:string)=>{
  const row=one("SELECT id,provider,workspace_id,status,updated_at,title,prompt,result,error,ownership,owned FROM tasks WHERE id=?",[taskId]);
  if(!row||!(row.ownership==="claudex-workhouse"||Boolean(row.owned))){run("DELETE FROM task_search_documents WHERE task_id=?",[taskId]);return;}
  run(SEARCH_DOCUMENT_UPSERT,[row.id,row.provider,row.workspace_id,row.status,row.updated_at,foldSearchText(row.title),foldSearchText(row.prompt),foldSearchText(row.result),foldSearchText(row.error),SEARCH_NORMALIZER_VERSION]);
};
const syncCodexThreadSearchDocument=(threadId:string)=>{
  const row=one("SELECT thread_id,workspace_id,status,updated_at,title,preview FROM codex_threads WHERE thread_id=?",[threadId]);if(!row)return;
  run(`INSERT INTO codex_thread_search_documents(thread_id,workspace_id,status,updated_at,title_folded,preview_folded,normalizer_version) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(thread_id) DO UPDATE SET workspace_id=excluded.workspace_id,status=excluded.status,updated_at=excluded.updated_at,title_folded=excluded.title_folded,preview_folded=excluded.preview_folded,normalizer_version=excluded.normalizer_version`,
    [row.thread_id,row.workspace_id,row.status,row.updated_at,foldSearchText(row.title),foldSearchText(row.preview),SEARCH_NORMALIZER_VERSION]);
};
const writeTask=(task:Row)=>{
  const marks=TASK_COLUMNS.map(()=>"?").join(","),updates=TASK_COLUMNS.filter(column=>column!=="id").map(column=>`${column}=excluded.${column}`).join(",");
  run(`INSERT INTO tasks(${TASK_COLUMNS.join(",")}) VALUES(${marks}) ON CONFLICT(id) DO UPDATE SET ${updates}`,taskValues(task));
  syncTaskSearchDocument(task.id);
  return taskRow(one("SELECT * FROM tasks WHERE id=?",[task.id]));
};
const upsertTask=(task:Row)=>transaction(()=>{const previous=one("SELECT status,work_chain_id FROM tasks WHERE id=?",[task.id]),result=writeTask(task)!;recordBoardStatusEvent("task",result.id,result.workChainId,previous?.status,result.status,result.updatedAt);return result;});
const upsertThread=(thread:Row)=>{
  const nullableSettings=new Set(["requested_model","requested_reasoning_effort","requested_service_tier","permission_profile","settings_updated_at"]),value=preserveNewerThreadSettings(thread),updates=THREAD_COLUMNS.filter(column=>column!=="thread_id").map(column=>column==="ownership"?"ownership=CASE WHEN codex_threads.ownership='claudex-workhouse' THEN codex_threads.ownership ELSE COALESCE(excluded.ownership,codex_threads.ownership) END":column==="source"?"source=CASE WHEN codex_threads.ownership='claudex-workhouse' THEN codex_threads.source ELSE COALESCE(excluded.source,codex_threads.source) END":nullableSettings.has(column)?`${column}=excluded.${column}`:`${column}=COALESCE(excluded.${column},${column})`).join(",");
  run(`INSERT INTO codex_threads(${THREAD_COLUMNS.join(",")}) VALUES(${THREAD_COLUMNS.map(()=>"?").join(",")}) ON CONFLICT(thread_id) DO UPDATE SET ${updates}`,threadValues(value));
  syncCodexThreadSearchDocument(value.threadId);
  return threadRow(one("SELECT * FROM codex_threads WHERE thread_id=?",[value.threadId]));
};

const COLLAB_SPECS:Record<string,{columns:string[];json:Set<string>}>={
  collaboration_sessions:{columns:["id","project_id","title","mode","status","outcome","primary_participant_id","max_calls","current_call_count","current_step","max_turns_per_participant","current_turn_counts_json","timeout_at","controller_generation","work_chain_id","source_task_id","created_at","updated_at","completed_at","cancelled_at","archived_at","metadata_json","revision"],json:new Set(["current_turn_counts_json","metadata_json"])},
  collaboration_participants:{columns:["id","collaboration_session_id","provider","role","execution_host_id","workspace_id","provider_session_id","source_task_id","permission_mode","status","session_generation","capability_snapshot_json","created_at","updated_at","archived_at"],json:new Set(["capability_snapshot_json"])},
  collaboration_runs:{columns:["id","collaboration_session_id","participant_id","round","sequence","attempt","purpose","source_participant_id","target_participant_id","provider_task_id","status","deadline_at","input_checksum","relay_artifact_id","generation","last_event_sequence","error_category","started_at","completed_at","failed_at","cancelled_at","created_at","updated_at"],json:new Set()},
  collaboration_messages:{columns:["id","collaboration_session_id","participant_id","run_id","round","message_type","source_message_id","provider_message_id","provider_task_id","content_kind","content_ref","checksum","status","created_at"],json:new Set()},
  relay_artifacts:{columns:["id","collaboration_session_id","source_participant_id","target_participant_id","source_run_id","source_provider","target_provider","source_session_id","source_task_id","source_commit","source_branch","dirty","changed_files_json","diff_checksum","permission_mode","path","checksum","size_bytes","schema_version","status","created_at","delivered_at","expires_at"],json:new Set(["changed_files_json"])},
  collaboration_avatar_state:{columns:["collaboration_session_id","participant_id","source_run_id","generation","utterance_type","line","emotion","activity","source","priority","version","created_at","expires_at"],json:new Set()}
};
const collabValues=(table:string,value:Row)=>{
  const spec=COLLAB_SPECS[table]!;
  return spec.columns.map(column=>{let item=value[camel(column)];if(table==="collaboration_sessions"&&column==="revision"&&item==null)item=1;if(spec.json.has(column))item=stringify(item,column==="changed_files_json"?[]:{});if(column==="dirty")item=item?1:0;return item;});
};
const upsertCollab=(table:string,value:Row,conflict=["id"])=>{
  const spec=COLLAB_SPECS[table]!,updates=spec.columns.filter(column=>!conflict.includes(column)).map(column=>table==="collaboration_sessions"&&column==="revision"?`revision=${table}.revision+1`:`${column}=excluded.${column}`).join(",");
  run(`INSERT INTO ${table}(${spec.columns.join(",")}) VALUES(${spec.columns.map(()=>"?").join(",")}) ON CONFLICT(${conflict.join(",")}) DO UPDATE SET ${updates}`,collabValues(table,value));
  return objectRow(one(`SELECT * FROM ${table} WHERE ${conflict.map(column=>`${column}=?`).join(" AND ")}`,conflict.map(column=>value[camel(column)])),spec.json);
};
const upsertCollaborationSession=(value:Row)=>transaction(()=>{const previous=one("SELECT status,work_chain_id FROM collaboration_sessions WHERE id=?",[value.id]),result=upsertCollab("collaboration_sessions",value)!;recordBoardStatusEvent("collaboration",result.id,result.workChainId,previous?.status,result.status,result.updatedAt);return result;});
const bumpRevision=(id:string)=>{const row=one("UPDATE collaboration_sessions SET revision=revision+1 WHERE id=? RETURNING revision",[id]);if(!row)throw new Error("Collaboration not found");return Number(row.revision);};
const upsertCollabChild=(table:string,value:Row)=>transaction(()=>{const result=upsertCollab(table,value)!;result.revision=bumpRevision(value.collaborationSessionId);return result;});

function handle(op:string,p:Row):any{
  if(op==="ping")return{journalMode:String(one("PRAGMA journal_mode")?.journal_mode),synchronous:Number(one("PRAGMA synchronous")?.synchronous),walAutocheckpoint:Number(one("PRAGMA wal_autocheckpoint")?.wal_autocheckpoint)};
  if(op==="list_tasks")return all("SELECT * FROM tasks ORDER BY updated_at DESC LIMIT ?",[p.limit??500]).map(taskRow);
  if(op==="search_history_local"){
    const query=String(p.query??"").trim();if(!query)return{results:[],nextCursor:null};
    const limit=Math.max(1,Math.min(100,Number(p.limit??50))),needle=foldSearchText(query),taskClauses=["(instr(s.title_folded,?)>0 OR instr(s.prompt_folded,?)>0 OR instr(s.result_folded,?)>0 OR instr(s.error_folded,?)>0)"],taskArgs:any[]=[needle,needle,needle,needle];
    for(const[key,column,operator]of[["provider","s.provider","="],["workspaceId","s.workspace_id","="],["status","s.status","="],["from","s.updated_at",">="],["to","s.updated_at","<="]]as const)if(p[key]){taskClauses.push(`${column}${operator}?`);taskArgs.push(p[key]);}
    if(p.cursorUpdatedAt&&p.cursorKey){taskClauses.push("(s.updated_at<? OR (s.updated_at=? AND ('task:'||s.task_id)<?))");taskArgs.push(p.cursorUpdatedAt,p.cursorUpdatedAt,p.cursorKey);}
    const taskRows=all(`SELECT t.id,t.provider,t.thread_id,t.project_id,t.workspace_id,t.title,t.prompt,t.status,t.updated_at,t.result,t.error,
      s.title_folded,s.prompt_folded,s.result_folded,s.error_folded,'task:'||s.task_id AS sort_key
      FROM task_search_documents s JOIN tasks t ON t.id=s.task_id WHERE ${taskClauses.join(" AND ")}
      ORDER BY s.updated_at DESC,sort_key DESC LIMIT ?`,[...taskArgs,limit+1]);
    const results:any[]=[];
    for(const row of taskRows){let found:Row|null=null;for(const field of["title","prompt","result","error"]){if(!String(row[`${field}_folded`]??"").includes(needle))continue;const value=String(row[field]??""),bounds=foldedLiteralBounds(value,query,String(row[`${field}_folded`]??""));if(bounds){const[startMatch,endMatch]=bounds,start=Math.max(0,startMatch-80),end=Math.min(value.length,endMatch+120);found={matchField:field,snippet:`${start?"…":""}${value.slice(start,end)}${end<value.length?"…":""}`,before:`${start?"…":""}${value.slice(start,startMatch)}`,match:value.slice(startMatch,endMatch),after:`${value.slice(endMatch,end)}${end<value.length?"…":""}`};break;}}if(found)results.push({id:`task:${row.id}`,sortKey:row.sort_key,source:"workhouse",provider:row.provider,taskId:row.id,threadId:row.thread_id,projectId:row.project_id,workspaceId:row.workspace_id,title:row.title,status:row.status,updatedAt:row.updated_at,...found});}
    let threadRows:Row[]=[];
    if(!p.provider||p.provider==="codex"){
      const threadClauses=["c.ownership<>'claudex-workhouse'","(instr(s.title_folded,?)>0 OR instr(s.preview_folded,?)>0)","NOT EXISTS(SELECT 1 FROM tasks t WHERE t.provider='codex' AND t.thread_id=c.thread_id AND (t.ownership='claudex-workhouse' OR t.owned=1))"],threadArgs:any[]=[needle,needle];
      for(const[key,column,operator]of[["workspaceId","s.workspace_id","="],["status","s.status","="],["from","s.updated_at",">="],["to","s.updated_at","<="]]as const)if(p[key]){threadClauses.push(`${column}${operator}?`);threadArgs.push(p[key]);}
      if(p.cursorUpdatedAt&&p.cursorKey){threadClauses.push("(s.updated_at<? OR (s.updated_at=? AND ('thread:codex:'||s.thread_id)<?))");threadArgs.push(p.cursorUpdatedAt,p.cursorUpdatedAt,p.cursorKey);}
      threadRows=all(`SELECT c.*,s.title_folded,s.preview_folded,'thread:codex:'||s.thread_id AS sort_key FROM codex_thread_search_documents s JOIN codex_threads c ON c.thread_id=s.thread_id WHERE ${threadClauses.join(" AND ")} ORDER BY s.updated_at DESC,sort_key DESC LIMIT ?`,[...threadArgs,limit+1]);
      for(const row of threadRows){const title=String(row.title??""),preview=String(row.preview??""),field=String(row.title_folded).includes(needle)?"title":String(row.preview_folded).includes(needle)?"provider":"";if(!field)continue;const value=field==="title"?title:preview,bounds=foldedLiteralBounds(value,query,field==="title"?String(row.title_folded):String(row.preview_folded));if(!bounds)continue;const[startMatch,endMatch]=bounds,start=Math.max(0,startMatch-80),end=Math.min(value.length,endMatch+120);results.push({id:`codex:${row.thread_id}`,sortKey:row.sort_key,source:"codex",provider:"codex",taskId:null,threadId:row.thread_id,projectId:row.project_id,workspaceId:row.workspace_id,title,status:row.status,updatedAt:row.updated_at,matchField:field,snippet:`${start?"…":""}${value.slice(start,end)}${end<value.length?"…":""}`,before:`${start?"…":""}${value.slice(start,startMatch)}`,match:value.slice(startMatch,endMatch),after:`${value.slice(endMatch,end)}${end<value.length?"…":""}`});}
    }
    // Keep this bytewise order aligned with SQLite's BINARY cursor seek. The
    // source prefixes also intentionally put thread:* before task:* on DESC.
    results.sort((left,right)=>String(right.updatedAt)>String(left.updatedAt)?1:String(right.updatedAt)<String(left.updatedAt)?-1:String(right.sortKey)>String(left.sortKey)?1:String(right.sortKey)<String(left.sortKey)?-1:0);
    const page=results.slice(0,limit),last=page.at(-1),hasMore=taskRows.length>limit||threadRows.length>limit||results.length>limit;
    const rawLast=!last&&hasMore?[...taskRows,...threadRows].sort((left,right)=>String(right.updated_at)>String(left.updated_at)?1:String(right.updated_at)<String(left.updated_at)?-1:String(right.sort_key)>String(left.sort_key)?1:String(right.sort_key)<String(left.sort_key)?-1:0).at(0):null;
    const nextCursor=hasMore?(last?{updatedAt:last.updatedAt,id:last.sortKey}:rawLast?{updatedAt:rawLast.updated_at,id:rawLast.sort_key}:null):null;for(const item of page)delete item.sortKey;return{results:page,nextCursor};
  }
  if(op==="search_history_tasks"){
    const query=String(p.query??"").trim();if(!query)return{results:[],nextCursor:null,scanned:0,exhausted:true};
    const limit=Math.max(1,Math.min(100,Number(p.limit??50))),needle=foldSearchText(query),clauses=["(instr(s.title_folded,?)>0 OR instr(s.prompt_folded,?)>0 OR instr(s.result_folded,?)>0 OR instr(s.error_folded,?)>0)"],args:any[]=[needle,needle,needle,needle];
    for(const[key,column,operator]of[["provider","s.provider","="],["workspaceId","s.workspace_id","="],["status","s.status","="],["from","s.updated_at",">="],["to","s.updated_at","<="]]as const)if(p[key]){clauses.push(`${column}${operator}?`);args.push(p[key]);}
    if(p.cursorUpdatedAt&&p.cursorId){clauses.push("(s.updated_at<? OR (s.updated_at=? AND s.task_id<?))");args.push(p.cursorUpdatedAt,p.cursorUpdatedAt,p.cursorId);}
    const rows=all(`SELECT t.id,t.provider,t.thread_id,t.project_id,t.workspace_id,t.title,t.prompt,t.status,t.updated_at,t.result,t.error,
      s.title_folded,s.prompt_folded,s.result_folded,s.error_folded
      FROM task_search_documents s JOIN tasks t ON t.id=s.task_id WHERE ${clauses.join(" AND ")}
      ORDER BY s.updated_at DESC,s.task_id DESC LIMIT ?`,[...args,limit+1]),candidates=rows.slice(0,limit),results:any[]=[];
    for(const row of candidates){let found:Row|null=null;for(const field of["title","prompt","result","error"]){if(!String(row[`${field}_folded`]??"").includes(needle))continue;const value=String(row[field]??""),bounds=foldedLiteralBounds(value,query,String(row[`${field}_folded`]??""));if(bounds){const[startMatch,endMatch]=bounds,start=Math.max(0,startMatch-80),end=Math.min(value.length,endMatch+120);found={matchField:field,snippet:`${start?"…":""}${value.slice(start,end)}${end<value.length?"…":""}`,before:`${start?"…":""}${value.slice(start,startMatch)}`,match:value.slice(startMatch,endMatch),after:`${value.slice(endMatch,end)}${end<value.length?"…":""}`};break;}}if(found)results.push({id:`task:${row.id}`,source:"workhouse",provider:row.provider,taskId:row.id,threadId:row.thread_id,projectId:row.project_id,workspaceId:row.workspace_id,title:row.title,status:row.status,updatedAt:row.updated_at,...found});}
    const exhausted=rows.length<=limit,last=candidates.at(-1);return{results,nextCursor:exhausted||!last?null:{updatedAt:last.updated_at,id:last.id},scanned:candidates.length,exhausted};
  }
  if(op==="list_push_tasks"){
    const ids=(p.taskIds??[]).slice(0,1000).map(String),active=["pending","queued","running","waiting","unknown"],columns="id,provider,status,execution_host_id,updated_at";
    const rows=all(`SELECT ${columns} FROM tasks WHERE status IN (?,?,?,?,?) ORDER BY updated_at DESC`,active);
    if(ids.length)rows.push(...all(`SELECT ${columns} FROM tasks WHERE id IN (${ids.map(()=>"?").join(",")}) AND status NOT IN (?,?,?,?,?)`,[...ids,...active]));
    return rows.sort((left,right)=>String(right.updated_at??"").localeCompare(String(left.updated_at??""))).map(row=>objectRow(row));
  }
  if(op==="get_task")return taskRow(one("SELECT * FROM tasks WHERE id=?",[p.id]));
  if(op==="get_native_task")return taskRow(one("SELECT * FROM tasks WHERE provider=? AND native_id=? ORDER BY updated_at DESC LIMIT 1",[p.provider,p.nativeId]));
  if(op==="list_provider_tasks")return all(p.since?"SELECT * FROM tasks WHERE provider=? AND updated_at>? ORDER BY updated_at DESC LIMIT ?":"SELECT * FROM tasks WHERE provider=? ORDER BY updated_at DESC LIMIT ?",p.since?[p.provider,p.since,p.limit??5000]:[p.provider,p.limit??5000]).map(taskRow);
  if(op==="list_provider_task_links_by_threads"){const ids=(p.threadIds??[]).slice(0,100).filter(Boolean).map(String);if(!ids.length)return[];return all(`SELECT id,thread_id,ownership,owned,command_marker,job_id,source,cwd,project_id,execution_host_id,workspace_id,status,created_at FROM tasks WHERE provider=? AND thread_id IN (${ids.map(()=>"?").join(",")}) ORDER BY updated_at DESC`,[p.provider,...ids]).map(row=>({id:row.id,threadId:row.thread_id,ownership:row.ownership,owned:Boolean(row.owned),commandMarker:row.command_marker,jobId:row.job_id,source:row.source,cwd:row.cwd,projectId:row.project_id,executionHostId:row.execution_host_id,workspaceId:row.workspace_id,status:row.status,createdAt:row.created_at}));}
  if(op==="list_provider_task_ids")return all("SELECT id FROM tasks WHERE provider=?",[p.provider]).map(row=>row.id);
  if(op==="list_provider_task_refresh_rows")return all("SELECT id,provider,thread_id,project_id,title,status,created_at,updated_at,owned,ownership,source,cwd,last_seen_at,command_marker,job_id,execution_host_id,workspace_id,provider_session_id,metadata_json FROM tasks WHERE provider=?",[p.provider]).map(row=>({...objectRow(row,new Set(["metadata_json"])),nativeId:row.id,prompt:"",result:null,error:null,log:"",owned:Boolean(row.owned)}));
  if(op==="list_active_tasks")return all("SELECT * FROM tasks WHERE status IN ('pending','queued','starting','running','waiting','stopping','unknown') ORDER BY updated_at DESC").map(taskRow);
  if(op==="upsert_task")return upsertTask(p.task);
  if(op==="delete_external_task_mirror")return run("DELETE FROM tasks WHERE provider=? AND id=? AND thread_id=? AND owned=0 AND ownership='external'",[p.provider,p.id,p.threadId]).changes===1;
  if(op==="delete_task_session"){run("DELETE FROM session_message_queue WHERE provider=? AND thread_id=?",[p.provider,p.threadId]);return run("DELETE FROM tasks WHERE provider=? AND thread_id=?",[p.provider,p.threadId]).changes;}
  if(op==="enqueue_session_message"){const x=p.item;run("INSERT INTO session_message_queue(id,provider,thread_id,source_task_id,prompt,status,created_at,updated_at,dispatched_task_id,error) VALUES(?,?,?,?,?,'queued',?,?,NULL,?)",[x.id,x.provider,x.threadId,x.sourceTaskId,x.prompt,x.createdAt,x.updatedAt,x.error]);return objectRow(one("SELECT * FROM session_message_queue WHERE id=?",[x.id]));}
  if(op==="update_session_message"){if(run("UPDATE session_message_queue SET prompt=?,updated_at=? WHERE id=? AND status='queued'",[p.prompt,p.updatedAt,p.id]).changes!==1)return null;return objectRow(one("SELECT * FROM session_message_queue WHERE id=?",[p.id]));}
  if(op==="list_session_messages")return all("SELECT * FROM session_message_queue WHERE provider=? AND thread_id=? AND status IN ('queued','dispatching','delivery-uncertain','failed') ORDER BY created_at,id",[p.provider,p.threadId]).map(row=>objectRow(row));
  if(op==="list_queued_session_messages")return all("SELECT * FROM session_message_queue WHERE status='queued' AND (error IS NULL OR error NOT LIKE 'paid-credit-consent-required:%') ORDER BY created_at,id LIMIT ?",[p.limit??100]).map(row=>objectRow(row));
  if(op==="list_credit_waiting_session_messages")return all("SELECT * FROM session_message_queue WHERE status='queued' AND error LIKE 'paid-credit-consent-required:%' ORDER BY created_at,id LIMIT ?",[p.limit??100]).map(row=>objectRow(row));
  if(op==="defer_session_message_credit"){run("UPDATE session_message_queue SET updated_at=?,error=? WHERE id=? AND status='queued'",[p.updatedAt,p.error,p.id]);return objectRow(one("SELECT * FROM session_message_queue WHERE id=?",[p.id]));}
  if(op==="clear_session_message_credit_wait"){run("UPDATE session_message_queue SET updated_at=?,error=NULL WHERE id=? AND status='queued' AND error LIKE 'paid-credit-consent-required:%'",[p.updatedAt,p.id]);return objectRow(one("SELECT * FROM session_message_queue WHERE id=?",[p.id]));}
  if(op==="get_session_message")return objectRow(one("SELECT * FROM session_message_queue WHERE id=?",[p.id]));
  if(op==="claim_session_message")return transaction(()=>{const row=one("SELECT * FROM session_message_queue WHERE id=? AND status='queued'",[p.id]);if(!row)return null;if(one("SELECT id FROM session_message_queue WHERE provider=? AND thread_id=? AND status IN ('dispatching','delivery-uncertain') LIMIT 1",[row.provider,row.thread_id]))return null;run("UPDATE session_message_queue SET status='dispatching',updated_at=?,error=NULL WHERE id=? AND status='queued'",[p.updatedAt,p.id]);return objectRow(one("SELECT * FROM session_message_queue WHERE id=?",[p.id]));});
  if(op==="finish_session_message"){run("UPDATE session_message_queue SET status=?,updated_at=?,dispatched_task_id=?,error=? WHERE id=? AND status='dispatching'",[p.status,p.updatedAt,p.dispatchedTaskId,p.error,p.id]);return objectRow(one("SELECT * FROM session_message_queue WHERE id=?",[p.id]));}
  if(op==="retry_session_message"){run("UPDATE session_message_queue SET status='queued',updated_at=?,dispatched_task_id=NULL,error=NULL WHERE id=? AND status IN ('failed','delivery-uncertain')",[p.updatedAt,p.id]);return objectRow(one("SELECT * FROM session_message_queue WHERE id=?",[p.id]));}
  if(op==="resolve_session_message_sent"){run("UPDATE session_message_queue SET status='sent',updated_at=?,error=COALESCE(error,'Manually marked delivered.') WHERE id=? AND status='delivery-uncertain'",[p.updatedAt,p.id]);return objectRow(one("SELECT * FROM session_message_queue WHERE id=?",[p.id]));}
  if(op==="delete_session_message")return run("DELETE FROM session_message_queue WHERE id=? AND status IN ('queued','failed','delivery-uncertain')",[p.id]).changes===1;
  if(op==="recover_session_messages")return run("UPDATE session_message_queue SET status='delivery-uncertain',updated_at=?,error='Server stopped while dispatching. Delivery could not be confirmed; automatic retry is blocked.' WHERE status='dispatching'",[p.updatedAt]).changes;
  if(op==="create_quota_task_reservation"){const x=p.item;run("INSERT INTO quota_task_reservations(id,provider,project_id,execution_host_id,workspace_id,title,request_json,permission_snapshot_json,status,criterion,idempotency_key,created_at,updated_at,next_check_at,last_quota_check_at,last_quota_status,claim_started_at,task_id,error) VALUES(?,?,?,?,?,?,?,?,?,'next-five-hour-reset',?,?,?,?,?,?,?,?,?)",[x.id,x.provider,x.projectId,x.executionHostId,x.workspaceId,x.title,stringify(x.request),stringify(x.permissionSnapshot),x.status,x.idempotencyKey,x.createdAt,x.updatedAt,x.nextCheckAt,x.lastQuotaCheckAt,x.lastQuotaStatus,x.claimStartedAt,x.taskId,x.error]);return quotaRow(one("SELECT * FROM quota_task_reservations WHERE id=?",[x.id]));}
  if(op==="get_quota_task_reservation")return quotaRow(one("SELECT * FROM quota_task_reservations WHERE id=?",[p.id]));
  if(op==="list_quota_task_reservations"){const clauses:string[]=[],args:any[]=[];if(p.includeTerminal===false)clauses.push(p.includeFailed?"status IN ('waiting-quota','claiming','starting','failed')":"status IN ('waiting-quota','claiming','starting')");if(p.provider){clauses.push("provider=?");args.push(p.provider);}return all(`SELECT * FROM quota_task_reservations${clauses.length?` WHERE ${clauses.join(" AND ")}`:""} ORDER BY CASE WHEN status IN ('waiting-quota','claiming','starting') THEN 0 WHEN status='failed' THEN 1 ELSE 2 END,created_at DESC LIMIT ?`,[...args,p.limit??200]).map(quotaRow);}
  if(op==="list_due_quota_task_reservations")return all("SELECT * FROM quota_task_reservations WHERE status='waiting-quota' AND next_check_at<=? ORDER BY next_check_at,created_at LIMIT ?",[p.now,p.limit??100]).map(quotaRow);
  const quotaUpdates:Record<string,[string,any[]]>={
    claim_quota_task_reservation:["UPDATE quota_task_reservations SET status='claiming',claim_started_at=?,updated_at=?,last_quota_check_at=?,last_quota_status=? WHERE id=? AND status='waiting-quota' RETURNING *",[p.now,p.now,p.now,p.quotaStatus,p.id]],
    reschedule_quota_task_reservation:["UPDATE quota_task_reservations SET updated_at=?,next_check_at=?,last_quota_check_at=?,last_quota_status=?,error=NULL,quota_check_count=quota_check_count+1 WHERE id=? AND status='waiting-quota' RETURNING *",[p.now,p.nextCheckAt,p.lastQuotaCheckAt,p.lastQuotaStatus,p.id]],
    mark_quota_task_reservation_starting:["UPDATE quota_task_reservations SET status='starting',updated_at=?,task_id=?,error=NULL WHERE id=? AND status='claiming' RETURNING *",[p.now,p.taskId,p.id]],
    mark_quota_task_reservation_started:["UPDATE quota_task_reservations SET status='started',updated_at=?,task_id=?,error=NULL WHERE id=? AND status='starting' RETURNING *",[p.now,p.taskId,p.id]],
    fail_quota_task_reservation:["UPDATE quota_task_reservations SET status='failed',updated_at=?,task_id=NULL,error=? WHERE id=? AND status IN ('claiming','starting') RETURNING *",[p.now,p.error,p.id]],
    retry_quota_task_reservation:["UPDATE quota_task_reservations SET status='waiting-quota',updated_at=?,next_check_at=?,claim_started_at=NULL,task_id=NULL,error=NULL,quota_check_count=0 WHERE id=? AND status='failed' AND task_id IS NULL RETURNING *",[p.now,p.now,p.id]],
    cancel_quota_task_reservation:["UPDATE quota_task_reservations SET status='cancelled',updated_at=?,error=NULL WHERE id=? AND status='waiting-quota' RETURNING *",[p.now,p.id]]
  };if(quotaUpdates[op]){const[sql,args]=quotaUpdates[op]!;return quotaRow(one(sql,args));}
  if(op==="recover_quota_task_reservations"){const clauses=["status IN ('claiming','starting')"],args:any[]=[];if(p.staleBefore){clauses.push("updated_at<=?");args.push(p.staleBefore);}return transaction(()=>all(`SELECT * FROM quota_task_reservations WHERE ${clauses.join(" AND ")}`,args).map(row=>{if(row.task_id&&one("SELECT 1 FROM tasks WHERE id=?",[row.task_id]))run("UPDATE quota_task_reservations SET status='started',updated_at=?,error=NULL WHERE id=?",[p.now,row.id]);else if(row.status==="starting")run("UPDATE quota_task_reservations SET status='failed',updated_at=?,task_id=NULL,error=? WHERE id=?",[p.now,"Provider launch began, but task creation could not be confirmed. Automatic retry is blocked to prevent duplicate execution.",row.id]);else run("UPDATE quota_task_reservations SET status='waiting-quota',updated_at=?,next_check_at=?,claim_started_at=NULL,error=? WHERE id=?",[p.now,p.now,"Recovered after server restart before task creation was confirmed.",row.id]);return quotaRow(one("SELECT * FROM quota_task_reservations WHERE id=?",[row.id]));}));}
  if(op==="get_task_recovery_attempt")return recoveryRow(one("SELECT * FROM task_recovery_attempts WHERE source_task_id=?",[p.sourceTaskId]));
  if(op==="claim_task_recovery")return transaction(()=>{const existing=one("SELECT * FROM task_recovery_attempts WHERE source_task_id=?",[p.sourceTaskId]);if(existing)return{claimed:false,attempt:recoveryRow(existing)};run("INSERT INTO task_recovery_attempts(source_task_id,attempt_id,status,prompt_hash,created_at,updated_at,resumed_task_id,error) VALUES(?,?,'claiming',?,?,?,NULL,NULL)",[p.sourceTaskId,p.attemptId,p.promptHash,p.now,p.now]);return{claimed:true,attempt:recoveryRow(one("SELECT * FROM task_recovery_attempts WHERE source_task_id=?",[p.sourceTaskId]))};});
  if(op==="finish_task_recovery")return recoveryRow(one("UPDATE task_recovery_attempts SET status=?,updated_at=?,resumed_task_id=?,error=? WHERE source_task_id=? AND attempt_id=? AND status='claiming' RETURNING *",[p.status,p.now,p.resumedTaskId,p.error,p.sourceTaskId,p.attemptId]));
  if(op==="release_task_recovery_claim")return run("DELETE FROM task_recovery_attempts WHERE source_task_id=? AND attempt_id=? AND status='claiming'",[p.sourceTaskId,p.attemptId]).changes===1;
  if(op==="recover_task_recovery_attempts")return transaction(()=>all("SELECT * FROM task_recovery_attempts WHERE status='claiming'").map(attempt=>{let resumed:string|null=null;for(const task of all("SELECT id,metadata_json FROM tasks WHERE id<>?",[attempt.source_task_id])){const metadata=json(task.metadata_json);if(metadata.recoveredFromTaskId===attempt.source_task_id&&metadata.recoveryAttemptId===attempt.attempt_id){resumed=task.id;break;}}if(!resumed){const source=one("SELECT id,metadata_json FROM tasks WHERE id=?",[attempt.source_task_id]),metadata=json(source?.metadata_json);if(source&&metadata.recoveredFromTaskId===attempt.source_task_id&&metadata.recoveryAttemptId===attempt.attempt_id)resumed=source.id;}if(resumed)run("UPDATE task_recovery_attempts SET status='started',updated_at=?,resumed_task_id=?,error=NULL WHERE source_task_id=? AND attempt_id=? AND status='claiming'",[p.now,resumed,attempt.source_task_id,attempt.attempt_id]);else run("UPDATE task_recovery_attempts SET status='failed',updated_at=?,error=? WHERE source_task_id=? AND attempt_id=? AND status='claiming'",[p.now,"Server restarted after Provider recovery launch may have begun. Automatic retry is blocked to prevent duplicate execution.",attempt.source_task_id,attempt.attempt_id]);return recoveryRow(one("SELECT * FROM task_recovery_attempts WHERE source_task_id=?",[attempt.source_task_id]));}));
  if(op==="latest_thread_task")return taskRow(one("SELECT * FROM tasks WHERE provider=? AND thread_id=? ORDER BY created_at DESC,updated_at DESC LIMIT 1",[p.provider,p.threadId]));
  if(op==="claim_idempotency")return transaction(()=>{run("DELETE FROM idempotency WHERE state IN ('completed','failed') AND updated_at<?",[p.pruneBefore??"1970-01-01T00:00:00.000Z"]);const row=one("SELECT * FROM idempotency WHERE key=? AND action=?",[p.key,p.action]);if(row){const stale=row.state==="pending"&&row.updated_at<(p.staleBefore??p.now)&&row.owner_token!==p.ownerToken;if(stale){run("UPDATE idempotency SET request_hash=?,state='pending',response_json=NULL,owner_token=?,updated_at=? WHERE key=? AND action=?",[p.requestHash,p.ownerToken,p.now,p.key,p.action]);return{claimed:true,state:"pending",requestHash:p.requestHash,response:null};}return{claimed:false,state:row.state,requestHash:row.request_hash,response:row.response_json?json(row.response_json,null):null};}run("INSERT INTO idempotency(key,action,request_hash,state,response_json,owner_token,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",[p.key,p.action,p.requestHash,"pending",null,p.ownerToken,p.now,p.now]);return{claimed:true,state:"pending",requestHash:p.requestHash,response:null};});
  if(op==="finish_idempotency")return run("UPDATE idempotency SET state=?,response_json=?,updated_at=? WHERE key=? AND action=? AND (owner_token=? OR (owner_token IS NULL AND ? IS NULL))",[p.state,stringify(p.response,null),p.now,p.key,p.action,p.ownerToken,p.ownerToken]).changes===1;
  if(op==="append_audit"){run("INSERT INTO audit_log(created_at,actor,action,provider,task_id,project_id,outcome,detail,host_id,workspace_id) VALUES(?,?,?,?,?,?,?,?,?,?)",[p.createdAt,p.actor,p.action,p.provider,p.taskId,p.projectId,p.outcome,p.detail,p.hostId,p.workspaceId]);return true;}
  if(op==="proven_task_ids")return all("SELECT DISTINCT task_id FROM audit_log WHERE outcome='success' AND action IN ('create','message','fork','codex-message','codex-fork') AND task_id IS NOT NULL").map(row=>row.task_id);
  if(op==="upsert_codex_thread")return upsertThread(p.thread);
  if(op==="apply_task_thread_settings")return transaction(()=>({tasks:(p.tasks??[]).map(writeTask),thread:upsertThread(p.thread)}));
  if(op==="get_codex_thread")return threadRow(one("SELECT * FROM codex_threads WHERE thread_id=?",[p.threadId]));
  if(op==="list_codex_threads")return all("SELECT * FROM codex_threads WHERE archived=? ORDER BY updated_at DESC,thread_id LIMIT ?",[p.archived?1:0,p.limit??100]).map(threadRow);
  if(op==="list_codex_threads_by_ids"){const ids=(p.threadIds??[]).slice(0,100).filter(Boolean).map(String);return ids.length?all(`SELECT * FROM codex_threads WHERE thread_id IN (${ids.map(()=>"?").join(",")})`,ids).map(threadRow):[];}
  if(op==="delete_codex_thread"){run("DELETE FROM codex_threads WHERE thread_id=?",[p.threadId]);return true;}
  if(op==="put_cache"){run("INSERT INTO provider_cache VALUES(?,?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET value_json=excluded.value_json,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at,version=excluded.version",[p.key,stringify(p.value),p.fetchedAt,p.expiresAt,p.version]);return true;}
  if(op==="get_cache"){const row=one("SELECT * FROM provider_cache WHERE cache_key=?",[p.key]);return row?{value:json(row.value_json),fetchedAt:row.fetched_at,expiresAt:row.expires_at,version:row.version}:null;}
  if(op==="list_push_subscriptions")return all("SELECT * FROM push_subscriptions WHERE disabled_at IS NULL ORDER BY last_used_at DESC").map(row=>objectRow(row));
  if(op==="upsert_push_subscription"){const x=p.subscription;run("INSERT INTO push_subscriptions(id,endpoint_hash,encrypted_json,browser_label,created_at,last_used_at,disabled_at) VALUES(?,?,?,?,?,?,NULL) ON CONFLICT(endpoint_hash) DO UPDATE SET encrypted_json=excluded.encrypted_json,browser_label=excluded.browser_label,last_used_at=excluded.last_used_at,disabled_at=NULL",[x.id,x.endpointHash,x.encryptedJson,x.browserLabel,x.createdAt,x.lastUsedAt]);return true;}
  if(op==="disable_push_subscription"){run("UPDATE push_subscriptions SET disabled_at=? WHERE id=? OR endpoint_hash=?",[p.disabledAt,p.id,p.endpointHash]);return true;}
  if(op==="disable_all_push_subscriptions"){run("UPDATE push_subscriptions SET disabled_at=? WHERE disabled_at IS NULL",[p.disabledAt]);return true;}
  if(op==="list_external_access_profiles")return all("SELECT * FROM external_access_profiles ORDER BY provider").map(row=>objectRow(row,new Set(["configuration_json","managed_resources_json"])));
  if(op==="get_external_access_profile")return objectRow(one("SELECT * FROM external_access_profiles WHERE id=?",[p.id]),new Set(["configuration_json","managed_resources_json"]));
  if(op==="upsert_external_access_profile")return transaction(()=>{const x=p.profile,current=one("SELECT * FROM external_access_profiles WHERE provider=?",[x.provider]);if(current&&p.expectedRevision!=null&&current.revision!==p.expectedRevision)return{updated:false,current:objectRow(current,new Set(["configuration_json","managed_resources_json"]))};const revision=current?current.revision+1:1,id=current?.id??x.id,createdAt=current?.created_at??x.createdAt;run("INSERT INTO external_access_profiles(id,provider,desired_mode,configuration_json,configuration_source,managed_resources_json,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET desired_mode=excluded.desired_mode,configuration_json=excluded.configuration_json,configuration_source=excluded.configuration_source,managed_resources_json=excluded.managed_resources_json,revision=excluded.revision,updated_at=excluded.updated_at",[id,x.provider,x.desiredMode,stringify(x.configuration),x.configurationSource,stringify(x.managedResources,[]),revision,createdAt,x.updatedAt]);return{updated:true,current:objectRow(one("SELECT * FROM external_access_profiles WHERE provider=?",[x.provider]),new Set(["configuration_json","managed_resources_json"]))};});
  if(op==="delete_external_access_profile")return run("DELETE FROM external_access_profiles WHERE id=? AND revision=?",[p.id,p.revision]).changes===1;
  if(op==="create_external_access_operation"){const x=p.operation;run("INSERT INTO external_access_operations(id,profile_id,provider,action,plan_digest,status,stage,safe_error_code,started_at,updated_at,finished_at,rollback_status,interrupted) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",[x.id,x.profileId,x.provider,x.action,x.planDigest,x.status,x.stage,x.safeErrorCode,x.startedAt,x.updatedAt,x.finishedAt,x.rollbackStatus,x.interrupted]);return objectRow(one("SELECT * FROM external_access_operations WHERE id=?",[x.id]));}
  if(op==="update_external_access_operation"){const x=p.operation;run("UPDATE external_access_operations SET profile_id=?,status=?,stage=?,safe_error_code=?,started_at=?,updated_at=?,finished_at=?,rollback_status=?,interrupted=? WHERE id=?",[x.profileId,x.status,x.stage,x.safeErrorCode,x.startedAt,x.updatedAt,x.finishedAt,x.rollbackStatus,x.interrupted,x.id]);return objectRow(one("SELECT * FROM external_access_operations WHERE id=?",[x.id]));}
  if(op==="get_external_access_operation")return objectRow(one("SELECT * FROM external_access_operations WHERE id=?",[p.id]));
  if(op==="list_external_access_checks")return all("SELECT * FROM external_access_checks WHERE operation_id=? ORDER BY checked_at,id",[p.operationId]).map(row=>objectRow(row));
  if(op==="append_external_access_check"){const x=p.check;run("INSERT INTO external_access_checks(operation_id,profile_id,check_code,status,safe_detail,checked_at) VALUES(?,?,?,?,?,?)",[x.operationId,x.profileId,x.code,x.status,x.detail,x.checkedAt]);return true;}
  if(op==="reconcile_external_access_operations")return run("UPDATE external_access_operations SET status='interrupted',stage='interrupted',safe_error_code='SERVER_RESTARTED',interrupted=1,updated_at=?,finished_at=? WHERE status IN ('pending','awaiting_approval','running','verifying','rolling_back')",[p.now,p.now]).changes;
  if(op==="create_proton_upload_operation"){const x=p.operation,columns=["id","host_id","task_id","workspace_id","source_relative_path","source_name","source_size","source_sha256","remote_path","status","stage","safe_error_code","cli_version","created_at","started_at","updated_at","finished_at","interrupted"],mapping:Record<string,string>={host_id:"hostId",task_id:"taskId",workspace_id:"workspaceId",source_relative_path:"sourceRelativePath",source_name:"sourceName",source_size:"sourceSize",source_sha256:"sourceSha256",remote_path:"remotePath",safe_error_code:"safeErrorCode",cli_version:"cliVersion",created_at:"createdAt",started_at:"startedAt",updated_at:"updatedAt",finished_at:"finishedAt"},values=columns.map(column=>column==="interrupted"?(x.interrupted?1:0):x[mapping[column]??column]);run(`INSERT INTO proton_upload_operations(${columns.join(",")}) VALUES(${columns.map(()=>"?").join(",")})`,values);return objectRow(one("SELECT * FROM proton_upload_operations WHERE id=?",[x.id]));}
  if(op==="update_proton_upload_operation"){const x=p.operation;run("UPDATE proton_upload_operations SET status=?,stage=?,safe_error_code=?,cli_version=?,started_at=?,updated_at=?,finished_at=?,interrupted=? WHERE id=?",[x.status,x.stage,x.safeErrorCode,x.cliVersion,x.startedAt,x.updatedAt,x.finishedAt,x.interrupted,x.id]);return objectRow(one("SELECT * FROM proton_upload_operations WHERE id=?",[x.id]));}
  if(op==="get_proton_upload_operation")return objectRow(one("SELECT * FROM proton_upload_operations WHERE id=?",[p.id]));
  if(op==="list_proton_upload_operations")return all("SELECT * FROM proton_upload_operations ORDER BY updated_at DESC,id DESC LIMIT ?",[Math.max(1,Math.min(Number(p.limit??50),200))]).map(row=>objectRow(row)!);
  if(op==="reconcile_proton_upload_operations")return run("UPDATE proton_upload_operations SET status='delivery-uncertain',stage='delivery-uncertain',safe_error_code='SERVER_RESTARTED',interrupted=1,updated_at=?,finished_at=? WHERE status IN ('running','verifying')",[p.now,p.now]).changes;
  if(op==="put_system_setting"){run("INSERT INTO system_settings(setting_key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(setting_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",[p.key,stringify(p.value),p.updatedAt]);return true;}
  if(op==="put_system_setting_if_updated")return transaction(()=>{const row=one("SELECT value_json,updated_at FROM system_settings WHERE setting_key=?",[p.key]),current=row?{value:json(row.value_json),updatedAt:row.updated_at}:null;if((row?.updated_at??null)!==(p.expectedUpdatedAt??null))return{updated:false,current};run("INSERT INTO system_settings(setting_key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(setting_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",[p.key,stringify(p.value),p.updatedAt]);return{updated:true,current:{value:p.value,updatedAt:p.updatedAt}};});
  if(op==="get_system_setting"){const row=one("SELECT value_json,updated_at FROM system_settings WHERE setting_key=?",[p.key]);return row?{value:json(row.value_json),updatedAt:row.updated_at}:null;}
  if(op==="update_application_update_attempt"){/* handled by the shared branch below */}
  if(op==="create_application_update_attempt"||op==="update_application_update_attempt"){
    const x=p.attempt,columns=["id","state","source_version","target_version","manifest_sha256","install_method","platform","architecture","snapshot_id","request_path","rollback_performed","error","created_at","updated_at","completed_at"],mapping:Record<string,string>={source_version:"sourceVersion",target_version:"targetVersion",manifest_sha256:"manifestSha256",install_method:"installMethod",snapshot_id:"snapshotId",request_path:"requestPath",rollback_performed:"rollbackPerformed",created_at:"createdAt",updated_at:"updatedAt",completed_at:"completedAt"},values=columns.map(column=>column==="rollback_performed"?(x.rollbackPerformed?1:0):x[mapping[column]??column]);
    if(op==="create_application_update_attempt")run(`INSERT INTO application_update_attempts(${columns.join(",")}) VALUES(${columns.map(()=>"?").join(",")})`,values);
    else{const mutable=columns.filter(column=>!["id","created_at"].includes(column));const result=run(`UPDATE application_update_attempts SET ${mutable.map(column=>`${column}=?`).join(",")} WHERE id=?`,[...mutable.map(column=>values[columns.indexOf(column)]),x.id]);if(result.changes!==1)throw new Error("Application update attempt not found");}
    const result:any=objectRow(one("SELECT * FROM application_update_attempts WHERE id=?",[x.id]));result.rollbackPerformed=Boolean(result.rollbackPerformed);return result;
  }
  if(op==="get_active_application_update_attempt"){const result:any=objectRow(one("SELECT * FROM application_update_attempts WHERE state IN ('staging','applying','verifying','rollback-running') ORDER BY created_at DESC LIMIT 1"));if(result)result.rollbackPerformed=Boolean(result.rollbackPerformed);return result;}
  if(op==="get_application_update_attempt"){const result:any=objectRow(one("SELECT * FROM application_update_attempts WHERE id=?",[p.id]));if(result)result.rollbackPerformed=Boolean(result.rollbackPerformed);return result;}
  if(op==="list_application_update_attempts"){const limit=Math.max(1,Math.min(Number(p.limit??10),100));return all("SELECT * FROM application_update_attempts ORDER BY created_at DESC,id DESC LIMIT ?",[limit]).map(row=>{const result:any=objectRow(row);result.rollbackPerformed=Boolean(result.rollbackPerformed);return result;});}
  if(op==="accept_release_state")return transaction(()=>{const key="deployment.release-state.v1",x=p.state,row=one("SELECT value_json FROM system_settings WHERE setting_key=?",[key]),current=row?json(row.value_json,null):null,valid=(value:any)=>value&&typeof value==="object"&&value.schemaVersion===1&&typeof value.channel==="string"&&/^[a-z][a-z0-9-]{0,31}$/.test(value.channel)&&Number.isInteger(value.releaseSequence)&&value.releaseSequence>0&&typeof value.manifestSha256==="string"&&/^[0-9a-f]{64}$/.test(value.manifestSha256);if(!valid(x)||current&&!valid(current))return{accepted:false,reason:"invalid-state",current};if(current&&current.channel!==x.channel)return{accepted:false,reason:"channel-mismatch",current};if(current&&x.releaseSequence<current.releaseSequence)return{accepted:false,reason:"downgrade",current};if(current&&x.releaseSequence===current.releaseSequence&&x.manifestSha256!==current.manifestSha256)return{accepted:false,reason:"equivocation",current};const reused=Boolean(current&&x.releaseSequence===current.releaseSequence&&x.manifestSha256===current.manifestSha256);run("INSERT INTO system_settings(setting_key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(setting_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",[key,stringify(x),p.updatedAt]);return{accepted:true,reused,current:x};});
  if(op==="upsert_snapshot"){const x=p.snapshot,columns=["id","format_version","logical_key","kind","origin","state","relative_path","created_at","updated_at","size_bytes","file_count","verification","pinned","protected_reason","trashed_at","purge_after","last_error","manifest_digest"],mapping:Record<string,string>={format_version:"formatVersion",logical_key:"logicalKey",relative_path:"relativePath",created_at:"createdAt",updated_at:"updatedAt",size_bytes:"sizeBytes",file_count:"fileCount",protected_reason:"protectedReason",trashed_at:"trashedAt",purge_after:"purgeAfter",last_error:"lastError",manifest_digest:"manifestDigest"},values=columns.map(column=>column==="pinned"?(x.pinned?1:0):x[mapping[column]??column]),updates=columns.filter(column=>!["id","created_at"].includes(column)).map(column=>`${column}=excluded.${column}`).join(",");run(`INSERT INTO snapshots(${columns.join(",")}) VALUES(${columns.map(()=>"?").join(",")}) ON CONFLICT(id) DO UPDATE SET ${updates}`,values);const result:any=objectRow(one("SELECT * FROM snapshots WHERE id=?",[x.id]));result.pinned=Boolean(result.pinned);return result;}
  if(op==="get_snapshot"){const result:any=objectRow(one("SELECT * FROM snapshots WHERE id=?",[p.id]));if(result)result.pinned=Boolean(result.pinned);return result;}
  if(op==="list_snapshots")return all("SELECT * FROM snapshots ORDER BY created_at DESC,id").map(row=>{const result:any=objectRow(row);result.pinned=Boolean(result.pinned);return result;});
  if(op==="list_hosts")return all("SELECT * FROM execution_hosts ORDER BY type,name").map(hostRow);
  if(op==="get_host")return hostRow(one("SELECT * FROM execution_hosts WHERE id=?",[p.id]));
  if(op==="upsert_host"){const h=p.host,now=h.updatedAt??h.createdAt;run("INSERT INTO execution_hosts(id,type,name,display_name,platform,architecture,operating_system_version,worker_version,status,capabilities_json,last_seen_at,created_at,updated_at,disabled_at,revoked_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,display_name=excluded.display_name,platform=excluded.platform,architecture=excluded.architecture,operating_system_version=excluded.operating_system_version,worker_version=excluded.worker_version,status=excluded.status,capabilities_json=excluded.capabilities_json,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at,disabled_at=excluded.disabled_at,revoked_at=excluded.revoked_at",[h.id,h.type??"worker",h.name??h.id,h.displayName??h.name??h.id,h.platform??"unknown",h.architecture??"unknown",h.operatingSystemVersion,h.workerVersion,h.status??"unknown",stringify(h.capabilities),h.lastSeenAt,h.createdAt??now,now,h.disabledAt,h.revokedAt]);return hostRow(one("SELECT * FROM execution_hosts WHERE id=?",[h.id]));}
  if(op==="put_worker_credential"){run("INSERT INTO worker_credentials(host_id,credential_hash,credential_version,created_at,last_used_at,rotated_at,revoked_at) VALUES(?,?,?,?,?,?,NULL) ON CONFLICT(host_id) DO UPDATE SET credential_hash=excluded.credential_hash,credential_version=excluded.credential_version,rotated_at=excluded.rotated_at,revoked_at=NULL",[p.hostId,p.credentialHash,p.credentialVersion??1,p.createdAt,p.lastUsedAt,p.rotatedAt]);return true;}
  if(op==="get_worker_credential")return objectRow(one("SELECT * FROM worker_credentials WHERE host_id=?",[p.hostId]));
  if(op==="revoke_worker_credential"){run("UPDATE worker_credentials SET revoked_at=? WHERE host_id=?",[p.revokedAt,p.hostId]);return true;}
  const enrollmentJson=new Set(["intended_roles_json"]);
  if(op==="create_bootstrap_enrollment"){const x=p.enrollment;run("INSERT INTO bootstrap_enrollments(id,scope,token_hash,expires_at,consumed_at,created_at,intended_roles_json) VALUES(?,?,?,?,?,?,?)",[x.id,x.scope,x.tokenHash,x.expiresAt,x.consumedAt,x.createdAt,stringify(x.intendedRoles,[])]);return objectRow(one("SELECT * FROM bootstrap_enrollments WHERE id=?",[x.id]),enrollmentJson);}
  if(op==="replace_bootstrap_enrollment"){const x=p.enrollment;return transaction(()=>{run("UPDATE bootstrap_enrollments SET consumed_at=? WHERE scope=? AND consumed_at IS NULL",[x.createdAt,x.scope]);run("INSERT INTO bootstrap_enrollments(id,scope,token_hash,expires_at,consumed_at,created_at,intended_roles_json) VALUES(?,?,?,?,?,?,?)",[x.id,x.scope,x.tokenHash,x.expiresAt,x.consumedAt,x.createdAt,stringify(x.intendedRoles,[])]);return objectRow(one("SELECT * FROM bootstrap_enrollments WHERE id=?",[x.id]),enrollmentJson);});}
  if(op==="get_bootstrap_enrollment")return objectRow(one("SELECT * FROM bootstrap_enrollments WHERE id=?",[p.id]),enrollmentJson);
  if(op==="get_active_bootstrap_enrollment")return objectRow(one("SELECT * FROM bootstrap_enrollments WHERE scope=? AND consumed_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1",[p.scope,p.now]),enrollmentJson);
  if(op==="consume_owner_bootstrap_enrollment")return transaction(()=>{const row=one("SELECT * FROM bootstrap_enrollments WHERE id=? AND scope='server-owner' AND token_hash=? AND consumed_at IS NULL AND expires_at>?",[p.id,p.tokenHash,p.now]);if(!row)return null;run("UPDATE bootstrap_enrollments SET consumed_at=? WHERE id=? AND consumed_at IS NULL",[p.now,p.id]);run("INSERT INTO system_settings(setting_key,value_json,updated_at) VALUES('owner.claim',?,?) ON CONFLICT(setting_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",[stringify(p.owner),p.now]);return objectRow(one("SELECT * FROM bootstrap_enrollments WHERE id=?",[p.id]),enrollmentJson);});
  if(op==="recover_owner_bootstrap_enrollment"){const x=p.enrollment;return transaction(()=>{run("UPDATE bootstrap_enrollments SET consumed_at=? WHERE scope='server-owner' AND consumed_at IS NULL",[x.createdAt]);run("INSERT INTO bootstrap_enrollments(id,scope,token_hash,expires_at,consumed_at,created_at,intended_roles_json) VALUES(?,?,?,?,?,?,?)",[x.id,"server-owner",x.tokenHash,x.expiresAt,null,x.createdAt,stringify(x.intendedRoles,[])]);run("INSERT INTO system_settings(setting_key,value_json,updated_at) VALUES('owner.claim',?,?) ON CONFLICT(setting_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",[stringify(p.recovery),x.createdAt]);return objectRow(one("SELECT * FROM bootstrap_enrollments WHERE id=?",[x.id]),enrollmentJson);});}
  if(op==="list_workspace_roots")return all(`SELECT * FROM workspace_roots${p.hostId?" WHERE host_id=?":""} ORDER BY display_name`,p.hostId?[p.hostId]:[]).map(rootRow);
  if(op==="upsert_workspace_root"){const r=p.root,existing=one("SELECT * FROM workspace_roots WHERE host_id=? AND canonical_path=?",[r.hostId,r.canonicalPath]);if(existing&&existing.id!==r.id){run("UPDATE workspace_roots SET display_name=?,allow_create=?,allow_register=?,allow_clone=?,allow_delete=?,verified_at=?,disabled_at=? WHERE id=?",[r.displayName,Boolean(r.allowCreate),r.allowRegister!==false,Boolean(r.allowClone),Boolean(r.allowDelete),r.verifiedAt,r.disabledAt,existing.id]);return rootRow(one("SELECT * FROM workspace_roots WHERE id=?",[existing.id]));}run("INSERT INTO workspace_roots(id,host_id,display_name,canonical_path,allow_create,allow_register,allow_clone,allow_delete,created_at,verified_at,disabled_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,canonical_path=excluded.canonical_path,allow_create=excluded.allow_create,allow_register=excluded.allow_register,allow_clone=excluded.allow_clone,allow_delete=excluded.allow_delete,verified_at=excluded.verified_at,disabled_at=excluded.disabled_at",[r.id,r.hostId,r.displayName,r.canonicalPath,Boolean(r.allowCreate),r.allowRegister!==false,Boolean(r.allowClone),Boolean(r.allowDelete),r.createdAt,r.verifiedAt,r.disabledAt]);return rootRow(one("SELECT * FROM workspace_roots WHERE id=?",[r.id]));}
  if(op==="list_projects")return all("SELECT * FROM projects ORDER BY name").map(projectRow);
  if(op==="upsert_project"){const x=p.project;run("INSERT INTO projects(id,name,slug,description,default_provider,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,slug=excluded.slug,description=excluded.description,default_provider=excluded.default_provider,updated_at=excluded.updated_at,archived_at=excluded.archived_at",[x.id,x.name,x.slug??x.id,x.description,x.defaultProvider,x.createdAt,x.updatedAt,x.archivedAt]);return projectRow(one("SELECT * FROM projects WHERE id=?",[x.id]));}
  if(op==="list_workspaces"){const clauses:string[]=[],args:any[]=[];if(p.hostId){clauses.push("host_id=?");args.push(p.hostId);}if(p.projectId){clauses.push("project_id=?");args.push(p.projectId);}if(!p.includeArchived)clauses.push("archived_at IS NULL");return all(`SELECT * FROM workspaces${clauses.length?` WHERE ${clauses.join(" AND ")}`:""} ORDER BY display_name`,args).map(workspaceRow);}
  if(op==="get_workspace")return workspaceRow(one("SELECT * FROM workspaces WHERE id=?",[p.id]));
  if(op==="upsert_workspace"){const x=p.workspace,existing=one("SELECT * FROM workspaces WHERE host_id=? AND canonical_path=?",[x.hostId,x.canonicalPath]);if(existing&&existing.id!==x.id){run("UPDATE workspaces SET project_id=?,root_id=?,relative_path=?,display_name=?,workspace_type=?,git_remote=?,default_branch=?,last_known_commit=?,last_git_status_json=?,last_verified_at=?,updated_at=?,archived_at=? WHERE id=?",[x.projectId,x.rootId,x.relativePath,x.displayName,x.workspaceType??"existing",x.gitRemote,x.defaultBranch,x.lastKnownCommit,x.lastGitStatus==null?null:stringify(x.lastGitStatus),x.lastVerifiedAt,x.updatedAt,x.archivedAt,existing.id]);return workspaceRow(one("SELECT * FROM workspaces WHERE id=?",[existing.id]));}run("INSERT INTO workspaces(id,project_id,host_id,root_id,relative_path,canonical_path,display_name,workspace_type,git_remote,default_branch,last_known_commit,last_git_status_json,last_verified_at,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,host_id=excluded.host_id,root_id=excluded.root_id,relative_path=excluded.relative_path,canonical_path=excluded.canonical_path,display_name=excluded.display_name,workspace_type=excluded.workspace_type,git_remote=excluded.git_remote,default_branch=excluded.default_branch,last_known_commit=excluded.last_known_commit,last_git_status_json=excluded.last_git_status_json,last_verified_at=excluded.last_verified_at,updated_at=excluded.updated_at,archived_at=excluded.archived_at",[x.id,x.projectId,x.hostId,x.rootId,x.relativePath,x.canonicalPath,x.displayName,x.workspaceType??"existing",x.gitRemote,x.defaultBranch,x.lastKnownCommit,x.lastGitStatus==null?null:stringify(x.lastGitStatus),x.lastVerifiedAt,x.createdAt,x.updatedAt,x.archivedAt]);return workspaceRow(one("SELECT * FROM workspaces WHERE id=?",[x.id]));}
  if(op==="archive_workspace"){run("UPDATE workspaces SET archived_at=?,updated_at=? WHERE id=?",[p.archivedAt,p.archivedAt,p.id]);return true;}
  const workChainRow=(row:Row|undefined)=>{const value:any=objectRow(row,new Set(["roles_json","automation_json"]));if(value)value.boardVisible=Boolean(value.boardVisible);return value;};
  const workChainEventRow=(row:Row|undefined)=>objectRow(row,new Set(["payload_json"]));
  if(op==="upsert_work_chain"){const x=p.chain,current=one("SELECT * FROM work_chains WHERE id=?",[x.id]),value=(key:string,column:string,fallback:any=null)=>Object.prototype.hasOwnProperty.call(x,key)?x[key]:(current?.[column]??fallback);run(`INSERT INTO work_chains(id,project_id,title,root_session_id,active_session_id,board_visible,description,board_status,priority,workspace_id,target_branch,roles_json,automation_json,last_activity_at,completed_at,revision,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,root_session_id=COALESCE(excluded.root_session_id,root_session_id),active_session_id=excluded.active_session_id,board_visible=excluded.board_visible,description=excluded.description,board_status=excluded.board_status,priority=excluded.priority,workspace_id=excluded.workspace_id,target_branch=excluded.target_branch,roles_json=excluded.roles_json,automation_json=excluded.automation_json,last_activity_at=excluded.last_activity_at,completed_at=excluded.completed_at,updated_at=excluded.updated_at,archived_at=excluded.archived_at`,[x.id,x.projectId,x.title,value("rootSessionId","root_session_id"),value("activeSessionId","active_session_id"),Boolean(value("boardVisible","board_visible",false)),value("description","description","")||"",value("boardStatus","board_status","queued"),value("priority","priority","normal"),value("workspaceId","workspace_id"),value("targetBranch","target_branch"),Object.prototype.hasOwnProperty.call(x,"roles")||!current?stringify(x.roles):current.roles_json,Object.prototype.hasOwnProperty.call(x,"automation")||!current?stringify(x.automation):current.automation_json,value("lastActivityAt","last_activity_at"),value("completedAt","completed_at"),value("revision","revision",1),x.createdAt,x.updatedAt,value("archivedAt","archived_at")]);return workChainRow(one("SELECT * FROM work_chains WHERE id=?",[x.id]));}
  if(op==="get_work_chain")return workChainRow(one("SELECT * FROM work_chains WHERE id=?",[p.id]));
  if(op==="list_board_cards"){const clauses=["board_visible=1"],args:any[]=[];if(p.projectId){clauses.push("project_id=?");args.push(p.projectId);}if(p.workspaceId){clauses.push("workspace_id=?");args.push(p.workspaceId);}if(!p.includeArchived)clauses.push("archived_at IS NULL");return all(`SELECT * FROM work_chains WHERE ${clauses.join(" AND ")} ORDER BY COALESCE(last_activity_at,updated_at) DESC,id`,args).map(workChainRow);}
  if(op==="update_board_card")return transaction(()=>{const x=p.card,result=run("UPDATE work_chains SET title=?,description=?,board_status=?,priority=?,workspace_id=?,target_branch=?,roles_json=?,automation_json=?,board_visible=?,last_activity_at=?,completed_at=?,archived_at=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=?",[x.title,x.description,x.boardStatus,x.priority,x.workspaceId,x.targetBranch,stringify(x.roles),stringify(x.automation),x.boardVisible!==false,x.lastActivityAt,x.completedAt,x.archivedAt,x.updatedAt,x.id,p.expectedRevision]);return{updated:result.changes===1,current:workChainRow(one("SELECT * FROM work_chains WHERE id=?",[x.id]))};});
  if(op==="append_work_chain_event")return transaction(()=>{const x=p.event,result=run("INSERT OR IGNORE INTO work_chain_events(id,chain_id,event_type,task_id,collaboration_session_id,actor_type,actor_id,dedupe_key,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",[x.id,x.chainId,x.eventType,x.taskId,x.collaborationSessionId,x.actorType,x.actorId,x.dedupeKey,stringify(x.payload),x.createdAt]),row=result.changes===1?one("SELECT * FROM work_chain_events WHERE id=?",[x.id]):one("SELECT * FROM work_chain_events WHERE chain_id=? AND dedupe_key=?",[x.chainId,x.dedupeKey]);if(result.changes===1)run("UPDATE work_chains SET last_activity_at=?,updated_at=? WHERE id=?",[x.createdAt,x.createdAt,x.chainId]);return{inserted:result.changes===1,event:workChainEventRow(row)};});
  if(op==="list_work_chain_events"){const limit=Math.max(1,Math.min(Number(p.limit??200),1000));return all("SELECT * FROM work_chain_events WHERE chain_id=? ORDER BY created_at,id LIMIT ?",[p.chainId,limit]).map(workChainEventRow);}
  if(op==="attach_board_session")return transaction(()=>{const chain=one("SELECT * FROM work_chains WHERE id=? AND board_visible=1",[p.chainId]);if(!chain)return{attached:false,reason:"not-found",chain:null};const targets:[[string,string|undefined],[string,string|undefined]]=[["tasks",p.taskId],["collaboration_sessions",p.collaborationSessionId]];for(const[table,id]of targets){if(!id)continue;const row=one(`SELECT work_chain_id FROM ${table} WHERE id=?`,[id]);if(!row)return{attached:false,reason:"not-found",chain:workChainRow(chain)};if(row.work_chain_id!=null&&row.work_chain_id!==p.chainId)return{attached:false,reason:"conflict",chain:workChainRow(chain)};}for(const[table,id]of targets)if(id)run(`UPDATE ${table} SET work_chain_id=? WHERE id=?`,[p.chainId,id]);let event=null;if(p.event){const x=p.event,result=run("INSERT OR IGNORE INTO work_chain_events(id,chain_id,event_type,task_id,collaboration_session_id,actor_type,actor_id,dedupe_key,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",[x.id,p.chainId,x.eventType,x.taskId,x.collaborationSessionId,x.actorType,x.actorId,x.dedupeKey,stringify(x.payload),x.createdAt]),row=result.changes===1?one("SELECT * FROM work_chain_events WHERE id=?",[x.id]):one("SELECT * FROM work_chain_events WHERE chain_id=? AND dedupe_key=?",[p.chainId,x.dedupeKey]);event=workChainEventRow(row);if(result.changes===1)run("UPDATE work_chains SET last_activity_at=?,updated_at=? WHERE id=?",[x.createdAt,x.createdAt,p.chainId]);}return{attached:true,chain:workChainRow(one("SELECT * FROM work_chains WHERE id=?",[p.chainId])),event};});
  if(op==="list_session_links")return all("SELECT * FROM session_links WHERE chain_id=? ORDER BY created_at",[p.chainId]).map(row=>objectRow(row));
  if(op==="upsert_session_link"){const x=p.link,columns=["id","chain_id","source_session_id","target_session_id","relation_type","handoff_artifact_id","source_host_id","target_host_id","source_provider","target_provider","source_commit","target_commit","status","created_at"],values=columns.map(column=>x[camel(column)]);run(`INSERT INTO session_links(${columns.join(",")}) VALUES(${columns.map(()=>"?").join(",")}) ON CONFLICT(id) DO UPDATE SET status=excluded.status,target_commit=excluded.target_commit`,values);return objectRow(one("SELECT * FROM session_links WHERE id=?",[x.id]));}
  if(op==="upsert_handoff_artifact"){const x=p.artifact,columns=all("PRAGMA table_info(handoff_artifacts)").map(row=>String(row.name)),values=columns.map(column=>x[camel(column)]),updates=columns.filter(column=>column!=="id").map(column=>`${column}=excluded.${column}`).join(",");run(`INSERT INTO handoff_artifacts(${columns.join(",")}) VALUES(${columns.map(()=>"?").join(",")}) ON CONFLICT(id) DO UPDATE SET ${updates}`,values);return objectRow(one("SELECT * FROM handoff_artifacts WHERE id=?",[x.id]));}
  if(op==="get_handoff_artifact")return objectRow(one("SELECT * FROM handoff_artifacts WHERE id=?",[p.id]));
  if(op==="upsert_managed_artifact"){const x=p.artifact,columns=all("PRAGMA table_info(managed_artifacts)").map(row=>String(row.name)),values=columns.map(column=>x[camel(column)]),updates=columns.filter(column=>column!=="id"&&column!=="created_at").map(column=>`${column}=excluded.${column}`).join(",");run(`INSERT INTO managed_artifacts(${columns.join(",")}) VALUES(${columns.map(()=>"?").join(",")}) ON CONFLICT(id) DO UPDATE SET ${updates}`,values);return objectRow(one("SELECT * FROM managed_artifacts WHERE id=?",[x.id]));}
  if(op==="upsert_managed_artifacts")return transaction(()=>{const items=(p.artifacts??[]).slice(0,10000),columns=all("PRAGMA table_info(managed_artifacts)").map(row=>String(row.name)),updates=columns.filter(column=>column!=="id"&&column!=="created_at").map(column=>`${column}=excluded.${column}`).join(","),statement=db.prepare(`INSERT INTO managed_artifacts(${columns.join(",")}) VALUES(${columns.map(()=>"?").join(",")}) ON CONFLICT(id) DO UPDATE SET ${updates}`);for(const x of items)statement.run(...normalize(columns.map(column=>x[camel(column)])));return items.length;});
  if(op==="list_managed_artifacts"){const limit=Math.max(1,Math.min(Number(p.limit??5000),10000));return all("SELECT * FROM managed_artifacts ORDER BY created_at DESC,id LIMIT ?",[limit]).map(row=>objectRow(row));}
  if(op==="list_workspace_leases")return all("SELECT * FROM workspace_leases WHERE workspace_id=? AND released_at IS NULL ORDER BY acquired_at",[p.workspaceId]).map(row=>objectRow(row));
  if(op==="upsert_workspace_lease"){const x=p.lease;run("INSERT INTO workspace_leases(id,project_id,workspace_id,chain_id,session_id,host_id,mode,acquired_at,expires_at,released_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at,released_at=excluded.released_at",[x.id,x.projectId,x.workspaceId,x.chainId,x.sessionId,x.hostId,x.mode,x.acquiredAt,x.expiresAt,x.releasedAt]);return objectRow(one("SELECT * FROM workspace_leases WHERE id=?",[x.id]));}
  if(op==="release_workspace_lease"){run("UPDATE workspace_leases SET released_at=? WHERE id=?",[p.releasedAt,p.id]);return true;}
  if(op==="upsert_collaboration_session")return upsertCollaborationSession(p.session);
  if(op==="get_collaboration_session")return objectRow(one("SELECT * FROM collaboration_sessions WHERE id=?",[p.id]),new Set(["current_turn_counts_json","metadata_json"]));
  if(op==="get_collaboration_detail_snapshot")return transaction(()=>({session:objectRow(one("SELECT * FROM collaboration_sessions WHERE id=?",[p.id]),new Set(["current_turn_counts_json","metadata_json"])),participants:all("SELECT * FROM collaboration_participants WHERE collaboration_session_id=? ORDER BY created_at,id",[p.id]).map(row=>objectRow(row,new Set(["capability_snapshot_json"]))),runs:all("SELECT * FROM collaboration_runs WHERE collaboration_session_id=? ORDER BY sequence,created_at,id",[p.id]).map(row=>objectRow(row)),messages:all("SELECT * FROM collaboration_messages WHERE collaboration_session_id=? ORDER BY created_at,id",[p.id]).map(row=>objectRow(row)),avatarStates:all("SELECT * FROM collaboration_avatar_state WHERE collaboration_session_id=? ORDER BY priority DESC,created_at",[p.id]).map(row=>objectRow(row))}),"DEFERRED");
  if(op==="list_collaboration_sessions")return all(`SELECT * FROM collaboration_sessions${p.includeArchived?"":" WHERE archived_at IS NULL"} ORDER BY updated_at DESC`).map(row=>objectRow(row,new Set(["current_turn_counts_json","metadata_json"])));
  if(op==="delete_collaboration_session")return transaction(()=>{const artifactPaths=all("SELECT path FROM relay_artifacts WHERE collaboration_session_id=?",[p.id]).map(row=>row.path);run("DELETE FROM collaboration_workspace_leases WHERE collaboration_session_id=?",[p.id]);return{deleted:run("DELETE FROM collaboration_sessions WHERE id=?",[p.id]).changes===1,artifactPaths};});
  if(op==="upsert_collaboration_participant")return upsertCollabChild("collaboration_participants",p.participant);
  if(op==="list_collaboration_participants")return all("SELECT * FROM collaboration_participants WHERE collaboration_session_id=? ORDER BY created_at,id",[p.collaborationSessionId]).map(row=>objectRow(row,new Set(["capability_snapshot_json"])));
  if(op==="upsert_collaboration_run")return upsertCollabChild("collaboration_runs",p.run);
  if(op==="create_collaboration_run"){const x={...p.run};return transaction(()=>{const session=one("SELECT status,mode,max_calls,current_call_count,max_turns_per_participant,current_turn_counts_json FROM collaboration_sessions WHERE id=?",[x.collaborationSessionId]);if(!session)throw new Error("Collaboration not found");if(["cancel-requested","cancelled","stop-unconfirmed","archived"].includes(session.status)||session.current_call_count>=session.max_calls)throw new Error("Collaboration call limit or cancellation prevents a new run");const participant=one("SELECT id,provider FROM collaboration_participants WHERE id=? AND collaboration_session_id=? AND archived_at IS NULL",[x.participantId,x.collaborationSessionId]);if(!participant)throw new Error("Collaboration participant not found");const turnCount=Number(one("SELECT COUNT(*) AS count FROM collaboration_runs WHERE collaboration_session_id=? AND participant_id=? AND purpose IN ('debate-turn','conversation-turn')",[x.collaborationSessionId,x.participantId])?.count??0);if(session.mode==="debate"&&["debate-turn","conversation-turn"].includes(x.purpose)&&(turnCount>=100||session.max_turns_per_participant!=null&&turnCount>=session.max_turns_per_participant))throw new Error("Conversation participant turn limit prevents a new run");x.generation=Number(one("SELECT COALESCE(MAX(generation),0) AS generation FROM collaboration_runs WHERE collaboration_session_id=? AND participant_id=?",[x.collaborationSessionId,x.participantId])?.generation??0)+1;const spec=COLLAB_SPECS.collaboration_runs!;run(`INSERT INTO collaboration_runs(${spec.columns.join(",")}) VALUES(${spec.columns.map(()=>"?").join(",")})`,collabValues("collaboration_runs",x));run("UPDATE collaboration_participants SET session_generation=?,updated_at=? WHERE id=?",[x.generation,x.updatedAt,x.participantId]);const counts=json(session.current_turn_counts_json);if(session.mode==="debate"&&["debate-turn","conversation-turn"].includes(x.purpose))counts[participant.provider]=turnCount+1;const revision=bumpRevision(x.collaborationSessionId);run("UPDATE collaboration_sessions SET current_call_count=current_call_count+1,current_turn_counts_json=?,current_step=?,status='running',updated_at=? WHERE id=?",[stringify(counts),x.purpose,x.updatedAt,x.collaborationSessionId]);return{...objectRow(one("SELECT * FROM collaboration_runs WHERE id=?",[x.id])),revision};});}
  if(op==="get_collaboration_run")return objectRow(one("SELECT * FROM collaboration_runs WHERE id=?",[p.id]));
  if(op==="list_collaboration_runs")return all("SELECT * FROM collaboration_runs WHERE collaboration_session_id=? ORDER BY sequence,created_at,id",[p.collaborationSessionId]).map(row=>objectRow(row));
  if(op==="insert_collaboration_message")return transaction(()=>{const x=p.message,spec=COLLAB_SPECS.collaboration_messages!;run(`INSERT INTO collaboration_messages(${spec.columns.join(",")}) VALUES(${spec.columns.map(()=>"?").join(",")})`,collabValues("collaboration_messages",x));return{...objectRow(one("SELECT * FROM collaboration_messages WHERE id=?",[x.id])),revision:bumpRevision(x.collaborationSessionId)};});
  if(op==="list_collaboration_messages")return all("SELECT * FROM collaboration_messages WHERE collaboration_session_id=? ORDER BY created_at,id",[p.collaborationSessionId]).map(row=>objectRow(row));
  if(op==="insert_relay_artifact"){const x=p.artifact,spec=COLLAB_SPECS.relay_artifacts!;run(`INSERT INTO relay_artifacts(${spec.columns.join(",")}) VALUES(${spec.columns.map(()=>"?").join(",")})`,collabValues("relay_artifacts",x));return objectRow(one("SELECT * FROM relay_artifacts WHERE id=?",[x.id]),spec.json);}
  if(op==="get_relay_artifact")return objectRow(one("SELECT * FROM relay_artifacts WHERE id=?",[p.id]),new Set(["changed_files_json"]));
  if(op==="update_relay_artifact_status"){run("UPDATE relay_artifacts SET status=?,delivered_at=COALESCE(?,delivered_at) WHERE id=?",[p.status,p.deliveredAt,p.id]);return objectRow(one("SELECT * FROM relay_artifacts WHERE id=?",[p.id]),new Set(["changed_files_json"]));}
  if(op==="upsert_collaboration_avatar_state")return upsertCollab("collaboration_avatar_state",p.state,["collaboration_session_id","participant_id"]);
  if(op==="list_collaboration_avatar_states")return all("SELECT * FROM collaboration_avatar_state WHERE collaboration_session_id=? ORDER BY priority DESC,created_at",[p.collaborationSessionId]).map(row=>objectRow(row));
  // A workspace is an orchestration target, not a single-writer editor. Every
  // mode combination acquires; the already-active leases come back as advisory
  // observation data instead of refusing the second writer.
  if(op==="acquire_collaboration_lease"){const x=p.lease;return transaction(()=>{const concurrent=all("SELECT id,workspace_id,collaboration_session_id,participant_id,owner_run_id,mode,acquired_at,expires_at FROM collaboration_workspace_leases WHERE workspace_id=? AND released_at IS NULL AND expires_at>? AND status='active' AND id<>? ORDER BY acquired_at",[x.workspaceId,x.acquiredAt,x.id]).map(row=>objectRow(row));run("INSERT INTO collaboration_workspace_leases(id,workspace_id,collaboration_session_id,participant_id,owner_run_id,mode,lease_generation,heartbeat_at,expires_at,acquired_at,released_at,status) VALUES(?,?,?,?,?,?,?,?,?,?,NULL,'active')",[x.id,x.workspaceId,x.collaborationSessionId,x.participantId,x.ownerRunId,x.mode,x.leaseGeneration,x.heartbeatAt,x.expiresAt,x.acquiredAt]);return{acquired:true,lease:objectRow(one("SELECT * FROM collaboration_workspace_leases WHERE id=?",[x.id])),concurrent};});}
  if(op==="heartbeat_collaboration_lease")return run("UPDATE collaboration_workspace_leases SET heartbeat_at=?,expires_at=? WHERE id=? AND owner_run_id=? AND lease_generation=? AND released_at IS NULL AND status='active' AND expires_at>?",[p.heartbeatAt,p.expiresAt,p.id,p.ownerRunId,p.leaseGeneration,p.heartbeatAt]).changes===1;
  if(op==="release_collaboration_leases"){const clauses=["released_at IS NULL"],args:any[]=[p.releasedAt,p.status??"released"];for(const[column,key]of[["collaboration_session_id","collaborationSessionId"],["owner_run_id","ownerRunId"],["workspace_id","workspaceId"]]as const)if(p[key]){clauses.push(`${column}=?`);args.push(p[key]);}return run(`UPDATE collaboration_workspace_leases SET released_at=?,status=? WHERE ${clauses.join(" AND ")}`,args).changes;}
  if(op==="list_collaboration_leases")return all(`SELECT * FROM collaboration_workspace_leases${p.workspaceId?" WHERE workspace_id=?":""} ORDER BY acquired_at`,p.workspaceId?[p.workspaceId]:[]).map(row=>objectRow(row));
  if(op==="backfill_local_assignments")return transaction(()=>{let tasks=0,threads=0;for(const item of p.projects??[]){const changed=all("SELECT id FROM tasks WHERE project_id=? AND (execution_host_id IS NULL OR workspace_id IS NULL)",[item.projectId]);run("UPDATE tasks SET execution_host_id=COALESCE(execution_host_id,?),workspace_id=COALESCE(workspace_id,?) WHERE project_id=? AND (execution_host_id IS NULL OR workspace_id IS NULL)",[p.hostId,item.workspaceId,item.projectId]);for(const row of changed)syncTaskSearchDocument(row.id);tasks+=changed.length;const changedThreads=all("SELECT thread_id FROM codex_threads WHERE project_id=? AND (execution_host_id IS NULL OR workspace_id IS NULL)",[item.projectId]);run("UPDATE codex_threads SET execution_host_id=COALESCE(execution_host_id,?),workspace_id=COALESCE(workspace_id,?) WHERE project_id=? AND (execution_host_id IS NULL OR workspace_id IS NULL)",[p.hostId,item.workspaceId,item.projectId]);for(const row of changedThreads)syncCodexThreadSearchDocument(row.thread_id);threads+=changedThreads.length;}return{tasks,threads};});
  if(op==="list_unassigned_locations")return all("SELECT project_id AS projectId,cwd FROM tasks WHERE execution_host_id IS NULL OR workspace_id IS NULL UNION SELECT project_id AS projectId,cwd FROM codex_threads WHERE execution_host_id IS NULL OR workspace_id IS NULL");
  if(op==="backfill_local_locations")return transaction(()=>{let tasks=0,threads=0;for(const item of p.locations??[]){const where=item.projectId==null?"project_id IS NULL AND COALESCE(cwd,'')=COALESCE(?, '')":"project_id=? AND COALESCE(cwd,'')=COALESCE(?, '')",whereArgs=item.projectId==null?[item.cwd]:[item.projectId,item.cwd],changed=all(`SELECT id FROM tasks WHERE ${where} AND (execution_host_id IS NULL OR workspace_id IS NULL)`,whereArgs);run(`UPDATE tasks SET execution_host_id=COALESCE(execution_host_id,?),workspace_id=COALESCE(workspace_id,?) WHERE ${where} AND (execution_host_id IS NULL OR workspace_id IS NULL)`,[p.hostId,item.workspaceId,...whereArgs]);for(const row of changed)syncTaskSearchDocument(row.id);tasks+=changed.length;const changedThreads=all(`SELECT thread_id FROM codex_threads WHERE ${where} AND (execution_host_id IS NULL OR workspace_id IS NULL)`,whereArgs);run(`UPDATE codex_threads SET execution_host_id=COALESCE(execution_host_id,?),workspace_id=COALESCE(workspace_id,?) WHERE ${where} AND (execution_host_id IS NULL OR workspace_id IS NULL)`,[p.hostId,item.workspaceId,...whereArgs]);for(const row of changedThreads)syncCodexThreadSearchDocument(row.thread_id);threads+=changedThreads.length;}return{tasks,threads};});
  if(op==="quick_check"){const rows=all("PRAGMA quick_check").map(row=>String(Object.values(row)[0]));return{rows,ok:rows.every(value=>value==="ok")};}
  if(op==="backup"){if(typeof p.destination!=="string")throw new Error("Backup destination is required.");return db.backup(p.destination).then(()=>{const copy=new Database(p.destination,{readonly:true,fileMustExist:true});try{const rows=copy.pragma("quick_check") as Row[];if(!rows.length||rows.some(row=>String(Object.values(row)[0])!=="ok"))throw new Error("backup quick_check failed");return{destination:p.destination,quickCheck:"ok"};}finally{copy.close();}});}
  throw new Error(`unsupported db operation: ${op}`);
}

const lines=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
let queue=Promise.resolve();
lines.on("line",line=>{queue=queue.then(async()=>{let request:Row={};try{request=JSON.parse(line);const result=await handle(request.op,request.params??{});process.stdout.write(`${JSON.stringify({id:request.id,ok:true,result})}\n`);}catch(error){process.stdout.write(`${JSON.stringify({id:request.id??null,ok:false,error:error instanceof Error?error.message:String(error)})}\n`);}});});
lines.on("close",()=>{void queue.finally(()=>db.close());});
