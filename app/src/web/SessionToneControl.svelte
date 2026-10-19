<script lang="ts">
  import { onMount } from "svelte";
  import AvatarToneMenu from "./AvatarToneMenu.svelte";
  import { requestJson } from "./api-client";
  import { DEFAULT_CHARACTERS, type CharacterSettings, type TonePreset } from "./character-settings";
  import { DEFAULT_TONE_FAVORITES } from "./tone-preview";
  import { t } from "./i18n";
  export let provider:keyof CharacterSettings["providers"];
  export let taskId:string|null=null;
  export let onfavorites:((provider:keyof CharacterSettings["providers"],favorites:TonePreset[])=>void)|null=null;
  let character=DEFAULT_CHARACTERS.providers[provider];
  let selected:TonePreset|null=null;
  let scope:"once"|"session"="once";
  let title="";
  let editable=false;
  let busy=false;
  let loaded=false;
  let error="";
  let generation=0;
  const path=()=>`/api/tasks/${provider}/${encodeURIComponent(taskId!)}/tone`;
  async function load(){
    const current=++generation;
    try{
      const [settings,state]=await Promise.all([requestJson("/api/system-settings/characters"),taskId?requestJson(path()):Promise.resolve(null)]);
      if(current!==generation)return;
      character=settings.settings?.providers?.[provider]??DEFAULT_CHARACTERS.providers[provider];
      selected=state?.tonePreset??null;scope=state?.scope??"once";title=state?.title??"";editable=state?.editable===true;loaded=true;error="";
    }catch(e){if(current===generation){error=e instanceof Error?e.message:String(e);loaded=false;}}
  }
  async function select(tonePreset:TonePreset|null,nextScope:"once"|"session"){
    if(!taskId||busy||!editable)return;
    busy=true;
    const current=++generation;
    try{const result=await requestJson(path(),{method:"PUT",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({tonePreset,scope:nextScope})});if(current===generation){selected=result.tonePreset;scope=result.scope;error="";}}
    catch(e){if(current===generation)error=e instanceof Error?e.message:String(e);}
    finally{busy=false;}
  }
  async function favorites(tones:TonePreset[]){
    if(busy)return;busy=true;
    const target=provider,current=++generation;
    try{const result=await requestJson(`/api/system-settings/characters/${target}/tone-favorites`,{method:"PUT",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({favorites:tones})});onfavorites?.(target,result.settings.providers[target].toneFavorites);if(current===generation){character=result.settings.providers[target];error="";}}
    catch(e){if(current===generation)error=e instanceof Error?e.message:String(e);}
    finally{busy=false;}
  }
  let mounted=false;
  let identity="";
  $: if(mounted&&identity!==`${provider}:${taskId}`){identity=`${provider}:${taskId}`;loaded=false;selected=null;editable=false;title="";void load();}
  onMount(()=>{mounted=true;const timer=setInterval(()=>{if(!busy)void load();},5000);return()=>{generation++;clearInterval(timer);};});
</script>

<div class="session-tone-control">
  {#if title}<p class="session-tone-target">{$t("character.toneTarget",{title})}</p>
  {:else if !taskId}<p class="session-tone-target">{$t("character.toneChooseSession")}</p>{/if}
  {#if !loaded&&!error}<p role="status">{$t("common.loading")}</p>{/if}
  {#if error}<p role="alert">{error}</p><button type="button" onclick={()=>void load()}>{$t("common.retry")}</button>{/if}
  <AvatarToneMenu outfit={character.avatarOutfit} favorites={character.toneFavorites??[...DEFAULT_TONE_FAVORITES]} {selected} activeScope={scope} customTone={character.customTone} disabled={busy||!loaded} selectionDisabled={!editable} onselect={(tone,scope)=>void select(tone,scope)} onfavorites={tones=>void favorites(tones)}/>
  <p class="session-tone-target">{$t("character.toneNextTurn")}</p>
</div>

<style>
  .session-tone-control{display:grid;gap:var(--space-2);margin-block:var(--space-3);padding-block:var(--space-3);border-block:1px solid var(--line);min-width:0}
  .session-tone-target{margin:0;color:var(--muted);font-size:var(--text-xs);overflow-wrap:anywhere}
  [role="alert"]{margin:0;color:var(--err);font-size:var(--text-xs)}
</style>
