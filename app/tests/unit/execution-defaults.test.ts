import {describe,it,expect,vi} from "vitest";
import {saveExecutionDefaults,effectiveDelegationSettings,EXECUTION_DEFAULTS_KEY} from "../../src/server/execution-defaults.js";
import {DEFAULT_DELEGATION_SETTINGS,applyGlobalDelegationModels} from "../../src/server/delegation-settings.js";
import {ManagedProviderBridge} from "../../src/server/managed-provider-mcp.js";
const entry=(id:string)=>({id,displayName:id,source:"runtime" as const,validatedAt:null});
const catalog:any={version:1,codex:{models:[entry("next-sol"),entry("heavy")]},claude:{models:[entry("claude-next")]},deepseek:{models:[entry("deepseek-next")]},ollama:{models:[]},antigravity:{models:[]},grok:{models:[]}};
function fixture(){
 const rows=new Map<string,any>([["delegation.launch-modes",{value:{...DEFAULT_DELEGATION_SETTINGS,codex:{...DEFAULT_DELEGATION_SETTINGS.codex,model:"heavy"}},updatedAt:"old"}]]);
 const db:any={getSystemSetting:vi.fn(async(key:string)=>rows.get(key)??null),putSystemSettingIfUpdated:vi.fn(async(key:string,value:any,updatedAt:string,expected:string|null)=>{const current=rows.get(key)??null;if((current?.updatedAt??null)!==expected)return{updated:false,current};rows.set(key,{value,updatedAt});return{updated:true,current:null};}),claimIdempotency:vi.fn(async()=>({claimed:true})),finishIdempotency:vi.fn(async()=>{}),appendAudit:vi.fn(async()=>{})};
 return{db,rows};
}
describe("server execution defaults",()=>{
 it("saving execution defaults updates delegation without changing launch mode",async()=>{
  const {db,rows}=fixture();rows.get("delegation.launch-modes").value.codex.launchMode="direct";
  await saveExecutionDefaults(db,{settings:{codexModel:"next-sol",codexEffort:"medium",codexTier:null},baseUpdatedAt:null},catalog);
  expect((await effectiveDelegationSettings(db)).codex).toEqual({launchMode:"direct",model:"next-sol",reasoningEffort:"medium",serviceTier:null});
 });
 it("migrates a localStorage payload once and ignores another browser's stale cache",async()=>{
  const {db}=fixture();const first=await saveExecutionDefaults(db,{settings:JSON.parse('{"codexModel":"next-sol","codexEffort":"medium","codexAutomation":"full","enterToSend":false,"unknownSecret":"removed"}'),baseUpdatedAt:null,migrate:true},catalog);
  expect(first).toMatchObject({migrated:true,settings:{codexModel:"next-sol",codexEffort:"medium",codexAutomation:"full",enterToSend:false}});
  expect(first.settings).not.toHaveProperty("unknownSecret");
  expect(await saveExecutionDefaults(db,{settings:{codexModel:"heavy"},baseUpdatedAt:null,migrate:true},catalog)).toMatchObject({migrated:false,settings:{codexModel:"next-sol"}});
 });
 it.each([{}, {codexAvatar:"Gpt-Sol"}])("does not claim migration from a cache without execution model choices: %j",async settings=>{
  const {db,rows}=fixture();await saveExecutionDefaults(db,{settings,baseUpdatedAt:null,migrate:true},catalog);expect(rows.has(EXECUTION_DEFAULTS_KEY)).toBe(false);
 });
 it("retains an unavailable migration choice visibly and rejects ordinary unavailable saves",async()=>{
  const {db}=fixture();await saveExecutionDefaults(db,{settings:{codexModel:"disabled"},baseUpdatedAt:null,migrate:true},catalog);
  expect((await effectiveDelegationSettings(db)).codex.model).toBe("disabled");
  await expect(saveExecutionDefaults(db,{settings:{codexModel:"disabled"},baseUpdatedAt:null},catalog)).rejects.toThrow(/no replacement/);
 });
 it("rejects stale-device saves without altering canonical values",async()=>{
  const {db}=fixture();await saveExecutionDefaults(db,{settings:{codexModel:"next-sol"},baseUpdatedAt:null},catalog);
  await expect(saveExecutionDefaults(db,{settings:{codexModel:"heavy"},baseUpdatedAt:null},catalog)).rejects.toThrow(/another device/);
  expect((await effectiveDelegationSettings(db)).codex.model).toBe("next-sol");
 });
 it.each(["codex","claude"] as const)("%s model discovery and real create arguments agree with execution defaults",async provider=>{
  const {db}=fixture(),model=provider==="codex"?"next-sol":"claude-next";
  await saveExecutionDefaults(db,{settings:{[`${provider}Model`]:model,[`${provider}Effort`]:"medium"},baseUpdatedAt:null},catalog);
  const collaboration:any={createAssist:vi.fn(async()=>({session:{id:"assist"}}))},gate=vi.fn(async()=>{});
  const bridge=new ManagedProviderBridge(db,collaboration,async t=>t,async t=>t,gate,async()=>({settings:catalog,updatedAt:null}));
  vi.spyOn(bridge as any,"collaborationSnapshot").mockResolvedValue({taskId:"target",threadId:"thread",status:"running"});
  const reported=await bridge.models({provider});
  await bridge.create({id:"source",title:"Source",projectId:"project",executionHostId:"local",workspaceId:"workspace",status:"running",metadata:{automationLevel:"full"}} as any,{provider,prompt:"Work",idempotencyKey:"11111111-1111-4111-8111-111111111111"});
  expect(reported).toMatchObject({configuredModel:model,reasoningEffort:"medium",configuredModelEnabled:true});
  expect(collaboration.createAssist).toHaveBeenCalledWith(expect.objectContaining({model:reported.configuredModel,reasoningEffort:reported.reasoningEffort,timeoutMs:2*60*60_000}));
  expect(gate).toHaveBeenCalledWith(provider,model);
 });
 it.each(["disabled","NEXT-SOL"])("blocks disabled or noncanonical default %s before creating a paid task",async model=>{
  const {db}=fixture();await saveExecutionDefaults(db,{settings:{codexModel:model},baseUpdatedAt:null,migrate:true},catalog);
  const gate=vi.fn(),collaboration:any={createAssist:vi.fn()},bridge=new ManagedProviderBridge(db,collaboration,async t=>t,async t=>t,gate,async()=>({settings:catalog,updatedAt:null}));
  expect(await bridge.models({provider:"codex"})).toMatchObject({configuredModel:model,configuredModelEnabled:false});
  await expect(bridge.create({} as any,{provider:"codex",prompt:"Work",idempotencyKey:"11111111-1111-4111-8111-111111111111"})).rejects.toThrow(/not enabled/);
  expect(gate).not.toHaveBeenCalled();expect(collaboration.createAssist).not.toHaveBeenCalled();
 });
 it("preserves compatible execution choices and their existing disabled-model fallback",async()=>{
  const {db,rows}=fixture();rows.set("models.global-catalog",{value:catalog,updatedAt:"catalog"});
  await saveExecutionDefaults(db,{settings:{deepseekModel:"deepseek-next",deepseekEffort:"high"},baseUpdatedAt:null,migrate:true},catalog);
  expect((await effectiveDelegationSettings(db)).deepseek).toMatchObject({model:"deepseek-next",reasoningEffort:"high"});
  rows.get(EXECUTION_DEFAULTS_KEY).value.deepseekModel="removed";
  expect((await effectiveDelegationSettings(db)).deepseek).toMatchObject({model:"deepseek-next",reasoningEffort:null});
  expect((await effectiveDelegationSettings(db)).ollama).toMatchObject({model:null,reasoningEffort:null});
 });
 it("retains compatible reconciliation when no execution value has migrated",async()=>{
  const {db,rows}=fixture();const base=applyGlobalDelegationModels(DEFAULT_DELEGATION_SETTINGS,catalog,[],{deepseek:{model:"deepseek-next",reasoningEffort:"high"},ollama:{model:null,reasoningEffort:null},antigravity:{model:null,reasoningEffort:null},grok:{model:null,reasoningEffort:null}});
  rows.set("delegation.launch-modes",{value:base,updatedAt:"old"});expect(await effectiveDelegationSettings(db)).toEqual(base);
  await saveExecutionDefaults(db,{settings:{codexModel:"next-sol"},baseUpdatedAt:null},catalog);
  expect((await effectiveDelegationSettings(db)).deepseek).toEqual(base.deepseek);
 });
});
