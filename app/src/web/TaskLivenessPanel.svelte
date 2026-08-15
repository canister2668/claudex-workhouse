<script lang="ts">
  import { providerDisplayName } from "./provider-display";
  import { onDestroy, onMount } from "svelte";
  import HeartbeatBar from "./HeartbeatBar.svelte";
  import ApprovalPanel from "./ApprovalPanel.svelte";
  import TaskPlanSummary from "./TaskPlanSummary.svelte";
  import UserInputPanel from "./UserInputPanel.svelte";
  import { initialTaskLiveness, subscribeTaskLiveness, type TaskLiveness } from "./liveness";
  import { sortAgentsByAttention, type ParallelAgentSummary } from "./parallel-agents";
  import { permissionLabel, relativeTime } from "./session-ui";
  import { normalizeTimestamp } from "./task-time";
  import { t } from "./i18n";

  export let task:any;
  export let hostName="";
  export let workspaceName="";
  export let api:(path:string,options?:RequestInit)=>Promise<any>;
  export let density:"full"|"medium"|"compact"="full";
  export let onopen:()=>void=()=>{};
  export let onexpand:()=>void=()=>{};

  let state:TaskLiveness=initialTaskLiveness(normalizeTimestamp(task.updatedAt)??Date.now(),task.id,task.status,normalizeTimestamp(task.createdAt));
  let now=Date.now(),timer:ReturnType<typeof setInterval>|null=null,stop:(()=>void)|null=null;
  let fanoutOpen=true;
  const ROSTER_LIMIT=5;
  const elapsedLabel=(from:number|null|undefined)=>{
    const seconds=Math.max(0,Math.floor((now-(from??now))/1_000));
    return seconds<60?$t("liveness.durationSeconds",{seconds}):$t("liveness.durationMinutes",{minutes:Math.floor(seconds/60),seconds:seconds%60});
  };
  const duration=()=>elapsedLabel(normalizeTimestamp(task.createdAt||task.updatedAt,now)??now);
  // Whatever needs a person is listed first; names stay bound to spawn order.
  $: rankedAgents=sortAgentsByAttention(state.agents);
  $: waitingAgent=rankedAgents.find((agent:ParallelAgentSummary)=>agent.status==="waiting")??null;
  $: rosterAgents=fanoutOpen?rankedAgents.slice(0,ROSTER_LIMIT):[];
  $: hiddenAgents=fanoutOpen?Math.max(0,rankedAgents.length-rosterAgents.length):0;
  const tallyParts=()=>{
    const tally=state.agentTally;
    return[tally.running?$t("fanout.running",{count:tally.running}):"",tally.waiting?$t("fanout.waiting",{count:tally.waiting}):"",tally.failed?$t("fanout.failed",{count:tally.failed}):"",tally.completed?$t("fanout.completed",{count:tally.completed}):""].filter(Boolean).join(" · ");
  };
  const contextPercent=()=>{
    const value=Number(task.metadata?.contextUsage?.percent);
    return Number.isFinite(value)?Math.max(0,Math.min(100,Math.round(value))):null;
  };
  const phaseLabel=()=>state.phase==="idle"?(task.metadata?.activity??$t(`task.status.${task.status}`)):$t(`liveness.phase.${state.phase}`);
  const activityTitle=()=>state.recentActivity?$t(state.recentActivity.labelKey):state.phase==="acting"?$t("liveness.activity.acting"):state.phase==="reasoning"?$t("liveness.activity.reasoning"):phaseLabel();
  const barHeight=(count:number)=>{
    const max=Math.max(1,...state.buckets);
    return Math.max(7,Math.round(count/max*34));
  };
  onMount(()=>{
    timer=setInterval(()=>now=Date.now(),1_000);
    stop=subscribeTaskLiveness({provider:task.provider,taskId:task.id,lastEventAt:normalizeTimestamp(task.updatedAt)??Date.now(),taskStatus:task.status,startedAt:normalizeTimestamp(task.createdAt),rootThreadId:task.threadId??null,onChange:value=>state=value});
  });
  onDestroy(()=>{if(timer)clearInterval(timer);stop?.();});
</script>

{#snippet agentChips()}
  <span class="fanout-chips">
    {#each rankedAgents.slice(0,4) as agent (agent.id)}
      <span class="fanout-chip {agent.status}"><i></i>{agent.name}{#if agent.status==="waiting"} · {$t("fanout.waitingTag")}{:else if agent.status==="failed"} · {$t("fanout.failedTag")}{/if}</span>
    {/each}
    {#if rankedAgents.length>4}<span class="fanout-chip rest">{$t("fanout.rest",{count:rankedAgents.length-4})}</span>{/if}
  </span>
{/snippet}

<article class="liveness-task-card provider-{task.provider} density-{density}">
  <span class="liveness-rail" aria-hidden="true"></span>
  <button type="button" class="liveness-open" onclick={onopen}>
    <span class="liveness-card-head">
      <span class="engine {task.provider}">{providerDisplayName(task.provider)}</span>
      <HeartbeatBar lastEventAt={state.lastMeaningfulEventAt} transport={state.transport} phase={state.phase} compact/>
      <span class="phase-pill phase-{state.phase}"><i></i>{phaseLabel()}</span>
    </span>
    <strong class="liveness-title">{task.title||$t("task.untitled")}</strong>
    <span class="liveness-meta">{hostName} · {workspaceName} · {permissionLabel(task.permissionProfile)}</span>
  </button>
  {#if density!=="compact"}
    <span class="liveness-activity">
    <span class="liveness-activity-head"><span><strong>{activityTitle()}</strong><small>{state.lastContent||task.metadata?.activity||$t("conversation.waitingForActivity")} · {relativeTime(state.lastEventAt?new Date(state.lastEventAt).toISOString():task.updatedAt)}</small></span><b>{duration()}</b></span>
    {#if state.recentActivity?.raw}<small class="liveness-raw">{state.recentActivity.raw}</small>{/if}
    <HeartbeatBar lastEventAt={state.lastMeaningfulEventAt} transport={state.transport} phase={state.phase}/>
    <span class="liveness-spark" aria-hidden="true">{#each state.buckets as count}<i style={`height:${barHeight(count)}px`}></i>{/each}</span>
    <span class="liveness-stats">
      <span><b>{state.commandCount}</b><small>{$t("liveness.metric.commands")}</small></span>
      <span><b>{state.fileCount}</b><small>{$t("liveness.metric.files")}</small></span>
      <span><b>{state.toolCount}</b><small>{$t("liveness.metric.tools")}</small></span>
      <span><b>{contextPercent()===null?state.eventCount:`${contextPercent()}%`}</b><small>{$t(contextPercent()===null?"liveness.metric.events":"liveness.metric.context")}</small></span>
    </span>
    </span>
    {#if state.agentTally.total&&density!=="full"}{@render agentChips()}{/if}
    {#if state.agentTally.total&&density==="full"}
      <div class="fanout">
        <header>
          <span class="fanout-label">{$t("fanout.title")}</span>
          <span class="fanout-tally">{tallyParts()}</span>
          <button type="button" class="fanout-toggle" aria-expanded={fanoutOpen} onclick={()=>fanoutOpen=!fanoutOpen}>{$t(fanoutOpen?"fanout.collapse":"fanout.expand")}</button>
        </header>
        <span class="fanout-bar" aria-hidden="true">{#each rankedAgents as agent (agent.id)}<i class={agent.status}></i>{/each}</span>
        {#if fanoutOpen}
          <div class="fanout-roster">
            {#each rosterAgents as agent (agent.id)}
              <button type="button" class="fanout-agent {agent.status}" onclick={onopen}>
                <span class="fanout-dot"></span>
                <span class="fanout-who"><strong>{agent.name}<code>{agent.id.replace(/[^A-Za-z0-9]/g,"").slice(-6)}</code></strong><small>{agent.waitingReason||agent.activity||agent.prompt||$t("conversation.waitingForActivity")}</small></span>
                <span class="fanout-side">
                  {#if agent.status==="waiting"}<span class="fanout-tag wait">{$t("fanout.waitingTag")}</span>{:else if agent.status==="failed"}<span class="fanout-tag fail">{$t("fanout.failedTag")}</span>{/if}
                  <b>{elapsedLabel(agent.startedAt)}</b>
                </span>
              </button>
            {/each}
            {#if hiddenAgents}<button type="button" class="fanout-more" onclick={onopen}>{$t("fanout.more",{count:hiddenAgents})}</button>{/if}
          </div>
        {/if}
      </div>
    {/if}
    {#if state.plan}<TaskPlanSummary plan={state.plan}/>{/if}
    {#if state.resolvedDecision}
      <div class="liveness-decision-record">✓ {$t("liveness.decisionResolved")}{#if state.resolvedDecision.selectedOption} · {state.resolvedDecision.selectedOption}{/if}</div>
    {/if}
  {:else}
    {#if state.agentTally.total}{@render agentChips()}{/if}
    <button type="button" class="liveness-expand" onclick={onexpand}>{$t("liveness.expandCard")}</button>
  {/if}
  {#if waitingAgent}
    <div class="fanout-escalate">
      <span class="fanout-escalate-copy"><strong>{$t("fanout.waitingAgent",{name:waitingAgent.name})}</strong><small>{waitingAgent.waitingReason||waitingAgent.activity}</small></span>
      <button type="button" onclick={onopen}>{$t("fanout.openWaitingAgent")}</button>
    </div>
  {/if}
  {#if state.phase==="waiting-user"||state.pendingDecision||task.status==="waiting"}
    <UserInputPanel {api} {task}/>
  {/if}
  {#if state.phase==="waiting-approval"||task.status==="waiting"}
    <ApprovalPanel {api} {task}/>
  {/if}
</article>
