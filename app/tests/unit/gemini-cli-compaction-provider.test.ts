import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterAll,describe,expect,it,vi} from "vitest";
import {AntigravityProvider} from "../../src/server/providers/antigravity";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"gemini-provider-"));
afterAll(()=>fs.rmSync(root,{recursive:true,force:true}));
function fixture(){
  const provider=new AntigravityProvider({root,dataDir:root,projects:[{id:"p",realPath:root}]} as any,{upsertTask:async(task:any)=>task} as any);
  const task:any={id:"antigravity:old",threadId:"native",projectId:"p",metadata:{antigravityExecution:{version:1,backend:"vertex-agent",vertex:{projectId:"sample-project",location:"global",credentialsPath:"",creditsUrl:""}}}};
  const launch=vi.spyOn(provider as any,"launch").mockResolvedValue({id:"compact",metadata:{}});
  return{provider,task,launch};
}
describe("Gemini compaction routing",()=>{
  it("launches maintenance mode instead of sending a slash prompt",async()=>{
    const {provider,task,launch}=fixture();vi.spyOn(provider,"listTasks").mockResolvedValue([]);
    await provider.compactThread(task);
    expect(launch.mock.calls[0][0]).toMatchObject({prompt:""});
    expect(launch.mock.calls[0].slice(1,4)).toEqual(["compact","native","native"]);
  });
  it("refuses compaction when another task owns the native thread",async()=>{
    const {provider,task,launch}=fixture();vi.spyOn(provider,"listTasks").mockResolvedValue([{...task,status:"running"}]);
    await expect(provider.compactThread(task)).rejects.toThrow(/busy/);expect(launch).not.toHaveBeenCalled();
  });
});
