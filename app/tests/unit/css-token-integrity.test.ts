import fs from "node:fs";
import path from "node:path";
import { describe,expect,it } from "vitest";

const webRoot=path.join(process.cwd(),"src","web");

function files(directory:string):string[]{
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    const target=path.join(directory,entry.name);
    return entry.isDirectory()?files(target):entry.isFile()&&(entry.name.endsWith(".svelte")||entry.name.endsWith(".css"))?[target]:[];
  });
}

function variableCalls(source:string){
  const calls:Array<{name:string;fallback:boolean;offset:number}>=[];let cursor=0;
  while((cursor=source.indexOf("var(",cursor))>=0){
    const start=cursor,cursorStart=cursor+=4;let depth=1,comma=false;
    while(cursor<source.length&&depth){
      const character=source[cursor];
      if(character==="(")depth++;
      else if(character===")")depth--;
      else if(character===","&&depth===1)comma=true;
      cursor++;
    }
    const name=source.slice(cursorStart,cursor).match(/^\s*(--[A-Za-z0-9_-]+)/)?.[1];
    if(name)calls.push({name,fallback:comma,offset:start});
  }
  return calls;
}

describe("CSS token integrity",()=>{
  it("defines every custom property referenced without a fallback",()=>{
    const sources=files(webRoot).map(file=>({file,source:fs.readFileSync(file,"utf8")}));
    const defined=new Set(sources.flatMap(({source})=>[...source.matchAll(/(?:^|[;{])\s*(--[A-Za-z0-9_-]+)\s*:/gm)].map(match=>match[1])));
    const missing=sources.flatMap(({file,source})=>variableCalls(source)
      .filter(call=>!call.fallback&&!defined.has(call.name))
      .map(call=>`${path.relative(webRoot,file)}:${source.slice(0,call.offset).split("\n").length} ${call.name}`));
    expect(missing).toEqual([]);
  });

  it("does not retain the legacy warning token",()=>{
    const references=files(webRoot).flatMap(file=>variableCalls(fs.readFileSync(file,"utf8")).map(call=>call.name));
    expect(references).not.toContain("--warning");
  });
});
