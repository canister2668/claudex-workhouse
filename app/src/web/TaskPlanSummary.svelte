<script lang="ts">
  import { Check, ChevronDown, Circle, CircleDot } from "@lucide/svelte";
  import { t } from "./i18n";
  import type { TaskPlanSummary as Plan } from "./liveness";

  export let plan:Plan;
  let open=false;
  $: current=plan.steps.find(step=>step.status==="active")
    ??plan.steps.find(step=>step.status==="pending")
    ??plan.steps.at(-1);
</script>

<section class="task-plan-summary">
  <button type="button" aria-expanded={open} onclick={()=>open=!open}>
    <span><strong>{$t("liveness.plan.label")} {plan.currentStep??0}/{plan.totalSteps??plan.steps.length}</strong><small>{current?.title??plan.title}</small></span>
    <span>{$t(open?"liveness.plan.close":"liveness.plan.open")}<ChevronDown size={15}/></span>
  </button>
  {#if open}
    <ol>
      {#each plan.steps as step}
        <li class={step.status}>
          {#if step.status==="completed"}<Check size={15}/>{:else if step.status==="active"}<CircleDot size={15}/>{:else}<Circle size={15}/>{/if}
          <span>{step.title}</span>
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  .task-plan-summary{border:1px solid var(--line);border-radius:12px;background:color-mix(in srgb,var(--surface) 92%,var(--accent) 8%);overflow:hidden}
  button{width:100%;min-height:48px;padding:.65rem .75rem;display:flex;align-items:center;justify-content:space-between;gap:.75rem;border:0;background:transparent;color:var(--text);text-align:left}
  button>span:first-child{min-width:0;display:grid;gap:.15rem}button small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)}
  button>span:last-child{display:flex;align-items:center;gap:.25rem;flex:none;color:var(--accent);font-size:.72rem}
  button[aria-expanded="true"]>span:last-child :global(svg){transform:rotate(180deg)}
  ol{display:grid;gap:.4rem;margin:0;padding:.2rem .75rem .75rem;list-style:none}
  li{display:flex;align-items:center;gap:.45rem;color:var(--muted);font-size:.8rem}li.completed{color:var(--status-complete,var(--accent))}li.active{color:var(--text);font-weight:700}
</style>
