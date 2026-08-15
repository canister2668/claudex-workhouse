import {describe,expect,it} from "vitest";
import {highlightCode,matchingBracketOffsets,positionedHighlightCode} from "../../src/web/syntax-highlight.js";

describe("workspace syntax highlighting",()=>{
  it("colors matching brackets by nesting depth",()=>{
    const tokens=highlightCode("call({items: [value]})")[0].filter(token=>token.kind.startsWith("bracket"));
    expect(tokens).toEqual([
      {text:"(",kind:"bracket-0"},{text:"{",kind:"bracket-1"},{text:"[",kind:"bracket-2"},
      {text:"]",kind:"bracket-2"},{text:"}",kind:"bracket-1"},{text:")",kind:"bracket-0"}
    ]);
  });

  it("distinguishes language structure instead of coloring the whole line",()=>{
    const tokens=highlightCode("export async function load(input: Request): Promise<string> { return true; }")[0];
    expect(tokens).toEqual(expect.arrayContaining([
      {text:"export",kind:"keyword"},{text:"async",kind:"keyword"},{text:"function",kind:"keyword"},
      {text:"load",kind:"function"},{text:"Request",kind:"type"},{text:"Promise",kind:"type"},
      {text:"string",kind:"type"},{text:"return",kind:"keyword"},{text:"true",kind:"literal"}
    ]));
  });

  it("keeps multiline comments in comment styling",()=>{
    const lines=highlightCode("const before = 1; /* open\nstill comment */ const after = 2;");
    expect(lines[0].at(-1)).toEqual({text:"/* open",kind:"comment"});
    expect(lines[1][0]).toEqual({text:"still comment */",kind:"comment"});
    expect(lines[1]).toContainEqual({text:"const",kind:"keyword"});
  });

  it("does not mistake a decrement operator for a Lua comment",()=>{
    const tokens=highlightCode("count--; -- actual comment")[0];
    expect(tokens).toContainEqual({text:"--",kind:"operator"});
    expect(tokens.at(-1)).toEqual({text:"-- actual comment",kind:"comment"});
  });

  it("finds the matching structural bracket next to the caret",()=>{
    const source="call({items: [value]})",lines=positionedHighlightCode(source);
    expect(matchingBracketOffsets(source,4,lines)).toEqual([4,21]);
    expect(matchingBracketOffsets(source,14,lines)).toEqual([13,19]);
    expect(matchingBracketOffsets('"ignored ( bracket"',10)).toEqual([]);
  });
});
