import type {AgentEventKind} from "./types.js";
import type {ProviderContextUsage,ProviderOutputUsage} from "./provider-context.js";

/**
 * Normalization for the Gemini CLI `--output-format stream-json` envelope.
 *
 * The CLI emits exactly six event types — `init`, `message`, `tool_use`,
 * `tool_result`, `error`, `result` — confirmed by reading every `emitEvent`
 * call site in the 0.55.1 bundle. There is no approval or thought event, which
 * is why Workhouse cannot bridge Gemini CLI tool approvals: in headless mode
 * the CLI resolves permission up front from `--approval-mode` and never asks.
 */

export type GeminiStreamEvent={
  type?:string;
  timestamp?:string;
  session_id?:string;
  model?:string;
  role?:string;
  content?:unknown;
  delta?:boolean;
  tool_name?:string;
  tool_id?:string;
  parameters?:unknown;
  status?:string;
  output?:unknown;
  severity?:string;
  message?:string;
  error?:{type?:string;message?:string};
  stats?:unknown;
};

function text(value:unknown){return typeof value==="string"?value:value===null||value===undefined?"":String(value);}

/** Tool names taken from live runs. Anything unknown stays a generic tool event
 * rather than being guessed into a file or command event. */
const FILE_WRITE_TOOLS=new Set(["write_file","replace","edit_file","create_file"]);
const FILE_READ_TOOLS=new Set(["read_file","read_many_files","list_directory","glob","search_file_content","grep"]);
const SHELL_TOOLS=new Set(["run_shell_command"]);

export type GeminiToolShape="shell"|"file-write"|"file-read"|"tool";

export function geminiToolShape(toolName:string):GeminiToolShape{
  if(SHELL_TOOLS.has(toolName))return"shell";
  if(FILE_WRITE_TOOLS.has(toolName))return"file-write";
  if(FILE_READ_TOOLS.has(toolName))return"file-read";
  return"tool";
}

export function geminiToolStartEvent(shape:GeminiToolShape):AgentEventKind{
  return shape==="shell"?"command_started":shape==="file-write"?"file_change_started":"tool_started";
}

export function geminiToolEndEvent(shape:GeminiToolShape,failed:boolean):AgentEventKind{
  if(failed)return"tool_completed";
  return shape==="shell"?"command_completed":shape==="file-write"?"file_change_completed":"tool_completed";
}

export function geminiWorkerActivity(shape:GeminiToolShape){
  return shape==="shell"?"building":shape==="file-write"?"coding":shape==="file-read"?"searching":"searching";
}

/** A one-line, non-sensitive summary of a tool call for the activity feed. The
 * full parameter object is kept in event metadata, not in the headline. */
export function geminiToolSummary(toolName:string,parameters:unknown){
  const item=parameters&&typeof parameters==="object"?parameters as Record<string,unknown>:{};
  const candidate=item.command??item.file_path??item.path??item.pattern??item.absolute_path??item.query;
  const summary=typeof candidate==="string"?candidate.replace(/\s+/g," ").trim():"";
  return summary?`${toolName}: ${summary.slice(0,300)}`:toolName;
}

export type GeminiModelUsage={model:string;totalTokens:number;inputTokens:number;outputTokens:number;cachedInputTokens:number;reasoningTokens:number};
export type GeminiUsage={
  totals:{totalTokens:number;inputTokens:number;outputTokens:number;cachedInputTokens:number;reasoningTokens:number};
  models:GeminiModelUsage[];
  toolCalls:number|null;
  durationMs:number|null;
};

function positive(value:unknown){const number=Number(value);return Number.isFinite(number)&&number>=0?number:0;}

/**
 * Gemini CLI reports `input_tokens` inclusive of `cached`, and reports neither
 * thinking tokens nor a separate reasoning counter. The difference between
 * `total_tokens` and `input_tokens + output_tokens` is the thinking budget, so
 * it is derived rather than dropped — otherwise the turn summary would under
 * report the tokens the project is actually billed for.
 */
function modelUsage(model:string,value:Record<string,unknown>):GeminiModelUsage{
  const total=positive(value.total_tokens),input=positive(value.input_tokens),output=positive(value.output_tokens),cached=positive(value.cached);
  const reasoning=Math.max(0,total-input-output);
  return{model,totalTokens:total||input+output+reasoning,inputTokens:input,outputTokens:output+reasoning,cachedInputTokens:cached,reasoningTokens:reasoning};
}

/**
 * One `result` event describes one CLI invocation, which is one Workhouse turn.
 * Resuming spawns a fresh process whose counters start at zero, so per-turn
 * usage never double counts a conversation the way a cumulative field would.
 */
export function geminiUsage(stats:unknown):GeminiUsage|null{
  if(!stats||typeof stats!=="object")return null;
  const item=stats as Record<string,unknown>;
  const rawModels=item.models&&typeof item.models==="object"?item.models as Record<string,unknown>:{};
  const models=Object.entries(rawModels)
    .filter(([,value])=>value&&typeof value==="object")
    .map(([model,value])=>modelUsage(model,value as Record<string,unknown>))
    .filter(entry=>entry.totalTokens>0)
    .sort((left,right)=>right.totalTokens-left.totalTokens);
  const total=positive(item.total_tokens),input=positive(item.input_tokens),output=positive(item.output_tokens),cached=positive(item.cached);
  if(!total&&!input&&!output&&!models.length)return null;
  const reasoning=Math.max(0,total-input-output);
  return{
    totals:{totalTokens:total||input+output+reasoning,inputTokens:input,outputTokens:output+reasoning,cachedInputTokens:cached,reasoningTokens:reasoning},
    models,
    toolCalls:Number.isFinite(Number(item.tool_calls))?Number(item.tool_calls):null,
    durationMs:Number.isFinite(Number(item.duration_ms))?Number(item.duration_ms):null
  };
}

export function geminiOutputUsage(usage:GeminiUsage|null,updatedAt=new Date().toISOString()):(ProviderOutputUsage&{requestCount:number|null})|null{
  if(!usage)return null;
  return{
    totalTokens:usage.totals.totalTokens,
    inputTokens:usage.totals.inputTokens,
    cachedInputTokens:usage.totals.cachedInputTokens,
    cacheWriteInputTokens:null,
    outputTokens:usage.totals.outputTokens,
    reasoningTokens:usage.totals.reasoningTokens,
    // The CLI counts model requests internally and does not publish them, so a
    // fabricated request count would be worse than none.
    requestCount:null,
    updatedAt
  };
}

const GEMINI_CONTEXT_WINDOW=1_000_000;

export function geminiContextUsage(usage:GeminiUsage|null,updatedAt=new Date().toISOString()):ProviderContextUsage|null{
  if(!usage)return null;
  // The prompt of the largest model is the live context reading; the utility
  // router's small prompts are not what fills the conversation window.
  const primary=usage.models[0];
  const usedTokens=primary?primary.inputTokens:usage.totals.inputTokens;
  return{usedTokens,windowTokens:GEMINI_CONTEXT_WINDOW,percent:Math.max(0,Math.min(100,Math.round(usedTokens/GEMINI_CONTEXT_WINDOW*1000)/10)),updatedAt};
}

/**
 * Gemini CLI routes small internal steps (topic summaries, routing decisions)
 * to a cheaper model. Both are billed, so both are reported, but only the
 * heaviest is the model the user chose — the rest are labelled as utility so
 * the UI does not present them as a second working model.
 */
export function geminiModelBreakdown(usage:GeminiUsage|null){
  if(!usage||!usage.models.length)return null;
  const[primary,...utility]=usage.models;
  return{
    primary:{model:primary.model,totalTokens:primary.totalTokens,inputTokens:primary.inputTokens,outputTokens:primary.outputTokens,cachedInputTokens:primary.cachedInputTokens,reasoningTokens:primary.reasoningTokens},
    utility:utility.map(entry=>({model:entry.model,totalTokens:entry.totalTokens,inputTokens:entry.inputTokens,outputTokens:entry.outputTokens,cachedInputTokens:entry.cachedInputTokens,reasoningTokens:entry.reasoningTokens}))
  };
}
