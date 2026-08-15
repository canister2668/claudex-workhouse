import fs from "node:fs";
import path from "node:path";
import {afterEach,describe,expect,it} from "vitest";
import {ClaudeProvider} from "../../src/server/providers/claude.js";
import type {DeckTask} from "../../src/server/types.js";

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

describe("local Claude interruption reconciliation",()=>{
  it("turns an unknown managed task with a missing process into a recoverable stop",async()=>{
    const root=fs.mkdtempSync(path.resolve("../data/claude-interruption-"));roots.push(root);
    const stateDir=path.join(root,"claude-jobs");fs.mkdirSync(stateDir,{recursive:true});
    const timestamp="2026-07-29T09:00:00.000Z",task:DeckTask={
      id:"claude:lost",provider:"claude",nativeId:"lost",threadId:"11111111-1111-4111-8111-111111111111",projectId:"project",title:"Interrupted",prompt:"work",status:"unknown",createdAt:timestamp,updatedAt:timestamp,result:null,error:null,log:"",owned:true,pid:2147483647,pgid:2147483647,processStart:"missing",commandMarker:"claudex-workhouse:lost",parentThreadId:null,executionHostId:"local",workspaceId:"workspace",ownership:"claudex-workhouse",source:"claudex-workhouse",metadata:{}
    };
    fs.writeFileSync(path.join(stateDir,"claude_lost.json"),JSON.stringify({status:"running",sessionId:task.threadId,updatedAt:timestamp,pid:task.pid,pgid:task.pgid,processStart:task.processStart}));
    const persisted:DeckTask[]=[];
    const db={upsertTask:async(value:DeckTask)=>{persisted.push(value);return value;}} as any;
    const provider=new ClaudeProvider({root,dataDir:root,projects:[]} as any,db);
    const recovered=await (provider as any).refresh(task) as DeckTask;
    expect(recovered).toMatchObject({status:"stopped",threadId:task.threadId,metadata:{interruptionCause:"worker-process-lost"}});
    expect(persisted).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(path.join(stateDir,"claude_lost.json"),"utf8"))).toMatchObject({status:"stopped"});
  });
});
