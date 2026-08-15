<script lang="ts">
  import { onDestroy } from "svelte";
  import { LIVENESS_DEAD_MS, LIVENESS_STALE_MS, livenessFreshness, type TaskPhase, type TransportState } from "./liveness";
  import { t } from "./i18n";

  export let lastEventAt=0;
  export let transport:TransportState="degraded";
  export let phase:TaskPhase="idle";
  export let compact=false;
  let now=Date.now();
  const timer=setInterval(()=>now=Date.now(),1_000);
  onDestroy(()=>clearInterval(timer));
  $: freshness=(phase==="waiting-user"||phase==="waiting-approval")&&livenessFreshness(lastEventAt,now)==="dead"
    ?"quiet"
    :livenessFreshness(lastEventAt,now);
  $: age=Math.max(0,Math.floor((now-lastEventAt)/1_000));
  $: displayTransport=transport==="degraded"&&age*1_000>=LIVENESS_DEAD_MS?"lost":transport;
  $: phaseLabel=$t(`liveness.phase.${phase}`);
  $: freshnessLabel=$t(`liveness.freshness.${freshness}`);
</script>

<span class="heartbeat-bar {freshness}" class:degraded={displayTransport!=="connected"} class:lost={displayTransport==="lost"} class:compact title={`${phaseLabel} · ${freshnessLabel} · ${$t("liveness.secondsAgo",{seconds:age})}`}>
  <span class="heartbeat-copy"><i></i><strong>{$t(`liveness.transport.${displayTransport}`)}</strong>{#if !compact}<span>· {phaseLabel} · {freshnessLabel}</span>{/if}</span>
  <span class="heartbeat-track" aria-hidden="true">{#key lastEventAt}<i style={`--heartbeat-stale:${LIVENESS_STALE_MS}ms;--heartbeat-dead:${LIVENESS_DEAD_MS}ms`}></i>{/key}</span>
  {#if !compact}<small>{$t("liveness.secondsAgo",{seconds:age})}</small>{/if}
</span>
