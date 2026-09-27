<script lang="ts">
  import {onMount} from "svelte";
  import {formatDateTime, locale} from "./i18n";

  export let api:(path:string,init?:RequestInit)=>Promise<any>;

  type Workspace={id:string;hostId:string;displayName:string;canonicalPath:string;archivedAt?:string|null};
  type Credit={state:"available"|"exhausted"|"expired"|"unknown";limitUsd:number|null;usedUsd:number|null;remainingUsd:number|null;expiresAt:string|null;fetchedAt:string|null};
  type Session={sessionId:string;url:string;title:string|null;workspaceId:string;repository:string;branch:string|null;upload:"bundle"|"auto";task:string;createdAt:string;paidConfirmed:boolean;lastMessageAt:string|null};
  type Pending={kind:"create"}|{kind:"send";sessionId:string};
  type GitHubStatus={repository:string|null;branches:string[];pullRequests:Array<{number:number;state:string;headRefName:string;title:string;url:string}>};

  let workspaces:Workspace[]=[];
  let sessions:Session[]=[];
  let credit:Credit|null=null;
  let workspaceId="";
  let task="";
  let bundle=false;
  let drafts:Record<string,string>={};
  let github:Record<string,GitHubStatus|string>={};
  let pending:Pending|null=null;
  let pendingCredit:Credit|null=null;
  let busy=false;
  let refreshing=false;
  let notice="";
  const ko=()=>String($locale).startsWith("ko");
  const label=(korean:string,english:string)=>ko()?korean:english;
  const usd=(value:number|null)=>value===null?"—":`$${value.toFixed(2)}`;
  const json=(body:unknown):RequestInit=>({method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const workspaceName=(id:string)=>workspaces.find(item=>item.id===id)?.displayName??id;
  const stateLabel=(state:Credit["state"])=>({available:label("사용 가능","Available"),exhausted:label("소진됨","Used up"),expired:label("만료됨","Expired"),unknown:label("확인 불가","Unknown")})[state];

  async function refresh(probe=false){
    if(probe)refreshing=true;
    try{
      const [catalog,state]=await Promise.all([api("/api/workspaces"),api(`/api/claude-cloud${probe?"?refresh=1":""}`)]);
      workspaces=(catalog.workspaces??[]).filter((item:Workspace)=>item.hostId==="local"&&!item.archivedAt);
      sessions=state.sessions??[];credit=state.credit??null;
      if(!workspaces.some(item=>item.id===workspaceId))workspaceId=workspaces[0]?.id??"";
    }catch(error){notice=String(error instanceof Error?error.message:error);}
    finally{refreshing=false;}
  }
  onMount(()=>{void refresh();});

  // A 402 means the cached cloud credit cannot cover the run; ask before
  // letting it draw from the subscription instead.
  function needsConfirmation(error:any,next:Pending){
    if(error?.code!=="CLOUD_CREDIT_CONFIRMATION_REQUIRED")return false;
    pending=next;pendingCredit=error?.details?.errorParams?.credit??credit;
    return true;
  }
  async function create(confirmWithoutCredit=false){
    busy=true;notice="";
    try{
      const result=await api("/api/claude-cloud/sessions",json({workspaceId,task:task.trim(),bundle,confirmWithoutCredit}));
      sessions=[result.session,...sessions.filter(item=>item.sessionId!==result.session.sessionId)];credit=result.credit??credit;task="";
      notice=label("클라우드 세션을 만들었어요. 진행 상황은 링크에서 확인하세요.","Cloud session created. Follow it through the link.");
    }catch(error){if(!needsConfirmation(error,{kind:"create"}))notice=String(error instanceof Error?error.message:error);}
    finally{busy=false;}
  }
  async function send(sessionId:string,confirmWithoutCredit=false){
    const message=(drafts[sessionId]??"").trim();
    if(!message)return;
    busy=true;notice="";
    try{
      await api(`/api/claude-cloud/sessions/${sessionId}/messages`,json({message,confirmWithoutCredit}));
      drafts={...drafts,[sessionId]:""};
      notice=label("후속 지시를 보냈어요.","Follow-up sent.");
      await refresh();
    }catch(error){if(!needsConfirmation(error,{kind:"send",sessionId}))notice=String(error instanceof Error?error.message:error);}
    finally{busy=false;}
  }
  async function confirmPending(){
    const next=pending;pending=null;pendingCredit=null;
    if(next?.kind==="create")await create(true);
    else if(next?.kind==="send")await send(next.sessionId,true);
  }
  async function loadGitHub(sessionId:string){
    github={...github,[sessionId]:label("조회 중…","Loading…")};
    try{github={...github,[sessionId]:await api(`/api/claude-cloud/sessions/${sessionId}/github`)};}
    catch(error){github={...github,[sessionId]:String(error instanceof Error?error.message:error)};}
  }
</script>

<section class="cloud-sessions" aria-labelledby="cloud-sessions-title">
  <header><h3 id="cloud-sessions-title">{label("Claude 클라우드 세션","Claude cloud sessions")}</h3><small>{label("claude --cloud로 Anthropic 클라우드에서 실행해요. 클라우드 세션 크레딧을 먼저 쓰고, 크레딧이 없으면 실행 전에 물어봐요.","Runs on Anthropic's cloud through claude --cloud. The cloud-session credit is spent first; without it, you are asked before running.")}</small></header>

  <div class="credit" class:warn={credit&&credit.state!=="available"}>
    {#if credit}
      <span><strong>{usd(credit.remainingUsd)}</strong> / {usd(credit.limitUsd)} · {stateLabel(credit.state)}</span>
      <small>{#if credit.expiresAt}{label("만료","Expires")} {formatDateTime(credit.expiresAt,$locale)} · {/if}{label("기준","As of")} {credit.fetchedAt?formatDateTime(credit.fetchedAt,$locale):"—"}</small>
    {:else}<span>{label("크레딧 정보를 불러오는 중…","Loading credit…")}</span>{/if}
    <button type="button" disabled={refreshing} onclick={()=>void refresh(true)}>{refreshing?label("확인 중…","Checking…"):label("잔액 다시 확인","Recheck balance")}</button>
  </div>

  {#if pending}
    <div class="confirm" role="alertdialog" aria-labelledby="cloud-confirm-title">
      <strong id="cloud-confirm-title">{pendingCredit?.state==="unknown"?label("클라우드 크레딧 잔액을 확인할 수 없어요","The cloud credit balance is unknown"):label("클라우드 크레딧이 남아 있지 않아요","No cloud credit left")}</strong>
      <p>{label("계속하면 이 실행은 Claude 구독 사용량에서 차감돼요. 그래도 실행할까요?","If you continue, this run draws from your Claude subscription usage. Run it anyway?")}{#if pendingCredit?.state!=="unknown"} ({label("잔액","Balance")} {usd(pendingCredit?.remainingUsd??null)}{#if pendingCredit?.state==="expired"}, {label("만료됨","expired")}{/if}){/if}</p>
      <div class="actions"><button type="button" class="primary" disabled={busy} onclick={()=>void confirmPending()}>{label("구독 사용량으로 실행","Use subscription")}</button><button type="button" disabled={busy} onclick={()=>{pending=null;pendingCredit=null;}}>{label("취소","Cancel")}</button></div>
    </div>
  {/if}

  <form onsubmit={(event)=>{event.preventDefault();void create();}}>
    <label>{label("작업공간 (git 저장소)","Workspace (git repository)")}<select bind:value={workspaceId}>{#each workspaces as workspace}<option value={workspace.id}>{workspace.displayName} · {workspace.canonicalPath}</option>{/each}</select></label>
    <label>{label("작업 지시","Task")}<textarea bind:value={task} rows="4" maxlength="20000" placeholder={label("클라우드에서 할 작업을 적어주세요","Describe the work for the cloud session")}></textarea></label>
    <label class="check"><input type="checkbox" bind:checked={bundle}/><span>{label("로컬 저장소를 그대로 업로드 (커밋하지 않은 tracked 변경 포함)","Upload the local repository as-is (includes uncommitted tracked changes)")}</span></label>
    <small>{label("Claude GitHub App이 없는 저장소는 자동으로 업로드돼요. 이 NAS의 Claude 홈을 포함한 저장소는 보낼 수 없어요.","Repositories without the Claude GitHub App are uploaded automatically. A repository containing this NAS's Claude home cannot be sent.")}</small>
    <button type="submit" class="primary" disabled={busy||!workspaceId||!task.trim()}>{busy?label("처리 중…","Working…"):label("클라우드 세션 시작","Start cloud session")}</button>
  </form>

  {#if sessions.length}
    <ul class="session-list">
      {#each sessions as session (session.sessionId)}
        <li>
          <div class="session-head"><a href={session.url} target="_blank" rel="noopener noreferrer">{session.title||session.sessionId}</a><small>{workspaceName(session.workspaceId)} · {session.branch??"—"} · {formatDateTime(session.createdAt,$locale)}{session.paidConfirmed?` · ${label("구독 사용","subscription")}`:""}</small></div>
          <p class="task">{session.task}</p>
          <form onsubmit={(event)=>{event.preventDefault();void send(session.sessionId);}}>
            <textarea rows="2" maxlength="20000" value={drafts[session.sessionId]??""} oninput={(event)=>drafts={...drafts,[session.sessionId]:(event.currentTarget as HTMLTextAreaElement).value}} placeholder={label("후속 지시","Follow-up message")}></textarea>
            <div class="actions"><button type="submit" disabled={busy||!(drafts[session.sessionId]??"").trim()}>{label("보내기","Send")}</button><button type="button" onclick={()=>void loadGitHub(session.sessionId)}>{label("GitHub 결과 확인","Check GitHub")}</button></div>
          </form>
          {#if github[session.sessionId]}
            {@const status=github[session.sessionId]}
            {#if typeof status==="string"}<small>{status}</small>
            {:else if !status.repository}<small>{label("GitHub remote가 없는 저장소예요. 결과는 링크에서 확인하세요.","No GitHub remote; check the results through the link.")}</small>
            {:else}
              <small>{`${status.repository} · ${label("claude/* 브랜치","claude/* branches")}: ${status.branches.length?status.branches.join(", "):label("없음","none")}`}</small>
              {#each status.pullRequests as pr}<small><a href={pr.url} target="_blank" rel="noopener noreferrer">#{pr.number}</a> [{pr.state}] {pr.title}</small>{/each}
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  {#if notice}<p role="status">{notice}</p>{/if}
</section>

<style>
  .cloud-sessions{display:grid;gap:.7rem;padding:.85rem;border:1px solid var(--line);border-radius:14px;background:var(--panel)}
  header h3{margin:0 0 .2rem}header small,small{color:var(--muted)}
  .credit{display:flex;align-items:center;flex-wrap:wrap;gap:.35rem .7rem;padding:.6rem;border-radius:10px;background:var(--bg)}.credit>small{flex:1 1 12rem}.credit.warn strong{color:var(--warn)}
  .confirm{display:grid;gap:.45rem;padding:.7rem;border:1px solid var(--warn);border-radius:12px}.confirm p{margin:0}
  form{display:grid;gap:.5rem}label{display:grid;gap:.25rem;min-width:0}label.check{display:flex;align-items:flex-start;gap:.45rem}label.check input{width:auto;margin-top:.2rem}
  input,select,textarea{width:100%;min-width:0;box-sizing:border-box}
  button{width:max-content;max-width:100%;min-height:38px}.actions{display:flex;gap:.5rem;flex-wrap:wrap}
  .session-list{display:grid;gap:.55rem;margin:0;padding:0;list-style:none}.session-list li{display:grid;gap:.4rem;padding:.6rem;border:1px solid var(--line);border-radius:10px}
  .session-head{display:grid;gap:.1rem}.session-head a{overflow-wrap:anywhere}.task{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;max-height:6.5em;overflow:auto;color:var(--muted)}
  p{margin:0}@media(max-width:600px){button{min-height:44px}.actions button{flex:1}}
</style>
