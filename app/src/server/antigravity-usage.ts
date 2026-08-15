import type {ProviderContextUsage,ProviderOutputUsage} from "./provider-context.js";

/** Raw Gemini token counters, as reported by `agy --output-format stream-json`. */
export type AntigravityUsageTotals={inputTokens:number;outputTokens:number;cachedInputTokens:number;reasoningTokens:number};

function finite(value:unknown){const number=Number(value);return value!==null&&value!==undefined&&value!==""&&Number.isFinite(number)&&number>=0?number:null;}
function count(...values:unknown[]){for(const value of values){const number=finite(value);if(number!==null)return number;}return null;}

/**
 * Gemini reports `input_tokens` exclusive of `cache_read_tokens`, while every
 * other provider in the deck reports an inclusive input figure and a cached
 * subset. Normalize to the inclusive convention so the shared turn summary,
 * cache-reuse percentage, and billable split stay comparable across providers.
 */
export function antigravityUsageTotals(value:unknown):AntigravityUsageTotals|null{
  if(!value||typeof value!=="object")return null;
  const item=value as Record<string,unknown>;
  const directInput=count(item.input_tokens,item.inputTokens),output=count(item.output_tokens,item.outputTokens);
  const cached=count(item.cache_read_tokens,item.cachedInputTokens)??0,thinking=count(item.thinking_tokens,item.reasoningTokens)??0;
  if(directInput===null&&output===null)return null;
  return{inputTokens:(directInput??0)+cached,outputTokens:(output??0)+thinking,cachedInputTokens:cached,reasoningTokens:thinking};
}

export function addAntigravityUsage(base:AntigravityUsageTotals|null,next:AntigravityUsageTotals|null):AntigravityUsageTotals|null{
  if(!next)return base;
  if(!base)return{...next};
  return{inputTokens:base.inputTokens+next.inputTokens,outputTokens:base.outputTokens+next.outputTokens,cachedInputTokens:base.cachedInputTokens+next.cachedInputTokens,reasoningTokens:base.reasoningTokens+next.reasoningTokens};
}

export function antigravityOutputUsage(totals:AntigravityUsageTotals|null,requestCount:number|null,updatedAt=new Date().toISOString()):(ProviderOutputUsage&{requestCount:number|null})|null{
  if(!totals)return null;
  return{
    totalTokens:totals.inputTokens+totals.outputTokens,
    inputTokens:totals.inputTokens,
    cachedInputTokens:totals.cachedInputTokens,
    cacheWriteInputTokens:null,
    outputTokens:totals.outputTokens,
    reasoningTokens:totals.reasoningTokens,
    requestCount,
    updatedAt
  };
}

/**
 * The Gemini catalog mixes Gemini and Anthropic model entries and prints them
 * as display strings ("Gemini 3.5 Flash (High)") as well as slugs
 * ("gemini-3.6-flash-high"), so match on substrings. Return null rather than
 * guessing for anything else: the meter then shows a token count with no
 * percentage instead of a fabricated one.
 */
export function antigravityContextWindow(model:unknown){
  const id=String(model??"").toLowerCase();
  if(!id)return null;
  if(id.includes("gemini"))return 1_000_000;
  if(id.includes("claude")||id.includes("opus")||id.includes("sonnet")||id.includes("haiku"))return 200_000;
  return null;
}

/**
 * A Gemini step reports the tokens of one model request, so `input_tokens +
 * cache_read_tokens` is the live prompt size — the closest equivalent to the
 * context reading Claude and Codex publish. The `result` envelope cannot be
 * used here: it is cumulative across every turn of the conversation.
 */
export function antigravityContextUsage(value:unknown,model:unknown,updatedAt=new Date().toISOString()):ProviderContextUsage|null{
  const totals=antigravityUsageTotals(value);
  if(!totals)return null;
  const usedTokens=totals.inputTokens,windowTokens=antigravityContextWindow(model);
  return{usedTokens,windowTokens,percent:windowTokens&&windowTokens>0?Math.max(0,Math.min(100,Math.round(usedTokens/windowTokens*1000)/10)):null,updatedAt};
}

export function antigravityStepUsage(value:unknown){
  if(!value||typeof value!=="object")return null;
  const step=value as Record<string,any>,inner=step.step_update??step.step??step;
  return antigravityUsageTotals(inner?.usage)?{totals:antigravityUsageTotals(inner.usage)!,stepIndex:count(inner.step_index,inner.stepIndex)}:null;
}
