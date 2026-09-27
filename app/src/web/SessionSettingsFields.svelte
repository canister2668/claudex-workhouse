<script lang="ts">
  import { permissionLabel } from "./session-ui";
  import { t } from "./i18n";
  import ModelPicker from "./ModelPicker.svelte";
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
  // Codex efforts and the priority tier belong to the chosen model, so a model
  // change has to re-validate both before the picker shows them.
  function chooseModel(id:string){
    model=id;
    if(provider!=="codex")return;
    const info=modelInfo();
    if(!info?.supportedReasoningEfforts?.some((item:any)=>item.reasoningEffort===effort))effort=info?.defaultReasoningEffort??"medium";
    if(!info?.serviceTiers?.some((item:any)=>item.id==="priority"))tier=null;
  }
</script>

<ModelPicker fields={["model","effort","tier"]} layout="stack" {provider} {models} efforts={provider==="codex"?(modelInfo()?.supportedReasoningEfforts??[]):efforts} hasPriority={provider==="codex"&&Boolean(modelInfo()?.serviceTiers?.some((item:any)=>item.id==="priority"))} bind:model bind:effort bind:tier idPrefix="session-settings" onmodel={chooseModel}/>
{#if showPermission}<label>{$t("permission.label")}<div class="chips">{#each permissions as item}<button type="button" class:active={permission===item.id} class:danger-chip={item.id===":danger-full-access"} onclick={()=>permission=item.id}>{permissionLabel(item.id)}</button>{/each}</div></label>
{#if permission===":danger-full-access"}<label class="danger-confirm"><input type="checkbox" bind:checked={danger}/>{$t("permission.unrestrictedDescription")}</label>{/if}{/if}
