<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import HeartbeatBar from "./HeartbeatBar.svelte";
  import { initialTaskLiveness, subscribeTaskLiveness, type TaskLiveness } from "./liveness";
  import { progressCountLabels, taskProgressHeartbeat } from "./task-progress";
  import { normalizeTimestamp } from "./task-time";
  import { t } from "./i18n";

  export let provider:"codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok"="codex";
  export let taskId="";
  export let status = "";
  export let updatedAt:string|null=null;
  export let startedAt:string|null=null;
  export let activity = "";
  export let workerOnline:boolean|null=null;
  export let streamEnabled=true;
  let liveness:TaskLiveness=initialTaskLiveness(normalizeTimestamp(updatedAt)??Date.now()),stop:(()=>void)|null=null;
  let mounted=false,subscribedKey="";

  const activeStatuses=new Set(["pending","queued","running","waiting"]);
  $: active=activeStatuses.has(status);
  $: waiting=status==="waiting"||status==="queued"||status==="pending";
  $: desiredKey=active&&streamEnabled&&taskId?`${provider}:${taskId}`:"";
  $: if(mounted&&desiredKey!==subscribedKey){
    stop?.();stop=null;subscribedKey=desiredKey;
    if(desiredKey)stop=subscribeTaskLiveness({provider,taskId,lastEventAt:normalizeTimestamp(updatedAt)??Date.now(),taskStatus:status,onChange:value=>liveness=value});
  }
  // A card list holds one instance per task, including finished ones. Only a
  // visible running card is allowed to hold a clock.
  let now=Date.now(),ticker:ReturnType<typeof setInterval>|null=null;
  function stopTicker(){if(ticker){clearInterval(ticker);ticker=null;}}
  $: if(active&&streamEnabled&&!ticker){now=Date.now();ticker=setInterval(()=>now=Date.now(),1_000);}
  $: if(!(active&&streamEnabled))stopTicker();
  $: progress=taskProgressHeartbeat({
    status,
    phase:liveness.phase,
    activity:liveness.recentActivity?.type,
    startedAt,
    now,
    lastEventAt:liveness.lastMeaningfulEventAt,
    eventCount:liveness.eventCount,
    commandCount:liveness.commandCount,
    fileCount:liveness.fileCount,
    toolCount:liveness.toolCount
  });
  $: elapsedText=$t(progress.elapsedLabel.key,progress.elapsedLabel.params);
  $: countsText=progressCountLabels(progress.counts).map(label=>$t(label.key,label.params)).join(" · ");
  $: progressLabel=$t("progress.heartbeatLabel",{stage:$t(progress.stageKey),elapsed:$t("progress.elapsed",{time:elapsedText})})+(countsText?` · ${countsText}`:"");
  onMount(()=>mounted=true);
  onDestroy(()=>{stopTicker();stop?.();});
</script>

{#if active&&streamEnabled}
  <span class="session-activity-strip" class:waiting title={activity}>
    <span class="session-progress-heartbeat" class:quiet={progress.quiet} title={progressLabel} aria-label={progressLabel}>
      <strong>{$t(progress.stageKey)}</strong>
      {#if progress.elapsedKnown}<b>{$t("progress.elapsed",{time:elapsedText})}</b>{/if}
    </span>
    {#if workerOnline===false}<strong class="worker-warning">{$t("visibility.workerUnavailable")}</strong>{/if}
    <HeartbeatBar lastEventAt={liveness.lastEventAt} transport={liveness.transport} phase={liveness.phase==="idle"?(waiting?"waiting-user":"acting"):liveness.phase}/>
  </span>
{/if}
