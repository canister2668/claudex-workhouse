<script lang="ts">
  import { Check, FolderGit2, KeyRound, LoaderCircle, Play, Server, X } from "@lucide/svelte";
  import { onDestroy, onMount } from "svelte";
  import type { ApiRequestOptions } from "./api-client";
  import { t } from "./i18n";
  export let api:(path:string,init?:RequestInit,options?:ApiRequestOptions)=>Promise<any>;
  export let onsettings:(tab:"account"|"workspace")=>void;
  export let oncomplete:()=>void;
  export let onskip:()=>void;
  let data:any=null,loading=true,busy="",error="",details="",providerStepConfirmed=false,timer:ReturnType<typeof setInterval>|null=null;
  const stageKeys=["setup.stage.server","setup.stage.providers","setup.stage.workspaceSimple","setup.stage.test","setup.stage.done"];
  $: providers=data?.readiness?.providers??[];
  $: workspaces=data?.readiness?.workspaces??[];
  $: test=data?.readiness?.firstTest??{status:"not-started",succeeded:false};
  $: hasReadyProvider=providers.some((item:any)=>item.state==="ready");
  $: stage=test.succeeded?5:test.status!=="not-started"?4:!providerStepConfirmed?2:workspaces.length?4:3;
  function stateKey(state:string){return state==="not-installed"?"setup.notInstalled":state==="login-required"?"setup.loginRequired":state==="ready"?"setup.available":"setup.needsCheck";}
  async function load(){try{data=await api("/api/setup");error="";}catch(value){error=value instanceof Error?value.message:String(value);}finally{loading=false;}}
  async function install(provider:string){busy=`install:${provider}`;error="";details="";try{await api(`/api/runtime-installs/${provider}`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({confirm:true})},{timeoutMs:15*60_000});await load();}catch(value){error=$t("setup.installFailed");details=value instanceof Error?value.message:String(value);}finally{busy="";}}
  async function runTest(){const provider=providers.find((item:any)=>item.state==="ready"),workspace=workspaces[0];if(!provider||!workspace)return;busy="test";error="";try{await api("/api/setup/test",{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({provider:provider.provider,workspaceId:workspace.id})});await load();}catch(value){error=value instanceof Error?value.message:String(value);}finally{busy="";}}
  async function complete(){busy="complete";error="";try{await api("/api/setup",{method:"PUT",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({step:10,completed:true,accessMode:"local",steps:{server:true,providers:true,workspace:true,testTask:true}})});oncomplete();}catch(value){error=value instanceof Error?value.message:String(value);}finally{busy="";}}
  onMount(()=>{void load();timer=setInterval(()=>{if(data?.readiness?.firstTest?.taskId&&!data.readiness.firstTest.succeeded)void load();},2000);});
  onDestroy(()=>{if(timer)clearInterval(timer);});
</script>
<div class="setup-backdrop"><div class="setup" role="dialog" aria-modal="true" aria-labelledby="setup-title">
  <header><span><h1 id="setup-title">{$t("setup.title")}</h1><p>{$t("setup.description")}</p></span><div class="header-actions"><button class="refresh" onclick={load} disabled={loading||!!busy}>{$t("common.refresh")}</button><button class="icon-button" aria-label={$t("setup.closeAndHide")} title={$t("setup.closeAndHide")} onclick={onskip}><X size={19}/></button></div></header>
  {#if loading}<p class="loading"><LoaderCircle class="spin" size={20}/>{$t("setup.checking")}</p>{:else}
    <ol>{#each stageKeys as key,index}<li class:current={stage===index+1} class:done={stage>index+1}><span>{#if stage>index+1}<Check size={15}/>{:else}{index+1}{/if}</span>{$t(key)}</li>{/each}</ol>
    {#if stage===2}<article><KeyRound size={28}/><h2>{$t("setup.runtimeTitle")}</h2><p>{$t("setup.runtimeBody")}</p><div class="providers">{#each providers as item}<section><span><strong>{item.name}</strong><small>{$t(stateKey(item.state))}{item.version?` · ${item.version}`:""}</small></span>{#if item.state==="not-installed"}<button class="primary" onclick={()=>install(item.provider)} disabled={!!busy}>{busy===`install:${item.provider}`?$t("setup.installing"):$t("setup.installProvider",{name:item.name})}</button>{:else if item.state!=="ready"}<button onclick={()=>onsettings("account")}>{$t("setup.openLogin")}</button>{:else}<Check size={20}/>{/if}</section>{/each}</div>{#if hasReadyProvider}<button class="primary" onclick={()=>providerStepConfirmed=true}>{$t("setup.continueReady")}</button>{/if}</article>
    {:else if stage===3}<article><FolderGit2 size={28}/><h2>{$t("setup.workspaceTitle")}</h2><p>{$t("setup.workspaceBody")}</p><button class="primary" onclick={()=>onsettings("workspace")}>{$t("setup.openWorkspaceSettings")}</button></article>
    {:else if stage===4}<article><Play size={28}/><h2>{$t("setup.testTitle")}</h2><p>{$t("setup.testBody")}</p>{#if test.status==="not-started"}<button class="primary" onclick={runTest} disabled={busy==="test"||!data.readiness.executable}>{busy==="test"?$t("setup.testStarting"):$t("setup.createTest")}</button>{:else if test.status==="failed"}<p class="failure">{$t("setup.testFailed")}</p><button onclick={runTest}>{$t("common.retry")}</button>{:else}<p class="loading"><LoaderCircle class="spin" size={20}/>{$t("setup.testRunning")}</p>{/if}</article>
    {:else if stage===5}<article><Check size={32}/><h2>{$t("setup.doneTitle")}</h2><p>{$t("setup.doneBody")}</p><button class="primary" onclick={complete} disabled={busy==="complete"}>{$t("setup.complete")}</button></article>
    {:else}<article><Server size={28}/><h2>{$t("setup.serverTitle")}</h2><p>{$t("setup.serverBody")}</p></article>{/if}
  {/if}
  {#if error}<div class="error"><strong>{error}</strong>{#if details}<details><summary>{$t("error.details")}</summary><pre>{details}</pre></details>{/if}</div>{/if}
  <footer><button type="button" onclick={onskip}>{$t("setup.later")}</button><small>{$t("setup.laterBody")}</small></footer>
</div></div>
<style>
  .setup-backdrop{position:fixed;inset:0;z-index:110;background:#000b;display:grid;place-items:center;padding:1rem}.setup{width:min(720px,100%);max-height:calc(100dvh - 2rem);overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:1rem}.setup>header{display:flex;justify-content:space-between;gap:1rem}.header-actions{display:flex;align-items:flex-start;gap:.4rem}.setup h1{margin:0;font-size:1.25rem}.setup header p{margin:.25rem 0;color:var(--muted)}.refresh{align-self:start}ol{display:grid;grid-template-columns:repeat(5,1fr);gap:.35rem;padding:0;list-style:none}li{display:flex;align-items:center;gap:.35rem;font-size:.75rem;color:var(--muted)}li>span{width:24px;height:24px;display:grid;place-items:center;border:1px solid var(--line);border-radius:50%;flex:none}li.current{color:var(--text);font-weight:700}li.current>span{border-color:var(--accent)}li.done>span{background:var(--accent);color:white}article{min-height:250px;padding:1rem;border:1px solid var(--line);border-radius:14px;display:grid;align-content:center;justify-items:start;gap:.65rem}article h2,article p{margin:0}article>p{color:var(--muted);line-height:1.5}.providers{width:100%;display:grid;gap:.5rem}.providers section{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.75rem;border:1px solid var(--line);border-radius:10px}.providers span{display:grid}.providers small{color:var(--muted);margin-top:.2rem}.primary{background:var(--accent);color:white}.loading{display:flex;align-items:center;gap:.5rem}.failure,.error{color:var(--danger)}.error{margin-top:.75rem;padding:.75rem;border:1px solid color-mix(in srgb,var(--danger) 35%,var(--line));border-radius:10px}.error pre{white-space:pre-wrap;overflow-wrap:anywhere}.setup>footer{display:flex;align-items:center;gap:.7rem;margin-top:.8rem}.setup>footer small{color:var(--muted)}:global(.spin){animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
  @media(max-width:600px){.setup-backdrop{padding:0}.setup{height:100dvh;max-height:none;border-radius:0}ol{grid-template-columns:repeat(2,1fr)}article{min-height:300px}.providers section{align-items:flex-start;flex-direction:column}}
</style>
