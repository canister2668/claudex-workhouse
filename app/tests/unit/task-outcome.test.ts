import{describe,expect,it}from"vitest";
import{hasTaskOutcomeDetails,taskOutcomeSummary}from"../../src/web/task-outcome";
describe("task outcome summary",()=>{
  it("collects changed files and evidence-backed checks",()=>{
    const result=taskOutcomeSummary({status:"completed",result:"Fixed the parser. More detail."},[
      {type:"file_change_completed",metadata:{path:"src/a.ts"}},
      {type:"command_completed",status:"completed",metadata:{command:"pnpm test",exitCode:0}}
    ]);
    expect(result).toMatchObject({headline:"Fixed the parser.",headlineIsModel:true,files:["src/a.ts"],images:[],checks:[{command:"pnpm test",status:"passed",source:"provider"}]});
  });
  it("collects only resolvable supported image changes for previews",()=>{
    const result=taskOutcomeSummary({status:"completed",result:"Rendered."},[
      {type:"file_change_completed",metadata:{path:"art/result.png",pathBase:"workspace"}},
      {type:"file_change_completed",metadata:{changes:[{path:"renders/final.webp",pathBase:"task-cwd"},{path:"vectors/logo.svg",pathBase:"workspace"},{path:"unknown.jpg"}]}}
    ]);
    expect(result.images).toEqual([{path:"art/result.png",pathBase:"workspace"},{path:"renders/final.webp",pathBase:"task-cwd"}]);
  });
  it("normalizes a failure into a reason and next action",()=>{
    expect(taskOutcomeSummary({status:"failed",error:"Host offline",metadata:{errorCategory:"HOST_OFFLINE"}},[]).failure)
      .toMatchObject({reasonKey:"task.failure.hostOffline.reason",actionKey:"task.failure.hostOffline.action"});
  });
  it("keeps unclassified provider error text as the reason",()=>{
    expect(taskOutcomeSummary({status:"failed",error:"Segmentation fault"},[]).failure)
      .toMatchObject({reasonKey:null,reason:"Segmentation fault",actionKey:"task.failure.unknown.action"});
  });
  it("shows the supplemental summary only when it adds evidence beyond the final answer",()=>{
    expect(hasTaskOutcomeDetails(taskOutcomeSummary({status:"completed",result:"Final answer."},[]))).toBe(false);
    expect(hasTaskOutcomeDetails(taskOutcomeSummary({status:"completed",result:"Final answer."},[{type:"command_completed",status:"completed",metadata:{command:"pnpm test",exitCode:0}}]))).toBe(true);
    expect(hasTaskOutcomeDetails(taskOutcomeSummary({status:"failed",error:"failed"},[]))).toBe(true);
  });
  it("never promotes a completed command without provider success evidence",()=>{
    expect(taskOutcomeSummary({status:"completed"},[{type:"command_completed",status:"completed",metadata:{command:"pnpm test"}}]).checks)
      .toEqual([{command:"pnpm test",status:"unverified",source:"heuristic"}]);
    expect(taskOutcomeSummary({status:"completed"},[{type:"command_completed",status:"completed",metadata:{command:"pnpm test",ok:true,source:"provider"}}]).checks)
      .toEqual([{command:"pnpm test",status:"passed",source:"provider"}]);
    expect(taskOutcomeSummary({status:"completed"},[{type:"command_completed",status:"failed",metadata:{command:"pnpm test",ok:false,source:"provider"}}]).checks)
      .toEqual([{command:"pnpm test",status:"failed",source:"provider"}]);
  });
  it("recognizes repository validation scripts without treating paths named build as checks",()=>{
    const commands=["pnpm test:e2e:docker","npm run build:web","pnpm run check:version","cd app && pnpm test","pytest -q","cargo test","go test ./..."];
    const noise=["cd build","rm -rf build","mkdir build","ls -la build"];
    const events=[...commands,...noise].map(command=>({type:"command_completed",status:"completed",metadata:{command,exitCode:0}}));
    expect(taskOutcomeSummary({status:"completed"},events).checks.map(check=>check.command)).toEqual(commands);
  });
  it("does not turn completed command output into a command when metadata was truncated",()=>{
    const result=taskOutcomeSummary({status:"completed"},[{type:"command_completed",status:"completed",content:"Tests: 12 passed",metadata:{truncated:true}}]);
    expect(result.checks).toEqual([]);
  });
});
