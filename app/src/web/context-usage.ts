import type { AgentEvent } from "./events";

export type ContextUsage = {
  usedTokens: number | null;
  windowTokens: number | null;
  percent: number | null;
  updatedAt: string | null;
  lastCompactedAt?: string | null;
  compactionTrigger?: "manual" | "auto" | null;
};

type ContextUsageOptions={provider?:"codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok";model?:unknown};

function valid(value: unknown): ContextUsage | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const number = (input: unknown) => Number.isFinite(Number(input)) && Number(input) >= 0 ? Number(input) : null;
  const usedTokens = item.usedTokens === null ? null : number(item.usedTokens);
  const windowTokens = item.windowTokens === null ? null : number(item.windowTokens);
  const percent = item.percent === null ? null : number(item.percent);
  if (usedTokens === null && windowTokens === null && !item.lastCompactedAt) return null;
  return { usedTokens, windowTokens, percent, updatedAt:typeof item.updatedAt === "string" ? item.updatedAt : null, lastCompactedAt:typeof item.lastCompactedAt === "string" ? item.lastCompactedAt : null, compactionTrigger:item.compactionTrigger === "auto" ? "auto" : item.compactionTrigger === "manual" ? "manual" : null };
}

export function contextUsageFromEvent(event: AgentEvent): ContextUsage | null {
  return valid(event.metadata?.contextUsage);
}

function normalized(value:ContextUsage|null,options:ContextUsageOptions){
  if(!value||options.provider!=="claude"||value.usedTokens===null)return value;
  // Claude result events used to be persisted as context snapshots even
  // though they contain cumulative billing totals. Values beyond Claude's
  // largest supported context window cannot be live context usage.
  if(value.usedTokens>1_000_000)return null;
  const model=String(options.model??"").toLowerCase();
  const millionModel=model.includes("[1m]")||/(?:^|[-_])1m(?:$|[-_])/.test(model)||/(?:^|[-_])opus[-_]5(?:$|[-_])/.test(model);
  const windowTokens=millionModel||value.usedTokens>200_000?1_000_000:value.windowTokens;
  const percent=windowTokens&&windowTokens>0?Math.max(0,Math.min(100,Math.round(value.usedTokens/windowTokens*1000)/10)):value.percent;
  return{...value,windowTokens,percent};
}

export function latestContextUsage(events: AgentEvent[], fallback: unknown = null,options:ContextUsageOptions={}) {
  let current = normalized(valid(fallback),options);
  for (const event of events){
    const raw=contextUsageFromEvent(event);
    if(!raw)continue;
    const next=normalized(raw,options);
    // Ignore impossible legacy cumulative snapshots while retaining the
    // preceding valid message usage (or the compaction boundary).
    if(next)current=next;
  }
  return current;
}

export function formatContextTokens(value: number | null) {
  if (value === null) return "";
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  if (value >= 1_000) return `${Math.round(value / 100) / 10}k`;
  return String(value);
}
