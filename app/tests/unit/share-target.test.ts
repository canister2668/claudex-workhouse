import{describe,expect,it}from"vitest";
import{sharedTaskPrompt}from"../../src/web/share-target";

describe("mobile share target",()=>{
  it("prefills title, text, and URL without duplicating equal values",()=>{
    expect(sharedTaskPrompt({title:"Article",text:"Read this",url:"https://example.test/a"})).toBe("Article\n\nRead this\n\nhttps://example.test/a");
    expect(sharedTaskPrompt({title:"same",text:"same",url:""})).toBe("same");
  });
  it("removes NUL and bounds sensitive shared text before it reaches UI state",()=>{
    const prompt=sharedTaskPrompt({text:`safe\\0${"x".repeat(30_000)}`.replace("\\0","\0")});
    expect(prompt).not.toContain("\0");
    expect(prompt.length).toBeLessThanOrEqual(20_000);
  });
});
