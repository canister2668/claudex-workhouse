// Per-call Claude API cost from token usage at Anthropic list prices.
//
// The CLI's own `total_cost_usd` is not used for the credit display: the pinned
// CLI prices models it does not know at an old default and charges cache reads
// at 0.1x input, so a long Opus 5.5 session (mostly cache reads at $0.20/MTok)
// was reported at ~7x what the Console billed. Prices are USD per million
// tokens; update this table when Anthropic changes them.
type Price={input:number;output:number;cacheRead:number};

const PRICES:Array<[RegExp,Price]>=[
  [/^claude-fable-5-1/,{input:10,output:50,cacheRead:0.25}],
  [/^claude-(?:fable|mythos)-5/,{input:10,output:50,cacheRead:1}],
  [/^claude-opus-5-5/,{input:4,output:20,cacheRead:0.2}],
  [/^claude-opus-(?:5|4-[5-8])/,{input:5,output:25,cacheRead:0.5}],
  [/^claude-sonnet-5-5/,{input:2,output:10,cacheRead:0.2}],
  [/^claude-sonnet-5/,{input:2,output:10,cacheRead:0.2}],
  [/^claude-sonnet-4/,{input:3,output:15,cacheRead:0.3}],
  [/^claude-haiku-5-5/,{input:0.1,output:0.5,cacheRead:0.01}],
  [/^claude-haiku-4/,{input:1,output:5,cacheRead:0.1}]
];
// Unknown models are charged at the Opus 5 rate so the display errs high.
const FALLBACK:Price={input:5,output:25,cacheRead:0.5};
// Claude Haiku 5.5 charges a higher rate once a prompt exceeds 100K tokens.
const HAIKU_LONG:Price={input:0.5,output:2.5,cacheRead:0.05};

export type ClaudeCallUsage={
  input_tokens?:number;output_tokens?:number;cache_read_input_tokens?:number;cache_creation_input_tokens?:number;
  cache_creation?:{ephemeral_5m_input_tokens?:number;ephemeral_1h_input_tokens?:number}|null;speed?:string|null;
};

const n=(value:unknown)=>typeof value==="number"&&Number.isFinite(value)&&value>0?value:0;

export function claudeModelPrice(model:string|null|undefined,promptTokens=0):{price:Price;known:boolean}{
  const id=String(model??"").toLowerCase().replace(/\[1m\]$/,"");
  const match=PRICES.find(([pattern])=>pattern.test(id));
  if(match&&/^claude-haiku-5-5/.test(id)&&promptTokens>100_000)return{price:HAIKU_LONG,known:true};
  return match?{price:match[1],known:true}:{price:FALLBACK,known:false};
}

export function claudeCallCostUsd(model:string|null|undefined,usage:ClaudeCallUsage){
  const input=n(usage.input_tokens),output=n(usage.output_tokens),read=n(usage.cache_read_input_tokens);
  const oneHour=n(usage.cache_creation?.ephemeral_1h_input_tokens);
  const fiveMinute=usage.cache_creation&&usage.cache_creation.ephemeral_5m_input_tokens!==undefined?n(usage.cache_creation.ephemeral_5m_input_tokens):Math.max(0,n(usage.cache_creation_input_tokens)-oneHour);
  const {price}=claudeModelPrice(model,input+read+fiveMinute+oneHour);
  // Fast mode doubles every rate on the models that offer it.
  const speed=usage.speed==="fast"?2:1;
  return speed*(input*price.input+output*price.output+read*price.cacheRead+fiveMinute*price.input*1.25+oneHour*price.input*2)/1_000_000;
}
