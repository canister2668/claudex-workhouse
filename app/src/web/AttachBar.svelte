<script lang="ts" context="module">
  export type Attachment = { path: string; name: string; size: number };
</script>

<script lang="ts">
  import { ChevronLeft, CloudDownload, Folder, LoaderCircle, Paperclip, X } from "@lucide/svelte";
  import { formatFileSize, locale, t } from "./i18n";

  export let attachments: Attachment[] = [];
  export let disabled = false;

  let input: HTMLInputElement;
  let uploading = false;
  let error = "";

  function clipboardName(file: File, index: number) {
    if (file.name && file.name !== "image.png") return file.name;
    const extension = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
    return `clipboard-${new Date().toISOString().replace(/[:.]/g, "-")}-${index + 1}.${extension}`;
  }

  async function uploadFiles(files: File[], fromClipboard = false) {
    const available = Math.max(0, 5 - attachments.length);
    if (!files.length || !available) { if (!available) error = $t("attachment.limit"); return false; }
    uploading = true; error = "";
    try {
      const form = new FormData();
      for (const [index, file] of files.slice(0, available).entries()) form.append("file", file, fromClipboard ? clipboardName(file, index) : file.name);
      const response = await fetch("/api/uploads", { method: "POST", body: form, headers: { "X-Claudex-Workhouse-Request": "1", Accept: "application/json" } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      attachments = [...attachments, ...(body.files ?? [])];
      return true;
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
    finally { uploading = false; }
    return false;
  }

  async function onFiles() {
    const files = Array.from(input.files ?? []);
    if (!files.length) return;
    await uploadFiles(files);
    input.value = "";
  }

  // A file already in the user's Drive is fetched by the server, so it never
  // passes through the browser's 90 MiB total multipart limit. Only what the user picks
  // here is imported — nothing reads the prompt.
  let protonOpen = false, protonBusy = false, protonError = "", protonPath = "";
  let protonFolders: string[] = [], protonFiles: Array<{ name: string; remotePath: string; size: number | null }> = [];

  async function loadProton(next = protonPath) {
    protonBusy = true; protonError = "";
    try {
      const response = await fetch(`/api/proton-drive/inbox?path=${encodeURIComponent(next)}`, { headers: { "X-Claudex-Workhouse-Request": "1", Accept: "application/json" } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.code === "PROTON_DISABLED" ? $t("proton.enableFirst") : body.error ?? `HTTP ${response.status}`);
      protonPath = next; protonFolders = body.folders ?? []; protonFiles = body.files ?? [];
    } catch (e) { protonError = e instanceof Error ? e.message : String(e); }
    finally { protonBusy = false; }
  }

  async function openProton() { protonOpen = true; await loadProton(""); }

  async function importProton(remotePath: string) {
    if (protonBusy || attachments.length >= 5) { if (attachments.length >= 5) protonError = $t("attachment.limit"); return; }
    protonBusy = true; protonError = "";
    try {
      const response = await fetch("/api/proton-drive/imports", {
        method: "POST",
        headers: { "X-Claudex-Workhouse-Request": "1", Accept: "application/json", "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ remotePath })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      attachments = [...attachments, body.attachment];
      protonOpen = false;
    } catch (e) { protonError = e instanceof Error ? e.message : String(e); }
    finally { protonBusy = false; }
  }

  export async function handlePaste(event: ClipboardEvent) {
    if (disabled || uploading) return false;
    const images = Array.from(event.clipboardData?.files ?? []).filter(file => file.type.startsWith("image/"));
    if (!images.length) return false;
    event.preventDefault();
    return uploadFiles(images, true);
  }
</script>

<button type="button" class="icon-button attach" onclick={() => input.click()} disabled={disabled || uploading} aria-label={$t("attachment.add")} title={$t("attachment.hint")}><Paperclip size={18}/></button>
<input bind:this={input} type="file" multiple accept="image/*,.txt,.md,.log,.json,.pdf,.csv,.html,.css,.js,.ts,.py,.sh,.yml,.yaml" hidden onchange={onFiles}/>
<button type="button" class="icon-button attach proton" onclick={openProton} disabled={disabled || uploading} aria-label={$t("proton.attach")} title={$t("proton.attach")}><CloudDownload size={18}/></button>
{#if protonOpen}
  <div class="modal-backdrop" role="presentation" onclick={(event)=>{if(event.target===event.currentTarget)protonOpen=false;}}>
    <div class="modal proton-picker" role="dialog" aria-modal="true" aria-labelledby="proton-picker-title">
      <header>
        <h2 id="proton-picker-title">{$t("proton.pickerTitle")}</h2>
        <button class="icon-button" aria-label={$t("a11y.closeDialog")} onclick={()=>protonOpen=false}><X size={20}/></button>
      </header>
      <p class="proton-picker-body">{$t("proton.pickerBody")}</p>
      <p class="proton-picker-path"><code>{protonPath || "/"}</code></p>
      {#if protonError}<p class="proton-picker-error" role="alert">{protonError}</p>{/if}
      {#if protonBusy}<p class="proton-picker-status"><LoaderCircle class="spin" size={16}/>{$t("proton.importing")}</p>{/if}
      <ul class="proton-picker-list">
        {#if protonPath}
          <li><button type="button" onclick={()=>loadProton(protonPath.split("/").slice(0,-1).join("/"))} disabled={protonBusy}><ChevronLeft size={15}/><span>{$t("proton.up")}</span></button></li>
        {/if}
        {#each protonFolders as folder (folder)}
          <li><button type="button" onclick={()=>loadProton(protonPath?`${protonPath}/${folder}`:folder)} disabled={protonBusy}><Folder size={15}/><span>{folder}</span></button></li>
        {/each}
        {#each protonFiles as file (file.remotePath)}
          <li><button type="button" class="file" onclick={()=>importProton(file.remotePath)} disabled={protonBusy}><CloudDownload size={15}/><span>{file.name}</span>{#if file.size!==null}<em>{formatFileSize(file.size,$locale)}</em>{/if}</button></li>
        {/each}
        {#if !protonBusy && !protonFolders.length && !protonFiles.length}<li class="empty">{$t("proton.empty")}</li>{/if}
      </ul>
    </div>
  </div>
{/if}
{#if attachments.length || uploading || error}
  <div class="attach-chips">
    {#each attachments as item, index}
      <span class="attach-chip"><code>{item.name}</code><em>{formatFileSize(item.size,$locale)}</em><button type="button" aria-label={$t("attachment.remove")} onclick={() => (attachments = attachments.filter((_, i) => i !== index))}><X size={13}/></button></span>
    {/each}
    {#if uploading}<span class="attach-status">{$t("attachment.uploading")}</span>{/if}
    {#if error}<span class="attach-status err">{error}</span>{/if}
  </div>
{/if}
