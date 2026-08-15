<script lang="ts">
  import { Check, ChevronDown, ChevronUp } from "@lucide/svelte";
  import { onMount } from "svelte";
  import type { AutomationLevel } from "./automation-level";
  import { currentViewportBand, popoverPlacement } from "./mobile-viewport";
  import { t } from "./i18n";
  export let provider:"codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok";
  export let value:AutomationLevel="auto";
  export let disabled=false;
  export let onchange:(level:AutomationLevel)=>void=()=>{};
  $: items=[
    {id:"full" as const,short:$t("permission.fullAccess"),full:$t("permission.fullAccessDescription")},
    {id:"auto" as const,short:$t("permission.automatic"),full:$t("permission.automaticDescription")},
    {id:"confirm" as const,short:$t("permission.confirm"),full:$t("permission.confirmDescription")},
    {id:"read" as const,short:$t("permission.readOnly"),full:$t("permission.readOnlyDescription")}
  ];
  let root:HTMLDivElement,menu:HTMLDivElement,open=false,menuStyle="",menuWidth=290;
  $: selected=items.find(item=>item.id===value)??items[1];
  $: if(disabled&&open)close();
  function place(){
    if(!root||!menu)return;
    const band=currentViewportBand(),rect=root.getBoundingClientRect();
    menuWidth=Math.min(290,Math.max(160,band.width-16));
    const spot=popoverPlacement({top:rect.top,bottom:rect.bottom,left:rect.left},{width:menuWidth,height:menu.scrollHeight},band);
    menuStyle=`left:${spot.left}px;top:${spot.top}px;width:${menuWidth}px;max-height:${spot.maxHeight}px`;
  }
  function show(){if(disabled)return;menuWidth=Math.min(290,Math.max(160,currentViewportBand().width-16));menuStyle=`width:${menuWidth}px`;open=true;requestAnimationFrame(()=>{try{menu.showPopover();}catch{}place();});}
  function close(){open=false;try{menu?.hidePopover();}catch{}}
  function toggle(){open?close():show();}
  function choose(level:AutomationLevel){if(provider==="claude"&&level==="confirm")return;onchange(level);close();}
  onMount(()=>{const outside=(event:PointerEvent)=>{if(open&&!root.contains(event.target as Node)&&!menu.contains(event.target as Node))close();},key=(event:KeyboardEvent)=>{if(open&&event.key==="Escape")close();},reposition=()=>open&&place();document.addEventListener("pointerdown",outside);document.addEventListener("keydown",key);window.addEventListener("resize",reposition);window.visualViewport?.addEventListener("resize",reposition);window.visualViewport?.addEventListener("scroll",reposition);return()=>{document.removeEventListener("pointerdown",outside);document.removeEventListener("keydown",key);window.removeEventListener("resize",reposition);window.visualViewport?.removeEventListener("resize",reposition);window.visualViewport?.removeEventListener("scroll",reposition);};});
</script>

<div bind:this={root} class="compact-choice" role="group" aria-label={$t("permission.level")}>
  <button type="button" class="choice-trigger" class:danger={value==="full"} {disabled} aria-label={selected.short} aria-haspopup="listbox" aria-expanded={open} onclick={toggle}><span>{selected.short}</span>{#if open}<ChevronDown size={15}/>{:else}<ChevronUp size={15}/>{/if}</button>
  <div bind:this={menu} class="choice-menu" popover="manual" role="listbox" aria-label={$t("permission.level")} style={menuStyle}>
    {#each items as item}
      {@const unsupported=provider==="claude"&&item.id==="confirm"}
      <button type="button" role="option" aria-selected={value===item.id} disabled={unsupported} title={unsupported?$t("permission.claudeConfirmUnavailable"):item.full} onclick={()=>choose(item.id)}><span><strong>{item.short}</strong><small>{unsupported?$t("permission.claudeConfirmUnavailable"):item.full}</small></span>{#if value===item.id}<Check size={16}/>{/if}</button>
    {/each}
  </div>
</div>

<style>
  .compact-choice{display:inline-flex;position:relative;pointer-events:auto;flex:none}
  .choice-trigger{min-width:94px;min-height:36px;padding:0 10px;display:flex;align-items:center;justify-content:space-between;gap:7px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--accent-strong);box-shadow:var(--shadow);font-size:.72rem;font-weight:800;white-space:nowrap}
  .choice-trigger.danger{border-color:color-mix(in srgb,var(--danger) 55%,var(--line));background:var(--danger);color:white}
  .choice-trigger:disabled{opacity:.5}
  .choice-menu{position:fixed;inset:auto;z-index:1000;margin:0;padding:5px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--text);box-shadow:var(--shadow-lg);overflow-y:auto;overscroll-behavior:contain}
  .choice-menu::backdrop{background:transparent}
  .choice-menu button{width:100%;min-height:48px;padding:7px 9px;display:flex;align-items:center;justify-content:space-between;gap:10px;border:0;border-radius:8px;background:transparent;color:var(--text);text-align:left}
  .choice-menu button:hover,.choice-menu button[aria-selected="true"]{background:color-mix(in srgb,var(--accent) 12%,transparent)}
  .choice-menu button:disabled{opacity:.42}.choice-menu button>span{display:flex;min-width:0;flex-direction:column;gap:2px}.choice-menu strong{font-size:.74rem}.choice-menu small{color:var(--muted);font-size:.64rem;line-height:1.3}
  @media(max-width:600px){.choice-trigger{min-width:88px;min-height:34px;padding-inline:9px}}
</style>
