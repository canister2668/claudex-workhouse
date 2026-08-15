export type DisplayProvider="codex"|"claude"|"antigravity"|"deepseek"|"ollama"|"grok";

const PROVIDER_NAMES:Record<DisplayProvider,string>={
  codex:"Codex",
  claude:"Claude",
  antigravity:"Gemini",
  deepseek:"DeepSeek",
  ollama:"Ollama",
  grok:"Grok"
};

export function providerDisplayName(provider:DisplayProvider|string){
  return PROVIDER_NAMES[provider as DisplayProvider]??provider;
}
