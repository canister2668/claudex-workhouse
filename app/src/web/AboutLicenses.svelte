<!--
SPDX-License-Identifier: AGPL-3.0-only
This file is part of Claudex Workhouse.
-->
<script lang="ts">
  import{onMount}from"svelte";
  import{locale,t}from"./i18n";

  type LegalNoticeMetadata={
    project:string;copyrightYear:string;copyrightHolder:string;license:string;
    distributionStatus:"Official"|"Modified"|"Unofficial";originalProject:string;originalRepository:string;
    distributor:string|null;version:string;commitSha:string;correspondingSource:string;
  };
  const legalLinks=$derived($locale==="en"
    ?["LICENSE","NOTICE.md","THIRD_PARTY_NOTICES.md"]
    :["LICENSE",`LICENSE.${$locale}.md`,`NOTICE.${$locale}.md`,`THIRD_PARTY_NOTICES.${$locale}.md`]);
  let{api}:{api:(path:string,options?:RequestInit)=>Promise<any>}=$props();
  let metadata:LegalNoticeMetadata|null=$state(null),error=$state("");
  onMount(async()=>{try{metadata=await api("/api/about");}catch(cause){error=cause instanceof Error?cause.message:String(cause);}});
</script>

<section class="about-licenses" aria-labelledby="about-licenses-title">
  <h3 id="about-licenses-title">{$t("about.title")}</h3>
  {#if error}
    <p class="about-error" role="alert">{$t("about.loadFailed")}</p>
  {:else if !metadata}
    <p class="about-loading" aria-live="polite">{$t("common.loading")}</p>
  {:else}
    <header>
      <strong>{metadata.project}</strong>
      <span class:modified={metadata.distributionStatus!=="Official"}>{$t(`about.status.${metadata.distributionStatus.toLowerCase()}`)}</span>
    </header>
    <p class="copyright">{$t("about.copyright",{year:metadata.copyrightYear,holder:metadata.copyrightHolder})}</p>
    <p class="license-summary">{$t("about.licenseSummary",{license:metadata.license})}</p>
    <dl>
      <div><dt>{$t("about.license")}</dt><dd>{metadata.license}</dd></div>
      <div><dt>{$t("about.originalProject")}</dt><dd>{metadata.originalProject}</dd></div>
      <div><dt>{$t("about.originalRepository")}</dt><dd><a href={metadata.originalRepository} target="_blank" rel="noopener noreferrer">{metadata.originalRepository}</a></dd></div>
      <div><dt>{$t("about.distributionStatus")}</dt><dd>{$t(`about.status.${metadata.distributionStatus.toLowerCase()}`)}</dd></div>
      {#if metadata.distributor}<div><dt>{$t("about.distributor")}</dt><dd>{metadata.distributor}</dd></div>{/if}
      <div><dt>{$t("about.version")}</dt><dd>{metadata.version}</dd></div>
      <div><dt>{$t("about.commit")}</dt><dd><code>{metadata.commitSha}</code></dd></div>
      <div><dt>{$t("about.sourceThisVersion")}</dt><dd><a href={metadata.correspondingSource} target="_blank" rel="noopener noreferrer">{metadata.correspondingSource}</a></dd></div>
    </dl>
    {#if metadata.distributionStatus!=="Official"}<p class="modified-notice">{$t("about.modifiedNotice")}</p>{/if}
    <p class="localized-license"><a href={`${metadata.originalRepository}/blob/main/docs/license.${$locale}.md`} target="_blank" rel="noopener noreferrer">{$t("about.localizedLicenseGuide")}</a></p>
    <p class="legal-links">{#each legalLinks as name}<a href={`${metadata.originalRepository}/blob/main/${name}`} target="_blank" rel="noopener noreferrer">{name}</a>{/each}</p>
  {/if}
</section>

<style>
  .about-licenses{display:grid;gap:12px;min-width:0}.about-licenses>h3{margin-bottom:0}.about-licenses>header{display:flex;align-items:center;gap:10px;padding:14px;border:1px solid var(--line);border-radius:14px;background:var(--bg)}header strong{min-width:0;flex:1;font-size:1rem}header span{padding:4px 8px;border-radius:var(--radius-pill);background:color-mix(in srgb,var(--accent) 12%,var(--surface-2));color:var(--accent-strong);font-size:.68rem;font-weight:750}header span.modified{background:color-mix(in srgb,var(--amber) 12%,var(--surface-2));color:var(--amber)}.copyright,.license-summary,.about-loading,.about-error,.modified-notice{margin:0;color:var(--muted);font-size:.72rem;line-height:1.5}.license-summary{padding:10px 12px;border-left:3px solid var(--accent);background:color-mix(in srgb,var(--accent) 6%,var(--bg));color:var(--text)}.about-error,.modified-notice{color:var(--amber)}dl{display:grid;margin:0;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--bg)}dl div{display:grid;grid-template-columns:minmax(125px,.38fr) minmax(0,1fr);gap:12px;padding:11px 13px;border-bottom:1px solid var(--line)}dl div:last-child{border-bottom:0}dt{color:var(--muted);font-size:.68rem;font-weight:650}dd{min-width:0;margin:0;color:var(--text);font-size:.72rem;overflow-wrap:anywhere}a{color:var(--accent-strong);text-underline-offset:2px}code{font-size:.7rem}.localized-license{margin:0}.localized-license a{display:inline-flex;padding:7px 9px;border:1px solid color-mix(in srgb,var(--accent) 45%,var(--line));border-radius:var(--radius-control-sm);background:color-mix(in srgb,var(--accent) 8%,var(--surface-2));font-size:.68rem;font-weight:700;text-decoration:none}.legal-links{display:flex;flex-wrap:wrap;gap:8px;margin:0}.legal-links a{padding:6px 8px;border:1px solid var(--line);border-radius:var(--radius-control-sm);background:var(--surface-2);font-size:.66rem;text-decoration:none}@media(max-width:520px){dl div{grid-template-columns:1fr;gap:4px;padding:10px 11px}.about-licenses>header{align-items:flex-start;flex-direction:column}.localized-license a{display:flex;justify-content:center}.legal-links{display:grid;grid-template-columns:1fr}.legal-links a{text-align:center}}
</style>
