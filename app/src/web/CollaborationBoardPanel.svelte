<script lang="ts">
  import { ArrowRight, KanbanSquare, Plus, RefreshCw } from "@lucide/svelte";
  import { t } from "./i18n";
  import CollaborationBoardCardView from "./CollaborationBoardCard.svelte";
  import CollaborationBoardEditor from "./CollaborationBoardEditor.svelte";
  import { boardDefaultRoles, cardNeedsAttention, createBoardCard, listBoardCards, type BoardApi, type CollaborationBoardCard, type CollaborationBoardDraft, type CollaborationBoardExecutionConfig } from "./collaboration-board";
  export let api:BoardApi;
  export let workspaces:Array<{id:string;displayName:string}>=[];
  export let executionConfig:CollaborationBoardExecutionConfig;
  export let onopen:(card:CollaborationBoardCard)=>void=()=>{};
  export let onopenall:()=>void=()=>{};
  let cards:CollaborationBoardCard[]=[];let loading=true;let error="";let status="all";let editor=false;let saving=false;
  const workspaceName=(id?:string|null)=>workspaces.find(item=>item.id===id)?.displayName??"";
  async function load(){loading=true;error="";try{cards=await listBoardCards(api)}catch(value){error=value instanceof Error?value.message:String(value)}finally{loading=false}}
  async function save(draft:CollaborationBoardDraft){saving=true;try{const card=await createBoardCard(api,draft);cards=[card,...cards];editor=false;onopen(card)}catch(value){error=value instanceof Error?value.message:String(value)}finally{saving=false}}
  function showAll(){status="all"}
  $: activeCards=cards.filter(card=>card.boardStatus!=="completed"||cardNeedsAttention(card));
  $: visible=activeCards.filter(card=>status==="all"||card.boardStatus===status).sort((a,b)=>Number(cardNeedsAttention(b))-Number(cardNeedsAttention(a))||String(b.lastActivityAt??"").localeCompare(String(a.lastActivityAt??""))).slice(0,5);
  load();
</script>

<section class="overview-panel board-summary">
  <header><div><span class="overview-kicker">{$t("collaborationBoard.kicker")}</span><h2>{$t("collaborationBoard.title")}</h2></div><div class="header-actions"><button class="new-icon" type="button" onclick={()=>editor=true} aria-label={$t("collaborationBoard.newCard")} title={$t("collaborationBoard.newCard")}><Plus size={17}/></button><button class="all" type="button" onclick={onopenall}>{$t("collaborationBoard.viewAll")} <ArrowRight size={15}/></button></div></header>
  <nav aria-label={$t("common.status")}><button class:active={status==="all"} onclick={showAll}>{$t("common.all")} <small>{activeCards.length}</small></button>{#each ["in_progress","review","approval"] as value}<button class:active={status===value} onclick={()=>status=value}>{$t(`collaborationBoard.status.${value}`)} <small>{activeCards.filter(card=>card.boardStatus===value).length}</small></button>{/each}</nav>
  {#if loading}<div class="panel-empty loading"><RefreshCw class="spin" size={18}/>{$t("task.loading")}</div>{:else if error}<div class="panel-empty error">{error}<button onclick={load}>{$t("common.retry")}</button></div>{:else if visible.length}<div class="cards">{#each visible as card (card.id)}<CollaborationBoardCardView {card} compact workspaceName={workspaceName(card.workspaceId)} {onopen}/>{/each}</div><footer><button class="new" type="button" onclick={()=>editor=true}><Plus size={16}/>{$t("collaborationBoard.newCard")}</button></footer>{:else}<div class="panel-empty"><span class="empty-icon"><KanbanSquare size={22}/></span><span><strong>{$t("collaborationBoard.empty")}</strong><small>{$t("collaborationBoard.quickCreateBody")}</small></span><button class="new" type="button" onclick={()=>editor=true}><Plus size={16}/>{$t("collaborationBoard.newCard")}</button></div>{/if}
</section>
{#if editor}<CollaborationBoardEditor initial={{title:"",description:"",boardStatus:"queued",priority:"normal",workspaceId:workspaces[0]?.id??null,targetBranch:"",roles:boardDefaultRoles(executionConfig)}} {workspaces} {executionConfig} {saving} {error} onsave={save} onclose={()=>{editor=false;error=""}}/>{/if}

<style>
  .board-summary{display:flex;flex-direction:column;gap:12px;padding-bottom:14px;overflow:hidden}.board-summary>header,.board-summary>footer,.all,.new,.header-actions{display:flex;align-items:center}.board-summary>header{justify-content:space-between}.header-actions{gap:5px}.all{gap:4px;padding:7px 3px;border:0;background:transparent;color:var(--accent);font-size:.72rem;font-weight:750}.new-icon{display:grid;width:34px;height:34px;place-items:center;border:0;border-radius:10px;background:var(--accent-soft);color:var(--accent)}nav{display:flex;gap:6px;overflow-x:auto;padding:0 16px 2px;scrollbar-width:none}nav button{display:flex;align-items:center;gap:6px;min-height:34px;white-space:nowrap;padding:5px 10px;border:1px solid var(--line);border-radius:999px;background:transparent;color:var(--muted);font-size:.72rem;font-weight:700}nav button.active{border-color:color-mix(in srgb,var(--accent) 55%,var(--line));color:var(--accent-strong);background:var(--accent-soft)}nav small{font-size:.62rem}.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;padding:0 12px}.panel-empty{min-height:118px;margin:0 12px;padding:16px;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:12px;border:1px dashed var(--line-strong);border-radius:16px;background:color-mix(in srgb,var(--surface-2) 48%,transparent);color:var(--muted)}.panel-empty.loading{display:flex;justify-content:center}.panel-empty>span:not(.empty-icon){display:grid;gap:3px}.panel-empty strong{color:var(--text);font-size:.8rem}.panel-empty small{font-size:.68rem}.empty-icon{display:grid;width:42px;height:42px;place-items:center;border-radius:13px;background:var(--accent-soft);color:var(--accent)}.panel-empty.error{color:var(--danger)}.board-summary>footer{padding:0 12px}.new{gap:5px;min-height:38px;padding:0 11px;border:1px solid transparent;border-radius:10px;background:var(--accent);color:var(--on-accent);font-size:.72rem;font-weight:750}@media(max-width:600px){.cards{grid-template-columns:1fr}.panel-empty{grid-template-columns:auto 1fr}.panel-empty .new{grid-column:1/-1;justify-content:center}.all{font-size:0}}
</style>
