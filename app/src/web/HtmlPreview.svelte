<script lang="ts">
  import {AlertTriangle,ExternalLink,Image,Monitor,MoreHorizontal,RefreshCw,ShieldCheck,Smartphone,SunMoon} from "@lucide/svelte";
  import {onDestroy,onMount,tick} from "svelte";
  import {buildHtmlPreview} from "./html-preview-compatibility";
  import type {HtmlPreviewCanvas,HtmlPreviewMode,HtmlPreviewReadResponse,HtmlPreviewResult,HtmlPreviewViewport} from "./html-preview-types";
  import {t} from "./i18n";

  export let api:(path:string,init?:RequestInit)=>Promise<any>;
  export let workspaceId:string;
  export let file:{id:string;name:string;sensitive:boolean};

  let source:HtmlPreviewReadResponse|null=null,result:HtmlPreviewResult|null=null,loading=false,processing=false,error="",detailsOpen=false;
  let previewToolsOpen=typeof window!=="undefined"&&window.matchMedia("(min-width:701px)").matches;
  let mode:HtmlPreviewMode="safe",viewport:HtmlPreviewViewport="desktop",canvas:HtmlPreviewCanvas="light",allowExternalImages=false;
  let previewModeLabel=$t("htmlPreview.safe");
  $: previewModeLabel=$t("htmlPreview.safe");
  let frame:HTMLIFrameElement;
  const cache=new Map<string,HtmlPreviewResult>();
  const previewUrls=new Set<string>();

  const message=(value:unknown)=>value instanceof Error?value.message:String(value);
  const key=()=>source?`${source.revision}:${mode}:${allowExternalImages}:${viewport}`:"";
  async function transform(){
    if(!source)return;
    const cacheKey=key(),cached=cache.get(cacheKey);
    if(cached){result=cached;return;}
    processing=true;await tick();
    try{const next=buildHtmlPreview(source.content,{mode,allowExternalImages});cache.set(cacheKey,next);result=next;}
    catch(value){error=message(value);result=null;}
    finally{processing=false;}
  }
  async function load(force=false){
    if(file.sensitive&&!confirm($t("htmlPreview.sensitiveConfirm")))return;
    loading=true;error="";
    try{
      const next=await api(`/api/workspaces/${workspaceId}/files/html-preview`,{method:"POST",body:JSON.stringify({fileId:file.id,confirmSensitive:file.sensitive})}) as HtmlPreviewReadResponse;
      if(force||source?.revision!==next.revision)cache.clear();
      source=next;await transform();
    }catch(value){error=message(value);source=null;result=null;}
    finally{loading=false;}
  }
  async function selectMode(value:HtmlPreviewMode){if(mode===value)return;mode=value;await transform();}
  async function selectViewport(value:HtmlPreviewViewport){if(viewport===value)return;viewport=value;await transform();}
  async function toggleImages(){allowExternalImages=!allowExternalImages;await transform();}
  function openNewWindow(){
    if(!result)return;
    const url=URL.createObjectURL(new Blob([result.srcdoc],{type:"text/html;charset=utf-8"}));
    previewUrls.add(url);
    window.open(url,"_blank","noopener,noreferrer");
    setTimeout(()=>{URL.revokeObjectURL(url);previewUrls.delete(url);},60_000);
  }

  onMount(()=>{const query=window.matchMedia("(min-width:701px)"),sync=()=>previewToolsOpen=query.matches;sync();query.addEventListener("change",sync);void load();return()=>query.removeEventListener("change",sync);});
  onDestroy(()=>{if(frame)frame.srcdoc="";for(const url of previewUrls)URL.revokeObjectURL(url);previewUrls.clear();source=null;result=null;cache.clear();});
</script>

<section class="html-preview">
  <div class="preview-toolbar" aria-label={$t("htmlPreview.controls")}>
    <div class="preview-primary">
      <div class="segments viewport-segments">
        <button class:active={viewport==="desktop"} aria-pressed={viewport==="desktop"} onclick={()=>selectViewport("desktop")}><Monitor size={15}/>{$t("htmlPreview.desktop")}</button>
        <button class:active={viewport==="mobile"} aria-pressed={viewport==="mobile"} onclick={()=>selectViewport("mobile")}><Smartphone size={15}/>{$t("htmlPreview.mobile")}</button>
      </div>
      <button class="icon-action" disabled={!result} onclick={openNewWindow} aria-label={$t("htmlPreview.openNewWindow")} title={$t("htmlPreview.openNewWindow")}><ExternalLink size={17}/><span>{$t("htmlPreview.openNewWindow")}</span></button>
      <button class="icon-action" disabled={loading} onclick={()=>load(true)} aria-label={$t("htmlPreview.reload")} title={$t("htmlPreview.reload")}><RefreshCw class={loading?"spin":undefined} size={17}/><span>{$t("htmlPreview.reload")}</span></button>
      <details class="preview-more" bind:open={previewToolsOpen}>
        <summary aria-label={$t("nav.moreActions")} title={$t("nav.moreActions")}><MoreHorizontal size={18}/></summary>
        <div class="preview-secondary">
          <strong class="preview-tools-title">{$t("htmlPreview.controls")}</strong>
          <div class="segments mode-segments">
            <button class:active={mode==="safe"} aria-pressed={mode==="safe"} onclick={()=>selectMode("safe")}><ShieldCheck size={15}/>{$t("htmlPreview.safe")}</button>
          </div>
          <button class="images-action" class:active={allowExternalImages} aria-pressed={allowExternalImages} onclick={toggleImages}><Image size={15}/>{allowExternalImages?$t("htmlPreview.imagesOn"):$t("htmlPreview.imagesOff")}</button>
          <button class="canvas-action" onclick={()=>canvas=canvas==="light"?"dark":"light"}><SunMoon size={15}/>{canvas==="light"?$t("htmlPreview.light"):$t("htmlPreview.dark")}</button>
          {#if result?.diagnostics.length}
            <details class="diagnostics" bind:open={detailsOpen}>
              <summary><strong>{$t("htmlPreview.diagnostics")}</strong><span>{$t("htmlPreview.summary",{tags:result.counts.tags,attributes:result.counts.attributes,css:result.counts.css,resources:result.counts.resources})}</span></summary>
              <ul>{#each result.diagnostics as item,index (`${item.category}:${item.target}:${item.name}:${index}`)}<li><em>{item.category}</em><code>{item.target}{item.name?`.${item.name}`:""}</code><span>{item.detail}</span></li>{/each}</ul>
            </details>
          {/if}
        </div>
      </details>
    </div>
  </div>

  {#if allowExternalImages}<p class="external-note"><Image size={14}/>{$t("htmlPreview.externalWarning")}</p>{/if}
  {#if error}<p class="preview-error">{error}</p>{/if}
  {#if loading||processing}<div class="preview-loading"><RefreshCw class="spin" size={20}/>{loading?$t("htmlPreview.loading"):$t("htmlPreview.processing")}</div>{/if}

  {#if result}
    <div class="preview-canvas {canvas}">
      <div class:mobile={viewport==="mobile"} class="preview-viewport">
        <iframe bind:this={frame} srcdoc={result.srcdoc} sandbox="" referrerpolicy="no-referrer" loading="lazy" title={$t("htmlPreview.iframeTitle",{name:file.name,mode:previewModeLabel})}></iframe>
      </div>
    </div>
  {/if}
</section>

<style>
  .html-preview{position:relative;display:flex;min-height:0;flex:1;flex-direction:column;gap:.55rem}.preview-toolbar{display:flex;align-items:center;gap:.4rem}.preview-primary{display:grid;grid-template-columns:max-content max-content max-content minmax(0,1fr);align-items:center;gap:.4rem;width:100%}.preview-toolbar button,.preview-more summary{display:inline-flex;align-items:center;justify-content:center;gap:.3rem;min-height:38px;padding:0 .6rem;border:1px solid var(--line-strong);border-radius:8px;background:var(--surface-3);color:var(--text);font-weight:700}.preview-toolbar button.active,.segments button.active{border-color:var(--accent);background:var(--accent);color:var(--on-accent)}.segments{display:flex;gap:.25rem}.preview-more{display:block;grid-column:1/-1;min-width:0}.preview-more>summary{display:none;list-style:none}.preview-more>summary::-webkit-details-marker{display:none}.preview-secondary{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr) minmax(0,1fr);gap:.4rem;min-width:0}.preview-secondary>.mode-segments{display:grid;grid-template-columns:1fr 1fr;min-width:0}.preview-secondary>.images-action,.preview-secondary>.canvas-action{width:100%;min-width:0}.preview-secondary>.diagnostics{grid-column:1/-1}.preview-tools-title{display:none}
  .external-note{display:flex;align-items:flex-start;gap:.45rem;margin:0;padding:.55rem .65rem;border:1px solid var(--line-strong);border-radius:9px;background:var(--surface-2);color:var(--text);font-size:.76rem}.preview-error{margin:0;padding:.6rem;color:var(--danger)}.preview-loading{display:grid;place-items:center;align-content:center;gap:.45rem;min-height:180px;color:var(--muted)}.diagnostics{flex:none;border:1px solid var(--line);border-radius:9px;background:var(--surface-2)}.diagnostics summary{display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:.55rem .65rem;cursor:pointer}.diagnostics summary span{color:var(--muted);font-size:.72rem}.diagnostics ul{display:grid;gap:.3rem;max-height:190px;margin:0;padding:.55rem;overflow:auto;list-style:none;border-top:1px solid var(--line)}.diagnostics li{display:grid;grid-template-columns:auto minmax(150px,1fr) minmax(180px,1.4fr);align-items:start;gap:.4rem;font-size:.72rem}.diagnostics em{padding:.12rem .3rem;border-radius:5px;background:var(--surface-3);font-style:normal}.diagnostics code{overflow-wrap:anywhere}.diagnostics li span{color:var(--muted)}.preview-canvas{min-height:0;flex:1;overflow:auto;padding:16px;border:1px solid var(--line-strong);border-radius:10px;background:#f5f5f5}.preview-canvas.dark{background:#17191b}.preview-viewport{width:100%;height:100%;min-height:0;margin:auto;background:white;box-shadow:0 3px 20px #0003}.preview-viewport.mobile{width:min(360px,100%)}.preview-viewport iframe{display:block;width:100%;height:100%;min-height:0;border:0;background:white}.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
  @media(min-width:701px){.preview-more:not([open])>.preview-secondary{display:contents}}
  @media(max-width:700px){.preview-primary{display:grid;grid-template-columns:minmax(0,1fr) 44px 44px 44px;gap:5px}.preview-toolbar button,.preview-more summary{min-height:44px;padding:0 .4rem}.preview-primary>.viewport-segments{display:grid;grid-template-columns:1fr 1fr;min-width:0}.viewport-segments button{min-width:0;font-size:.68rem}.icon-action span{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.preview-more{display:block;grid-column:auto}.preview-more>summary{display:inline-flex;width:44px;padding:0;cursor:pointer}.preview-secondary{position:fixed;z-index:90;left:8px;right:8px;bottom:max(8px,env(safe-area-inset-bottom));display:none;grid-template-columns:1fr 1fr;gap:7px;padding:14px;border:1px solid var(--line-strong);border-radius:18px;background:var(--surface);box-shadow:var(--shadow-lg)}.preview-more[open]>.preview-secondary{display:grid}.preview-tools-title{display:block;grid-column:1/-1}.preview-secondary>.segments{display:grid;grid-template-columns:1fr 1fr;grid-column:1/-1}.preview-secondary>button{width:100%}.preview-secondary>.diagnostics{grid-column:1/-1}.preview-canvas{padding:4px}.diagnostics summary{align-items:flex-start;flex-direction:column}.diagnostics li{grid-template-columns:auto 1fr}.diagnostics li span{grid-column:1/-1}}
</style>
