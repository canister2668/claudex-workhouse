<script lang="ts">
  import { Check, CheckCheck, ChevronDown, ChevronUp, CircleAlert, Clock3, LoaderCircle, Pencil, Play, RotateCcw, Trash2, X } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { activeTaskStatus, shouldPollMessageQueue } from "./client-polling";
  import { upsertStableRows } from "./collaboration-identity";
  import { t } from "./i18n";
  import { isTransientApiError } from "./api-client";
  export let api:(path:string,init?:RequestInit)=>Promise<any>;
  export let provider:"codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok";
  export let taskId:string;
  export let threadId:string;
  export let active=false;
  let threadActive=false;
  export let onstarted:((task:any)=>void|Promise<void>)|null=null;
  let items:any[]=[];let busy="";let error="";let mounted=false;let loadedKey="";let reportedActiveTaskId="";let editingId="";let editingPrompt="";let loadGeneration=0;let loading=false;
  let collapsed=false;
  let expandedItems=new Set<string>();let foldableItems=new Set<string>();
  function toggleQueue(){collapsed=!collapsed;try{localStorage.setItem("ui.messageQueueCollapsed",String(collapsed));}catch{}}
  function toggleItem(id:string){const next=new Set(expandedItems);if(next.has(id))next.delete(id);else next.add(id);expandedItems=next;}
  function measureQueuePrompt(node:HTMLElement,initial:{id:string;prompt:string;expanded:boolean}){
    let current=initial;
    const check=()=>{const itemId=current.id;if(current.expanded)return;const overflow=node.scrollWidth>node.clientWidth+1||node.scrollHeight>node.clientHeight+1;if(foldableItems.has(itemId)===overflow)return;const next=new Set(foldableItems);if(overflow)next.add(itemId);else next.delete(itemId);foldableItems=next;};
    const observer=new ResizeObserver(check);observer.observe(node);requestAnimationFrame(check);
    return{update(next:{id:string;prompt:string;expanded:boolean}){current=next;requestAnimationFrame(check);},destroy(){observer.disconnect();}};
  }
  const key=()=>`${provider}:${taskId}:${threadId}`;
  const itemKey=(item:any)=>`queued-message:${provider}:${taskId}:${item.id}`;
  async function load(){if(loading||document.visibilityState==="hidden"||!taskId||!threadId)return;loading=true;const requested=key(),generation=loadGeneration;try{const data=await api(`/api/tasks/${provider}/${encodeURIComponent(taskId)}/message-queue`);if(requested!==key()||generation!==loadGeneration)return;items=upsertStableRows(Array.isArray(data.items)?data.items:[],itemKey);threadActive=activeTaskStatus(data.activeTask?.status);error="";if(data.activeTask&&data.activeTask.id!==taskId&&data.activeTask.id!==reportedActiveTaskId){reportedActiveTaskId=data.activeTask.id;await onstarted?.(data.activeTask);}}catch(e){error=isTransientApiError(e)?"":e instanceof Error?e.message:String(e);}finally{loading=false;}}
  $: if(mounted&&key()!==loadedKey){loadedKey=key();reportedActiveTaskId="";void load();}
  export async function enqueue(prompt:string){if(!prompt.trim()||busy)return false;busy="enqueue";try{const data=await api(`/api/tasks/${provider}/${encodeURIComponent(taskId)}/message-queue`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({prompt})});loadGeneration++;if(data.item)items=upsertStableRows([...items,data.item],itemKey);else void load();error="";return true;}catch(e){error=e instanceof Error?e.message:String(e);return false;}finally{busy="";}}
  function startEdit(item:any){if(busy||item.status!=="queued")return;editingId=item.id;editingPrompt=item.prompt;error="";}
  function cancelEdit(){editingId="";editingPrompt="";}
  async function saveEdit(item:any){const prompt=editingPrompt.trim();if(busy||item.status!=="queued"||!prompt)return;busy=item.id;try{const data=await api(`/api/tasks/${provider}/${encodeURIComponent(taskId)}/message-queue/${item.id}`,{method:"PATCH",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({prompt})});items=items.map(row=>row.id===item.id?data.item:row);cancelEdit();error="";}catch(e){error=e instanceof Error?e.message:String(e);await load();}finally{busy="";}}
  function editKey(event:KeyboardEvent,item:any){if(event.key==="Escape"){event.preventDefault();cancelEdit();}else if(event.key==="Enter"&&(event.ctrlKey||event.metaKey)){event.preventDefault();void saveEdit(item);}}
  async function remove(item:any){if(busy||(item.status==="delivery-uncertain"&&!confirm($t("queue.removeUncertainConfirm"))))return;busy=item.id;try{await api(`/api/tasks/${provider}/${encodeURIComponent(taskId)}/message-queue/${item.id}`,{method:"DELETE"});items=items.filter(row=>row.id!==item.id);error="";}catch(e){error=e instanceof Error?e.message:String(e);}finally{busy="";}}
  async function sendNow(item:any){if(busy||!confirm($t(active?"queue.sendNowActiveConfirm":"queue.sendNowConfirm")))return;busy=item.id;try{const data=await api(`/api/tasks/${provider}/${encodeURIComponent(taskId)}/message-queue/${item.id}/send-now`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:"{}"});items=items.filter(row=>row.id!==item.id);error="";if(data.task)await onstarted?.(data.task);}catch(e){error=e instanceof Error?e.message:String(e);await load();}finally{busy="";}}
  async function retry(item:any){if(busy||!confirm($t(item.status==="delivery-uncertain"?"queue.retryDuplicateConfirm":"queue.retryFailedConfirm")))return;busy=item.id;try{await api(`/api/tasks/${provider}/${encodeURIComponent(taskId)}/message-queue/${item.id}/retry`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({confirmDuplicateRisk:true})});await load();error="";}catch(e){error=e instanceof Error?e.message:String(e);await load();}finally{busy="";}}
  async function resolveSent(item:any){if(busy||!confirm($t("queue.resolveSentConfirm")))return;busy=item.id;try{await api(`/api/tasks/${provider}/${encodeURIComponent(taskId)}/message-queue/${item.id}/resolve-sent`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({confirm:true})});items=items.filter(row=>row.id!==item.id);error="";}catch(e){error=e instanceof Error?e.message:String(e);await load();}finally{busy="";}}
  onMount(()=>{try{const saved=localStorage.getItem("ui.messageQueueCollapsed");collapsed=saved===null?matchMedia("(max-width: 640px)").matches:saved==="true";}catch{collapsed=matchMedia("(max-width: 640px)").matches;}mounted=true;loadedKey=key();void load();const poll=()=>{if(shouldPollMessageQueue(active,items,threadActive))void load();},visible=()=>{if(document.visibilityState==="visible")void load();};const timer=setInterval(poll,2500);document.addEventListener("visibilitychange",visible);return()=>{clearInterval(timer);document.removeEventListener("visibilitychange",visible);};});
</script>

{#if items.length||error}
  <section class="message-queue" class:collapsed aria-label={$t("queue.title")}>
    <header><span><Clock3 size={16}/><strong>{$t("queue.title")}</strong></span><div class="queue-header-actions">{#if items.length&&!collapsed}<small>{$t("task.count.other",{count:items.length})}</small>{/if}<button type="button" class="queue-collapse-toggle" aria-label={$t(collapsed?"queue.expand":"queue.collapse")} title={$t(collapsed?"queue.expand":"queue.collapse")} aria-expanded={!collapsed} onclick={toggleQueue}>{#if collapsed&&items.length}<span class="queue-count-badge">{items.length}</span>{/if}{#if collapsed}<ChevronDown size={18}/>{:else}<ChevronUp size={18}/>{/if}</button></div></header>
    {#if !collapsed}
    {#each items as item (itemKey(item))}
      <article class:failed={item.status==="failed"} class:uncertain={item.status==="delivery-uncertain"}>
        {#if editingId===item.id}
          <textarea class="queue-editor" aria-label={$t("queue.editInput")} bind:value={editingPrompt} rows="3" maxlength="20000" onkeydown={(event)=>editKey(event,item)}></textarea>
        {:else}
          <div class="queue-prompt-row">
            <p class:expanded={expandedItems.has(item.id)} use:measureQueuePrompt={{id:item.id,prompt:item.prompt,expanded:expandedItems.has(item.id)}}>{item.prompt}</p>
            {#if foldableItems.has(item.id)}
              {@const queueFoldLabel=$t(expandedItems.has(item.id)?"queue.collapseInput":"queue.expandInput")}
              <button type="button" class="queue-fold-toggle" aria-label={queueFoldLabel} title={queueFoldLabel} aria-expanded={expandedItems.has(item.id)} onclick={()=>toggleItem(item.id)}>{#if expandedItems.has(item.id)}<ChevronUp size={16}/>{:else}<ChevronDown size={16}/>{/if}</button>
            {/if}
          </div>
        {/if}
        {#if item.error}<small>{item.error}</small>{/if}
        <div class="queue-actions">
          {#if editingId===item.id}<button type="button" onclick={()=>saveEdit(item)} disabled={Boolean(busy)||!editingPrompt.trim()}><Check size={14}/>{$t("common.save")}</button><button type="button" onclick={cancelEdit} disabled={Boolean(busy)}><X size={14}/>{$t("common.cancel")}</button>
          {:else if item.status==="dispatching"}<span class="dispatching"><LoaderCircle class="spin" size={14}/>{$t("queue.dispatching")}</span>
          {:else if item.status==="delivery-uncertain"}<span class="uncertain-label"><CircleAlert size={14}/>{$t("queue.deliveryUncertain")}</span><button type="button" onclick={()=>resolveSent(item)} disabled={Boolean(busy)}><CheckCheck size={14}/>{$t("queue.markSent")}</button><button type="button" onclick={()=>retry(item)} disabled={Boolean(busy)}><RotateCcw size={14}/>{$t("queue.sendAgain")}</button><button type="button" class="remove" onclick={()=>remove(item)} disabled={Boolean(busy)}><Trash2 size={14}/>{$t("common.delete")}</button>
          {:else if item.status==="failed"}<span class="dispatching">{$t("task.status.failed")}</span><button type="button" onclick={()=>retry(item)} disabled={Boolean(busy)}><RotateCcw size={14}/>{$t("common.retry")}</button><button type="button" class="remove" onclick={()=>remove(item)} disabled={Boolean(busy)}><Trash2 size={14}/>{$t("common.delete")}</button>
          {:else}<button type="button" onclick={()=>startEdit(item)} disabled={Boolean(busy)}><Pencil size={14}/>{$t("common.edit")}</button><button type="button" onclick={()=>sendNow(item)} disabled={Boolean(busy)}><Play size={14}/>{$t("common.send")}</button><button type="button" class="remove" onclick={()=>remove(item)} disabled={Boolean(busy)}><Trash2 size={14}/>{$t("common.delete")}</button>{/if}
        </div>
      </article>
    {/each}
    {#if error}<p class="queue-error">{error}</p>{/if}
    {/if}
  </section>
{/if}

<style>
  /* flex:none is load-bearing. The detail view is a fixed-height flex column,
     and overflow:auto drops this item's automatic minimum size to zero, so
     without it the queue is squeezed below its own content — a single folded
     row ends up scrollable with its buttons cut off. */
  .message-queue{flex:none;max-height:min(68vh,640px);margin:10px 14px;padding:10px;border:1px solid var(--line);border-radius:12px;background:color-mix(in srgb,var(--panel) 92%,var(--accent) 8%);display:grid;gap:8px;overflow:auto;overscroll-behavior:contain}
  .message-queue header,.message-queue header span,.queue-prompt-row,.queue-actions,.dispatching,.uncertain-label{display:flex;align-items:center;gap:7px}
  .message-queue header{justify-content:space-between;padding:0 0 2px;background:color-mix(in srgb,var(--panel) 92%,var(--accent) 8%)}
  .message-queue.collapsed{max-height:none;overflow:visible;padding-block:9px}
  .message-queue.collapsed header{padding-bottom:0}
  .queue-header-actions{display:flex;align-items:center;gap:7px}
  .message-queue header small{color:var(--muted)}
  .queue-collapse-toggle{min-width:34px;height:34px;justify-content:center!important;padding:0 7px!important;border:1px solid var(--line);border-radius:999px!important;background:var(--surface-2);color:var(--muted)}
  .queue-collapse-toggle:hover{color:var(--text);border-color:var(--accent)}
  .queue-count-badge{min-width:20px;height:20px;padding:0 5px;justify-content:center;border-radius:999px;background:var(--accent);color:var(--on-accent);font-size:.7rem;font-weight:800;line-height:20px}
  .message-queue article{display:grid;grid-template-columns:minmax(0,1fr);gap:7px;padding:9px;border-radius:9px;background:var(--panel);border:1px solid var(--line)}
  .message-queue article.failed{border-color:var(--danger)}
  .message-queue article.uncertain{border-color:var(--warn);background:color-mix(in srgb,var(--panel) 94%,var(--warn) 6%)}
  .queue-prompt-row{min-width:0;align-items:flex-start}
  .message-queue p{min-width:0;flex:1;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .message-queue p.expanded{max-height:min(40vh,360px);overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;overscroll-behavior:contain;scrollbar-gutter:stable}
  .queue-fold-toggle{width:28px;height:28px;min-width:28px;flex:none;justify-content:center;padding:0!important;border:1px solid var(--line);border-radius:999px!important;background:var(--surface-2);color:var(--muted)}
  .queue-fold-toggle:hover{color:var(--text);border-color:var(--accent)}
  .queue-editor{width:100%;min-width:0;resize:vertical}
  .message-queue article>small{color:var(--danger)}
  .queue-actions{min-width:0;justify-content:flex-end;flex-wrap:wrap;padding-top:2px;border-top:1px solid color-mix(in srgb,var(--line) 64%,transparent)}
  .message-queue button{display:inline-flex;align-items:center;gap:5px;padding:6px 8px;border-radius:8px}
  .message-queue .remove{color:var(--danger)}
  .dispatching{color:var(--muted);font-size:12px}
  .uncertain-label{color:var(--warn);font-size:12px}
  .queue-error{color:var(--danger);font-size:12px}
  @media(max-width:640px){.message-queue{max-height:min(44vh,380px);margin-inline:8px}.queue-actions{justify-content:flex-end}.message-queue article{padding:8px}}
</style>
