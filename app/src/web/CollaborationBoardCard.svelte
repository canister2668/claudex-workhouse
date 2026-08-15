<script lang="ts">
  import { AlertTriangle, ArrowUpRight, GitBranch, Play, Users } from "@lucide/svelte";
  import { locale, t } from "./i18n";
  import { providerDisplayName } from "./provider-display";
  import { cardNeedsAttention, isBoardSessionActive, type CollaborationBoardCard } from "./collaboration-board";
  export let card:CollaborationBoardCard;
  export let workspaceName="";
  export let compact=false;
  export let onopen:(card:CollaborationBoardCard)=>void=()=>{};
  const date=(value?:string|null)=>value?new Intl.DateTimeFormat($locale,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(value)):$t("common.unknown");
  $: activeSessions=card.sessions.filter(isBoardSessionActive);
  $: providers=[...new Set(activeSessions.map(item=>item.provider).filter(Boolean))];
</script>

<button type="button" class="board-card" class:compact class:attention={cardNeedsAttention(card)} onclick={()=>onopen(card)} aria-label={$t("collaborationBoard.openCard",{title:card.title})}>
  <span class="board-card-top">
    <span class="priority priority-{card.priority}">{$t(`collaborationBoard.priority.${card.priority}`)}</span>
    {#if cardNeedsAttention(card)}<span class="attention-mark"><AlertTriangle size={14}/>{$t("collaborationBoard.attention")}</span>{/if}
    <span class="status">{$t(`collaborationBoard.status.${card.boardStatus}`)}</span>
  </span>
  <strong>{card.title}</strong>
  {#if card.description&&!compact}<p>{card.description}</p>{/if}
  <span class="board-card-meta">
    {#if workspaceName}<span>{workspaceName}</span>{/if}
    {#if card.targetBranch}<span><GitBranch size={13}/>{card.targetBranch}</span>{/if}
    <span>{date(card.lastActivityAt)}</span>
  </span>
  {#if activeSessions.length}
    <span class="running"><Play size={13} fill="currentColor"/>{$t("collaborationBoard.runningAbove")} · {providers.map(provider=>providerDisplayName(provider!)).join(" · ")} · {$t("collaborationBoard.activeSessions",{count:activeSessions.length})}</span>
  {:else if card.sessions.length}
    <span class="session-count"><Users size={14}/>{$t("collaborationBoard.linkedSessions",{count:card.sessions.length})}</span>
  {/if}
  <ArrowUpRight class="open-mark" size={16}/>
</button>

<style>
  .board-card{position:relative;display:flex;min-width:0;width:100%;flex-direction:column;gap:8px;padding:14px 15px 14px 17px;overflow:hidden;text-align:left;color:var(--text);background:linear-gradient(135deg,var(--surface),color-mix(in srgb,var(--surface-2) 86%,var(--accent)));border:1px solid color-mix(in srgb,var(--accent) 25%,var(--line));border-radius:16px;box-shadow:0 4px 14px var(--overlay-weak);cursor:pointer;transition:border-color .16s,transform .16s,box-shadow .16s}.board-card::before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:var(--accent)}.board-card:hover{border-color:color-mix(in srgb,var(--accent) 52%,var(--line));transform:translateY(-1px);box-shadow:0 8px 22px var(--overlay-medium)}.board-card.attention{border-color:color-mix(in srgb,var(--amber) 42%,var(--line))}.board-card.attention::before{background:var(--amber)}.board-card>strong{padding-right:24px;font-size:.82rem;line-height:1.4;letter-spacing:-.012em}.board-card p{display:-webkit-box;margin:0;color:var(--muted);font-size:.72rem;line-height:1.45;overflow:hidden;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical}.board-card-top,.board-card-meta,.running,.session-count{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.board-card-top{font-size:.62rem}.priority,.status,.attention-mark{padding:3px 7px;border-radius:999px;background:var(--surface-2);color:var(--muted);font-weight:750}.priority-high,.priority-urgent{color:var(--amber);background:color-mix(in srgb,var(--amber) 12%,transparent)}.priority-urgent{color:var(--red)}.status{margin-left:auto}.attention-mark{display:flex;align-items:center;gap:4px;color:var(--amber)}.board-card-meta{color:var(--muted);font-size:.64rem}.board-card-meta span{display:flex;align-items:center;gap:3px}.running{padding:7px 9px;border-radius:9px;color:var(--accent-strong);background:color-mix(in srgb,var(--accent) 9%,var(--surface));font-size:.64rem;font-weight:750}.session-count{font-size:.64rem;color:var(--muted)}.open-mark{position:absolute;right:13px;bottom:13px;color:var(--muted)}.compact{padding:13px 14px 13px 16px;box-shadow:none}.compact>strong{font-size:.78rem}.compact .board-card-meta{display:none}
</style>
