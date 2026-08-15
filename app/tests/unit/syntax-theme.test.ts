import fs from "node:fs";
import path from "node:path";
import { describe,expect,it } from "vitest";

const css=fs.readFileSync(path.join(process.cwd(),"src","web","styles.css"),"utf8");
const viewer=fs.readFileSync(path.join(process.cwd(),"src","web","WorkspaceViewer.svelte"),"utf8");

function block(selector:string){
  const start=css.indexOf(`${selector}{`);
  if(start<0)throw new Error(`Missing ${selector}`);
  let cursor=start+selector.length+1,depth=1;
  while(cursor<css.length&&depth){if(css[cursor]==="{")depth++;else if(css[cursor]==="}")depth--;cursor++;}
  return css.slice(start+selector.length+1,cursor-1);
}

function syntaxTokens(source:string){
  return Object.fromEntries([...source.matchAll(/(--syntax-[a-z0-9-]+):([^;]+);/g)].map(match=>[match[1],match[2]]));
}

function luminance(hex:string){
  const channels=[1,3,5].map(offset=>Number.parseInt(hex.slice(offset,offset+2),16)/255)
    .map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);
  return .2126*channels[0]+.7152*channels[1]+.0722*channels[2];
}

describe("syntax theme tokens",()=>{
  it("preserves the existing dark syntax palette",()=>{
    const dark=syntaxTokens(block(":root"));
    expect(dark).toMatchObject({
      "--syntax-comment":"#82908f","--syntax-string":"#e7a478","--syntax-number":"#a8cc8c","--syntax-keyword":"#c792ea",
      "--syntax-literal":"#ff9d76","--syntax-type":"#72d5c6","--syntax-function":"#82aaff","--syntax-property":"#addbff",
      "--syntax-operator":"#f071a8","--syntax-punctuation":"#91a4b7","--syntax-bracket-0":"#ffd866","--syntax-bracket-1":"#c792ea",
      "--syntax-bracket-2":"#55d6be","--syntax-bracket-3":"#ff9d76","--syntax-bracket-4":"#82aaff","--syntax-bracket-5":"#a8cc8c",
    });
  });

  it("duplicates the explicit light palette for system light mode",()=>{
    const explicit=syntaxTokens(block(':root[data-theme="light"]'));
    const system=syntaxTokens(block(':root:not([data-theme="dark"]):not([data-theme="light"])'));
    expect(system).toEqual(explicit);
  });

  it("keeps every opaque light syntax color above 4.5:1 on white",()=>{
    const tokens=syntaxTokens(block(':root[data-theme="light"]'));
    const colors=[...new Set(Object.entries(tokens)
      .filter(([name,value])=>!["--syntax-bg","--syntax-fg","--syntax-match-bg"].includes(name)&&/^#[0-9a-f]{6}$/i.test(value))
      .map(([,value])=>value))];
    expect(colors).toHaveLength(13);
    for(const color of colors)expect(1.05/(luminance(color)+.05),color).toBeGreaterThanOrEqual(4.5);
  });

  it("shares tokenized rules between the viewer and editor backdrop",()=>{
    expect(viewer).toContain(".code .comment,.editor-backdrop .comment{color:var(--syntax-comment)");
    expect(viewer).toContain(".code .bracket-0,.editor-backdrop .bracket-0{color:var(--syntax-bracket-0)");
    expect(viewer).not.toMatch(/#(?:82908f|e7a478|a8cc8c|c792ea|ff9d76|72d5c6|82aaff|addbff|f071a8|91a4b7|ffd866|55d6be|718096|f5f7ff)/i);
  });
});
