import {describe,expect,it} from "vitest";
import {compatibleDefaultsFromUi,compatibleUiFromDelegation,reconcileDelegationAfterModelSave} from "../../src/web/delegation-save.js";

const settings=(model:string)=>({
  version:3,
  claude:{launchMode:"managed" as const,model,reasoningEffort:"default"},
  codex:{launchMode:"managed" as const,model:"gpt-current",reasoningEffort:null,serviceTier:null},
  deepseek:{launchMode:"managed" as const,model:null,reasoningEffort:null},ollama:{launchMode:"managed" as const,model:null,reasoningEffort:null},antigravity:{launchMode:"managed" as const,model:null,reasoningEffort:null},grok:{launchMode:"managed" as const,model:null,reasoningEffort:null}
});
const enabled={claude:{models:[{id:"claude-fable-5"},{id:"claude-opus-5"}]},codex:{models:[{id:"gpt-current"}]},deepseek:{models:[{id:"deepseek-v4-pro"}]},ollama:{models:[{id:"mistral-large-3:675b"},{id:"deepseek-v4-pro"}]},antigravity:{models:[{id:"gemini-pro"}]},grok:{models:[{id:"grok-build"}]}};

describe("delegation settings save",()=>{
  it("keeps a newly selected enabled Claude model when the model-list response contains the previous selection",()=>{
    expect(reconcileDelegationAfterModelSave(
      settings("claude-opus-5"),
      settings("claude-fable-5"),
      enabled
    ).claude.model).toBe("claude-opus-5");
  });

  it("uses the server fallback only when the pending model was disabled",()=>{
    expect(reconcileDelegationAfterModelSave(
      settings("claude-opus-5"),
      settings("claude-fable-5"),
      {...enabled,claude:{models:[{id:"claude-fable-5"}]}}
    ).claude.model).toBe("claude-fable-5");
  });

  it("keeps a newly selected enabled Ollama default instead of the server's previous catalog-first model",()=>{
    const pending=settings("claude-opus-5"),server=settings("claude-opus-5");pending.ollama.model="deepseek-v4-pro";server.ollama.model="mistral-large-3:675b";
    expect(reconcileDelegationAfterModelSave(pending,server,enabled).ollama.model).toBe("deepseek-v4-pro");
  });

  it("uses the server-compatible fallback when the pending Ollama model was disabled",()=>{
    const pending=settings("claude-opus-5"),server=settings("claude-opus-5");pending.ollama.model="deepseek-v4-pro";server.ollama.model="mistral-large-3:675b";
    expect(reconcileDelegationAfterModelSave(pending,server,{...enabled,ollama:{models:[{id:"mistral-large-3:675b"}]}}).ollama.model).toBe("mistral-large-3:675b");
  });

  it("round-trips compatible UI defaults with the null/default effort sentinel",()=>{
    const original=settings("claude-opus-5"),fromUi=compatibleDefaultsFromUi(original,{deepseek:"deepseek-v4-pro",ollama:"deepseek-v4-pro",antigravity:"gemini-pro",grok:"grok-build"},{deepseek:"default",ollama:"high",antigravity:"default",grok:"max"}),ui=compatibleUiFromDelegation(fromUi,{deepseek:"",ollama:"",antigravity:"",grok:""},{deepseek:"default",ollama:"default",antigravity:"default",grok:"default"});
    expect(fromUi.ollama).toMatchObject({model:"deepseek-v4-pro",reasoningEffort:"high"});expect(fromUi.deepseek.reasoningEffort).toBeNull();expect(ui).toEqual({models:{deepseek:"deepseek-v4-pro",ollama:"deepseek-v4-pro",antigravity:"gemini-pro",grok:"grok-build"},efforts:{deepseek:"default",ollama:"high",antigravity:"default",grok:"max"}});
  });

  it("preserves an existing browser default until it is promoted to the canonical server setting",()=>{
    const stored=settings("claude-opus-5");stored.ollama.model="mistral-large-3:675b";stored.ollama.reasoningEffort="low";
    expect(compatibleUiFromDelegation(stored,{deepseek:"deepseek-v4-pro",ollama:"deepseek-v4-pro",antigravity:"gemini-pro",grok:"grok-build"},{deepseek:"default",ollama:"high",antigravity:"default",grok:"default"}).models.ollama).toBe("deepseek-v4-pro");
  });
});
