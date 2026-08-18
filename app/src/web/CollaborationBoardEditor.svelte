<script lang="ts">
  import { X } from "@lucide/svelte";
  import { t } from "./i18n";
  import { providerDisplayName } from "./provider-display";
  import { modelLabel } from "./session-ui";
  import { permissionForAutomation } from "./automation-level";
  import { BOARD_BRANCH_MAX, BOARD_DESCRIPTION_MAX, BOARD_TITLE_MAX, COLLABORATION_BOARD_PRIORITIES, COLLABORATION_BOARD_STATUSES, boardDefaultRole, boardProviderExecution, normalizeBoardRole, type CollaborationBoardAutomation, type CollaborationBoardDraft, type CollaborationBoardExecutionConfig, type CollaborationBoardProvider, type CollaborationBoardRole } from "./collaboration-board";
  export let initial:CollaborationBoardDraft={title:"",description:"",boardStatus:"queued",priority:"normal",workspaceId:null,targetBranch:"",roles:{}};
  export let workspaces:Array<{id:string;displayName:string}>=[];
  export let executionConfig:CollaborationBoardExecutionConfig;
  export let saving=false;
  export let error="";
  export let onsave:(draft:CollaborationBoardDraft)=>void=()=>{};
  export let onclose:()=>void=()=>{};
  let draft:CollaborationBoardDraft=structuredClone(initial);
  const roleKeys=["implementer","reviewer","secondaryReviewer"] as const;
  const roleLabel={implementer:"collaborationBoard.role.implementer",reviewer:"collaborationBoard.role.reviewer",secondaryReviewer:"collaborationBoard.role.secondaryReviewer"} as const;
  const providers=()=>executionConfig.providers.filter(item=>item.models.length);
  const providerUsedElsewhere=(key:typeof roleKeys[number],provider:CollaborationBoardProvider)=>roleKeys.some(other=>other!==key&&draft.roles[other]?.provider===provider);
  function setProvider(key:typeof roleKeys[number],value:string){
    if(!value){const roles={...draft.roles};delete roles[key];draft={...draft,roles};return;}
    const next=boardDefaultRole(executionConfig,value as CollaborationBoardProvider);
    if(key!=="implementer")Object.assign(next,{automationLevel:"read",permissionProfile:":read-only",workMode:"plan"});
    draft={...draft,roles:{...draft.roles,[key]:next}};
  }
  function setRole(key:typeof roleKeys[number],patch:Partial<CollaborationBoardRole>){const current=draft.roles[key];if(!current)return;draft={...draft,roles:{...draft.roles,[key]:normalizeBoardRole(executionConfig,{...current,...patch})}};}
  function setModel(key:typeof roleKeys[number],model:string){const current=draft.roles[key];if(!current)return;const execution=boardProviderExecution(executionConfig,current.provider),info=execution?.models.find(item=>item.id===model),efforts=info?.supportedReasoningEfforts??execution?.efforts??[],reasoningEffort=efforts.some(item=>("reasoningEffort" in item?item.reasoningEffort:item.id)===current.reasoningEffort)?current.reasoningEffort:(info?.defaultReasoningEffort??execution?.defaultReasoningEffort??null),serviceTier=current.provider==="codex"&&info?.serviceTiers?.some(item=>item.id==="priority")?current.serviceTier:null;setRole(key,{model,reasoningEffort,serviceTier});}
  function setAutomation(key:typeof roleKeys[number],level:CollaborationBoardAutomation){const current=draft.roles[key];if(!current)return;setRole(key,{automationLevel:level,permissionProfile:permissionForAutomation(current.provider,level),...(level==="read"?{workMode:"plan" as const}:{})});}
  const effortId=(item:any)=>item.reasoningEffort??item.id;
</script>

<div class="modal-backdrop board-editor-backdrop" role="presentation" onclick={(event)=>event.currentTarget===event.target&&onclose()}>
  <form class="modal create-panel board-editor" aria-labelledby="board-editor-title" onsubmit={(event)=>{event.preventDefault();onsave(draft)}}>
    <header><h2 id="board-editor-title">{$t(initial.title?"collaborationBoard.editTitle":"collaborationBoard.newTitle")}</h2><button type="button" class="icon-button" onclick={onclose} aria-label={$t("a11y.closeDialog")}><X size={20}/></button></header>
    <section class="cblk board-basics">
      <label class="cf board-wide"><span class="cf-n">{$t("collaborationBoard.field.title")}</span><input required maxlength={BOARD_TITLE_MAX} bind:value={draft.title}/></label>
      <label class="cf board-wide"><span class="cf-n">{$t("collaborationBoard.field.description")}</span><textarea rows="3" maxlength={BOARD_DESCRIPTION_MAX} bind:value={draft.description}></textarea></label>
      <label class="cf"><span class="cf-n">{$t("common.status")}</span><select bind:value={draft.boardStatus}>{#each COLLABORATION_BOARD_STATUSES as value}<option {value}>{$t(`collaborationBoard.status.${value}`)}</option>{/each}</select></label>
      <label class="cf"><span class="cf-n">{$t("collaborationBoard.field.priority")}</span><select bind:value={draft.priority}>{#each COLLABORATION_BOARD_PRIORITIES as value}<option {value}>{$t(`collaborationBoard.priority.${value}`)}</option>{/each}</select></label>
      <label class="cf"><span class="cf-n">{$t("workspace.label")}</span><select bind:value={draft.workspaceId}><option value={null}>{$t("workspace.noWorkspace")}</option>{#each workspaces as workspace}<option value={workspace.id}>{workspace.displayName}</option>{/each}</select></label>
      <label class="cf"><span class="cf-n">{$t("collaborationBoard.field.branch")}</span><input maxlength={BOARD_BRANCH_MAX} placeholder={$t("collaborationBoard.branchPlaceholder")} bind:value={draft.targetBranch}/></label>
    </section>
    <section class="cblk"><h4 class="cover">{$t("collaborationBoard.roles")}<span class="r">{$t("collaborationBoard.globalDefaultsHelp")}</span></h4>
      {#each roleKeys as key}{@const assigned=draft.roles[key]}{@const execution=assigned?boardProviderExecution(executionConfig,assigned.provider):null}{@const model=execution?.models.find(item=>item.id===assigned?.model)}{@const efforts=model?.supportedReasoningEfforts??execution?.efforts??[]}
        <div class="cwho" data-provider={assigned?.provider??"none"}>
          <h5>{$t(roleLabel[key])}{#if key!=="implementer"}<em>{$t("common.optional")}</em>{/if}</h5>
          <label class="cf"><span class="cf-n">{$t("session.provider")}</span><select aria-label={`${$t(roleLabel[key])} ${$t("session.provider")}`} value={assigned?.provider??""} onchange={(event)=>setProvider(key,event.currentTarget.value)}>{#if key!=="implementer"}<option value="">{$t("common.none")}</option>{/if}{#each providers() as item}<option value={item.provider} disabled={providerUsedElsewhere(key,item.provider)}>{providerDisplayName(item.provider)}</option>{/each}</select></label>
          {#if assigned&&execution}
            <label class="cf"><span class="cf-n">{$t("session.model")}</span><select aria-label={`${$t(roleLabel[key])} ${$t("session.model")}`} value={assigned.model??""} onchange={(event)=>setModel(key,event.currentTarget.value)}>{#each execution.models as item}<option value={item.id}>{modelLabel(item)}</option>{/each}</select></label>
            {#if efforts.length}<div class="cf" role="group"><span class="cf-n">{$t("session.reasoning")}</span><div class="sel">{#each efforts as item}<button type="button" class:active={assigned.reasoningEffort===effortId(item)} onclick={()=>setRole(key,{reasoningEffort:effortId(item)})}>{$t(`session.effort.${effortId(item)}`)}</button>{/each}</div></div>{/if}
            {#if assigned.provider==="codex"&&model?.serviceTiers?.some(item=>item.id==="priority")}<div class="cf" role="group"><span class="cf-n">{$t("session.speed")}</span><div class="sel"><button type="button" class:active={!assigned.serviceTier} onclick={()=>setRole(key,{serviceTier:null})}>{$t("model.standard")}</button><button type="button" class:active={assigned.serviceTier==="priority"} onclick={()=>setRole(key,{serviceTier:"priority"})}>{$t("session.fastUsage")}</button></div></div>{/if}
            {#if assigned.provider==="antigravity"}<div class="cf" role="group"><span class="cf-n">{$t("vertexSearch.label")}</span><div class="sel">{#each (["off","auto","always"] as const) as mode}<button type="button" class:active={(assigned.googleSearchMode??"off")===mode} onclick={()=>setRole(key,{googleSearchMode:mode})}>{$t(`vertexSearch.${mode}`)}</button>{/each}</div></div>{/if}
            {#if key==="implementer"}<div class="cf" role="group"><span class="cf-n">{$t("workMode.label")}</span><div class="sel"><button type="button" class:active={assigned.workMode!=="plan"} onclick={()=>setRole(key,{workMode:"default"})}>{$t("workMode.default")}</button><button type="button" class:active={assigned.workMode==="plan"} onclick={()=>setRole(key,{workMode:"plan",automationLevel:"read",permissionProfile:":read-only"})}>{$t("workMode.plan")}</button></div></div>
              <div class="cf" role="group"><span class="cf-n">{$t("permission.level")}</span><div class="sel">{#each (["auto","confirm","read","full"] as CollaborationBoardAutomation[]) as level}<button type="button" disabled={assigned.provider!=="codex"&&level==="confirm"||level==="full"&&!executionConfig.fullAccessAcknowledged} class:active={assigned.automationLevel===level} class:danger={level==="full"} onclick={()=>setAutomation(key,level)}>{$t(level==="auto"?"permission.automatic":level==="confirm"?"permission.confirm":level==="full"?"permission.fullAccess":"permission.readOnly")}</button>{/each}</div></div>
            {:else}<p class="review-note">{$t("collaborationBoard.reviewReadOnly")}</p>{/if}
          {/if}
        </div>
      {/each}
    </section>
    {#if error}<p class="create-error" role="alert">{error}</p>{/if}
    <div class="create-submit-actions"><button type="button" onclick={onclose}>{$t("common.cancel")}</button><button class="primary" disabled={saving||!draft.title.trim()||!draft.roles.implementer?.model}>{saving?$t("common.saving"):$t("common.save")}</button></div>
  </form>
</div>

<style>
  .board-editor{width:min(720px,100%);max-height:min(900px,calc(100dvh - 32px));overflow:auto}.board-basics{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}.board-wide{grid-column:1/-1}.board-editor input,.board-editor textarea,.board-editor select{width:100%;min-width:0}.board-editor textarea{resize:vertical}.review-note{margin:10px 0 0;color:var(--muted);font-size:.7rem}.create-error{color:var(--danger)}
  @media(max-width:600px){.board-editor-backdrop{align-items:flex-end}.board-editor{max-height:calc(100dvh - 16px);padding-bottom:calc(16px + env(safe-area-inset-bottom));border-radius:18px 18px 0 0}.board-basics{grid-template-columns:1fr}.board-wide{grid-column:auto}.board-editor .cwho{padding-left:10px}.board-editor .sel{grid-auto-flow:row;grid-template-columns:repeat(2,minmax(0,1fr))}.create-submit-actions{position:sticky;bottom:calc(-16px - env(safe-area-inset-bottom));z-index:2;padding:10px 0 calc(12px + env(safe-area-inset-bottom));background:var(--panel)}}
</style>
