<script lang="ts">
  import { ChevronDown, CircleHelp, GitCommitHorizontal, Upload } from "@lucide/svelte";
  import type { GitWorkspaceRecord, SessionGitSummary } from "./session-git-state";
  import { t } from "./i18n";

  type ProviderAttribution={provider:string;files:string[];count:number};
  export let items:Array<{workspace:GitWorkspaceRecord;summary:SessionGitSummary;providerAttributions:ProviderAttribution[];unattributedFiles:string[]|null;unattributedCount:number|null}>=[];
  let expanded=false;
  const providerOrder=["codex","claude","grok","antigravity","deepseek","ollama"];
  const providerLabel=(provider:string)=>provider==="antigravity"?"Gemini":provider==="codex"?"Codex":provider==="claude"?"Claude":provider==="grok"?"Grok":provider==="deepseek"?"DeepSeek":provider==="ollama"?"Ollama":provider;
  const dirtyLabel=(summary:SessionGitSummary)=>summary.changedCount===null
    ?$t("session.gitWorkspaceDirtyUnknown")
    :$t("session.gitWorkspaceDirty",{count:summary.changedCount});
  $: compactSummary=items.length?{
    ...items[0].summary,
    dirty:items.some(item=>item.summary.dirty),
    changedCount:items.some(item=>item.summary.dirty&&item.summary.changedCount===null)
      ?null
      :items.reduce((total,item)=>total+(item.summary.changedCount??0),0),
    ahead:items.reduce((total,item)=>total+item.summary.ahead,0),
    workspaceCount:items.length,
    branch:null,
    commit:null
  } satisfies SessionGitSummary:null;
  $: compactUnattributed=items.some(item=>item.unattributedCount===null)?null:items.reduce((total,item)=>total+(item.unattributedCount??0),0);
  $: compactProviders=providerOrder.flatMap(provider=>{const files=[...new Set(items.flatMap(item=>item.providerAttributions.filter(entry=>entry.provider===provider).flatMap(entry=>entry.files)))].sort();return files.length?[{provider,files,count:files.length}]:[];});
  // A long attribution list is unreadable as one wrapped blob, so each row keeps
  // a collapsed head and reveals the rest on demand.
  const fileLimit=8;
  let revealed=new Set<string>();
  const revealKey=(workspaceId:string,provider:string)=>`${workspaceId}::${provider}`;
  const reveal=(key:string)=>revealed=new Set(revealed).add(key);
  const splitPath=(path:string)=>{const cut=path.lastIndexOf("/");return cut<0?{dir:"",name:path}:{dir:path.slice(0,cut+1),name:path.slice(cut+1)};};
</script>

{#if items.length}
  <section class="workspace-git-overview" class:expanded aria-label={$t("session.gitWorkspaceOverview")}>
    <button type="button" class="workspace-git-toggle" aria-expanded={expanded} aria-controls="workspace-git-details" aria-label={$t(expanded?"session.gitWorkspaceCollapse":"session.gitWorkspaceExpand")} onclick={()=>expanded=!expanded}>
      <strong>{$t("session.gitWorkspaceOverview")}</strong>
      {#if compactSummary}<span class="workspace-git-compact-badges">
        {#if compactSummary.dirty}<span class="session-git-badge dirty" title={dirtyLabel(compactSummary)} aria-label={dirtyLabel(compactSummary)}><GitCommitHorizontal size={12}/>{$t("session.gitAllUncommittedShort",{count:compactSummary.changedCount??"?"})}</span>{/if}
        {#each compactProviders as provider}<span class="session-git-badge provider {provider.provider}" title={provider.files.join(", ")}>{$t("session.gitProviderUncommitted",{provider:providerLabel(provider.provider),count:provider.count})}</span>{/each}
        {#if compactUnattributed===null||compactUnattributed>0}<span class="session-git-badge unattributed" title={$t("session.gitUnattributedDetail")} aria-label={$t("session.gitUnattributed",{count:compactUnattributed??"?"})}><CircleHelp size={12}/>{compactUnattributed??"?"}</span>{/if}
        {#if compactSummary.ahead>0}<span class="session-git-badge unpushed" title={$t("session.gitUnpushed",{count:compactSummary.ahead})} aria-label={$t("session.gitUnpushed",{count:compactSummary.ahead})}><Upload size={12}/>{compactSummary.ahead}</span>{/if}
      </span>{/if}
      <ChevronDown size={16}/>
    </button>
    <div id="workspace-git-details" class="workspace-git-details">
      {#each items as item (item.workspace.id)}
        <span class="workspace-git-row">
          <span class="workspace-git-name" title={item.workspace.canonicalPath??undefined}>{item.workspace.displayName??item.workspace.canonicalPath??item.workspace.id}</span>
          {#each providerOrder.flatMap(provider=>item.providerAttributions.filter(entry=>entry.provider===provider)) as provider}
            {@const key=revealKey(item.workspace.id,provider.provider)}
            {@const shown=revealed.has(key)?provider.files:provider.files.slice(0,fileLimit)}
            <span class="workspace-git-provider-detail">
              <span class="workspace-git-provider-tag {provider.provider}">{$t("session.gitProviderUncommitted",{provider:providerLabel(provider.provider),count:provider.count})}</span>
              <span class="workspace-git-files">
                {#each shown as file}{@const parts=splitPath(file)}<code title={file}><span class="dir">{parts.dir}</span>{parts.name}</code>{/each}
                {#if shown.length<provider.files.length}<button type="button" class="workspace-git-more" onclick={()=>reveal(key)}>{$t("session.gitFilesMore",{count:provider.files.length-shown.length})}</button>{/if}
              </span>
            </span>
          {/each}
          {#if item.unattributedCount===null||item.unattributedCount>0}
            {@const key=revealKey(item.workspace.id,"unattributed")}
            {@const files=item.unattributedFiles??[]}
            {@const shown=revealed.has(key)?files:files.slice(0,fileLimit)}
            <span class="workspace-git-provider-detail unattributed-files">
              <span class="workspace-git-provider-tag unattributed" title={$t("session.gitUnattributedDetail")}>{$t("session.gitUnattributed",{count:item.unattributedCount??"?"})}</span>
              <span class="workspace-git-files">
                {#if files.length}{#each shown as file}{@const parts=splitPath(file)}<code title={file}><span class="dir">{parts.dir}</span>{parts.name}</code>{/each}{#if shown.length<files.length}<button type="button" class="workspace-git-more" onclick={()=>reveal(key)}>{$t("session.gitFilesMore",{count:files.length-shown.length})}</button>{/if}{:else}<small>{$t("session.gitUnattributedDetail")}</small>{/if}
              </span>
            </span>
          {/if}
        </span>
      {/each}
    </div>
  </section>
{/if}
