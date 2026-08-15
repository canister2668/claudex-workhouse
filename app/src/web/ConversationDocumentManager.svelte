<script lang="ts">
  import { Download, Eye, FileText, Trash2, X } from "@lucide/svelte";
  import { t } from "./i18n";
  import { workspaceFileDownloadHref } from "./workspace-viewer-state";

  type ConversationDocument={collaborationId:string;title:string;status:string;updatedAt:string;workspaceId:string;relativePath:string;revision:string};
  export let documents:ConversationDocument[]=[];
  export let deletingId="";
  export let onopen:(document:ConversationDocument)=>void=()=>{};
  export let ondelete:(document:ConversationDocument)=>void=()=>{};
  export let onclose:()=>void=()=>{};
</script>

<section class="conversation-document-manager" aria-label={$t("conclusion.managerTitle")}>
  <header>
    <span><FileText size={18}/><strong>{$t("conclusion.managerTitle")}</strong><small>{$t("conclusion.managerCount",{count:documents.length})}</small></span>
    <button type="button" class="icon-button" aria-label={$t("common.close")} onclick={onclose}><X size={18}/></button>
  </header>
  {#if documents.length}
    <div class="conversation-document-list">
      {#each documents as document (document.collaborationId)}
        <article>
          <span><strong>{document.title}</strong><code title={document.relativePath}>{document.relativePath}</code><small>{$t("conclusion.managerSource",{id:document.collaborationId.slice(0,8),status:$t(`collaboration.${document.status}`)})}</small></span>
          <div>
            <button type="button" onclick={()=>onopen(document)}><Eye size={15}/>{$t("conclusion.view")}</button>
            <a href={workspaceFileDownloadHref(document.workspaceId,document.relativePath)??undefined} download={document.relativePath.split("/").at(-1)}><Download size={15}/>{$t("conclusion.download")}</a>
            <button type="button" class="danger" disabled={deletingId===document.collaborationId} onclick={()=>ondelete(document)}><Trash2 size={15}/>{deletingId===document.collaborationId?$t("conclusion.deleting"):$t("conclusion.delete")}</button>
          </div>
        </article>
      {/each}
    </div>
  {:else}
    <p>{$t("conclusion.managerEmpty")}</p>
  {/if}
</section>
