import {describe,expect,it} from "vitest";
import {hideOwnedProviderSessionMirrors} from "../../src/server/provider-session-mirrors.js";

const row=(value:Record<string,unknown>)=>value as any;

describe("provider session mirror de-duplication",()=>{
  it("uses the Workhouse task as the canonical row for every provider",()=>{
    for(const provider of ["codex","claude","deepseek","ollama","antigravity","grok"]){
      const owned=row({id:`${provider}:owned`,provider,threadId:"session-a",providerSessionId:"session-a",owned:true});
      const mirror=row({id:`${provider}:external:session-a`,provider,threadId:"session-a",providerSessionId:"session-a",owned:false,ownership:"external"});
      expect(hideOwnedProviderSessionMirrors([mirror,owned])).toEqual([owned]);
      expect(hideOwnedProviderSessionMirrors([mirror])).toEqual([mirror]);
    }
  });

  it("never merges two providers that happen to share a thread id",()=>{
    const owned=row({id:"codex:owned",provider:"codex",threadId:"shared",owned:true});
    const grok=row({id:"grok:external:shared",provider:"grok",threadId:"shared",owned:false,ownership:"external"});
    const antigravity=row({id:"antigravity:external:shared",provider:"antigravity",threadId:"shared",owned:false,ownership:"external"});
    expect(hideOwnedProviderSessionMirrors([grok,antigravity,owned])).toEqual([grok,antigravity,owned]);
  });

  it("still hides a Claude transcript mirror owned by a Claude-CLI compatible provider",()=>{
    const deepseek=row({id:"deepseek:owned",provider:"deepseek",threadId:"shared-session",owned:true});
    const mirror=row({id:"claude:external:shared-session",provider:"claude",threadId:"shared-session",owned:false,ownership:"external"});
    expect(hideOwnedProviderSessionMirrors([mirror],[mirror,deepseek])).toEqual([]);
  });

  it("keeps a mirror whose session is not owned and rows without a session id",()=>{
    const pending=row({id:"claude:pending",provider:"claude",threadId:null,providerSessionId:null,owned:false});
    const unrelated=row({id:"claude:external:session-b",provider:"claude",threadId:"session-b",owned:false,ownership:"external"});
    expect(hideOwnedProviderSessionMirrors([pending,unrelated])).toEqual([pending,unrelated]);
  });
});
