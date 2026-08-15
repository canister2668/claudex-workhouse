import fs from "node:fs";
import path from "node:path";
import {afterEach,describe,expect,it,vi} from "vitest";
import {emptyConfig} from "../../src/server/desktop-worker/config.js";
import {RemoteTaskManager} from "../../src/server/desktop-worker/tasks.js";

const roots:string[]=[];
afterEach(()=>{vi.unstubAllEnvs();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
async function until<T>(read:()=>T,accept:(value:T)=>boolean,timeout=3000){
  const end=Date.now()+timeout;
  while(Date.now()<end){const value=read();if(accept(value))return value;await new Promise(resolve=>setTimeout(resolve,25));}
  throw new Error("condition timed out");
}

describe("Desktop Worker interrupted task recovery",()=>{
  it("persists a missing active process as a host-restart interruption",async()=>{
    const base=fs.mkdtempSync(path.resolve("../data/claudex-worker-recovery-"));roots.push(base);
    vi.stubEnv("CLAUDEX_WORKHOUSE_WORKER_HOME",base);
    const stateFile=path.join(base,"state.json"),timestamp="2026-07-29T09:00:00.000Z";
    fs.writeFileSync(stateFile,JSON.stringify({status:"running",updatedAt:timestamp,pid:2147483647}));
    const config=emptyConfig();
    config.tasks.push({id:"claude:lost",provider:"claude",workspaceId:"workspace",stateFile,pid:2147483647,marker:"claudex-workhouse-worker:lost",createdAt:timestamp,updatedAt:timestamp,status:"running",threadId:"worker-thread",lastForwardedSequence:0});
    const manager=new RemoteTaskManager(config,()=>true);
    try{
      const recovered=await until(()=>manager.list()[0],value=>value?.status==="stopped");
      expect(recovered).toMatchObject({status:"stopped",threadId:"worker-thread",interruptionCause:"worker-host-restarted"});
      await new Promise(resolve=>setTimeout(resolve,400));
      expect(manager.list()[0]).toMatchObject({status:"stopped",interruptionCause:"worker-host-restarted"});
      expect(JSON.parse(fs.readFileSync(path.join(base,"config.json"),"utf8")).tasks[0]).toMatchObject({status:"stopped",interruptionCause:"worker-host-restarted"});
      await expect(manager.command("provider.session.resume",{taskId:"claude:lost",workspaceId:"workspace",expectedThreadId:"different-thread",prompt:"resume"})).rejects.toMatchObject({code:"TASK_RECOVERY_THREAD_MISMATCH"});
    }finally{manager.close();}
  });
  it("publishes a fresh snapshot when a worker state file changes",async()=>{
    const base=fs.mkdtempSync(path.resolve("../data/claudex-worker-snapshot-"));roots.push(base);vi.stubEnv("CLAUDEX_WORKHOUSE_WORKER_HOME",base);
    const stateFile=path.join(base,"state.json"),first="2026-07-29T09:00:00.000Z",second="2026-07-29T09:00:01.000Z";
    fs.writeFileSync(stateFile,JSON.stringify({status:"completed",updatedAt:first,result:"first"}));const config=emptyConfig();config.tasks.push({id:"codex:snapshot",provider:"codex",workspaceId:"workspace",stateFile,pid:null,marker:"done",createdAt:first,updatedAt:first,status:"completed",threadId:"worker-thread",lastForwardedSequence:0});let snapshots=0;
    const manager=new RemoteTaskManager(config,()=>true,()=>snapshots++);try{fs.writeFileSync(stateFile,JSON.stringify({status:"completed",updatedAt:second,result:"final output"}));await until(()=>snapshots,value=>value>0);expect(manager.list()[0]).toMatchObject({updatedAt:second,result:"final output"});}finally{manager.close();}
  });
});
