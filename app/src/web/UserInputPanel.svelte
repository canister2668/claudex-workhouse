<script lang="ts">
  import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleHelp, Clock3 } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { shouldPollAttention } from "./client-polling";
  import { upsertStableRows } from "./collaboration-identity";
  import { t } from "./i18n";
  import { isTransientApiError } from "./api-client";
  export let api:(path:string,options?:RequestInit)=>Promise<any>;
  export let task:{id:string;provider:"codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok";title:string;status?:string};
  type Option={label:string;description:string};type Question={id:string;header:string;question:string;options:Option[];isOther:boolean;isSecret:boolean};
  type Request={id:string;questions:Question[];expiresAt:string;title?:string};
  let requests:Request[]=[];let selected:Record<string,string>={};let custom:Record<string,string>={};let activeQuestion:Record<string,number>={};let collapsed:Record<string,boolean>={};let busy="";let error="";let timer:ReturnType<typeof setInterval>|null=null;let loading=false;
  const key=(requestId:string,questionId:string)=>`${requestId}:${questionId}`;
  const remaining=(item:Request)=>Math.max(0,Math.ceil((Date.parse(item.expiresAt)-Date.now())/1000));
  const requestKey=(item:Request)=>`user-input:${task.id}:${item.id}`;
  async function load(){if(loading||document.visibilityState==="hidden")return;loading=true;try{const data=await api(`/api/user-input?taskId=${encodeURIComponent(task.id)}`);requests=upsertStableRows(data.requests??[],requestKey).map(item=>({...item,questions:upsertStableRows(item.questions??[],question=>`question:${task.id}:${item.id}:${question.id}`)}));error="";}catch(e){error=isTransientApiError(e)?"":e instanceof Error?e.message:String(e);}finally{loading=false;}}
  function choose(requestId:string,questionId:string,value:string){selected={...selected,[key(requestId,questionId)]:value};}
  function updateCustom(requestId:string,questionId:string,value:string){custom={...custom,[key(requestId,questionId)]:value};selected={...selected,[key(requestId,questionId)]:"__other__"};}
  function answered(requestId:string,question:Question){const value=selected[key(requestId,question.id)];return Boolean(value&&value!=="__other__"||value==="__other__"&&custom[key(requestId,question.id)]?.trim());}
  function answeredCount(item:Request){return item.questions.filter(question=>answered(item.id,question)).length;}
  function questionIndex(item:Request){return Math.min(activeQuestion[item.id]??0,Math.max(0,item.questions.length-1));}
  function setQuestion(item:Request,index:number){activeQuestion={...activeQuestion,[item.id]:Math.max(0,Math.min(index,item.questions.length-1))};}
  function toggleCollapsed(item:Request){collapsed={...collapsed,[item.id]:!collapsed[item.id]};}
  function advance(item:Request){const index=questionIndex(item),question=item.questions[index];if(!question||!answered(item.id,question))return;if(index<item.questions.length-1)setQuestion(item,index+1);else void submit(item);}
  function ready(item:Request){return item.questions.every(question=>{const value=selected[key(item.id,question.id)];return Boolean(value&&value!=="__other__"||value==="__other__"&&custom[key(item.id,question.id)]?.trim());});}
  async function submit(item:Request){if(busy||!ready(item))return;busy=item.id;error="";const answers=Object.fromEntries(item.questions.map(question=>{const value=selected[key(item.id,question.id)];return[question.id,{answers:[value==="__other__"?custom[key(item.id,question.id)].trim():value]}];}));try{await api(`/api/tasks/${task.provider}/${encodeURIComponent(task.id)}/user-input/${item.id}`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({answers})});requests=requests.filter(value=>value.id!==item.id);for(const question of item.questions){delete selected[key(item.id,question.id)];delete custom[key(item.id,question.id)];}selected={...selected};custom={...custom};}catch(e){error=e instanceof Error?e.message:String(e);await load();}finally{busy="";}}
  onMount(()=>{const visible=()=>{if(document.visibilityState==="visible")void load();};void load();timer=setInterval(()=>{if(shouldPollAttention(task.status,requests.length))void load();},5000);document.addEventListener("visibilitychange",visible);return()=>{if(timer)clearInterval(timer);document.removeEventListener("visibilitychange",visible);};});
</script>

{#if requests.length||error}
  <section class="user-input-stack" aria-label={$t("form.userChoiceNeeded")} aria-live="polite">
    {#each requests as item (requestKey(item))}
      {@const index=questionIndex(item)}
      {@const question=item.questions[index]}
      {@const count=answeredCount(item)}
      <article class:collapsed={collapsed[item.id]}>
        <button type="button" class="user-input-head" aria-expanded={!collapsed[item.id]} onclick={()=>toggleCollapsed(item)}>
          <span class="head-title"><span class="help-icon"><CircleHelp size={18}/></span><span><strong>{$t("form.userChoiceNeeded")}</strong><small>{item.questions.length>1?$t("form.questionProgress",{current:index+1,total:item.questions.length,answered:count}):question?.header||$t("form.question",{count:1})}</small></span></span>
          <span class="head-side"><small><Clock3 size={12}/>{$t("format.seconds",{count:remaining(item)})}</small>{#if item.questions.length>1}<span class="answer-count">{count}/{item.questions.length}</span>{/if}{#if collapsed[item.id]}<ChevronDown size={17}/>{:else}<ChevronUp size={17}/>{/if}</span>
        </button>
        {#if !collapsed[item.id]&&question}
          <div class="question-progress" aria-hidden="true"><em>{question.header||$t("form.question",{count:index+1})}</em>{#if item.questions.length>1}<span>{#each item.questions as _,dot}<i class:active={dot===index} class:done={dot!==index&&answered(item.id,item.questions[dot])}></i>{/each}</span>{/if}</div>
          <fieldset><legend>{question.question}</legend>
            <div class="choice-list">
              {#each question.options as option}
                <label class:active={selected[key(item.id,question.id)]===option.label}><input type="radio" name={key(item.id,question.id)} checked={selected[key(item.id,question.id)]===option.label} onchange={()=>choose(item.id,question.id,option.label)}/><span><strong>{option.label}</strong>{#if option.description}<small>{option.description}</small>{/if}</span></label>
              {/each}
              <label class="other" class:active={selected[key(item.id,question.id)]==="__other__"}><input type="radio" name={key(item.id,question.id)} checked={selected[key(item.id,question.id)]==="__other__"} onchange={()=>choose(item.id,question.id,"__other__")}/><span><strong>{$t("form.other")}</strong>{#if selected[key(item.id,question.id)]==="__other__"}<input type={question.isSecret?"password":"text"} maxlength="1000" value={custom[key(item.id,question.id)]??""} oninput={(event)=>updateCustom(item.id,question.id,event.currentTarget.value)} autocomplete="off"/>{/if}</span></label>
            </div>
          </fieldset>
          <footer class:single={item.questions.length===1}>
            {#if item.questions.length>1}<button type="button" class="previous" disabled={index===0||busy===item.id} onclick={()=>setQuestion(item,index-1)}><ChevronLeft size={16}/>{$t("form.previousQuestion")}</button>{/if}
            <button class="primary" disabled={busy===item.id||!answered(item.id,question)} onclick={()=>advance(item)}>{#if busy===item.id}<Check size={17}/>{$t("form.submitting")}{:else if index<item.questions.length-1}{$t("form.nextQuestion")}<ChevronRight size={16}/>{:else}<Check size={17}/>{$t("form.submitSelection")}{/if}</button>
          </footer>
        {/if}
      </article>
    {/each}
    {#if error}<button class="input-error" onclick={()=>error=""}>{error}</button>{/if}
  </section>
{/if}

<style>
  .user-input-stack{display:grid;gap:.55rem;margin:.55rem .7rem}.user-input-stack article{display:grid;gap:.55rem;padding:0 .7rem .7rem;border:1px solid color-mix(in srgb,var(--accent) 52%,var(--line));border-radius:14px;background:color-mix(in srgb,var(--panel) 94%,var(--accent) 6%);font-size:13px;overflow:hidden}.user-input-stack article.collapsed{padding-bottom:0}.user-input-head,.user-input-head span,.user-input-head small,footer{display:flex;align-items:center}.user-input-head{width:calc(100% + 1.4rem);min-height:52px;margin:0 -.7rem;padding:.55rem .7rem;justify-content:space-between;gap:.6rem;border:0;background:transparent;color:inherit;text-align:left}.head-title{min-width:0;gap:.5rem}.head-title>span:last-child{min-width:0;display:grid;gap:.08rem}.head-title strong{font-size:13px}.head-title small{display:block;max-width:min(52vw,470px);overflow:hidden;color:var(--muted);font-size:10.5px;font-weight:500;text-overflow:ellipsis;white-space:nowrap}.help-icon{width:30px;height:30px;display:flex;flex:none;justify-content:center;border-radius:9px;background:color-mix(in srgb,var(--accent) 14%,var(--surface));color:var(--accent-strong)}.head-side{flex:none;gap:.45rem;color:var(--muted)}.head-side small{gap:.25rem;font-size:10.5px}.answer-count{min-width:30px;height:24px;justify-content:center;border-radius:999px;background:color-mix(in srgb,var(--accent) 12%,var(--surface));color:var(--accent-strong);font-size:10px;font-weight:800}.question-progress{display:flex;align-items:center;gap:.5rem}.question-progress em{color:var(--accent-strong);font-size:10.5px;font-style:normal;font-weight:800}.question-progress>span{margin-left:auto;display:flex;gap:.25rem}.question-progress i{width:18px;height:4px;border-radius:999px;background:var(--line-strong)}.question-progress i.active{background:var(--accent)}.question-progress i.done{background:color-mix(in srgb,var(--accent) 55%,var(--line))}fieldset{display:grid;gap:.4rem;border:0;padding:0;margin:0}legend{padding:0;margin-bottom:.3rem;font-size:14px;font-weight:650;line-height:1.45}.choice-list{display:grid;gap:.35rem}.choice-list>label{display:flex;gap:.5rem;align-items:flex-start;min-height:48px;padding:.55rem .6rem;border:1px solid var(--line);border-radius:10px;background:var(--surface);cursor:pointer}.choice-list>label.active{border-color:var(--accent);background:color-mix(in srgb,var(--surface) 90%,var(--accent) 10%)}.choice-list label>span{display:grid;gap:.1rem;min-width:0;flex:1}.choice-list strong{font-size:13px;line-height:1.35}.choice-list small{color:var(--muted);font-size:11px;line-height:1.35}.choice-list input[type="radio"]{margin-top:.15rem}.choice-list .other span input{width:100%;min-height:38px;margin-top:.3rem;font-size:12px}footer{display:grid;grid-template-columns:auto minmax(0,1fr);gap:.4rem;margin-top:.05rem}footer.single{grid-template-columns:1fr}footer button{min-height:40px;display:flex;align-items:center;justify-content:center;gap:.3rem;border-radius:10px}.previous{padding:0 .75rem;border:1px solid var(--line);background:var(--surface);color:var(--muted);font-size:12px;font-weight:700}.input-error{color:var(--danger);text-align:left}@media(max-width:600px){.user-input-stack{margin:.45rem .55rem}.user-input-stack article{border-radius:12px}.head-title small{max-width:42vw}.head-side small{display:none}footer .primary{width:100%}}
</style>
