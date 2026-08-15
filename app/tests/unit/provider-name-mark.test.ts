import { describe,expect,it } from "vitest";
import { providerNameMark } from "../../src/web/provider-name-mark";

describe("provider name marks",()=>{
  it("uses fixed collision-free marks for every supported language",()=>{
    expect(["codex","claude","grok","deepseek","ollama","antigravity"].map(provider=>providerNameMark(provider as any,"ko"))).toEqual(["코","클","그","딥","올","젬"]);
    expect(["codex","claude","grok","deepseek","ollama","antigravity"].map(provider=>providerNameMark(provider as any,"en"))).toEqual(["CX","CL","GR","DS","OL","GM"]);
    expect(["codex","claude","grok","deepseek","ollama","antigravity"].map(provider=>providerNameMark(provider as any,"ja"))).toEqual(["コ","ク","グ","デ","オ","ジ"]);
  });
});
