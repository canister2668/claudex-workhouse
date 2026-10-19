import { describe,it,expect,vi } from "vitest";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { SessionToneSettings,sessionToneKey,sessionToneInput } from "../../src/server/session-tone.js";
import { DEFAULT_CHARACTER_SETTINGS,characterSettingsSchema } from "../../src/server/character-settings.js";
import type { DeckTask } from "../../src/server/types.js";
const task={id:"codex:one",provider:"codex",threadId:"session-1",executionHostId:"host-1",metadata:{},owned:true} as DeckTask;
function fixture(){
  const values=new Map<string,{value:any;updatedAt:string}>();
  const store={getSystemSetting:async(key:string)=>values.get(key),putSystemSetting:async(key:string,value:any,updatedAt:string)=>{values.set(key,{value,updatedAt});},putSystemSettingIfUpdated:async(key:string,value:any,updatedAt:string,expected:string|null)=>{if((values.get(key)?.updatedAt??null)!==expected)return{updated:false};values.set(key,{value,updatedAt});return{updated:true};}};
  return{service:new SessionToneSettings(store,async()=>structuredClone(DEFAULT_CHARACTER_SETTINGS)),values,store};
}
describe("session quick tone",()=>{
  it.each([false,true])("injects through the production local/worker dispatch wrapper (worker=%s)",async(worker)=>{
    const {service}=fixture(),source=fs.readFileSync(new URL("../../src/server/index.ts",import.meta.url),"utf8");
    const local=source.slice(source.indexOf("async function sendTaskMessage("),source.indexOf("async function currentUiLocale("));
    const remote=source.slice(source.indexOf("async function remoteTaskCommand("),source.indexOf("async function latestQueuedThreadTask("));
    let received="";
    const context:any={sessionTones:service,provider:()=>({sendMessage:async(_task:any,prompt:string)=>{received=prompt;return{status:"running"};}}),workspacePromptForTask:(_task:any,prompt:string)=>`Workspace instructions\n${prompt}`,executionHostUsesWorker:()=>true,hostWorkspaces:{requireWorkspace:async()=>{}},LOCAL_HOST_ID:"local",refreshManagedLocalWorkerConfig:async()=>{},automationLevel:()=>"read",claudeRemoteExecutionSettings:async()=>({}),workerHub:{request:async(_host:string,_command:string,payload:any)=>{received=payload.prompt;return{status:"running"};}},db:{upsertTask:async(value:any)=>value},workspaceInstructionFollowUpMetadata:()=>({}),withoutLegacyWorkspaceApprovalMetadata:()=>({})};
    vm.runInNewContext(ts.transpileModule(local+remote,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
    await service.select(task,{tonePreset:"tsundere",scope:"once"});
    if(worker)await context.remoteTaskCommand(task,"provider.session.resume",{prompt:"The actual request"});else await context.sendTaskMessage(task,"The actual request");
    expect(received).toContain("Workspace instructions");expect(received).toContain("brusque");expect(received).toContain("The actual request");expect((await service.read(task)).tonePreset).toBeNull();
  });

  it("does not inject or store anything for untouched sessions",async()=>{const {service,values}=fixture(),send=vi.fn(async()=>({status:"running"}));await service.dispatch(task,"hello",send);expect(send).toHaveBeenCalledWith("hello");expect(values.size).toBe(0);expect(await service.read(task)).toEqual({tonePreset:null,scope:"once"});});
  it("persists session choices across task ids and coordinator restarts",async()=>{const {service,store}=fixture();await service.select(task,{tonePreset:"tsundere",scope:"session"});const restarted=new SessionToneSettings(store,async()=>structuredClone(DEFAULT_CHARACTER_SETTINGS));expect(await restarted.read({...task,id:"codex:two"})).toEqual({tonePreset:"tsundere",scope:"session"});const send=vi.fn(async()=>({status:"running"}));await restarted.dispatch(task,"test",send);expect(send.mock.calls[0][0]).toContain("brusque");});
  it("one reply restores the session tone and leaves global defaults untouched",async()=>{const {service}=fixture();await service.select(task,{tonePreset:"tsundere",scope:"session"});await service.select(task,{tonePreset:"secretary",scope:"once"});expect((await service.read(task)).scope).toBe("once");await service.dispatch(task,"hello",async()=>({status:"running"}));expect(await service.read(task)).toEqual({tonePreset:"tsundere",scope:"session"});expect(DEFAULT_CHARACTER_SETTINGS.providers.codex.tonePreset).toBe("default");});
  it("retains once on throws and provider rejection",async()=>{const {service}=fixture();await service.select(task,{tonePreset:"secretary",scope:"once"});await expect(service.dispatch(task,"hello",async()=>{throw Error("offline");})).rejects.toThrow("offline");await service.dispatch(task,"hello",async()=>({status:"failed"}));expect((await service.read(task)).scope).toBe("once");});
  it("does not erase a new choice while a dispatch is starting",async()=>{const {service}=fixture();await service.select(task,{tonePreset:"secretary",scope:"once"});await service.dispatch(task,"hello",async()=>{await service.select(task,{tonePreset:"tsundere",scope:"once"});return{status:"running"};});expect(await service.read(task)).toEqual({tonePreset:"tsundere",scope:"once"});});
  it("reset explicitly restores the captured initial style",async()=>{const {service}=fixture();const original={...task,metadata:{characterSnapshot:{nickname:"Before",conversationOnly:false,directive:"Historical voice."}}};await service.select(original,{tonePreset:"secretary",scope:"session"});await service.select(original,{tonePreset:null,scope:"once"});const send=vi.fn(async()=>({status:"running"}));await service.dispatch(original,"test",send);expect(send.mock.calls[0][0]).toContain("Historical voice.");expect(send.mock.calls[0][0]).toContain("Before");expect((await service.read(original)).tonePreset).toBeNull();});
  it("isolates native threads, providers and execution hosts",()=>{const base=sessionToneKey(task);for(const other of [{...task,threadId:"other"},{...task,provider:"claude" as const},{...task,executionHostId:"host-2"}])expect(sessionToneKey(other)).not.toBe(base);});
  it("rejects empty custom choice and missing session",async()=>{const {service}=fixture();await expect(service.select(task,{tonePreset:"custom",scope:"once"})).rejects.toThrow("custom tone");expect(()=>sessionToneKey({...task,threadId:null})).toThrow("Open a session");expect(sessionToneInput.safeParse({tonePreset:"unknown",scope:"once"}).success).toBe(false);});
  it("accepts zero to three unique favorites and defaults legacy settings",()=>{const settings=structuredClone(DEFAULT_CHARACTER_SETTINGS);delete (settings.providers.codex as any).toneFavorites;expect(characterSettingsSchema.parse(settings).providers.codex.toneFavorites).toHaveLength(3);for(const invalid of [["default","default"],["default","secretary","tsundere","custom"]]){(settings.providers.codex as any).toneFavorites=invalid;expect(characterSettingsSchema.safeParse(settings).success).toBe(false);}settings.providers.codex.toneFavorites=[];expect(characterSettingsSchema.parse(settings).providers.codex.toneFavorites).toEqual([]);});
});
