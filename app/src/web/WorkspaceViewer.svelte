<script lang="ts">
  import { providerDisplayName } from "./provider-display";
  import { AlertTriangle, ArrowLeft, ArrowLeftRight, ArrowUpDown, Clipboard, Columns2, Download, ExternalLink, File, Folder, GitCompare, Maximize2, Minimize2, MoreHorizontal, PanelLeft, Pencil, RotateCcw, Rows2, Save, Search, WrapText, X } from "@lucide/svelte";
  import { onMount, tick } from "svelte";
  import GitWorkspacePanel from "./GitWorkspacePanel.svelte";
  import HtmlPreview from "./HtmlPreview.svelte";
  import { formatFileSize, locale, t } from "./i18n";
  import { statusLabel } from "./session-ui";
  import { MAX_HTML_PREVIEW_BYTES } from "../server/workspace-limits.js";
  import { highlightCode, matchingBracketOffsets, positionedHighlightCode, type PositionedSyntaxToken, type SyntaxToken } from "./syntax-highlight";
  import { filterWorkspaceEntries, forgetWorkspaceDraft, lineChangeCount, rememberWorkspaceDraft, workspaceDraft, workspaceFileDownloadHref, workspaceLineDiff, type WorkspaceEditorSnapshot } from "./workspace-viewer-state";
  import { selectWorkspaceViewerLayout, type WorkspaceViewerLayout, type WorkspaceViewerLayoutState } from "./workspace-viewer-layout";

  export let api:(path:string,init?:RequestInit)=>Promise<any>;
  export let workspace:{id:string;displayName:string;hostId?:string;lastGitStatus?:any};
  export let initialFile:{path:string;pathBase:"workspace"|"task-cwd";sourceTaskId?:string;line?:number}|null=null;
  export let initialEdit=false;
  export let sourceTaskId:string|null=null;
  export let relatedSessions:Array<{id:string;provider:"codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok";title:string;status:string;updatedAt:string}>=[];
  export let onopensession:(task:{id:string})=>void=()=>{};
  export let onlayoutchange:(state:WorkspaceViewerLayoutState)=>void=()=>{};
  export let onclose:()=>void;

  type Entry={id:string;name:string;type:"directory"|"file"|"other";size:number|null;modifiedAt:string;sensitive:boolean;relativePath?:string};
  type Mode="view"|"edit"|"compare"|"conflict";
  let dialog:HTMLDialogElement,editorTextarea:HTMLTextAreaElement,editorBackdrop:HTMLPreElement,searchInput:HTMLInputElement;
  let listing:any=null,stack:string[]=[],active:Entry|null=null,file:any=null,diff="",diffHasChanges=false,diffRequest=0,loading=false,saving=false,error="",search="",section:"files"|"git"="files",mode:Mode="view",compareReturnMode:"view"|"edit"="view",contentTab:"source"|"preview"="source";
  let fileToolsOpen=typeof window!=="undefined"&&window.matchMedia("(min-width:1181px)").matches;
  let visibleEntries:Entry[]=[],highlightedLines:SyntaxToken[][]=[],editorHighlightedLines:PositionedSyntaxToken[][]=[],matchingBrackets=new Set<number>(),base:WorkspaceEditorSnapshot|null=null,draft="",latest:WorkspaceEditorSnapshot|null=null,mergeLatest:WorkspaceEditorSnapshot|null=null,conflictTab:"base"|"latest"|"draft"="latest",sessionPicker=false,searchOpen=false,fileListCollapsed=false,windowFileListCollapsed=false,lineWrap=false,dirty=false,htmlPreviewAvailable=false,referencedLine:number|null=null,cursorOffset=0,cursorLine=1,cursorColumn=1,selectionLength=0,locationLabel=".";
  let layoutState:WorkspaceViewerLayoutState={layout:"window",reversed:false};
  $: visibleEntries=filterWorkspaceEntries((listing?.entries??[]) as Entry[],search,$locale);
  $: highlightedLines=highlightCode(String(file?.content??""));
  $: editorHighlightedLines=positionedHighlightCode(draft);
  $: matchingBrackets=new Set(matchingBracketOffsets(draft,cursorOffset,editorHighlightedLines));
  $: dirty=Boolean(base&&draft!==base.content);
  $: locationLabel=section==="files"?(active?.relativePath??file?.relativePath??listing?.current?.relativePath??"."):$t("git.title");
  $: downloadHref=workspaceFileDownloadHref(workspace.id,file?.relativePath??active?.relativePath);
  $: htmlPreviewAvailable=Boolean(active&&active.type==="file"&&(active.size??0)<=MAX_HTML_PREVIEW_BYTES&&/\.html?$/i.test(active.relativePath??active.name)&&(workspace.hostId??"local")==="local"&&!file?.binary);
  $: orderedSessions=[...relatedSessions].sort((left,right)=>Number(right.id===sourceTaskId)-Number(left.id===sourceTaskId)||right.updatedAt.localeCompare(left.updatedAt));
  $: activeSessionCount=relatedSessions.filter(item=>["pending","queued","running","waiting","unknown"].includes(item.status)).length;

  const uuid=()=>crypto.randomUUID();
  const message=(value:unknown)=>value instanceof Error?value.message:String(value);
  const code=(value:unknown)=>(value as any)?.code;

  function remember(){if(base&&dirty)rememberWorkspaceDraft(workspace.id,{base,content:draft});}
  function forget(){if(base)forgetWorkspaceDraft(workspace.id,base.relativePath);}
  function discardPrompt(){return !dirty||confirm($t("workspace.editorDiscardConfirm"));}
  function resetEditor(clearDraft=true){diffRequest+=1;if(clearDraft)forget();mode="view";compareReturnMode="view";base=null;draft="";latest=null;mergeLatest=null;diff="";diffHasChanges=false;referencedLine=null;cursorOffset=0;cursorLine=1;cursorColumn=1;selectionLength=0;}
  function setDraft(value:string){draft=value;if(base&&value!==base.content)rememberWorkspaceDraft(workspace.id,{base,content:value});else if(base)forgetWorkspaceDraft(workspace.id,base.relativePath);}
  function updateEditorCursor(){
    if(!editorTextarea)return;
    const start=editorTextarea.selectionStart??0,end=editorTextarea.selectionEnd??start,before=draft.slice(0,start),lineStart=before.lastIndexOf("\n");
    cursorOffset=start;cursorLine=before.split("\n").length;cursorColumn=start-lineStart;selectionLength=Math.max(0,end-start);
  }
  function syncEditorScroll(){if(!editorTextarea||!editorBackdrop)return;editorBackdrop.scrollTop=editorTextarea.scrollTop;editorBackdrop.scrollLeft=editorTextarea.scrollLeft;}
  function editorInput(event:Event){setDraft((event.currentTarget as HTMLTextAreaElement).value);requestAnimationFrame(()=>{updateEditorCursor();syncEditorScroll();});}
  function editorActivity(){requestAnimationFrame(updateEditorCursor);}
  async function editorReady(){await tick();updateEditorCursor();syncEditorScroll();}

  async function browse(entryId?:string,push=true){
    if(!discardPrompt())return;resetEditor();loading=true;error="";
    try{const params=new URLSearchParams();if(entryId)params.set("entryId",entryId);const next=await api(`/api/workspaces/${workspace.id}/files${params.size?`?${params}`:""}`);if(push&&listing)stack.push(listing.current.id);listing=next;active=null;file=null;diff="";}
    catch(value){error=message(value);}finally{loading=false;}
  }
  async function back(){const id=stack.at(-1);if(!id||!discardPrompt())return;stack.pop();resetEditor();await browse(id,false);}
  async function resolveFile(path:string,pathBase:"workspace"|"task-cwd"="workspace",taskId?:string){return api(`/api/workspaces/${workspace.id}/files/resolve`,{method:"POST",body:JSON.stringify({path,pathBase,...(taskId?{sourceTaskId:taskId}:{})})});}
  async function read(item:Entry,confirmSensitive=false,skipGuard=false){
    if(!skipGuard&&!discardPrompt())return;if(!skipGuard)resetEditor();if(active?.id!==item.id)contentTab="source";active=item;diff="";loading=true;error="";
    try{file=await api(`/api/workspaces/${workspace.id}/files/read`,{method:"POST",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({fileId:item.id,offset:0,limit:131072,confirmSensitive})});}
    catch(value){error=message(value);}finally{loading=false;}
  }
  async function openPath(path:string,pathBase:"workspace"|"task-cwd"="workspace",taskId?:string){
    if(!discardPrompt())return;resetEditor();const html=/\.html?$/i.test(path);fileListCollapsed=html;loading=true;error="";section="files";
    try{const resolved=await resolveFile(path,pathBase,taskId);await read(resolved.entry,false,true);contentTab=html?"preview":"source";}
    catch(value){error=message(value);}finally{loading=false;}
  }
  async function readMore(){if(!active||file?.nextOffset==null)return;loading=true;try{const next=await api(`/api/workspaces/${workspace.id}/files/read`,{method:"POST",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({fileId:active.id,offset:file.nextOffset,limit:131072,confirmSensitive:Boolean(file.sensitive)})});file={...next,content:String(file.content??"")+String(next.content??""),offset:0};}catch(value){error=message(value)}finally{loading=false;}}
  async function editableSnapshot(relativePath:string){const resolved=await resolveFile(relativePath);return api(`/api/workspaces/${workspace.id}/files/edit/read`,{method:"POST",body:JSON.stringify({fileId:resolved.entry.id})}) as Promise<WorkspaceEditorSnapshot>;}
  async function startEdit(){
    if(!active||active.sensitive)return;loading=true;error="";
    try{
      diff="";
      const relative=active.relativePath??file?.relativePath;if(!relative)throw new Error($t("workspace.editorPathUnavailable"));
      const current=await editableSnapshot(relative),stored=workspaceDraft(workspace.id,current.relativePath);
      if(stored&&stored.content!==stored.base.content){base=stored.base;draft=stored.content;if(stored.base.revision!==current.revision){latest=current;mode="conflict";}else mode="edit";}
      else{base=current;draft=current.content;mode="edit";}
      await editorReady();
    }catch(value){error=message(value);}finally{loading=false;}
  }
  async function save(expectedCurrentRevision?:string){
    if(!base||saving)return;saving=true;error="";
    try{
      const resolved=await resolveFile(base.relativePath),result=await api(`/api/workspaces/${workspace.id}/files/write`,{method:"PUT",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({fileId:resolved.entry.id,content:draft,expectedRevision:base.revision,...(expectedCurrentRevision?{expectedCurrentRevision}:{})})});
      if(result.status)workspace.lastGitStatus=result.status;
      const saved=await editableSnapshot(base.relativePath);forgetWorkspaceDraft(workspace.id,base.relativePath);base=saved;draft=saved.content;latest=null;mergeLatest=null;mode="view";active=resolved.entry;await read(resolved.entry,false,true);
    }catch(value){
      if(code(value)==="FILE_VERSION_CONFLICT"){
        try{latest=await editableSnapshot(base.relativePath);conflictTab="latest";mode="conflict";remember();}catch(refreshError){error=message(refreshError);}
      }else error=message(value);
    }finally{saving=false;}
  }
  function useLatest(){if(!latest)return;forget();base=latest;draft=latest.content;latest=null;mergeLatest=null;mode="edit";void editorReady();}
  function manualMerge(){if(!latest)return;mergeLatest=latest;mode="edit";void editorReady();}
  function cancelEdit(){if(!discardPrompt())return;resetEditor();}
  function showViewer(){diffRequest+=1;loading=false;mode="view";compareReturnMode="view";diff="";}
  async function showEditor(){diffRequest+=1;loading=false;if(base){mode="edit";compareReturnMode="edit";diff="";await editorReady();}else await startEdit();}
  async function showDiff(item:Entry){
    searchOpen=false;search="";error="";
    if(mode==="compare"){
      diffRequest+=1;loading=false;
      mode=compareReturnMode;diff="";diffHasChanges=false;
      if(mode==="edit")await editorReady();
      return;
    }
    compareReturnMode=mode==="edit"?"edit":"view";
    // A session changed-file opens directly in the editor. Until the person
    // changes that draft, comparing it with its own freshly loaded base would
    // always be empty and hide the real Git change that brought them here.
    // Use the local draft comparison only once there is an unsaved edit;
    // otherwise compare the working-tree file with Git.
    if(base&&dirty){diff=workspaceLineDiff(base.content,draft);diffHasChanges=Boolean(diff);if(!diff)diff=$t("workspace.noChanges");mode="compare";return;}
    const request=++diffRequest;loading=true;mode="compare";diff=$t("common.loading");diffHasChanges=false;
    try{const data=await api(`/api/workspaces/${workspace.id}/git-diff`,{method:"POST",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({fileId:item.id})});if(request!==diffRequest)return;diff=String(data.diff??"");diffHasChanges=Boolean(diff);if(!diff)diff=$t("workspace.noChanges");}
    catch(value){if(request===diffRequest)error=message(value)}finally{if(request===diffRequest)loading=false;}
  }
  async function copyPath(){const relative=active?.relativePath??file?.relativePath;if(relative)await navigator.clipboard.writeText(relative);}
  async function toggleSearch(){searchOpen=!searchOpen;if(!searchOpen){search="";return;}await tick();searchInput?.focus();searchInput?.select();}
  function searchKeydown(event:KeyboardEvent){if(event.key!=="Escape")return;event.preventDefault();event.stopPropagation();searchOpen=false;search="";}
  function chooseSection(next:"files"|"git"){if(next===section)return;if(!discardPrompt())return;resetEditor();searchOpen=false;search="";section=next;}
  function chooseLayout(next:WorkspaceViewerLayout){
    const previous=layoutState,nextState=selectWorkspaceViewerLayout(previous,next);
    if(nextState===previous)return;
    if(previous.layout==="window")windowFileListCollapsed=fileListCollapsed;
    if(nextState.layout==="window")fileListCollapsed=windowFileListCollapsed;
    else if(previous.layout!==nextState.layout)fileListCollapsed=true;
    layoutState=nextState;onlayoutchange(layoutState);
  }
  function close(){if(!discardPrompt())return;resetEditor();if(dialog.open)dialog.close();else onclose();}
  function openSession(task:{id:string}){remember();if(dialog.open)dialog.close();onopensession(task);}
  function keydown(event:KeyboardEvent){if(event.key==="Tab"){event.preventDefault();const target=event.currentTarget as HTMLTextAreaElement,start=target.selectionStart,end=target.selectionEnd,next=`${draft.slice(0,start)}  ${draft.slice(end)}`;setDraft(next);requestAnimationFrame(()=>{target.selectionStart=target.selectionEnd=start+2;updateEditorCursor();syncEditorScroll();});}}
  function viewerKeydown(event:KeyboardEvent){if(event.key!=="Escape"||!dialog?.open)return;event.preventDefault();close();}

  onMount(()=>{
    const expandedToolsQuery=window.matchMedia("(min-width:1181px)"),syncTools=()=>fileToolsOpen=expandedToolsQuery.matches;
    const syncViewport=()=>dialog.style.setProperty("--viewer-vh",`${Math.round(window.visualViewport?.height??window.innerHeight)}px`);
    dialog.show();syncTools();syncViewport();expandedToolsQuery.addEventListener("change",syncTools);window.visualViewport?.addEventListener("resize",syncViewport);window.visualViewport?.addEventListener("scroll",syncViewport);
    void (async()=>{await browse(undefined,false);if(initialFile){await openPath(initialFile.path,initialFile.pathBase,initialFile.sourceTaskId);if(initialFile.line&&!file?.binary){referencedLine=initialFile.line;await tick();dialog.querySelector(`[data-code-line="${initialFile.line}"]`)?.scrollIntoView({block:"center"});}if(initialEdit&&active&&!active.sensitive&&!file?.binary&&(active.size??0)<=262144)await startEdit();}})();
    return()=>{expandedToolsQuery.removeEventListener("change",syncTools);window.visualViewport?.removeEventListener("resize",syncViewport);window.visualViewport?.removeEventListener("scroll",syncViewport);if(dialog.open)dialog.close();};
  });
</script>

<svelte:window onkeydown={viewerKeydown}/>

{#snippet draftEditor()}
  <div class="editor-shell" class:wrap-lines={lineWrap}>
    <pre class="editor-backdrop" bind:this={editorBackdrop} aria-hidden="true">{#each editorHighlightedLines as line,index}<span class:cursor-line={cursorLine===index+1}><i>{index+1}</i><code>{#each line as token}<b class={token.kind} class:matching-bracket={matchingBrackets.has(token.offset)}>{token.text}</b>{/each}</code></span>{/each}</pre>
    <textarea bind:this={editorTextarea} class="editor editor-input" value={draft} oninput={editorInput} onkeydown={keydown} onkeyup={editorActivity} onclick={editorActivity} onselect={editorActivity} onscroll={syncEditorScroll} spellcheck="false" autocapitalize="off" autocomplete="off" wrap={lineWrap?"soft":"off"} aria-label={active?.name??"Code editor"}></textarea>
  </div>
{/snippet}

<dialog bind:this={dialog} class="viewer-dialog layout-{layoutState.layout}" class:layout-reversed={layoutState.reversed} onclose={onclose} oncancel={(event)=>{event.preventDefault();close();}} onclick={(event)=>layoutState.layout==="window"&&event.target===event.currentTarget&&close()}>
  <div class="viewer" class:html-preview-open={contentTab==="preview"&&htmlPreviewAvailable} role="dialog" aria-modal={layoutState.layout==="window"||layoutState.layout==="fullscreen"} aria-labelledby="viewer-title">
    <header>
      {#if section==="files"&&stack.length&&mode==="view"}<button aria-label={$t("common.back")} onclick={back}><ArrowLeft size={18}/></button>{/if}
      <span class="viewer-location"><h2 id="viewer-title">{workspace.displayName}</h2>{#if searchOpen}<label class="header-search"><Search size={15}/><input bind:this={searchInput} type="search" bind:value={search} placeholder={$t("workspace.fileSearch")} aria-label={$t("workspace.fileSearch")} onkeydown={searchKeydown}/></label>{:else}<small title={locationLabel}>{locationLabel}</small>{/if}</span>
      {#if activeSessionCount}<em class="active-session"><AlertTriangle size={14}/>{$t("workspace.editorActiveSessions",{count:activeSessionCount})}</em>{/if}
      {#if orderedSessions.length}<button class="session-button" onclick={()=>sessionPicker=!sessionPicker}><ExternalLink size={16}/>{$t("workspace.relatedSessions")}</button>{/if}
      {#if section==="files"}<button class="header-search-toggle" class:active={searchOpen} aria-label={$t("common.search")} aria-expanded={searchOpen} onclick={toggleSearch}><Search size={16}/><span>{$t("common.search")}</span></button>{/if}
      <nav class="viewer-tabs" aria-label={$t("workspace.viewTabs")}><button class:active={section==="files"} onclick={()=>chooseSection("files")}>{$t("workspace.files")}</button><button class:active={section==="git"} onclick={()=>chooseSection("git")}>{$t("git.title")}</button></nav>
      {#if section==="files"&&layoutState.layout!=="window"}<button class="viewer-tree-toggle" class:active={!fileListCollapsed} aria-label={$t(fileListCollapsed?"workspace.expandFileList":"workspace.collapseFileList")} title={$t(fileListCollapsed?"workspace.expandFileList":"workspace.collapseFileList")} aria-pressed={!fileListCollapsed} onclick={()=>fileListCollapsed=!fileListCollapsed}><PanelLeft size={17}/></button>{/if}
      <nav class="viewer-layout-controls" aria-label={$t("workspace.viewerLayout")}>
        <button class:active={layoutState.layout==="window"} aria-label={$t("workspace.layoutWindow")} title={$t("workspace.layoutWindow")} aria-pressed={layoutState.layout==="window"} onclick={()=>chooseLayout("window")}><Minimize2 size={17}/></button>
        <button class:active={layoutState.layout==="columns"} aria-label={$t(layoutState.layout==="columns"?"workspace.reverseColumns":"workspace.layoutColumns")} title={$t(layoutState.layout==="columns"?"workspace.reverseColumns":"workspace.layoutColumns")} aria-pressed={layoutState.layout==="columns"} onclick={()=>chooseLayout("columns")}>{#if layoutState.layout==="columns"}<ArrowLeftRight size={17}/>{:else}<Columns2 size={17}/>{/if}</button>
        <button class:active={layoutState.layout==="rows"} aria-label={$t(layoutState.layout==="rows"?"workspace.reverseRows":"workspace.layoutRows")} title={$t(layoutState.layout==="rows"?"workspace.reverseRows":"workspace.layoutRows")} aria-pressed={layoutState.layout==="rows"} onclick={()=>chooseLayout("rows")}>{#if layoutState.layout==="rows"}<ArrowUpDown size={17}/>{:else}<Rows2 size={17}/>{/if}</button>
        <button class:active={layoutState.layout==="fullscreen"} aria-label={$t("workspace.layoutFullscreen")} title={$t("workspace.layoutFullscreen")} aria-pressed={layoutState.layout==="fullscreen"} onclick={()=>chooseLayout("fullscreen")}><Maximize2 size={17}/></button>
      </nav>
      <button aria-label={$t("a11y.closeDialog")} onclick={close}><X size={20}/></button>
    </header>
    {#if sessionPicker}<div class="session-picker">{#each orderedSessions as task}<button onclick={()=>openSession(task)}><strong>{providerDisplayName(task.provider)} · {task.title}</strong><small>{statusLabel(task.status)}{task.id===sourceTaskId?` · ${$t("workspace.sourceSession")}`:""}</small></button>{/each}</div>{/if}
    {#if section==="git"}<div class="git-area"><GitWorkspacePanel {api} {workspace} onopenfile={(path)=>openPath(path)}/></div>
    {:else}
      <div class="viewer-body" class:editing={mode!=="view"} class:file-list-collapsed={fileListCollapsed}>
        <nav aria-label={$t("workspace.fileList")}>{#each visibleEntries as item (item.id)}<button class:active={active?.id===item.id} class:folder={item.type==="directory"} class:file={item.type==="file"} title={item.name} onclick={()=>item.type==="directory"?browse(item.id):item.type==="file"&&read(item)}>{#if item.type==="directory"}<Folder size={18}/>{:else}<File size={18}/>{/if}<span><strong>{item.name}</strong><small>{item.type==="file"?formatFileSize(item.size??0,$locale):$t("workspace.folder")}</small></span></button>{/each}{#if loading&&!listing}<p>{$t("common.loading")}</p>{/if}</nav>
        <main>
          {#if active}{@const selectedFile=active}
            <div class="file-heading">
              <strong title={selectedFile.name}>{selectedFile.name}</strong>
              <span class="file-primary-actions">
                {#if dirty}<em>{$t("workspace.editorUnsaved")}</em>{/if}
                <button class:active={!fileListCollapsed} aria-pressed={!fileListCollapsed} onclick={()=>fileListCollapsed=!fileListCollapsed}><PanelLeft size={15}/>{$t("workspace.fileList")}</button>
                {#if mode!=="conflict"&&!selectedFile.sensitive&&!file?.binary&&(selectedFile.size??0)<=262144}<button class:active={mode==="edit"} aria-pressed={mode==="edit"} onclick={showEditor}><Pencil size={15}/>{$t("workspace.editor")}</button>{/if}
                <details class="file-more" bind:open={fileToolsOpen}>
                  <summary aria-label={$t("nav.moreActions")} title={$t("nav.moreActions")}><MoreHorizontal size={17}/><span>{$t("nav.moreActions")}</span></summary>
                  <div class="file-more-sheet">
                    <strong>{$t("nav.moreActions")}</strong>
                    <button class:active={lineWrap} aria-pressed={lineWrap} aria-label={$t("workspace.lineWrap")} title={$t("workspace.lineWrap")} onclick={()=>lineWrap=!lineWrap}><WrapText size={15}/>{$t("workspace.lineWrap")}</button>
                    <button onclick={copyPath}><Clipboard size={15}/>{$t("workspace.copyPath")}</button>
                    {#if mode!=="conflict"}<button class:active={mode==="view"} aria-pressed={mode==="view"} onclick={showViewer}><File size={15}/>{$t("workspace.viewer")}</button>{#if !selectedFile.sensitive&&!file?.binary&&(selectedFile.size??0)<=262144}<button class:active={mode==="compare"} aria-pressed={mode==="compare"} onclick={()=>showDiff(selectedFile)}><GitCompare size={15}/>{$t("workspace.diff")}</button>{/if}{/if}
                    {#if mode==="view"&&downloadHref}<a class="file-action" href={downloadHref} download={selectedFile.name}><Download size={15}/>{$t("attachment.download")}</a>{/if}
                  </div>
                </details>
              </span>
            </div>
          {/if}
          {#if mode==="view"&&htmlPreviewAvailable}<nav class="html-tabs" aria-label={$t("htmlPreview.controls")}><button class:active={contentTab==="source"} aria-pressed={contentTab==="source"} onclick={()=>contentTab="source"}>{$t("htmlPreview.source")}</button><button class:active={contentTab==="preview"} aria-pressed={contentTab==="preview"} onclick={()=>{contentTab="preview";fileListCollapsed=true;}}>{$t("htmlPreview.preview")}</button></nav>{/if}
          {#if mode==="edit"&&base}
            <div class="editor-actions"><span class="editor-position">{$t("workspace.editorPosition",{line:cursorLine,column:cursorColumn})}{#if selectionLength} · ↔ {selectionLength}{/if}</span><button onclick={cancelEdit}><RotateCcw size={15}/>{$t("common.cancel")}</button><button class="primary" disabled={!dirty||saving} onclick={()=>save()}><Save size={15}/>{saving?$t("common.saving"):$t("common.save")}</button></div>
            {#if mergeLatest}<div class="merge-grid"><section><strong>{$t("workspace.editorLatest")}</strong><pre>{mergeLatest.content}</pre></section><section><strong>{$t("workspace.editorMine")}</strong>{@render draftEditor()}</section></div>
            {:else}{@render draftEditor()}{/if}
          {:else if mode==="compare"}
            {#if base}<div class="editor-actions"><span class="editor-position">{$t("workspace.editorChangedLines",{count:lineChangeCount(base.content,draft)})}</span><button onclick={cancelEdit}><RotateCcw size={15}/>{$t("common.cancel")}</button><button class="primary" disabled={!dirty||saving} onclick={()=>save()}><Save size={15}/>{saving?$t("common.saving"):$t("common.save")}</button></div>{/if}
            <section class="diff-shell" aria-label={$t("workspace.diff")}>
              <header><strong><GitCompare size={15}/>{$t("workspace.diff")}</strong><span class="diff-legend removed">− {$t("workspace.diffRemoved")}</span><span class="diff-legend added">+ {$t("workspace.diffAdded")}</span></header>
              {#if diffHasChanges}<pre class="diff">{#each diff.split("\n") as line}<span class:added={line.startsWith("+")&&!line.startsWith("+++")} class:removed={line.startsWith("-")&&!line.startsWith("---")} class:hunk={line.startsWith("@@")} class:metadata={line.startsWith("+++")||line.startsWith("---")}>{line}{"\n"}</span>{/each}</pre>{:else}<div class="diff-empty"><GitCompare size={24}/><strong>{diff}</strong></div>{/if}
            </section>
          {:else if mode==="conflict"&&base&&latest}{@const currentLatest=latest}
            <section class="conflict-editor"><header><AlertTriangle size={20}/><span><strong>{$t("workspace.editorConflictTitle")}</strong><small>{$t("workspace.editorConflictBody")}</small></span></header><div class="conflict-summary"><span>{$t("workspace.editorLatestChanged",{count:lineChangeCount(base.content,currentLatest.content)})}</span><span>{$t("workspace.editorMineChanged",{count:lineChangeCount(base.content,draft)})}</span></div><nav><button class:active={conflictTab==="base"} onclick={()=>conflictTab="base"}>{$t("workspace.editorBase")}</button><button class:active={conflictTab==="latest"} onclick={()=>conflictTab="latest"}>{$t("workspace.editorLatest")}</button><button class:active={conflictTab==="draft"} onclick={()=>conflictTab="draft"}>{$t("workspace.editorMine")}</button></nav><pre>{conflictTab==="base"?base.content:conflictTab==="latest"?currentLatest.content:draft}</pre><footer><button onclick={useLatest}>{$t("workspace.editorUseLatest")}</button><button onclick={manualMerge}>{$t("workspace.editorManualMerge")}</button>{#if orderedSessions.length}<button onclick={()=>sessionPicker=true}><ExternalLink size={15}/>{$t("workspace.relatedSessions")}</button>{/if}<button class="danger" disabled={saving} onclick={()=>save(currentLatest.revision)}>{$t("workspace.editorOverwriteMine")}</button></footer></section>
          {:else if contentTab==="preview"&&htmlPreviewAvailable&&active}<HtmlPreview {api} workspaceId={workspace.id} file={{id:active.id,name:active.name,sensitive:active.sensitive}}/>
          {:else if file?.requiresConfirmation}<div class="sensitive"><strong>{$t("workspace.sensitive")}</strong><p>{$t("workspace.sensitiveBody")}</p><button onclick={()=>active&&read(active,true)}>{$t("workspace.openSensitive")}</button></div>
          {:else if file?.binary}<div class="empty">{$t("workspace.binary")}</div>
          {:else if file?.content!==undefined&&file?.content!==null}<pre class="code" class:wrap-lines={lineWrap}>{#each highlightedLines as line,index}<span data-code-line={index+1} class:referenced-line={referencedLine===index+1}><i>{index+1}</i><code>{#each line as token}<b class={token.kind}>{token.text}</b>{/each}</code></span>{/each}</pre>{#if file.nextOffset!==null}<button class="more" disabled={loading} onclick={readMore}>{$t("workspace.loadNext")}</button>{/if}
          {:else}<div class="empty">{$t("workspace.selectFile")}</div>{/if}
        </main>
      </div>
    {/if}
    {#if error}<p class="viewer-error">{error}</p>{/if}
  </div>
</dialog>

<style>
  .viewer-dialog{width:100%;max-width:none;height:100%;max-height:none;margin:0;padding:1rem;border:0;background:transparent;color:var(--text)}.viewer-dialog[open]{display:grid;place-items:center}.viewer-dialog::backdrop{background:#0009}.viewer{width:min(1120px,100%);height:min(800px,calc(100dvh - 2rem));background:var(--panel);border:1px solid var(--line);border-radius:18px;display:flex;flex-direction:column;overflow:hidden;box-shadow:var(--shadow-lg)}.viewer.html-preview-open{width:min(1480px,100%);height:calc(100dvh - 2rem)}.viewer>header,.file-heading,.editor-actions{display:flex;align-items:center}.viewer>header{flex:none;gap:.55rem;padding:.7rem;border-bottom:1px solid var(--line)}.viewer-location{display:grid;min-width:0;flex:1;gap:.12rem}.viewer-location>small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.viewer h2{margin:0;font-size:1rem}.viewer small{color:var(--muted)}.viewer button,.file-action{display:inline-flex;align-items:center;gap:.35rem;min-height:40px}.header-search{display:flex;align-items:center;gap:.4rem;width:min(560px,100%);min-height:30px;padding:0 .55rem;border:1px solid var(--line-strong);border-radius:8px;background:var(--bg);color:var(--muted)}.header-search input{min-width:0;flex:1;border:0;outline:0;background:transparent;color:var(--text);font:inherit}.header-search-toggle.active{border-color:var(--blue);background:color-mix(in srgb,var(--blue) 12%,var(--surface))}.active-session{display:inline-flex;align-items:center;gap:.25rem;color:var(--warn);font-size:.72rem;font-style:normal}.session-button{white-space:nowrap}.session-picker{display:flex;flex:none;gap:.35rem;padding:.45rem;overflow:auto;border-bottom:1px solid var(--line);background:var(--surface-2)}.session-picker button{min-width:190px;display:grid;text-align:left}.session-picker strong,.session-picker small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.viewer-body{display:grid;grid-template-columns:280px 1fr;min-height:0;flex:1}.viewer-body.file-list-collapsed{grid-template-columns:0 minmax(0,1fr)}.viewer-body.file-list-collapsed>nav{visibility:hidden;padding:0;border:0;overflow:hidden}.viewer-body>nav{display:flex;flex-direction:column;gap:.2rem;border-right:1px solid var(--line);overflow:auto;padding:.45rem;background:var(--surface-2)}.viewer-body>nav>button{width:100%;min-height:52px;padding:.4rem .5rem;flex:none;text-align:left;border:1px solid transparent;background:var(--surface);color:var(--text);border-radius:9px}.viewer-body>nav>button:hover{border-color:var(--line-strong);background:var(--surface-3)}.viewer-body>nav>button.active{border-color:var(--accent);background:var(--accent-soft);box-shadow:inset 3px 0 0 var(--accent)}.viewer-body>nav>button.folder{background:color-mix(in srgb,var(--accent) 7%,var(--surface))}.viewer-body>nav>button.folder :global(svg){color:var(--accent-strong)}.viewer-body>nav>button.file :global(svg){color:var(--blue)}.viewer-body>nav span{display:grid;min-width:0;gap:.1rem}.viewer-body>nav strong{font-size:.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.viewer main{min-width:0;overflow:auto;padding:.6rem;background:var(--panel);display:flex;flex-direction:column}.file-heading{justify-content:space-between;gap:.5rem;position:sticky;top:0;z-index:2;background:var(--panel);padding-bottom:.5rem}.file-heading>span{display:flex;gap:.3rem;align-items:center}.file-heading>span>button,.file-more summary,.file-more-sheet>button,.file-action{box-sizing:border-box;align-items:center;justify-content:center;padding:0 .7rem;border:1px solid var(--line-strong);border-radius:8px;background:var(--surface-3);color:var(--text);font-family:inherit;font-size:.78rem;font-weight:700;line-height:1.2;text-decoration:none;white-space:nowrap}.file-heading>span>button:hover,.file-more-sheet>button:hover{border-color:var(--accent);background:var(--surface-2)}.file-heading>span>button.active,.file-more-sheet>button.active{border-color:var(--accent);background:var(--accent-soft);color:var(--accent-strong);box-shadow:inset 0 -3px 0 var(--accent)}.file-action{border-color:var(--accent);background:var(--accent);color:var(--on-accent)}.file-action:hover{border-color:var(--accent-strong);background:var(--accent-strong);color:var(--on-accent)}.file-heading>span>button :global(svg),.file-action :global(svg){flex:none}.file-heading em{color:var(--warn);font-size:.72rem}.file-more{display:contents}.file-more>summary{display:none;list-style:none}.file-more>summary::-webkit-details-marker{display:none}.file-more-sheet{display:contents}.file-more-sheet>strong{display:none}.code,.diff,.conflict-editor pre,.merge-grid pre{margin:0;font:12px/1.55 ui-monospace,SFMono-Regular,monospace;white-space:pre;overflow:auto}.code>span{display:grid;grid-template-columns:3.5rem 1fr}.code i{font-style:normal;color:var(--muted);text-align:right;padding-right:.8rem;user-select:none}.code code{white-space:pre}.code b{font:inherit}.more{margin:.75rem auto}.sensitive,.empty{padding:1rem;border:1px solid var(--line);border-radius:10px}.viewer-error{flex:none;color:var(--danger);padding:0 .7rem}.viewer-tabs{display:flex!important;gap:.25rem}.viewer-tabs button{border:1px solid var(--line)}.viewer-tabs button.active{border-color:var(--accent)}.git-area{min-height:0;flex:1;overflow:auto}.editor-actions{justify-content:flex-end;gap:.4rem;margin-bottom:.45rem}.editor{width:100%;min-height:0;flex:1;resize:none;border:1px solid var(--line-strong);border-radius:8px;background:var(--bg);color:var(--text);padding:.75rem;font:13px/1.55 ui-monospace,SFMono-Regular,monospace;tab-size:2}.merge-grid{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;min-height:0;flex:1}.merge-grid section{display:grid;grid-template-rows:auto 1fr;min-height:0;gap:.25rem}.merge-grid pre,.merge-grid textarea{min-height:0;margin:0;padding:.6rem;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text);overflow:auto;font:12px/1.55 ui-monospace,SFMono-Regular,monospace;white-space:pre}.merge-grid textarea{resize:none}.conflict-editor{display:grid;grid-template-rows:auto auto auto minmax(0,1fr) auto;min-height:0;flex:1;gap:.45rem}.conflict-editor>header,.conflict-editor footer,.conflict-editor nav,.conflict-summary{display:flex;align-items:center;gap:.4rem;flex-wrap:wrap}.conflict-editor>header{color:var(--warn)}.conflict-editor>header span{display:grid}.conflict-summary span{padding:.25rem .45rem;border-radius:999px;background:var(--surface-2);font-size:.75rem}.conflict-editor nav button.active{border-color:var(--accent)}.conflict-editor pre{padding:.6rem;border:1px solid var(--line);border-radius:8px;background:var(--bg)}.conflict-editor footer{justify-content:flex-end}
  .diff-shell{display:flex;min-width:0;min-height:0;flex:1;flex-direction:column;overflow:hidden;border:1px solid var(--line-strong);border-radius:10px;background:var(--syntax-bg);box-shadow:inset 0 1px 0 color-mix(in srgb,var(--text) 5%,transparent)}
  .diff-shell>header{display:flex;align-items:center;gap:.45rem;min-height:42px;padding:.35rem .65rem;border-bottom:1px solid var(--line-strong);background:var(--surface-2)}.diff-shell>header strong{display:inline-flex;align-items:center;gap:.35rem;margin-right:auto}.diff-legend{padding:.2rem .5rem;border:1px solid currentColor;border-radius:999px;font-size:.72rem;font-weight:750}.diff-legend.added{background:var(--diff-add-bg);color:var(--diff-add-fg)}.diff-legend.removed{background:var(--diff-del-bg);color:var(--diff-del-fg)}
  .diff-shell>.diff{min-height:0;flex:1;padding:.35rem 0;background:var(--syntax-bg);color:var(--syntax-fg)}.diff>span{display:block;box-sizing:border-box;width:max-content;min-width:100%;min-height:1.55em;padding:0 .75rem;border-left:4px solid transparent}.diff>span.added{border-left-color:var(--diff-add-fg);background:color-mix(in srgb,var(--diff-add-bg) 78%,var(--syntax-bg));color:var(--diff-add-fg);font-weight:650}.diff>span.removed{border-left-color:var(--diff-del-fg);background:color-mix(in srgb,var(--diff-del-bg) 78%,var(--syntax-bg));color:var(--diff-del-fg);font-weight:650}.diff>span.hunk{border-block:1px solid color-mix(in srgb,var(--blue) 40%,var(--line));background:color-mix(in srgb,var(--blue) 13%,var(--syntax-bg));color:var(--blue);font-weight:700}.diff>span.metadata{color:var(--muted);font-weight:700}.diff-empty{display:grid;place-content:center;justify-items:center;gap:.55rem;min-height:180px;flex:1;color:var(--muted)}.diff-empty :global(svg){color:var(--accent-strong)}
  .code{padding:.4rem 0;border:1px solid var(--line);border-radius:9px;background:var(--syntax-bg);color:var(--syntax-fg);font-family:"SFMono-Regular","Cascadia Code","JetBrains Mono",Consolas,ui-monospace,monospace;line-height:1.65;tab-size:2}
  .html-tabs{display:flex;flex:none;gap:.3rem;margin-bottom:.5rem;border-bottom:1px solid var(--line)}.html-tabs button{min-height:36px;padding:0 .75rem;border:0;border-bottom:3px solid transparent;border-radius:7px 7px 0 0;background:var(--surface-2);color:var(--muted);font-weight:700}.html-tabs button.active{border-bottom-color:var(--accent);background:var(--surface-3);color:var(--text)}
  .code b,.editor-backdrop b{font-weight:450}.code .comment,.editor-backdrop .comment{color:var(--syntax-comment);font-style:italic}.code .string,.editor-backdrop .string{color:var(--syntax-string)}.code .number,.editor-backdrop .number{color:var(--syntax-number)}.code .keyword,.editor-backdrop .keyword{color:var(--syntax-keyword);font-weight:750}.code .literal,.editor-backdrop .literal{color:var(--syntax-literal);font-weight:700}.code .type,.editor-backdrop .type{color:var(--syntax-type);font-weight:700}.code .function,.editor-backdrop .function{color:var(--syntax-function);font-weight:750}.code .property,.editor-backdrop .property{color:var(--syntax-property)}.code .operator,.editor-backdrop .operator{color:var(--syntax-operator);font-weight:650}.code .punctuation,.editor-backdrop .punctuation{color:var(--syntax-punctuation)}
  .code .bracket-0,.editor-backdrop .bracket-0{color:var(--syntax-bracket-0)}.code .bracket-1,.editor-backdrop .bracket-1{color:var(--syntax-bracket-1)}.code .bracket-2,.editor-backdrop .bracket-2{color:var(--syntax-bracket-2)}.code .bracket-3,.editor-backdrop .bracket-3{color:var(--syntax-bracket-3)}.code .bracket-4,.editor-backdrop .bracket-4{color:var(--syntax-bracket-4)}.code .bracket-5,.editor-backdrop .bracket-5{color:var(--syntax-bracket-5)}.code [class^="bracket-"],.editor-backdrop [class^="bracket-"]{font-weight:850}
  .code>span:hover{background:color-mix(in srgb,var(--blue) 7%,transparent)}.code>span.referenced-line{background:color-mix(in srgb,var(--blue) 16%,transparent);box-shadow:inset 3px 0 0 var(--blue)}
  .editor-actions button{box-sizing:border-box;width:auto;height:40px;min-height:40px;margin:0;padding:0 .8rem;justify-content:center;border:1px solid var(--line-strong);border-radius:8px;background:var(--surface-2);color:var(--text);font-weight:700;line-height:1;white-space:nowrap}
  .editor-actions button.primary{width:auto;height:40px;min-height:40px;margin:0;border-color:var(--accent);background:var(--accent);color:var(--on-accent)}
  .editor-position{margin-right:auto;padding:.25rem .5rem;border:1px solid var(--line);border-radius:7px;background:var(--surface-2);color:var(--muted);font:650 .72rem/1.2 "SFMono-Regular","Cascadia Code","JetBrains Mono",Consolas,ui-monospace,monospace;white-space:nowrap}
  .editor-shell{position:relative;isolation:isolate;min-width:0;min-height:0;flex:1;overflow:hidden;border:1px solid var(--line-strong);border-radius:9px;background:var(--syntax-bg)}
  .editor-shell:focus-within{border-color:var(--blue);box-shadow:0 0 0 2px color-mix(in srgb,var(--blue) 24%,transparent)}
  .editor-backdrop,.editor-input{position:absolute;inset:0;box-sizing:border-box;width:100%;height:100%;margin:0;padding:.6rem .85rem .6rem 4.25rem;overflow:auto;white-space:pre;font:13px/1.65 "SFMono-Regular","Cascadia Code","JetBrains Mono",Consolas,ui-monospace,monospace;tab-size:2}
  .editor-backdrop{z-index:0;pointer-events:none;color:var(--syntax-fg);scrollbar-width:none}
  .editor-backdrop::-webkit-scrollbar{width:0;height:0}
  .editor-backdrop>span{display:block;position:relative;min-width:max-content;min-height:1.65em}
  .editor-backdrop>span.cursor-line{background:color-mix(in srgb,var(--blue) 11%,transparent);box-shadow:-4.25rem 0 0 color-mix(in srgb,var(--blue) 11%,transparent),inset 2px 0 0 var(--blue)}
  .editor-backdrop i{position:absolute;left:-4rem;width:3.2rem;color:var(--syntax-line-number);font-style:normal;text-align:right;user-select:none}
  .editor-backdrop code,.editor-backdrop b{font:inherit}
  .editor-backdrop .matching-bracket{border-radius:2px;background:var(--syntax-match-bg);box-shadow:0 0 0 1px var(--syntax-match-outline);color:var(--syntax-match-fg)!important}
  .editor-input{z-index:1;resize:none;border:0;border-radius:0;outline:0;background:transparent;color:transparent;-webkit-text-fill-color:transparent;caret-color:var(--syntax-caret)}
  .editor-input::selection{background:color-mix(in srgb,var(--blue) 42%,transparent);color:transparent;-webkit-text-fill-color:transparent}
  .merge-grid .editor-shell{height:100%}
  @media(min-width:1181px){.file-more:not([open])>.file-more-sheet{display:contents}}
  @media(min-width:701px) and (max-width:1180px){.file-heading{flex-wrap:nowrap}.file-heading>strong{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.file-heading>.file-primary-actions{flex:none;flex-wrap:nowrap}.file-more{position:relative;display:block}.file-more>summary{display:inline-flex;min-width:40px;min-height:40px;padding:0 .6rem;cursor:pointer}.file-more>summary>span{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.file-more-sheet{position:absolute;z-index:20;top:calc(100% + .35rem);right:0;display:none;width:min(430px,calc(100vw - 2rem));grid-template-columns:1fr 1fr;gap:.4rem;padding:.65rem;border:1px solid var(--line-strong);border-radius:12px;background:var(--surface);box-shadow:var(--shadow-lg)}.file-more[open]>.file-more-sheet{display:grid}.file-more-sheet>strong{display:block;grid-column:1/-1}.file-more-sheet>button,.file-more-sheet>.file-action{width:100%;min-height:42px}}
  @media(max-height:700px) and (min-width:701px){.viewer-dialog{padding:.5rem}.viewer.html-preview-open{height:calc(100dvh - 1rem)}}
  @media(max-width:700px){.viewer-dialog{padding:0;align-items:start}.viewer,.viewer.html-preview-open{height:var(--viewer-vh,100dvh);border-radius:0}.viewer>header{min-height:52px;padding:.35rem;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}.viewer>header::-webkit-scrollbar{display:none}.viewer>header>.viewer-location{order:initial;min-width:140px;flex:1 0 140px}.viewer>header>button,.viewer>header>nav,.viewer>header>em{flex:none}.viewer>header>button:last-child{position:sticky;right:0;background:var(--panel);box-shadow:-8px 0 10px var(--panel)}.header-search-toggle span{display:none}.active-session{width:auto;white-space:nowrap}.viewer-body{grid-template-columns:1fr;grid-template-rows:minmax(110px,28%) 1fr}.viewer-body.file-list-collapsed,.viewer-body.editing{grid-template-columns:1fr;grid-template-rows:0 minmax(0,1fr)}.viewer-body.file-list-collapsed>nav,.viewer-body.editing>nav{visibility:hidden;padding:0;border:0}.viewer-body>nav{border-right:0;border-bottom:1px solid var(--line)}.viewer main{padding:.4rem;overflow:hidden}.merge-grid{grid-template-columns:1fr;grid-template-rows:minmax(120px,35%) 1fr}.conflict-editor footer{position:sticky;bottom:0;background:var(--panel);padding:.4rem 0}.file-heading{position:static;align-items:center;flex:none;display:grid;grid-template-columns:minmax(0,1fr);gap:.4rem;padding-bottom:.35rem}.file-heading>strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.file-heading>.file-primary-actions{width:100%;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.35rem}.file-heading em{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.file-heading>span>button,.file-more>summary{width:100%;min-width:0;min-height:44px;padding:0 .55rem}.file-more{display:block;min-width:0}.file-more>summary{display:inline-flex;cursor:pointer}.file-more>summary>span{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.file-more-sheet{position:fixed;z-index:90;left:8px;right:8px;bottom:max(8px,env(safe-area-inset-bottom));display:none;grid-template-columns:1fr 1fr;gap:7px;padding:14px;border:1px solid var(--line-strong);border-radius:18px;background:var(--surface);box-shadow:var(--shadow-lg)}.file-more[open]>.file-more-sheet{display:grid}.file-more-sheet>strong{display:block;grid-column:1/-1}.file-more-sheet>button,.file-more-sheet>.file-action{width:100%;min-width:0;min-height:46px}.html-tabs{height:42px;margin-bottom:.35rem}.html-tabs button{flex:1}.editor-actions{position:sticky;z-index:5;bottom:0;order:2;flex:none;display:grid;grid-template-columns:auto minmax(76px,1fr) minmax(104px,1.3fr);gap:.4rem;margin:.4rem 0 0;padding:.4rem 0 0;border-top:1px solid var(--line);background:var(--panel)}.editor-actions .editor-position{min-width:0;margin:0;overflow:hidden;text-overflow:ellipsis}.editor-actions button,.editor-actions button.primary{min-width:0;height:44px;min-height:44px;margin:0;justify-content:center;white-space:nowrap}.editor-shell,.diff-shell{order:1}.viewer:has(.editor-shell:focus-within)>header,.viewer main:has(.editor-shell:focus-within) .file-heading{display:none}}
  .viewer-dialog{position:fixed;inset:0;z-index:60}.viewer-dialog.layout-window{background:rgba(0,0,0,.6)}.viewer-dialog.layout-columns{width:50vw;height:100dvh;left:auto;right:0;padding:.5rem 0 .5rem .5rem}.viewer-dialog.layout-columns.layout-reversed{left:0;right:auto;padding:.5rem .5rem .5rem 0}.viewer-dialog.layout-rows{width:100vw;height:50dvh;top:auto;bottom:0;padding:.5rem .5rem 0}.viewer-dialog.layout-rows.layout-reversed{top:0;bottom:auto;padding:0 .5rem .5rem}.viewer-dialog.layout-fullscreen{padding:0}.viewer-dialog.layout-columns .viewer,.viewer-dialog.layout-rows .viewer,.viewer-dialog.layout-fullscreen .viewer,.viewer-dialog.layout-columns .viewer.html-preview-open,.viewer-dialog.layout-rows .viewer.html-preview-open,.viewer-dialog.layout-fullscreen .viewer.html-preview-open{width:100%;height:100%;max-width:none;border-radius:0}.viewer-dialog.layout-columns .viewer>header,.viewer-dialog.layout-rows .viewer>header{flex-wrap:wrap}.viewer-layout-controls{display:flex!important;flex:none;gap:.2rem;padding:.2rem;border:1px solid var(--line);border-radius:9px;background:var(--surface-2)}.viewer-layout-controls button,.viewer-tree-toggle{min-width:36px!important;min-height:36px!important;padding:0!important;justify-content:center;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--muted)}.viewer-layout-controls button:hover,.viewer-tree-toggle:hover{background:var(--surface-3);color:var(--text)}.viewer-layout-controls button.active,.viewer-tree-toggle.active{border-color:color-mix(in srgb,var(--accent) 48%,var(--line));background:var(--accent-soft);color:var(--accent-strong)}
  .code.wrap-lines>span{grid-template-columns:3.5rem minmax(0,1fr)}.code.wrap-lines code{min-width:0;white-space:pre-wrap;overflow-wrap:anywhere}.editor-shell.wrap-lines .editor-backdrop,.editor-shell.wrap-lines .editor-input{white-space:pre-wrap;overflow-wrap:anywhere}.editor-shell.wrap-lines .editor-backdrop>span{min-width:0;white-space:pre-wrap;overflow-wrap:anywhere}
  @media(max-width:700px){.viewer-dialog:not(.layout-window) .viewer-body.editing:not(.file-list-collapsed){grid-template-rows:minmax(110px,28%) minmax(0,1fr)}.viewer-dialog:not(.layout-window) .viewer-body.editing:not(.file-list-collapsed)>nav{visibility:visible;padding:.45rem;border-bottom:1px solid var(--line)}}
</style>
