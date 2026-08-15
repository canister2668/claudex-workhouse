<script lang="ts">
  import {onMount} from "svelte";
  import {t} from "./i18n";
  import {modelLabel} from "./session-ui";

  type ProviderId="codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok";
  const providers:ProviderId[]=["codex","claude","grok","deepseek","ollama","antigravity"];
  const names:Record<ProviderId,string>={codex:"OpenAI",claude:"Anthropic",grok:"xAI",deepseek:"DeepSeek",ollama:"Ollama",antigravity:"Google"};

  export let api:(path:string,init?:RequestInit)=>Promise<any>;
  export let sourceProvider:ProviderId;
  export let hostId="local";
  export let selectionKey="review";
  export let provider:ProviderId=sourceProvider==="codex"?"claude":"codex";
  export let model="";
  export let effort="default";
  export let tier:string|null=null;

  let loading=true,error="",hosts:any[]=[],evaluatedHostId=hostId;
  let models:Record<ProviderId,any[]>={codex:[],claude:[],grok:[],deepseek:[],ollama:[],antigravity:[]};
  let efforts:Record<ProviderId,any[]>={codex:[],claude:[],grok:[],deepseek:[],ollama:[],antigravity:[]};
  let disabledReasons:Record<ProviderId,string>={codex:"",claude:"",grok:"",deepseek:"",ollama:"",antigravity:""};
  const hostProviders=()=>{const capabilities=hosts.find(item=>item.id===hostId)?.capabilities,execution=capabilities?.providerExecution;if(Array.isArray(execution))return execution.filter(item=>item.create).map(item=>item.provider) as ProviderId[];const configured=capabilities?.providers;return Array.isArray(configured)?configured as ProviderId[]:hostId==="local"?providers:(["codex","claude"] as ProviderId[]);};
  const currentDisabledReason=(item:ProviderId)=>!hostProviders().includes(item)?$t("targetPicker.hostUnsupported"):!models[item].length?$t("targetPicker.noModels"):"";
  const refreshDisabledReasons=()=>disabledReasons=Object.fromEntries(providers.map(item=>[item,currentDisabledReason(item)])) as Record<ProviderId,string>;
  const selectedModel=()=>models[provider].find(item=>item.id===model);
  const selectedEfforts=()=>provider==="codex"?(selectedModel()?.supportedReasoningEfforts??[]).map((item:any)=>({id:item.reasoningEffort})):efforts[provider];
  function syncSelection(){
    const available=models[provider];if(!available.some(item=>item.id===model))model=available[0]?.id??"";
    const choices=selectedEfforts();if(!choices.some((item:any)=>item.id===effort))effort=provider==="codex"?(selectedModel()?.defaultReasoningEffort??choices[0]?.id??"medium"):(choices.find((item:any)=>item.id==="default")?.id??choices[0]?.id??"default");
    if(provider!=="codex"||!selectedModel()?.serviceTiers?.some((item:any)=>item.id==="priority"))tier=null;
  }
  function chooseProvider(next:ProviderId){if(disabledReasons[next])return;provider=next;model="";effort="default";tier=null;syncSelection();}
  function chooseModel(next:string){model=next;syncSelection();}
  $: if(hostId!==evaluatedHostId){evaluatedHostId=hostId;refreshDisabledReasons();if(!loading&&disabledReasons[provider]){const next=providers.find(item=>!disabledReasons[item]);if(next){provider=next;model="";effort="default";tier=null;syncSelection();}}}
  onMount(()=>{let alive=true;void (async()=>{try{
    const[global,codex,claude,grok,deepseek,ollama,antigravity,hostData]=await Promise.all([
      api("/api/system-settings/models?snapshot=true"),api("/api/providers/codex/models"),api("/api/providers/claude/permissions"),api("/api/providers/grok/models"),api("/api/providers/deepseek/models"),api("/api/providers/ollama/models"),api("/api/providers/antigravity/models"),api("/api/hosts")
    ]);if(!alive)return;
    hosts=hostData.hosts??[];
    const enabled=global.settings??{},filter=(id:ProviderId,items:any[])=>{const selected=enabled[id]?.models??[],runtime=new Map(items.filter(item=>!item.hidden).map(item=>[item.id,item])),fallback=items.find(item=>!item.hidden);return selected.map((item:any)=>runtime.get(item.id)??{...fallback,...item,id:item.id,model:item.id,displayName:item.displayName??item.id,hidden:false,isDefault:false});};
    models={codex:filter("codex",codex.catalog?.models??[]),claude:filter("claude",claude.models??[]),grok:filter("grok",grok.models??grok.catalog?.models??[]),deepseek:filter("deepseek",deepseek.models??[]),ollama:filter("ollama",ollama.models??[]),antigravity:filter("antigravity",antigravity.models??[])};
    efforts={codex:[],claude:claude.efforts??[],grok:grok.efforts??[],deepseek:deepseek.efforts??[],ollama:ollama.efforts??[],antigravity:antigravity.efforts??[]};refreshDisabledReasons();
    try{const saved=JSON.parse(localStorage.getItem(`claudex-target-selection:${selectionKey}`)??"null");if(providers.includes(saved?.provider)){provider=saved.provider;model=String(saved.model??"");effort=String(saved.effort??"default");tier=saved.tier==="priority"?"priority":null;}}catch{}
    if(disabledReasons[provider]){const next=providers.find(item=>!disabledReasons[item]);if(next)provider=next;}syncSelection();
  }catch(e){if(alive)error=e instanceof Error?e.message:String(e);}finally{if(alive)loading=false;}})();return()=>{alive=false;};});
  $: if(!loading&&model&&typeof localStorage!=="undefined")localStorage.setItem(`claudex-target-selection:${selectionKey}`,JSON.stringify({provider,model,effort,tier}));
</script>

<div class="target-picker" aria-busy={loading}>
  <div class="provider-field"><span class="field-label">{$t("targetPicker.company")}</span><div class="provider-tabs" role="tablist" aria-label={$t("targetPicker.company")}>{#each providers as item}<button type="button" role="tab" aria-selected={provider===item} aria-disabled={Boolean(disabledReasons[item])} class:active={provider===item} disabled={Boolean(disabledReasons[item])} title={disabledReasons[item]} onclick={()=>chooseProvider(item)}><strong>{names[item]}</strong><small>{item==="antigravity"?"Gemini":item==="claude"?"Claude Code":item==="codex"?"Codex":item}</small></button>{/each}</div></div>
  {#if loading}<p class="picker-note">{$t("targetPicker.loading")}</p>{:else if error}<p class="picker-error">{error}</p>{:else}
    <label>{$t("session.model")}<select value={model} onchange={(event)=>chooseModel((event.currentTarget as HTMLSelectElement).value)}>{#each models[provider] as item}<option value={item.id}>{modelLabel(item)}</option>{/each}</select></label>
    {#if selectedEfforts().length}<label>{$t("session.reasoning")}<select bind:value={effort}>{#each selectedEfforts() as item}<option value={item.id}>{$t(`session.effort.${item.id}`)}</option>{/each}</select></label>{/if}
    {#if provider==="codex"&&selectedModel()?.serviceTiers?.some((item:any)=>item.id==="priority")}<label>{$t("session.speed")}<select value={tier??""} onchange={(event)=>tier=(event.currentTarget as HTMLSelectElement).value||null}><option value="">{$t("model.standard")}</option><option value="priority">{$t("session.fastUsage")}</option></select></label>{/if}
    {#if provider===sourceProvider}<p class="picker-warning">{$t("targetPicker.sameProviderWarning")}</p>{/if}<p class="picker-note">{$t("targetPicker.permissionDerived")}</p>
  {/if}
</div>

<style>
  .target-picker{display:grid;gap:.7rem}.target-picker label,.provider-field{display:grid;gap:.35rem}.field-label{font-size:inherit}.provider-tabs{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:.35rem}.provider-tabs button{display:grid;gap:.15rem;min-width:0;padding:.55rem .4rem;text-align:center}.provider-tabs button.active{border-color:var(--accent);background:var(--accent-soft)}.provider-tabs button:disabled{opacity:.42}.provider-tabs strong,.provider-tabs small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.provider-tabs small,.picker-note,.picker-warning{font-size:.7rem}.picker-note{color:var(--muted)}.picker-note,.picker-warning{margin:0}.picker-warning{color:var(--warn)}.picker-error{margin:0;color:var(--danger)}
  @media(max-width:600px){.provider-tabs{display:flex;overflow-x:auto;padding-bottom:.2rem}.provider-tabs button{min-width:94px;min-height:52px}}
</style>
