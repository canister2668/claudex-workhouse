export type ProviderContextUsage = {
  usedTokens: number | null;
  windowTokens: number | null;
  percent: number | null;
  updatedAt: string;
  lastCompactedAt?: string | null;
  compactionTrigger?: "manual" | "auto" | null;
};

export type ProviderOutputUsage = {
  totalTokens: number | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteInputTokens: number | null;
  outputTokens: number;
  reasoningTokens: number | null;
  updatedAt: string;
};
export type CodexOutputUsageBaseline = Omit<ProviderOutputUsage,"updatedAt">;

function finite(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function percentage(usedTokens: number | null, windowTokens: number | null) {
  if (usedTokens === null || windowTokens === null || windowTokens <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((usedTokens / windowTokens) * 1000) / 10));
}

export function codexContextUsage(value: any, updatedAt = new Date().toISOString()): ProviderContextUsage | null {
  const last = value?.last;
  const usedTokens = finite(last?.totalTokens);
  const windowTokens = finite(value?.modelContextWindow);
  if (usedTokens === null && windowTokens === null) return null;
  return { usedTokens, windowTokens, percent: percentage(usedTokens, windowTokens), updatedAt };
}

export function codexOutputUsage(value:any,updatedAt=new Date().toISOString()):ProviderOutputUsage|null{
  const outputTokens=finite(value?.last?.outputTokens);
  if(outputTokens===null)return null;
  return{totalTokens:finite(value?.last?.totalTokens),inputTokens:finite(value?.last?.inputTokens),cachedInputTokens:finite(value?.last?.cachedInputTokens),cacheWriteInputTokens:finite(value?.last?.cacheWriteInputTokens),outputTokens,reasoningTokens:finite(value?.last?.reasoningOutputTokens),updatedAt};
}

function codexUsageBucket(value:any):CodexOutputUsageBaseline|null{
  const outputTokens=finite(value?.outputTokens);
  if(outputTokens===null)return null;
  return{totalTokens:finite(value?.totalTokens),inputTokens:finite(value?.inputTokens),cachedInputTokens:finite(value?.cachedInputTokens),cacheWriteInputTokens:finite(value?.cacheWriteInputTokens),outputTokens,reasoningTokens:finite(value?.reasoningOutputTokens)};
}

export function codexTaskOutputUsage(
  value:any,
  baseline:CodexOutputUsageBaseline|null,
  updatedAt=new Date().toISOString(),
):{usage:ProviderOutputUsage|null;baseline:CodexOutputUsageBaseline|null}{
  const cumulative=codexUsageBucket(value?.total),last=codexUsageBucket(value?.last);
  if(!cumulative)return{usage:codexOutputUsage(value,updatedAt),baseline};
  const subtract=(current:number|null,previous:number|null,fallback:number|null)=>{
    if(current===null)return fallback;
    if(previous===null)return fallback??current;
    return Math.max(0,current-previous);
  };
  const established=baseline??{
    totalTokens:subtract(cumulative.totalTokens,last?.totalTokens??null,last?.totalTokens??null),
    inputTokens:subtract(cumulative.inputTokens,last?.inputTokens??null,last?.inputTokens??null),
    cachedInputTokens:subtract(cumulative.cachedInputTokens,last?.cachedInputTokens??null,last?.cachedInputTokens??null),
    cacheWriteInputTokens:subtract(cumulative.cacheWriteInputTokens,last?.cacheWriteInputTokens??null,last?.cacheWriteInputTokens??null),
    outputTokens:subtract(cumulative.outputTokens,last?.outputTokens??null,last?.outputTokens??0)??0,
    reasoningTokens:subtract(cumulative.reasoningTokens,last?.reasoningTokens??null,last?.reasoningTokens??null)
  };
  const outputTokens=subtract(cumulative.outputTokens,established.outputTokens,last?.outputTokens??0)??0;
  const inputTokens=subtract(cumulative.inputTokens,established.inputTokens,last?.inputTokens??null);
  return{
    baseline:established,
    usage:{
      totalTokens:inputTokens===null?subtract(cumulative.totalTokens,established.totalTokens,last?.totalTokens??null):inputTokens+outputTokens,
      inputTokens,
      cachedInputTokens:subtract(cumulative.cachedInputTokens,established.cachedInputTokens,last?.cachedInputTokens??null),
      cacheWriteInputTokens:subtract(cumulative.cacheWriteInputTokens,established.cacheWriteInputTokens,last?.cacheWriteInputTokens??null),
      outputTokens,
      reasoningTokens:subtract(cumulative.reasoningTokens,established.reasoningTokens,last?.reasoningTokens??null),
      updatedAt
    }
  };
}

export function claudeContextWindow(model: unknown) {
  const id = String(model ?? "").toLowerCase();
  if (!id || id === "default") return null;
  // Claude Code reports the canonical runtime model in message events, so a
  // configured `[1m]` alias can arrive here simply as `claude-opus-5`.
  const millionContext=id.includes("[1m]")
    || /(?:^|[-_])1m(?:$|[-_])/.test(id)
    || /(?:^|[-_])opus[-_]5(?:$|[-_])/.test(id);
  return millionContext ? 1_000_000 : 200_000;
}

export function claudeContextUsage(usage: any, model: unknown, updatedAt = new Date().toISOString()): ProviderContextUsage | null {
  if (!usage || typeof usage !== "object") return null;
  const parts = [usage.input_tokens, usage.cache_creation_input_tokens, usage.cache_read_input_tokens].map(finite);
  const known = parts.filter((value): value is number => value !== null);
  if (!known.length) return null;
  const usedTokens = known.reduce((sum, value) => sum + value, 0);
  const windowTokens = claudeContextWindow(model);
  return { usedTokens, windowTokens, percent: percentage(usedTokens, windowTokens), updatedAt };
}

export function claudeContextUsageFromStreamEvent(event: any, fallbackModel: unknown, updatedAt = new Date().toISOString()): ProviderContextUsage | null {
  // Claude's top-level `result.usage` is cumulative billing usage for the
  // entire CLI run. It is not the live context size and can exceed the model
  // window after compaction, which previously made the meter jump back to
  // 100%. Only assistant message usage describes the current model request.
  if (event?.type !== "assistant" || !event.message?.usage) return null;
  return claudeContextUsage(event.message.usage, event.message?.model ?? event.model ?? fallbackModel, updatedAt);
}

export function claudeOutputUsageFromStreamEvent(event:any,updatedAt=new Date().toISOString()):ProviderOutputUsage|null{
  const usage=event?.type==="assistant"
    ?event.message?.usage
    :event?.type==="stream_event"&&event.event?.type==="message_delta"
      ?event.event?.usage
      :null;
  const outputTokens=finite(usage?.output_tokens);
  if(outputTokens===null)return null;
  const directInput=finite(usage?.input_tokens),cacheWriteInputTokens=finite(usage?.cache_creation_input_tokens),cachedInputTokens=finite(usage?.cache_read_input_tokens),inputs=[directInput,cacheWriteInputTokens,cachedInputTokens].filter((value):value is number=>value!==null),inputTokens=inputs.length?inputs.reduce((sum,value)=>sum+value,0):null;
  return{totalTokens:inputTokens===null?null:inputTokens+outputTokens,inputTokens,cachedInputTokens,cacheWriteInputTokens,outputTokens,reasoningTokens:null,updatedAt};
}

export function compactedContext(previous: ProviderContextUsage | null | undefined, trigger: unknown, updatedAt = new Date().toISOString()): ProviderContextUsage {
  return {
    usedTokens: null,
    windowTokens: previous?.windowTokens ?? null,
    percent: null,
    updatedAt,
    lastCompactedAt: updatedAt,
    compactionTrigger: trigger === "auto" ? "auto" : trigger === "manual" ? "manual" : null
  };
}
