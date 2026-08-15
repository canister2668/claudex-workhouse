<script lang="ts">
  import { modelLabel, permissionLabel } from "./session-ui";
  import { t } from "./i18n";
  export let provider:"codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok";
  export let models:Array<any>=[];
  export let permissions:Array<any>=[];
  export let efforts:Array<any>=[];
  export let model="";
  export let effort="medium";
  export let tier:string|null=null;
  export let permission=":read-only";
  export let danger=false;
  export let showPermission=true;

  const modelInfo=()=>models.find(item=>item.id===model);
  function chooseModel(id:string){
    model=id;
    if(provider!=="codex")return;
    const info=modelInfo();
    if(!info?.supportedReasoningEfforts?.some((item:any)=>item.reasoningEffort===effort))effort=info?.defaultReasoningEffort??"medium";
    if(!info?.serviceTiers?.some((item:any)=>item.id==="priority"))tier=null;
  }
</script>

<label>{$t("session.model")}<div class="chips">{#each models.filter((item:any)=>!item.hidden) as item}<button type="button" class:active={model===item.id} onclick={()=>chooseModel(item.id)}>{modelLabel(item)}</button>{/each}</div></label>
{#if provider==="codex"}
  <label>{$t("session.reasoning")}<div class="chips">{#each modelInfo()?.supportedReasoningEfforts??[] as item}<button type="button" class:active={effort===item.reasoningEffort} onclick={()=>effort=item.reasoningEffort}>{$t(`session.effort.${item.reasoningEffort}`)}</button>{/each}</div></label>
  {#if modelInfo()?.serviceTiers?.some((item:any)=>item.id==="priority")}<label>{$t("session.speed")}<div class="chips"><button type="button" class:active={tier===null} onclick={()=>tier=null}>{$t("model.standard")}</button><button type="button" class:active={tier==="priority"} onclick={()=>tier="priority"}>{$t("session.fastUsage")}</button></div></label>{/if}
{:else if efforts.length}
  <!-- The provider catalog ships an untranslated displayName; the dictionary owns the label. -->
  <label>{$t("session.reasoning")}<div class="chips">{#each efforts as item}<button type="button" class:active={effort===item.id} onclick={()=>effort=item.id}>{$t(`session.effort.${item.id}`)}</button>{/each}</div></label>
{/if}
{#if showPermission}<label>{$t("permission.label")}<div class="chips">{#each permissions as item}<button type="button" class:active={permission===item.id} class:danger-chip={item.id===":danger-full-access"} onclick={()=>permission=item.id}>{permissionLabel(item.id)}</button>{/each}</div></label>
{#if permission===":danger-full-access"}<label class="danger-confirm"><input type="checkbox" bind:checked={danger}/>{$t("permission.unrestrictedDescription")}</label>{/if}{/if}
