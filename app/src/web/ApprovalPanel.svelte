<script lang="ts">
  import { AlertTriangle, Check, Clock3, ShieldAlert, X } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { shouldPollAttention } from "./client-polling";
  import { upsertStableRows } from "./collaboration-identity";
  import { formatDateTime, locale, t } from "./i18n";
  import { approvalDecisionRequest, type BrowserApprovalDecision } from "./approval-request";
  import { isTransientApiError } from "./api-client";
  export let api:(path:string,options?:RequestInit)=>Promise<any>;
  export let task:{id:string;provider:"codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok";status:string;executionHostId?:string|null;workspaceId?:string|null;title:string};
  type Approval={id:string;provider:string;hostId:string;workspaceId:string|null;kind:string;summary:string;command:string|null;paths:string[];access:string[];risk:"low"|"medium"|"high"|"very-high";availableDecisions:string[];requestedAt:string;expiresAt:string;title?:string};
  let approvals:Approval[]=[];let busy="";let error="";let timer:ReturnType<typeof setInterval>|null=null;let loading=false;
  $: labels={low:$t("approval.risk.low"),medium:$t("approval.risk.medium"),high:$t("approval.risk.high"),"very-high":$t("approval.risk.veryHigh")};
  const remaining=(item:Approval)=>Math.max(0,Math.ceil((new Date(item.expiresAt).getTime()-Date.now())/1000));
  const approvalKey=(item:Approval)=>`approval:${task.id}:${item.id}`;
  async function load(){if(loading||document.visibilityState==="hidden")return;loading=true;try{const data=await api(`/api/approvals?taskId=${encodeURIComponent(task.id)}`);approvals=upsertStableRows(data.approvals??[],approvalKey);error="";}catch(e){error=isTransientApiError(e)?"":e instanceof Error?e.message:String(e);}finally{loading=false;}}
  async function decide(item:Approval,decision:BrowserApprovalDecision){
    if(busy)return;busy=item.id;error="";
    try{const request=approvalDecisionRequest(task,item.id,decision,crypto.randomUUID());await api(request.path,request.options);approvals=approvals.filter(value=>value.id!==item.id);}
    catch(e){error=e instanceof Error?e.message:String(e);await load();}finally{busy="";}
  }
  onMount(()=>{const visible=()=>{if(document.visibilityState==="visible")void load();};void load();timer=setInterval(()=>{if(shouldPollAttention(task.status,approvals.length))void load();},5000);document.addEventListener("visibilitychange",visible);return()=>{if(timer)clearInterval(timer);document.removeEventListener("visibilitychange",visible);};});
</script>

{#if approvals.length||error}
  <section class="approval-stack" aria-label={$t("approval.title")} aria-live="polite">
    {#each approvals as item (approvalKey(item))}
      <article class:risk-high={item.risk==="high"||item.risk==="very-high"}>
        <header><span>{#if item.risk==="high"||item.risk==="very-high"}<ShieldAlert size={19}/>{:else}<AlertTriangle size={19}/>{/if}<strong>{item.kind==="command"?$t("approval.command"):$t("approval.file")}</strong></span><em class="risk {item.risk}">{labels[item.risk]}</em></header>
        <p>{item.summary}</p>
        {#if item.command}<code>{item.command}</code>{/if}
        {#if item.paths.length}<div class="paths">{#each item.paths as value}<span title={value}>{value}</span>{/each}</div>{/if}
        <dl><div><dt>{$t("approval.provider")}</dt><dd>Codex</dd></div><div><dt>{$t("session.title")}</dt><dd>{item.title??task.title}</dd></div><div><dt>{$t("session.host")}</dt><dd title={item.hostId}>{item.hostId.slice(0,12)}</dd></div>{#if item.workspaceId}<div><dt>{$t("session.workspace")}</dt><dd title={item.workspaceId}>{item.workspaceId.slice(0,12)}</dd></div>{/if}<div><dt>{$t("approval.access")}</dt><dd>{item.access.join(" · ")}</dd></div><div><dt>{$t("conversation.request")}</dt><dd>{formatDateTime(item.requestedAt,$locale)}</dd></div><div><dt>{$t("approval.ttl")}</dt><dd><Clock3 size={13}/>{$t("format.seconds",{count:remaining(item)})}</dd></div></dl>
        <footer>
          <button class="deny" disabled={busy===item.id} onclick={()=>decide(item,"decline")}><X size={17}/>{$t("approval.decline")}</button>
          {#if item.availableDecisions.includes("acceptForSession")}<button disabled={busy===item.id} onclick={()=>decide(item,"acceptForSession")}><Check size={17}/>{$t("approval.session")}</button>{/if}
          {#if item.availableDecisions.includes("accept")}<button class="allow" disabled={busy===item.id} onclick={()=>decide(item,"accept")}><Check size={17}/>{$t("approval.once")}</button>{/if}
        </footer>
      </article>
    {/each}
    {#if error}<p class="approval-error">{error}</p>{/if}
  </section>
{/if}

<style>
  .approval-stack{display:grid;gap:.6rem;margin:.65rem 0}.approval-stack article{display:grid;gap:.55rem;padding:.8rem;border:1px solid color-mix(in srgb,var(--warn) 55%,var(--line));border-radius:14px;background:color-mix(in srgb,var(--panel) 92%,var(--warn) 8%)}article.risk-high{border-color:color-mix(in srgb,var(--danger) 65%,var(--line))}.approval-stack header,.approval-stack header span,.approval-stack footer,.approval-stack dl,.approval-stack dl div{display:flex;align-items:center}.approval-stack header{justify-content:space-between}.approval-stack header span{gap:.4rem}.approval-stack p{margin:0}.approval-stack code{display:block;padding:.6rem;border-radius:8px;background:var(--bg);overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}.paths{display:grid;gap:.25rem}.paths span{font:12px ui-monospace,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.risk{font-style:normal;font-size:.75rem}.risk.high,.risk.very-high{color:var(--danger)}.approval-stack dl{gap:.8rem;flex-wrap:wrap;margin:0}.approval-stack dl div{gap:.3rem}.approval-stack dt{color:var(--muted);font-size:.75rem}.approval-stack dd{display:flex;align-items:center;gap:.2rem;margin:0;font-size:.78rem}.approval-stack footer{justify-content:flex-end;gap:.45rem;flex-wrap:wrap}.approval-stack footer button{min-height:42px;display:inline-flex;align-items:center;gap:.3rem}.allow{background:var(--accent);color:white}.deny{color:var(--danger)}.approval-error{color:var(--danger)}
  @media(max-width:600px){.approval-stack footer{display:grid;grid-template-columns:repeat(2,1fr)}.approval-stack footer button{justify-content:center}.approval-stack footer button:last-child{grid-column:1/-1}}
</style>
