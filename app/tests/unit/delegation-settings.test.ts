import {describe,expect,it} from "vitest";
import {applyGlobalDelegationModels,DEFAULT_DELEGATION_SETTINGS} from "../../src/server/delegation-settings.js";

const entry=(id:string)=>({id,displayName:id,source:"runtime" as const,validatedAt:null});
const globalSettings={version:1 as const,claude:{models:[entry("claude-opus-5")]},codex:{models:[entry("gpt-default"),entry("gpt-other")]},deepseek:{models:[entry("deepseek-v4-pro")]},ollama:{models:[entry("mistral-large-3:675b"),entry("deepseek-v4-pro")]},antigravity:{models:[entry("gemini-pro")]},grok:{models:[entry("grok-build")]}};
const codex=[{id:"gpt-default",isDefault:true,defaultReasoningEffort:"medium",supportedReasoningEfforts:[{reasoningEffort:"medium"}],serviceTiers:[]}];

describe("global delegation model reconciliation",()=>{
  it("uses an enabled explicit compatible default instead of catalog ordering",()=>{
    const result=applyGlobalDelegationModels(DEFAULT_DELEGATION_SETTINGS,globalSettings,codex,{deepseek:{model:"deepseek-v4-pro",reasoningEffort:null},ollama:{model:"deepseek-v4-pro",reasoningEffort:"high"},antigravity:{model:"gemini-pro",reasoningEffort:null},grok:{model:"grok-build",reasoningEffort:"max"}});
    expect(result.ollama).toMatchObject({model:"deepseek-v4-pro",reasoningEffort:"high"});
  });

  it("falls back to the first enabled model and clears effort when a requested default is unavailable",()=>{
    const result=applyGlobalDelegationModels(DEFAULT_DELEGATION_SETTINGS,globalSettings,codex,{deepseek:{model:"missing",reasoningEffort:"high"},ollama:{model:"missing",reasoningEffort:"high"},antigravity:{model:"missing",reasoningEffort:"high"},grok:{model:"missing",reasoningEffort:"high"}});
    expect(result.ollama).toMatchObject({model:"mistral-large-3:675b",reasoningEffort:null});
  });

  it("keeps a null compatible default when that provider has no enabled models",()=>{
    const result=applyGlobalDelegationModels(DEFAULT_DELEGATION_SETTINGS,{...globalSettings,ollama:{models:[]}},codex);
    expect(result.ollama.model).toBeNull();
  });
});
