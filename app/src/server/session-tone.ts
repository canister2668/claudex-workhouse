import { z } from "zod";
import { randomUUID } from "node:crypto";
import { characterSnapshot, normalizeCharacterSettings, tonePreset, type CharacterSettings } from "./character-settings.js";
import type { DeckTask } from "./types.js";

export const sessionToneInput=z.object({tonePreset:tonePreset.nullable(),scope:z.enum(["once","session"])});
const choice=z.object({tonePreset,customTone:z.string().max(2000)});
const stateSchema=z.object({revision:z.string(),session:choice.nullable(),once:choice.nullable(),base:z.object({nickname:z.string(),directive:z.string()})});
type State=z.infer<typeof stateSchema>;
type Store={
  getSystemSetting(key:string):Promise<{value:any;updatedAt:string}|null|undefined>;
  putSystemSetting(key:string,value:any,updatedAt:string):Promise<unknown>;
  putSystemSettingIfUpdated(key:string,value:any,updatedAt:string,expected:string|null):Promise<{updated:boolean}>;
};
// The key survives task-id changes between turns, but never crosses a host,
// provider or native session. Historical character snapshots remain immutable.
export function sessionToneKey(task:Pick<DeckTask,"provider"|"executionHostId"|"threadId">){
  if(!task.threadId)throw Object.assign(new Error("Open a session before choosing its tone."),{statusCode:409,code:"TONE_SESSION_REQUIRED"});
  return `characters.session-tone:${JSON.stringify([task.executionHostId??"local",task.provider,task.threadId])}`;
}
export class SessionToneSettings {
  constructor(private store:Store,private settings:()=>Promise<CharacterSettings>){}
  private async load(task:DeckTask){const stored=await this.store.getSystemSetting(sessionToneKey(task));return{stored,state:stored?stateSchema.parse(stored.value):null};}
  async read(task:DeckTask){const {state}=await this.load(task);return{tonePreset:state?.once?.tonePreset??state?.session?.tonePreset??null,scope:state?.session&&!state.once?"session":"once"};}
  async select(task:DeckTask,input:z.infer<typeof sessionToneInput>){
    const key=sessionToneKey(task),{stored,state}=await this.load(task),settings=await this.settings(),profile=settings.providers[task.provider];
    if(input.tonePreset==="custom"&&!profile.customTone.trim())throw Object.assign(new Error("Save custom tone text in global settings first."),{statusCode:400,code:"TONE_CUSTOM_EMPTY"});
    const snapshot=task.metadata?.characterSnapshot;
    const historical=snapshot&&typeof snapshot==="object"?snapshot as Record<string,unknown>:null;
    // A work session with conversationOnly had no style at creation. Reset
    // restores that actual initial behavior instead of today's global default.
    const base=state?.base??{
      nickname:typeof historical?.nickname==="string"?historical.nickname:profile.nickname,
      directive:historical?.conversationOnly===false&&typeof historical.directive==="string"?historical.directive:"Use a natural, neutral voice suitable for the user's task."
    };
    const selected=input.tonePreset?{tonePreset:input.tonePreset,customTone:input.tonePreset==="custom"?profile.customTone:""}:null;
    const next:State={revision:randomUUID(),base,session:input.tonePreset===null?null:input.scope==="session"?selected:state?.session??null,once:input.scope==="once"?selected:null};
    const saved=await this.store.putSystemSettingIfUpdated(key,next,new Date(Math.max(Date.now(),Date.parse(stored?.updatedAt??"")+1||0)).toISOString(),stored?.updatedAt??null);
    if(!saved.updated)throw Object.assign(new Error("Session tone changed. Reload and try again."),{statusCode:409,code:"TONE_CONFLICT"});
    return{tonePreset:next.once?.tonePreset??next.session?.tonePreset??null,scope:next.session&&!next.once?"session":"once"};
  }
  async dispatch<T extends {status?:string}>(task:DeckTask,prompt:string,send:(prompt:string)=>Promise<T>):Promise<T>{
    if(!task.threadId)return send(prompt);
    const {stored,state}=await this.load(task);
    if(!state)return send(prompt);
    const selected=state.once??state.session;
    let snapshot=state.base;
    if(selected){const settings=normalizeCharacterSettings(await this.settings());settings.providers[task.provider]={...settings.providers[task.provider],...selected,nickname:state.base.nickname};snapshot=characterSnapshot(settings,task.provider);}
    const styled=`[Current session expression style]\nReplace earlier expression-style instructions with the following for this response. Apply only to conversational prose; preserve code, files, quotations, accuracy and permissions.\nThis model's nickname: ${snapshot.nickname}\n${snapshot.directive}\n[End current session expression style]\n\n${prompt}`;
    const result=await send(styled);
    if(state.once&&result.status!=="failed"){
      // A newer selection made while the provider starts must not be cleared.
      const next={...state,once:null,revision:randomUUID()};
      await this.store.putSystemSettingIfUpdated(sessionToneKey(task),next,new Date(Math.max(Date.now(),Date.parse(stored!.updatedAt)+1)).toISOString(),stored!.updatedAt);
    }
    return result;
  }
}
