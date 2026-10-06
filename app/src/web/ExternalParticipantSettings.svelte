<script lang="ts">
  import {onMount} from "svelte";
  import {locale} from "./i18n";

  export let api:(path:string,init?:RequestInit)=>Promise<any>;

  type Workspace={id:string;projectId:string;hostId:string;displayName:string;canonicalPath:string;archivedAt?:string|null};
  type MountDraft={alias:string;workspaceId:string;rootPath:string;readPaths:string;writePaths:string};
  let workspaces:Workspace[]=[];
  let grants:any[]=[];
  let primaryWorkspaceId="";
  let mounts:MountDraft[]=[];
  let executionEnabled=false;
  let executionProvider:"codex"|"claude"="codex";
  let executionLevel:"auto"|"read"="auto";
  let runtimeKey="";
  let keyConfigured=false;
  let tokenConfigured=false;
  let pendingToken="";
  let busy=false;
  let notice="";
  const ko=()=>String($locale).startsWith("ko");
  const label=(korean:string,english:string)=>ko()?korean:english;
  const paths=(value:string)=>value.split(/[\n,]/).map(item=>item.trim()).filter(Boolean);

  async function refresh(){
    const [catalog,existing,status]=await Promise.all([api("/api/workspaces"),api("/api/external-participants/grants"),api("/api/external-participants/tunnel-status")]);
    workspaces=(catalog.workspaces??[]).filter((item:Workspace)=>item.hostId==="local"&&!item.archivedAt);
    grants=existing.grants??[];keyConfigured=Boolean(status.runtimeKeyConfigured);tokenConfigured=Boolean(status.participantTokenConfigured);
    if(!workspaces.some(item=>item.id===primaryWorkspaceId))primaryWorkspaceId=workspaces[0]?.id??"";
    if(!mounts.length){
      const match=(projectId:string)=>workspaces.find(item=>item.projectId===projectId);
      const suggested=[(["workhouse","claudex-workhouse"]),(["risu","risuai"]),(["nai","nai-studio"])] as const;
      mounts=suggested.flatMap(([alias,projectId])=>{const workspace=match(projectId);return workspace?[{alias,workspaceId:workspace.id,rootPath:"docs",readPaths:".",writePaths:""}]:[];});
      const workhouse=match("claudex-workhouse");
      if(workhouse)mounts=[...mounts,{alias:"shared",workspaceId:workhouse.id,rootPath:"data/collaboration",readPaths:"inbox, outbox",writePaths:"outbox"}];
      if(!mounts.length)mounts=[{alias:"shared",workspaceId:primaryWorkspaceId,rootPath:"",readPaths:".",writePaths:""}];
    }
    mounts=mounts.map(item=>({...item,workspaceId:workspaces.some(workspace=>workspace.id===item.workspaceId)?item.workspaceId:primaryWorkspaceId}));
  }
  onMount(()=>{void refresh().catch(error=>notice=String(error));});
  async function createGrant(){
    busy=true;notice="";
    try{
      const body={workspaceId:primaryWorkspaceId,mounts:mounts.map(item=>({alias:item.alias.trim(),workspaceId:item.workspaceId,rootPath:item.rootPath.trim(),readPaths:paths(item.readPaths),writePaths:paths(item.writePaths)})),...(executionEnabled?{execution:{provider:executionProvider,automationLevel:executionLevel,maxActiveTasks:1}}:{})};
      const created=await api("/api/external-participants/grants",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      pendingToken=created.token;
      await saveParticipantToken();
      await refresh();
      notice=label("협업 폴더 권한과 터널용 토큰을 저장했어요.","Collaboration folder grant and tunnel token saved.");
    }catch(error){notice=String(error);}
    finally{busy=false;}
  }
  async function saveParticipantToken(){
    if(!pendingToken)return;
    await api("/api/external-participants/tunnel-token",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({participantToken:pendingToken})});
    pendingToken="";tokenConfigured=true;
  }
  async function saveRuntimeKey(){
    busy=true;notice="";
    try{await api("/api/external-participants/tunnel-key",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({apiKey:runtimeKey.trim()})});runtimeKey="";keyConfigured=true;notice=label("Platform 런타임 키를 NAS에 저장했어요.","Platform runtime key saved on the NAS.");}
    catch(error){notice=String(error);}
    finally{busy=false;}
  }
  async function revoke(id:string){
    if(!confirm(label("이 권한을 폐기할까요?", "Revoke this grant?")))return;
    busy=true;notice="";
    try{await api(`/api/external-participants/grants/${id}/revoke`,{method:"POST",body:"{}",headers:{"Content-Type":"application/json"}});await refresh();}
    catch(error){notice=String(error);}
    finally{busy=false;}
  }
</script>

<section class="participant-settings" aria-labelledby="participant-title">
  <header><h3 id="participant-title">{label("외부 모델 협업 폴더","External model collaboration folder")}</h3><small>{label("등록된 로컬 Workspace만 별칭으로 연결하며, 모델 감시는 실행하지 않아요. Risu·NAI 운영 DB 대신 문서와 작업용 폴더를 선택하세요.","Mount only registered local Workspaces. No model watcher runs. Choose documents and working folders, not live Risu or NAI databases.")}</small></header>
  <div class="participant-status"><span>{label("Platform 런타임 키","Platform runtime key")}: {keyConfigured?"✓":"—"}</span><span>{label("작업 토큰","Participant token")}: {tokenConfigured?"✓":"—"}</span></div>
  <p>{label("키와 권한 저장은 터널 실행과 별개예요. 저장 후 tunnel-client 진단과 연결 확인이 필요해요.","Saving keys and grants does not start the tunnel. Run tunnel-client diagnostics and verify the connection afterward.")}</p>
  <form onsubmit={(event)=>{event.preventDefault();void saveRuntimeKey();}}>
    <label>{label("Platform 런타임 API 키","Platform runtime API key")}<input type="password" bind:value={runtimeKey} autocomplete="off" spellcheck="false" placeholder={"sk-…"}/></label>
    <button type="submit" disabled={busy||!runtimeKey.trim()}>{label("키를 비공개 저장","Save key privately")}</button>
  </form>
  <form onsubmit={(event)=>{event.preventDefault();void createGrant();}}>
    <label>{label("작업 보드 Workspace","Board Workspace")}<select bind:value={primaryWorkspaceId}>{#each workspaces as workspace}<option value={workspace.id}>{workspace.displayName} · {workspace.canonicalPath}</option>{/each}</select></label>
    <label class="participant-check"><input type="checkbox" bind:checked={executionEnabled}/>{label("dot 등 외부 모델의 실행 작업 제출 허용","Allow dot or another external model to submit execution tasks")}</label>
    {#if executionEnabled}
      <p>{label("선택한 작업 보드 Workspace에서 실제 제공자 작업을 시작하고 후속 수정을 요청할 수 있어요. 아래 폴더 읽기·쓰기 범위와 별개이며, 모델은 전역 위임 설정을 사용해요. 동시에 실행하는 작업은 하나예요.","Allows real provider tasks and follow-ups in the selected Board Workspace, independently of the file mounts below. Uses global delegation model settings and permits one active task at a time.")}</p>
      <label>{label("실행 제공자","Execution provider")}<select bind:value={executionProvider}><option value="codex">Codex</option><option value="claude">Claude</option></select></label>
      <label>{label("작업 권한","Task access")}<select bind:value={executionLevel}><option value="auto">{label("파일 수정·명령 실행","Edit files and run commands")}</option><option value="read">{label("읽기·검토","Read and review")}</option></select></label>
    {/if}
    {#each mounts as mount,index}
      <fieldset><legend>{label("폴더 구획","Folder mount")} {index+1}</legend>
        <label>{label("보이는 이름","Alias")}<input bind:value={mount.alias} placeholder={"risu"}/></label>
        <label>{label("작업공간","Workspace")}<select bind:value={mount.workspaceId}>{#each workspaces as workspace}<option value={workspace.id}>{workspace.displayName} · {workspace.canonicalPath}</option>{/each}</select></label>
        <label>{label("Workspace 안의 시작 폴더","Root inside Workspace")}<input bind:value={mount.rootPath} placeholder={"docs"}/></label>
        <label>{label("읽기 경로 · 쉼표 또는 줄바꿈 구분","Readable paths · comma or newline separated")}<textarea bind:value={mount.readPaths} rows="2" placeholder={"."}></textarea></label>
        <label>{label("쓰기 경로 · 비워두면 읽기 전용","Writable paths · blank means read-only")}<textarea bind:value={mount.writePaths} rows="2" placeholder={"outbox"}></textarea></label>
        {#if mounts.length>1}<button type="button" onclick={()=>mounts=mounts.filter((_,i)=>i!==index)}>{label("구획 제거","Remove mount")}</button>{/if}
      </fieldset>
    {/each}
    <div class="participant-actions"><button type="button" disabled={mounts.length>=8} onclick={()=>mounts=[...mounts,{alias:"",workspaceId:primaryWorkspaceId,rootPath:"",readPaths:"",writePaths:""}]}>{label("구획 추가","Add mount")}</button><button type="submit" disabled={busy||!primaryWorkspaceId||!mounts.length}>{label("협업 권한 만들기","Create collaboration grant")}</button></div>
  </form>
  {#if pendingToken}<button type="button" disabled={busy} onclick={()=>void saveParticipantToken().then(()=>notice=label("작업 토큰을 저장했어요.","Participant token saved.")).catch(error=>notice=String(error))}>{label("토큰 저장 재시도","Retry saving token")}</button>{/if}
  {#if grants.length}<div class="participant-grants"><strong>{label("발급된 권한","Grants")}</strong>{#each grants as grant}<div><span>{grant.mounts?.length?grant.mounts.map((item:any)=>item.alias).join(" / "):grant.workspaceId} · {grant.revokedAt?label("폐기됨","revoked"):label("활성","active")}{#if grant.execution} · {grant.execution.provider} ({grant.execution.automationLevel}){/if}</span>{#if !grant.revokedAt}<button type="button" disabled={busy} onclick={()=>void revoke(grant.id)}>{label("폐기","Revoke")}</button>{/if}</div>{/each}</div>{/if}
  {#if notice}<p role="status">{notice}</p>{/if}
</section>

<style>
  .participant-settings{display:grid;gap:.7rem;padding:.85rem;border:1px solid var(--line);border-radius:14px;background:var(--panel)}
  header h3{margin:0 0 .2rem}header small{color:var(--muted)}.participant-status,.participant-actions{display:flex;gap:.5rem;flex-wrap:wrap}
  form,fieldset{display:grid;gap:.55rem}fieldset{border:1px solid var(--line);border-radius:10px;padding:.65rem}label{display:grid;gap:.25rem;min-width:0}input,select,textarea{width:100%;min-width:0;box-sizing:border-box}
  button{width:max-content;max-width:100%;min-height:38px}.participant-grants{display:grid;gap:.35rem}.participant-grants>div{display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:.4rem;border:1px solid var(--line);border-radius:8px}.participant-grants span{overflow-wrap:anywhere}
  p{margin:0;color:var(--muted)}@media(max-width:600px){button{min-height:44px}.participant-actions button{flex:1}}
  .participant-check{display:flex;align-items:center;gap:.5rem}.participant-check input{width:auto;flex:none}
</style>
