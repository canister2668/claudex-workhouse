import{describe,expect,it}from"vitest";
import{parseGrokModels}from"../../src/server/grok-runtime";

describe("Grok runtime adapters",()=>{
  it("extracts canonical model ids from the CLI catalog",()=>{
    expect(parseGrokModels("Default model: grok-4.5\n\nAvailable models:\n  * grok-4.5 (default)\n  * grok-build-0.1\n")).toEqual([
      {id:"grok-4.5",displayName:"grok-4.5",source:"runtime"},
      {id:"grok-build-0.1",displayName:"grok-build-0.1",source:"runtime"}
    ]);
  });
});
