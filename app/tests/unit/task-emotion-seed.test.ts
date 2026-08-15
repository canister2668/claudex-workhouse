import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { seedTaskEmotion } from "../../src/server/task-emotion-seed.js";

const created:string[]=[];
afterEach(()=>{for(const item of created.splice(0))fs.rmSync(item,{recursive:true,force:true});});

function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"claudex-workhouse-seed-"));created.push(root);
  const data=path.join(root,"data","emotion");fs.mkdirSync(data,{recursive:true});
  return{root,data};
}
const taskFile=(data:string,provider:string,taskId:string)=>path.join(data,"tasks",provider,`${crypto.createHash("sha256").update(taskId).digest("hex")}.json`);
const read=(file:string)=>JSON.parse(fs.readFileSync(file,"utf8"));

describe("launch-time emotion seed",()=>{
  it("replaces the previous task's outcome the moment a new task exists",()=>{
    const x=fixture(),previous={emotion:"proud",line:"해냈어요!",statusLine:"완료!",outfit:"capy",source:"claude-worker",sessionId:"old-session",taskId:"claude:old",taskStartedAt:1,timestamp:2};
    fs.writeFileSync(path.join(x.data,"state.json"),`${JSON.stringify(previous)}\n`);
    seedTaskEmotion(x.root,"claude","claude:new","new-session",1000);
    const global=read(path.join(x.data,"state.json"));
    expect(global).toMatchObject({emotion:"thinking",statusKey:"avatar.status.thinking",taskId:"claude:new",sessionId:"new-session",taskStartedAt:1000,source:"claude-start"});
    // The user's outfit choice is appearance, not state, and survives the seed.
    expect(global.outfit).toBe("capy");
    expect(read(taskFile(x.data,"claude","claude:new"))).toMatchObject({emotion:"thinking",taskId:"claude:new"});
    // The finished task keeps its own outcome for its own avatar.
    expect(read(path.join(x.data,"state.json")).taskId).not.toBe("claude:old");
  });

  it("writes a task-scoped state for every provider without a prior file",()=>{
    const x=fixture();
    for(const provider of ["codex","deepseek","ollama","antigravity"] as const){
      seedTaskEmotion(x.root,provider,`${provider}:1`,null);
      expect(read(taskFile(x.data,provider,`${provider}:1`))).toMatchObject({emotion:"thinking",source:`${provider}-start`});
    }
    expect(read(path.join(x.data,"codex-state.json")).outfit).toBe("Gpt-Sol");
  });

  it("preserves the selected Codex outfit while seeding a new task",()=>{
    const x=fixture();fs.writeFileSync(path.join(x.data,"codex-state.json"),JSON.stringify({emotion:"neutral",outfit:"Gpt-Sol"}));
    seedTaskEmotion(x.root,"codex","codex:new",null);
    expect(read(path.join(x.data,"codex-state.json")).outfit).toBe("Gpt-Sol");
  });

  it("never throws into the launch path when the data root is unusable",()=>{
    const x=fixture(),blocked=path.join(x.root,"blocked");fs.writeFileSync(blocked,"not a directory");
    expect(()=>seedTaskEmotion(blocked,"claude","claude:new",null)).not.toThrow();
  });
});
