import fs from"node:fs";
import os from"node:os";
import path from"node:path";
import{execFileSync}from"node:child_process";
import{afterEach,describe,expect,it}from"vitest";
import{DeckDatabase}from"../../src/server/db/client.js";

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
async function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),"history-search-"));roots.push(root);const dbPath=path.join(root,"db.sqlite"),db=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),dbPath);await db.ping();return{db,dbPath};}
function task(index:number,overrides:Record<string,unknown>={}){
  const updatedAt=new Date(Date.UTC(2026,6,29,9,0,index)).toISOString();
  return{id:`claude:${index}`,provider:"claude",nativeId:`native-${index}`,threadId:`thread-${index}`,projectId:"p",title:`task ${index}`,prompt:"ordinary request",status:"completed",createdAt:updatedAt,updatedAt,result:null,error:null,log:"transcript must not be searched",owned:true,pid:null,pgid:null,processStart:null,commandMarker:null,parentThreadId:null,ownership:"claudex-workhouse",source:"claudex-workhouse",cwd:"/workspace",executionHostId:"local",workspaceId:"w",metadata:{},...overrides};
}
function codexThread(index:number,overrides:Record<string,unknown>={}){
  const updatedAt=new Date(Date.UTC(2026,6,30,9,0,index%60)).toISOString(),threadId=`external-${index}`;
  return{threadId,sessionId:threadId,projectId:"p",cwd:"/workspace",title:`external ${index}`,preview:"ordinary preview",source:"vscode",ownership:"external",status:"completed",archived:false,parentThreadId:null,forkedFromId:null,modelProvider:null,requestedModel:null,effectiveModel:null,requestedReasoningEffort:null,effectiveReasoningEffort:null,requestedServiceTier:null,effectiveServiceTier:null,permissionProfile:null,settingsUpdatedAt:null,createdAt:updatedAt,updatedAt,lastSeenAt:updatedAt,executionHostId:"local",workspaceId:"w",workChainId:null,metadata:{},...overrides};
}

describe("bounded stored history search",()=>{
  it("directly finds an older unloaded Claude turn and applies literal, provider, workspace, status, and date filters",async()=>{
    const{db}=await fixture();
    for(let index=0;index<25;index++)await db.upsertTask(task(index,index===3?{title:"Maß",prompt:"사용자 특수 %_ 한글검색 질문",result:"정확한 최종 출력 카드 · straße · ẞ Σ ς ﬁ İ 🚀끝"}:{title:`row ${index}`} as any));
    const first=await db.searchHistoryTasks({query:"%_ 한글",provider:"claude",workspaceId:"w",status:"completed",from:"2026-07-29T00:00:00.000Z",to:"2026-07-30T00:00:00.000Z",limit:5,maxScan:10});
    expect(first.results).toHaveLength(1);expect(first.results[0]).toMatchObject({taskId:"claude:3",threadId:"thread-3",matchField:"prompt",match:"%_ 한글"});expect(first.exhausted).toBe(true);
    expect((await db.searchHistoryTasks({query:"transcript must not be searched",limit:5,maxScan:50})).results).toEqual([]);
    expect((await db.searchHistoryTasks({query:"정확한 최종 출력",provider:"codex",limit:5,maxScan:50})).results).toEqual([]);
    expect((await db.searchHistoryTasks({query:"정확한 최종 출력",workspaceId:"other",limit:5,maxScan:50})).results).toEqual([]);
    expect((await db.searchHistoryTasks({query:"정확한 최종 출력",status:"failed",limit:5,maxScan:50})).results).toEqual([]);
    expect((await db.searchHistoryTasks({query:"정확한 최종 출력",from:"2026-07-30T00:00:00.000Z",limit:5,maxScan:50})).results).toEqual([]);
    expect((await db.searchHistoryTasks({query:"정확한 최종 출력",to:"2026-07-28T00:00:00.000Z",limit:5,maxScan:50})).results).toEqual([]);
    expect((await db.searchHistoryTasks({query:"strasse",limit:5,maxScan:50})).results[0]).toMatchObject({taskId:"claude:3",match:"straße"});
    expect((await db.searchHistoryLocal({query:"as",limit:5})).results[0]).toMatchObject({taskId:"claude:3",match:"aß"});
    expect((await db.searchHistoryLocal({query:"f",limit:5})).results[0]).toMatchObject({taskId:"claude:3",match:"ﬁ"});
    for(const query of["ss","σ","fi","i̇","🚀끝"]){
      expect((await db.searchHistoryTasks({query,limit:5})).results[0]).toMatchObject({taskId:"claude:3"});
    }
    const links=await db.listProviderTaskLinksByThreads("claude",["thread-3"]);
    expect(links).toHaveLength(1);expect(links[0]).toMatchObject({id:"claude:3",threadId:"thread-3",workspaceId:"w"});
    expect(links[0]).not.toHaveProperty("log");expect(links[0]).not.toHaveProperty("prompt");expect(links[0]).not.toHaveProperty("result");
    await db.close();
  });

  it("keeps normalized documents in sync across updates, pagination, and deletion",async()=>{
    const{db}=await fixture();
    for(let index=0;index<8;index++)await db.upsertTask(task(index,{prompt:`공통검색 ${index}`}));
    const first=await db.searchHistoryTasks({query:"공통검색",limit:3});
    expect(first.results).toHaveLength(3);expect(first.exhausted).toBe(false);expect(first.nextCursor).not.toBeNull();
    const second=await db.searchHistoryTasks({query:"공통검색",limit:3,cursorUpdatedAt:first.nextCursor!.updatedAt,cursorId:first.nextCursor!.id});
    expect(second.results).toHaveLength(3);
    expect(new Set([...first.results,...second.results].map(result=>result.taskId)).size).toBe(6);
    await db.upsertTask(task(7,{prompt:"새검색어"}));
    expect((await db.searchHistoryTasks({query:"공통검색",limit:20})).results.map(result=>result.taskId)).not.toContain("claude:7");
    expect((await db.searchHistoryTasks({query:"새검색어",limit:20})).results[0]).toMatchObject({taskId:"claude:7"});
    await db.deleteTaskSession("claude","thread-7");
    expect((await db.searchHistoryTasks({query:"새검색어",limit:20})).results).toEqual([]);
    await db.close();
  });

  it("backfills an existing database once without a manual migration",async()=>{
    const initial=await fixture();await initial.db.upsertTask(task(1,{prompt:"자동백필 확인"}));await initial.db.upsertCodexThread(codexThread(1,{title:"외부자동백필 확인"}));await initial.db.close();
    execFileSync("python3",["-c","import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); db.execute('DELETE FROM task_search_documents'); db.execute('DELETE FROM codex_thread_search_documents'); db.execute('DELETE FROM schema_migrations WHERE version IN (14,15)'); db.commit(); db.close()",initial.dbPath]);
    const reopened=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),initial.dbPath);await reopened.ping();
    expect((await reopened.searchHistoryTasks({query:"자동백필",limit:5})).results[0]).toMatchObject({taskId:"claude:1"});
    expect((await reopened.searchHistoryLocal({query:"외부자동백필",provider:"codex",limit:5})).results[0]).toMatchObject({threadId:"external-1"});
    await reopened.close();
  });

  it("searches every cached external Codex thread with stable mixed pagination and suppresses owned-thread duplicates",async()=>{
    const fixtureValue=await fixture();let db=fixtureValue.db;await db.close();
    execFileSync("sqlite3",[fixtureValue.dbPath,`WITH RECURSIVE seq(x) AS (SELECT 0 UNION ALL SELECT x+1 FROM seq WHERE x<519)
      INSERT INTO codex_threads(thread_id,project_id,cwd,title,preview,source,ownership,status,archived,created_at,updated_at,last_seen_at,metadata_json,execution_host_id,workspace_id)
      SELECT 'external-'||x,'p','/workspace',CASE WHEN x=0 THEN '500개 밖의 희귀검색' ELSE '외부 공통검색 '||x END,'ordinary preview','vscode','external','completed',0,'2026-07-30T09:00:00.000Z','2026-07-30T09:00:00.000Z','2026-07-30T09:00:00.000Z','{}','local','w' FROM seq;
      INSERT INTO codex_thread_search_documents(thread_id,workspace_id,status,updated_at,title_folded,preview_folded,normalizer_version)
      SELECT thread_id,workspace_id,status,updated_at,lower(title),lower(preview),1 FROM codex_threads WHERE thread_id LIKE 'external-%';`]);
    db=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),fixtureValue.dbPath);await db.ping();
    expect((await db.searchHistoryLocal({query:"희귀검색",provider:"codex",limit:5})).results[0]).toMatchObject({source:"codex",threadId:"external-0",matchField:"title"});
    await db.upsertCodexThread(codexThread(700,{threadId:"owned-thread",title:"소유중복검색"}));
    await db.upsertTask(task(700,{id:"codex:700",provider:"codex",nativeId:"codex-700",threadId:"owned-thread",title:"owned task",prompt:"unrelated",updatedAt:"2026-07-30T10:00:00.000Z"}));
    expect((await db.searchHistoryLocal({query:"소유중복검색",provider:"codex",limit:5})).results).toEqual([]);
    await db.upsertCodexThread(codexThread(800,{threadId:"location-thread",title:"작업공간동기화검색",workspaceId:null,executionHostId:null}));
    expect((await db.searchHistoryLocal({query:"작업공간동기화검색",workspaceId:"assigned-workspace",limit:5})).results).toEqual([]);
    await db.backfillLocalAssignments({hostId:"local",projects:[{projectId:"p",workspaceId:"assigned-workspace"}]});
    expect((await db.searchHistoryLocal({query:"작업공간동기화검색",workspaceId:"assigned-workspace",limit:5})).results[0]).toMatchObject({threadId:"location-thread"});
    await db.upsertTask(task(701,{id:"codex:701",provider:"codex",nativeId:"codex-701",threadId:"owned-search",prompt:"혼합페이지검색",updatedAt:"2026-07-30T11:00:00.000Z"}));
    await db.upsertCodexThread(codexThread(701,{threadId:"external-page",title:"혼합페이지검색",updatedAt:"2026-07-30T10:30:00.000Z"}));
    await db.upsertTask(task(702,{prompt:"혼합페이지검색",updatedAt:"2026-07-30T10:00:00.000Z"}));
    const first=await db.searchHistoryLocal({query:"혼합페이지검색",limit:2});
    expect(first.results).toHaveLength(2);expect(first.nextCursor).not.toBeNull();
    const second=await db.searchHistoryLocal({query:"혼합페이지검색",limit:2,cursorUpdatedAt:first.nextCursor!.updatedAt,cursorKey:first.nextCursor!.id});
    expect(new Set([...first.results,...second.results].map(item=>item.id)).size).toBe(3);
    await db.close();
  },20_000);

  it("advances past stale normalized rows instead of silently ending pagination",async()=>{
    const fixtureValue=await fixture();let db=fixtureValue.db;
    for(let index=0;index<5;index++)await db.upsertTask(task(950+index,{id:`codex:stale-task-${index}`,provider:"codex",nativeId:`stale-task-${index}`,threadId:`stale-task-thread-${index}`,title:"live task without needle",updatedAt:`2026-08-01T10:00:0${index}.000Z`}));
    await db.upsertTask(task(980,{id:"codex:real-between-sources",provider:"codex",nativeId:"real-between-sources",threadId:"real-between-sources",title:"stalecursor 소스사이 실제 결과",updatedAt:"2026-07-31T12:00:00.000Z"}));
    for(let index=0;index<8;index++)await db.upsertCodexThread(codexThread(900+index,{threadId:`stale-${index}`,title:"live title without needle",updatedAt:`2026-07-31T10:00:0${index}.000Z`}));
    await db.upsertCodexThread(codexThread(999,{threadId:"real-after-stale",title:"stalecursor 실제 결과",updatedAt:"2026-07-31T09:00:00.000Z"}));await db.close();
    execFileSync("sqlite3",[fixtureValue.dbPath,"UPDATE codex_thread_search_documents SET title_folded='stalecursor' WHERE thread_id LIKE 'stale-%'; UPDATE task_search_documents SET title_folded='stalecursor' WHERE task_id LIKE 'codex:stale-task-%';"]);
    db=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),fixtureValue.dbPath);await db.ping();
    let page=await db.searchHistoryLocal({query:"stalecursor",provider:"codex",limit:3});expect(page.results).toEqual([]);expect(page.nextCursor).not.toBeNull();
    for(let attempt=0;attempt<4&&!page.results.length&&page.nextCursor;attempt++)page=await db.searchHistoryLocal({query:"stalecursor",provider:"codex",limit:3,cursorUpdatedAt:page.nextCursor.updatedAt,cursorKey:page.nextCursor.id});
    expect(page.results[0]).toMatchObject({taskId:"codex:real-between-sources"});await db.close();
  });
});
