<script lang="ts">
  import { CircleCheck, ExternalLink, GitBranch, KeyRound, RefreshCw } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { t } from "./i18n";
  export let api:(path:string,init?:RequestInit)=>Promise<any>;
  let hosts:any[]=[],hostId="local",state:any=null,loading=false,notice="",name="",email="",repositories:any[]=[],repositoriesLoaded=false,visibility="all",search="",login:any=null,loginTimer:ReturnType<typeof setTimeout>|null=null,tokenUsername="",token="",tokenProtocol:"https"|"ssh"="https",tokenBusy=false;
  const text=(key:string)=>$t(`git.${key}`);
  async function loadHosts(){try{hosts=(await api("/api/hosts")).hosts??[];if(!hosts.some(item=>item.id===hostId))hostId=hosts[0]?.id??"local";await refresh();}catch(error){notice=error instanceof Error?error.message:String(error)}}
  async function refresh(){loading=true;notice="";try{state=await api(`/api/hosts/${encodeURIComponent(hostId)}/git`);name=state.commitIdentity?.name??"";email=state.commitIdentity?.email??"";if(state.github?.username)tokenUsername=state.github.username;}catch(error){notice=error instanceof Error?error.message:String(error)}finally{loading=false;}}
  async function changeHost(){token="";tokenUsername="";repositories=[];repositoriesLoaded=false;login=null;if(loginTimer)clearTimeout(loginTimer);await refresh();}
  function localTokenSupported(){return hostId==="local"||hosts.find(item=>item.id===hostId)?.type==="local";}
  async function saveIdentity(){try{state=await api(`/api/hosts/${encodeURIComponent(hostId)}/git/identity`,{method:"PUT",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({name,email})});notice=text("operationDone");}catch(error){notice=error instanceof Error?error.message:String(error)}}
  async function connect(){try{const data=await api(`/api/hosts/${encodeURIComponent(hostId)}/github/connect`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({protocol:"https"})});if(data.alreadyConnected){await refresh();return;}login=data.attempt;pollLogin();}catch(error){notice=error instanceof Error?error.message:String(error)}}
  async function connectToken(){
    if(!token.trim()||!tokenUsername.trim()||tokenBusy)return;
    tokenBusy=true;notice="";
    const body=JSON.stringify({username:tokenUsername.trim(),token:token.trim(),protocol:tokenProtocol});
    token="";
    try{
      const data=await api(`/api/hosts/${encodeURIComponent(hostId)}/github/token`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body});
      tokenUsername=data.github?.username??tokenUsername;
      state={...state,github:{...state?.github,...data.github,connected:true,hostAuthenticated:true,connectionMethod:"token",tokenConnected:true,tokenProtocol:data.github?.protocol??tokenProtocol}};
      await refresh();
      await loadRepos();
      notice=$t("git.tokenConnected",{username:tokenUsername});
    }catch(error){notice=error instanceof Error?error.message:String(error)}
    finally{token="";tokenBusy=false;}
  }
  function pollLogin(){if(!login||login.status!=="running")return;loginTimer=setTimeout(async()=>{try{login=(await api(`/api/hosts/${encodeURIComponent(hostId)}/github/connect/${login.id}`)).attempt;if(login.status==="completed")await refresh();else pollLogin();}catch(error){notice=error instanceof Error?error.message:String(error)}},2000);}
  async function disconnect(){if(!confirm(`${text("disconnectGitHub")} — ${text("hostAuthRetained")}`))return;try{await api(`/api/hosts/${encodeURIComponent(hostId)}/github/disconnect`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({hostLogout:false})});await refresh();notice=text("hostAuthRetained");}catch(error){notice=error instanceof Error?error.message:String(error)}}
  async function loadRepos(){try{const params=new URLSearchParams({visibility,search});repositories=(await api(`/api/hosts/${encodeURIComponent(hostId)}/github/repositories?${params}`)).repositories??[];repositoriesLoaded=true;}catch(error){notice=error instanceof Error?error.message:String(error)}}
  onMount(()=>{void loadHosts();return()=>{if(loginTimer)clearTimeout(loginTimer);}});
</script>
<section class="git-settings">
  <header><span><h3>{text("settings")}</h3><small>{$t("git.credentialsBody")}</small></span></header>
  <div class="toolbar"><select bind:value={hostId} onchange={changeHost}>{#each hosts as host}<option value={host.id}>{host.displayName}</option>{/each}</select><button onclick={refresh} disabled={loading}><RefreshCw size={15}/>{text("refresh")}</button></div>
  {#if state}<div class="facts"><article><strong>Git</strong><em class:good={state.git?.installed}>{state.git?.installed?state.git.version:$t("git.notInstalled")}</em></article><article><strong>{$t("git.githubCli")}</strong><em class:good={state.githubCli?.installed}>{state.githubCli?.installed?state.githubCli.version:$t("git.notInstalled")}</em></article><article><strong>GitHub</strong><em class:good={state.github?.connected}>{state.github?.connected?`${state.github.tokenConnected?$t("git.tokenConnectedStatus"):text("connected")} · ${state.github.username??""}`:text("notConnected")}</em></article><article><strong>{$t("git.credentialHelper")}</strong><em>{state.credentialHelper||"—"}</em></article><article><strong>{$t("git.sshAgent")}</strong><em class:good={state.ssh?.authenticated}>{state.ssh?.authenticated?$t("git.keyCount",{count:state.ssh.keyCount}):state.ssh?.agentAvailable?$t("git.noLoadedKey"):$t("common.unavailable")}</em></article></div>{/if}
  <div class="actions"><button class="primary" onclick={connect} disabled={!state?.githubCli?.installed||state?.github?.connected}><GitBranch size={16}/>{text("connectGitHub")}</button><button onclick={disconnect} disabled={!state?.github?.connected}>{text("disconnectGitHub")}</button></div>
  {#if login}<pre class="login">{login.output||text("loading")}</pre>{/if}
  <section class="token-connect">
    <header><span><h4>{$t("git.tokenTitle")}</h4><small>{$t("git.tokenBody")}</small></span><KeyRound size={20}/></header>
    {#if localTokenSupported()}
      {#if state?.github?.tokenConnected}
        <div class="token-connected" role="status" aria-live="polite">
          <CircleCheck size={20}/>
          <span><strong>{$t("git.tokenConnectedStatus")}</strong><small>{$t("git.tokenConnectedAccount",{username:state.github.username,protocol:(state.github.tokenProtocol??"https").toUpperCase()})}</small></span>
        </div>
      {/if}
      <section class="token-guide">
        <div>
          <h5>{$t("git.tokenGuideTitle")}</h5>
          <ol>
            <li>{$t("git.tokenGuideStep1")}</li>
            <li>{$t("git.tokenGuideStep2")}</li>
            <li>{@html $t("git.tokenGuideStep3")}</li>
            <li>{$t("git.tokenGuideStep4")}</li>
          </ol>
        </div>
        <div class="token-guide-actions">
          <a class="token-create-link" href="https://github.com/settings/tokens/new" target="_blank" rel="noreferrer">{$t("git.createClassicToken")}<ExternalLink size={15}/></a>
          <a href="https://docs.github.com/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens" target="_blank" rel="noreferrer">{$t("git.tokenOfficialGuide")}<ExternalLink size={14}/></a>
        </div>
        <p>{$t("git.fineGrainedCaution")}</p>
      </section>
      <form class="token-form" onsubmit={(event)=>{event.preventDefault();void connectToken();}}>
        <label>{$t("git.expectedUsername")}<input bind:value={tokenUsername} maxlength="39" autocomplete="username" placeholder={$t("git.usernamePlaceholder")} required/></label>
        <label>{$t("git.personalAccessToken")}<input type="password" bind:value={token} minlength="20" maxlength="1024" autocomplete="new-password" autocapitalize="none" spellcheck="false" placeholder={$t("git.tokenPlaceholder")} required/></label>
        <label>{$t("git.protocol")}<select bind:value={tokenProtocol}><option value="https">{$t("git.protocolHttps")}</option><option value="ssh">{$t("git.protocolSsh")}</option></select></label>
        <button class="primary" disabled={tokenBusy||!state?.githubCli?.installed||!token.trim()||!tokenUsername.trim()}>{tokenBusy?$t("git.tokenConnecting"):state?.github?.connected?$t("git.updateToken"):$t("git.connectWithToken")}</button>
      </form>
      <small class="token-note">{$t("git.tokenStorageNote")}</small>
    {:else}
      <p class="token-note">{$t("git.tokenLocalOnly")}</p>
    {/if}
  </section>
  <form onsubmit={(event)=>{event.preventDefault();void saveIdentity();}}><h4>{text("identity")}</h4><label>{$t("common.name")}<input bind:value={name} maxlength="200" required/></label><label>{$t("common.email")}<input type="email" bind:value={email} maxlength="320" required/></label><button class="primary">{$t("common.save")}</button></form>
  {#if state?.github?.connected}<section class="repos"><header><h4>{text("githubRepos")}</h4><div><select bind:value={visibility}><option value="all">{text("all")}</option><option value="private">{text("private")}</option><option value="public">{text("public")}</option></select><input type="search" bind:value={search} placeholder={text("search")}/><button onclick={loadRepos}>{text("refresh")}</button></div></header>{#if repositoriesLoaded&&repositories.length===0}<div class="empty-repos"><strong>{$t("git.noAccessibleRepos")}</strong><small>{$t("git.repoAccessHint")}</small></div>{/if}{#each repositories as repo}<article><span><strong>{repo.nameWithOwner}</strong><small>{repo.private?text("private"):text("public")} · {repo.defaultBranch??"—"}</small></span><code>{repo.httpsUrl}</code></article>{/each}</section>{/if}
  {#if notice}<p class="notice">{notice}</p>{/if}
</section>
<style>
  .git-settings{display:grid;gap:1rem;width:100%;min-width:0}.git-settings>header,.toolbar,.actions,.repos>header,.token-connect>header{display:flex;align-items:center;justify-content:space-between;gap:.65rem}.git-settings>header>span,.token-connect>header>span{min-width:0}.git-settings h3,.git-settings h4,.git-settings h5{margin:0}.git-settings small{color:var(--muted);line-height:1.45}.git-settings label{display:grid;gap:.3rem;min-width:0;margin:0}.toolbar{min-width:0}.toolbar select{min-width:0;min-height:44px;flex:1}.toolbar button,.actions button{min-height:44px;margin:0;padding:.5rem .8rem;display:inline-flex;align-items:center;justify-content:center;gap:.35rem;white-space:normal;line-height:1.25}.toolbar button{min-width:108px;flex:none}.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(175px,100%),1fr));gap:.65rem;min-width:0}.facts article,.repos article{display:grid;min-width:0;gap:.25rem;padding:.8rem;border:1px solid var(--line);border-radius:13px;background:var(--bg)}.facts em{font-style:normal;color:var(--muted);overflow-wrap:anywhere}.facts em.good{color:var(--good)}.actions{justify-content:flex-start}.actions .primary{width:auto;min-width:190px;min-height:44px;margin:0;padding:.5rem 1rem}.actions button:last-child{min-width:150px}form{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;align-items:end;gap:.65rem;min-width:0;padding:.9rem;border:1px solid var(--line);border-radius:13px;background:var(--bg)}form h4{grid-column:1/-1}form input{width:100%;max-width:100%}form .primary{width:auto;min-width:112px;min-height:42px;margin:0;padding:.5rem 1rem}.login{max-height:180px;overflow:auto;white-space:pre-wrap;padding:.75rem;background:var(--bg);border:1px solid var(--line);border-radius:10px}.token-connect{display:grid;gap:.65rem;width:100%;min-width:0;max-width:100%;padding:.9rem;border:1px solid color-mix(in srgb,var(--accent) 45%,var(--line));border-radius:13px;background:color-mix(in srgb,var(--bg) 92%,var(--accent) 8%)}.token-connect>header :global(svg){flex:none;color:var(--accent)}.token-connected{display:flex;align-items:center;gap:.55rem;min-width:0;padding:.65rem .75rem;border:1px solid color-mix(in srgb,var(--good) 55%,var(--line));border-radius:10px;background:color-mix(in srgb,var(--bg) 86%,var(--good) 14%);color:var(--good)}.token-connected>span{display:grid;min-width:0}.token-connected strong{font-size:.78rem}.token-connected small{overflow-wrap:anywhere}.token-connected :global(svg){flex:none}.token-guide{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.55rem .8rem;min-width:0;padding:.75rem;border:1px solid color-mix(in srgb,var(--accent) 28%,var(--line));border-radius:10px;background:var(--bg)}.token-guide h5{font-size:.78rem}.token-guide ol{margin:.45rem 0 0;padding-left:1.15rem;color:var(--muted);font-size:.74rem;line-height:1.55}.token-guide li+li{margin-top:.15rem}.token-guide :global(code){padding:.08rem .24rem;border-radius:4px;background:var(--panel);color:var(--accent-strong);font-size:.71rem}.token-guide-actions{display:flex;align-items:flex-start;gap:.4rem;flex-wrap:wrap}.token-guide a{display:inline-flex;align-items:center;justify-content:center;gap:.3rem;min-height:38px;padding:.45rem .65rem;border:1px solid var(--line-strong);border-radius:8px;color:var(--text);text-decoration:none;font-size:.72rem;font-weight:700}.token-guide a:hover{border-color:var(--accent);color:var(--accent-strong)}.token-guide a.token-create-link{border-color:var(--accent);background:var(--accent);color:var(--on-accent)}.token-guide p{grid-column:1/-1;margin:0;color:var(--muted);font-size:.7rem;line-height:1.5;overflow-wrap:anywhere}.token-form{grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr);padding:0;border:0;background:transparent}.token-form>*{min-width:0;max-width:100%}.token-form select{width:100%;min-height:42px}.token-form .primary{width:100%}.token-note{margin:0;overflow-wrap:anywhere}.repos{display:grid;gap:.55rem;min-width:0}.repos>header{align-items:stretch;flex-direction:column}.repos>header div{width:100%;display:grid;grid-template-columns:minmax(120px,.45fr) minmax(0,1fr) auto;gap:.65rem}.repos>header div>*{min-width:0;margin:0}.repos>header div button{min-width:108px;white-space:normal}.empty-repos{display:grid;gap:.2rem;padding:.8rem;border:1px dashed var(--line-strong);border-radius:10px;background:var(--bg)}.empty-repos strong{font-size:.78rem}.repos article{grid-template-columns:minmax(0,1fr) minmax(160px,38%)}.repos article span{display:grid;min-width:0}.repos code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.notice{margin:0;color:var(--warn)}
  @media(max-width:800px){.git-settings>header{align-items:stretch;flex-direction:column}.facts{grid-template-columns:repeat(2,minmax(0,1fr))}form,.token-form{grid-template-columns:1fr}form h4{grid-column:auto}form .primary{width:100%}.repos article{grid-template-columns:1fr}.repos code{white-space:normal;overflow-wrap:anywhere}.actions .primary,.actions button:last-child{flex:1;min-width:0}}
  @media(max-width:520px){.toolbar{display:grid;grid-template-columns:minmax(0,1fr) auto}.toolbar button{min-width:96px}.facts{grid-template-columns:1fr}.actions{display:grid;grid-template-columns:1fr}.actions .primary,.actions button:last-child{width:100%}.token-guide{grid-template-columns:1fr}.token-guide-actions{display:grid;grid-template-columns:1fr}.token-guide a{width:100%}.repos>header div{grid-template-columns:minmax(100px,.7fr) minmax(0,1.3fr)}.repos>header div button{grid-column:1/-1;width:100%}}
</style>
