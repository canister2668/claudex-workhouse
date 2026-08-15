<script lang="ts">
  import{Check,CircleAlert,ChevronDown,Hammer,LoaderCircle,SquareTerminal}from"@lucide/svelte";
  import{onMount}from"svelte";
  import type{BuildProgress}from"./build-progress";
  import{t}from"./i18n";

  export let build:BuildProgress;
  let now=Date.now();
  let firstSeenAt=now;
  onMount(()=>{
    const timer=setInterval(()=>{if(build.status==="running")now=Date.now();},1000);
    return()=>clearInterval(timer);
  });
  $: timestampStart=build.startedAt?Date.parse(build.startedAt):NaN;
  $: elapsedMs=build.durationMs??Math.max(0,now-(Number.isFinite(timestampStart)?timestampStart:firstSeenAt));
  $: elapsed=elapsedMs<1000?$t("build.lessThanSecond"):elapsedMs<60_000?$t("build.seconds",{count:Math.round(elapsedMs/1000)}):$t("build.minutes",{count:Math.floor(elapsedMs/60_000),seconds:Math.round(elapsedMs%60_000/1000)});
</script>

<article class="build-progress {build.status}" data-build-status={build.status}>
  <header>
    <span class="build-icon">{#if build.status==="running"}<LoaderCircle size={18}/>{:else if build.status==="completed"}<Check size={18}/>{:else}<CircleAlert size={18}/>{/if}</span>
    <span class="build-copy"><strong aria-live="polite"><Hammer size={14}/>{build.tool} · {$t(`build.${build.status}`)}</strong><code title={build.command}>{build.command}</code></span>
    <span class="build-time">{elapsed}</span>
  </header>
  <div class="build-track" aria-hidden="true"><i></i></div>
  <div class="build-meta">
    <span>{$t(`build.phase.${build.phase}`)}</span>
    {#if build.latestLine}<small title={build.latestLine}>{build.latestLine}</small>{/if}
    {#if build.status==="failed"&&build.exitCode!==null}<em>{$t("build.exitCode",{code:build.exitCode})}</em>{/if}
  </div>
  <details>
    <summary><SquareTerminal size={14}/>{$t("build.logs")}{#if build.outputLines}<span>{build.outputLines}</span>{/if}<i class="log-chevron"><ChevronDown size={14}/></i></summary>
    <pre>$ {build.command}{#if build.output}{`\n${build.output}`}{/if}</pre>
  </details>
</article>

<style>
  .build-progress{overflow:clip;border:1px solid color-mix(in srgb,var(--accent) 38%,var(--line));border-radius:11px;background:var(--surface)}
  .build-progress.failed{border-color:color-mix(in srgb,var(--red) 50%,var(--line))}
  header{min-height:58px;padding:9px 11px;display:flex;align-items:center;gap:9px}
  .build-icon{width:32px;height:32px;flex:none;display:grid;place-items:center;border-radius:9px;background:color-mix(in srgb,var(--accent) 13%,transparent);color:var(--accent)}
  .running .build-icon :global(svg){animation:spin 1.1s linear infinite}
  .completed .build-icon{background:color-mix(in srgb,var(--cyan) 13%,transparent);color:var(--cyan)}
  .failed .build-icon{background:color-mix(in srgb,var(--red) 12%,transparent);color:var(--red)}
  .build-copy{min-width:0;flex:1;display:grid;gap:3px}
  .build-copy strong{display:flex;align-items:center;gap:5px;color:var(--text);font-size:.8rem}
  .build-copy code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:.67rem}
  .build-time{flex:none;color:var(--muted);font-size:.68rem;font-variant-numeric:tabular-nums}
  .build-track{height:3px;overflow:hidden;background:var(--surface-2)}
  .build-track i{display:block;width:100%;height:100%;background:var(--cyan);transform-origin:left}
  .running .build-track i{width:38%;background:var(--accent);animation:progress 1.35s ease-in-out infinite}
  .failed .build-track i{background:var(--red)}
  .build-meta{min-height:36px;padding:7px 11px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--line)}
  .build-meta>span{flex:none;color:var(--accent-strong);font-size:.7rem;font-weight:750}
  .failed .build-meta>span{color:var(--red)}
  .build-meta small{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:.67rem}
  .build-meta em{flex:none;color:var(--red);font-size:.66rem;font-style:normal;font-weight:700}
  details>summary{min-height:38px;padding:6px 11px;display:flex;align-items:center;gap:6px;list-style:none;cursor:pointer;color:var(--muted);font-size:.7rem;font-weight:700}
  details>summary::-webkit-details-marker{display:none}
  details>summary span{min-width:20px;padding:1px 6px;border-radius:999px;background:var(--surface-2);text-align:center;font-size:.62rem}
  .log-chevron{margin-left:auto;display:inline-flex;transition:transform .15s}
  details[open] .log-chevron{transform:rotate(180deg)}
  pre{max-height:260px;margin:0;padding:10px 12px;overflow:auto;border-top:1px solid var(--line);background:var(--term-bg);color:var(--term-fg);font:inherit;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.74rem;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes progress{0%{transform:translateX(-105%)}50%{transform:translateX(95%)}100%{transform:translateX(265%)}}
  @media(prefers-reduced-motion:reduce){.running .build-icon :global(svg){animation:none}.running .build-track i{width:100%;animation:none;opacity:.65}}
</style>
