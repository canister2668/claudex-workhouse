import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import{afterEach,describe,expect,it}from"vitest";
import{captureTaskImageOutput,resolveTaskImageOutput}from"../../src/server/task-image-output.js";

const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64");
const roots:string[]=[];afterEach(()=>{delete process.env.CODEX_HOME;for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

describe("task image output",()=>{
  it("captures the real Codex image-generation layout when savedPath is absent",()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"task-image-output-")),codex=path.join(root,"codex-home"),thread="thread-1",item="exec-1";roots.push(root);process.env.CODEX_HOME=codex;
    fs.mkdirSync(path.join(codex,"generated_images",thread),{recursive:true});fs.writeFileSync(path.join(codex,"generated_images",thread,`${item}.png`),png);
    const metadata=captureTaskImageOutput({root,taskId:"codex:task:1",threadId:thread,item:{type:"imageGeneration",id:item,status:"completed"}});
    expect(metadata).toMatchObject({mediaKind:"image",mediaPathBase:"task-output"});
    const output=resolveTaskImageOutput(root,"codex:task:1",(metadata as any).mediaPath);
    expect(fs.readFileSync(output.real)).toEqual(png);expect(output.mime).toBe("image/png");
  });

  it("binds every managed path to its source task",()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"task-image-output-")),codex=path.join(root,"codex-home");roots.push(root);process.env.CODEX_HOME=codex;
    fs.mkdirSync(path.join(codex,"generated_images","thread"),{recursive:true});fs.writeFileSync(path.join(codex,"generated_images","thread","item.png"),png);
    const metadata=captureTaskImageOutput({root,taskId:"task-a",threadId:"thread",item:{type:"imageGeneration",id:"item"}}) as any;
    expect(()=>resolveTaskImageOutput(root,"task-b",metadata.mediaPath)).toThrow(/invalid/i);
  });
});
