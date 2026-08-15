import{describe,expect,it,vi}from"vitest";
import{ManagedProviderBridge,workspaceInstructionsUpdateToolSchema}from"../../src/server/managed-provider-mcp.js";
import{normalizeWorkspaceInstructionProfile,workspaceInstructionSettingKey}from"../../src/server/workspace-instructions.js";
import type{DeckTask}from"../../src/server/types.js";

const key="11111111-1111-4111-8111-111111111111";
const source:DeckTask={id:"codex:source-task",provider:"codex",nativeId:"source",threadId:"thread",projectId:"project",title:"source",prompt:"",status:"running",createdAt:"2026-08-07T00:00:00.000Z",updatedAt:"2026-08-07T00:00:00.000Z",result:null,error:null,log:"",owned:true,pid:null,pgid:null,processStart:null,commandMarker:null,parentThreadId:null,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace-a",providerSessionId:"thread",metadata:{}};

function fixture(overrides:Record<string,unknown>={}){
  let stored={value:normalizeWorkspaceInstructionProfile({enabled:true,sourceMode:"combined",markdown:"before",agentEditable:true,revision:4,completionPolicy:{restart:"always",requireCheck:false,requireTest:true,requireBuild:false,requireDirectVerification:true,execution:"confirm"},...overrides}),updatedAt:"2026-08-07T00:00:00.000Z"};
  const claims=new Map<string,{requestHash:string;state:string;response?:unknown}>(),writes:any[]=[],audits:any[]=[];
  const db:any={
    getSystemSetting:vi.fn(async(name:string)=>name===workspaceInstructionSettingKey("workspace-a")?structuredClone(stored):null),
    putSystemSettingIfUpdated:vi.fn(async(_name:string,value:unknown,updatedAt:string,expectedUpdatedAt:string|null)=>{if(expectedUpdatedAt!==stored.updatedAt)return{updated:false,current:stored};stored={value:structuredClone(value) as any,updatedAt};writes.push(structuredClone(value));return{updated:true,current:stored};}),
    appendAudit:vi.fn(async(value:unknown)=>{audits.push(structuredClone(value));return true;}),
    claimIdempotency:vi.fn(async(input:any)=>{const previous=claims.get(input.key);if(previous)return{claimed:false,requestHash:previous.requestHash,state:previous.state,response:previous.response};claims.set(input.key,{requestHash:input.requestHash,state:"pending"});return{claimed:true,requestHash:input.requestHash,state:"pending",response:null};}),
    finishIdempotency:vi.fn(async(input:any)=>{claims.set(input.key,{requestHash:claims.get(input.key)!.requestHash,state:input.state,response:structuredClone(input.response)});return true;})
  };
  const bridge=new ManagedProviderBridge(db,{} as any,async task=>task,async task=>task);
  return{bridge,db,writes,audits,current:()=>stored.value};
}

describe("managed workspace instructions",()=>{
  it("rejects updates while owner-controlled agent editing is disabled",async()=>{const{bridge}=fixture({agentEditable:false});await expect(bridge.updateInstructions(source,{markdown:"next",expectedRevision:4,idempotencyKey:key})).rejects.toMatchObject({statusCode:403,code:"WORKSPACE_INSTRUCTIONS_AGENT_WRITE_DISABLED"});});
  it("rejects a stale expected revision",async()=>{const{bridge}=fixture();await expect(bridge.updateInstructions(source,{markdown:"next",expectedRevision:3,idempotencyKey:key})).rejects.toMatchObject({statusCode:409,code:"WORKSPACE_INSTRUCTIONS_REVISION_CONFLICT"});});
  it("changes only Markdown and editor metadata while preserving owner-only controls byte-for-byte",async()=>{
    const{bridge,current,writes,audits}=fixture(),before=current(),protectedBefore=JSON.stringify({enabled:before.enabled,sourceMode:before.sourceMode,completionPolicy:before.completionPolicy,agentEditable:before.agentEditable});
    await expect(bridge.updateInstructions(source,{markdown:"after",expectedRevision:4,idempotencyKey:key})).resolves.toMatchObject({workspaceId:"workspace-a",revision:5,appliesTo:"next-task"});
    const after=current();expect(JSON.stringify({enabled:after.enabled,sourceMode:after.sourceMode,completionPolicy:after.completionPolicy,agentEditable:after.agentEditable})).toBe(protectedBefore);expect(after).toMatchObject({markdown:"after",revision:5,lastEditedBy:"agent",lastEditedTaskId:source.id});expect(writes).toHaveLength(1);expect(audits[0]).toMatchObject({actor:`agent-task:${source.id}`,action:"workspace-instructions-agent-update",workspaceId:"workspace-a",detail:"revision=5"});expect(JSON.stringify(audits[0])).not.toContain("after");
  });
  it("rejects credentials in managed Markdown",async()=>{const{bridge}=fixture();await expect(bridge.updateInstructions(source,{markdown:`api_key = ${"a".repeat(16)}`,expectedRevision:4,idempotencyKey:key})).rejects.toThrow(/credentials/i);});
  it("rejects managed Markdown above 32,768 characters",async()=>{const{bridge}=fixture();await expect(bridge.updateInstructions(source,{markdown:"x".repeat(32_769),expectedRevision:4,idempotencyKey:key})).rejects.toThrow();});
  it("increments the revision only once for a repeated idempotency key",async()=>{const{bridge,current,writes}=fixture(),input={markdown:"after",expectedRevision:4,idempotencyKey:key};const first=await bridge.updateInstructions(source,input),second=await bridge.updateInstructions(source,input);expect(second).toEqual(first);expect(current().revision).toBe(5);expect(writes).toHaveLength(1);});
  it("does not expose a workspace selector in the update tool schema",()=>{expect(Object.keys(workspaceInstructionsUpdateToolSchema).sort()).toEqual(["expectedRevision","idempotencyKey","markdown"]);expect(workspaceInstructionsUpdateToolSchema).not.toHaveProperty("workspaceId");});
});
