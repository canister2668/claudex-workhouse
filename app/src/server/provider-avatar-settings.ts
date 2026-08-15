import { DEFAULT_CHARACTER_SETTINGS, normalizeCharacterSettings, type CharacterSettings } from "./character-settings.js";
import type { EmotionState, EmotionWatcher } from "./emotion.js";
import type { ProviderId } from "./types.js";

const PROVIDERS:ProviderId[]=["codex","claude","deepseek","ollama","antigravity","grok"];
const SETTINGS_KEY="characters.providers";
const MIGRATION_KEY="characters.avatar-source";

export type AvatarSettingsStore={
  getSystemSetting(key:string):Promise<{value:any;updatedAt:string}|null|undefined>;
  putSystemSetting(key:string,value:any,updatedAt:string):Promise<unknown>;
};
export type AvatarWatchers=Record<ProviderId,Pick<EmotionWatcher,"get"|"outfits"|"setOutfit">>;

export class ProviderAvatarSettings {
  private queue:Promise<unknown>=Promise.resolve();
  constructor(private store:AvatarSettingsStore,private watchers:AvatarWatchers){}

  private exclusive<T>(operation:()=>Promise<T>):Promise<T>{
    const next=this.queue.then(operation,operation);this.queue=next.catch(()=>undefined);return next;
  }
  private validate(settings:CharacterSettings){
    for(const provider of PROVIDERS){
      const outfit=settings.providers[provider].avatarOutfit;
      if(!this.watchers[provider].outfits().includes(outfit))throw Object.assign(new Error(`Avatar outfit is unavailable for ${provider}: ${outfit}`),{statusCode:400,code:"AVATAR_OUTFIT_UNAVAILABLE"});
    }
    return settings;
  }
  async read(){
    const stored=await this.store.getSystemSetting(SETTINGS_KEY);
    return{settings:stored?normalizeCharacterSettings(stored.value):DEFAULT_CHARACTER_SETTINGS,updatedAt:stored?.updatedAt??null};
  }
  private async apply(settings:CharacterSettings,updatedAt:string,persist=true){
    this.validate(settings);
    const previous=Object.fromEntries(PROVIDERS.map(provider=>[provider,this.watchers[provider].get().outfit])) as Record<ProviderId,string>;
    const changed:ProviderId[]=[];
    try{
      for(const provider of PROVIDERS){
        const outfit=settings.providers[provider].avatarOutfit;
        if(previous[provider]!==outfit){await this.watchers[provider].setOutfit(outfit);changed.push(provider);}
      }
      if(persist)await this.store.putSystemSetting(SETTINGS_KEY,settings,updatedAt);
      return{settings,updatedAt};
    }catch(error){
      await Promise.allSettled(changed.map(provider=>this.watchers[provider].setOutfit(previous[provider])));
      throw error;
    }
  }
  save(input:unknown,updatedAt=new Date().toISOString()){
    const settings=this.validate(normalizeCharacterSettings(input));
    return this.exclusive(()=>this.apply(settings,updatedAt));
  }
  select(provider:ProviderId,outfit:string,updatedAt=new Date().toISOString()){
    return this.exclusive(async()=>{
      if(!this.watchers[provider].outfits().includes(outfit))throw Object.assign(new Error(`Avatar outfit is unavailable for ${provider}: ${outfit}`),{statusCode:400,code:"AVATAR_OUTFIT_UNAVAILABLE"});
      const current=(await this.read()).settings;
      const settings:CharacterSettings={...current,providers:{...current.providers,[provider]:{...current.providers[provider],avatarOutfit:outfit}}};
      const result=await this.apply(settings,updatedAt);
      return{...result,provider,state:this.watchers[provider].get() as EmotionState};
    });
  }
  reconcile(){
    return this.exclusive(async()=>{
      const [stored,migration]=await Promise.all([this.store.getSystemSetting(SETTINGS_KEY),this.store.getSystemSetting(MIGRATION_KEY)]);
      let settings=stored?normalizeCharacterSettings(stored.value):DEFAULT_CHARACTER_SETTINGS;
      const updatedAt=new Date().toISOString();
      if(!migration){
        // Before this coordinator existed, the avatar menu only updated watcher
        // files while the settings dialog only updated the DB. Preserve the
        // user's most recent visible choice once, then establish the DB source.
        settings={...settings,providers:{...settings.providers}};
        for(const provider of PROVIDERS){
          const outfit=this.watchers[provider].get().outfit;
          if(this.watchers[provider].outfits().includes(outfit))settings.providers[provider]={...settings.providers[provider],avatarOutfit:outfit};
        }
        await this.apply(settings,updatedAt);
        await this.store.putSystemSetting(MIGRATION_KEY,{version:1,source:"characters.providers"},updatedAt);
        return{settings,updatedAt,migrated:true};
      }
      await this.apply(settings,updatedAt,false);
      return{settings,updatedAt:stored?.updatedAt??updatedAt,migrated:false};
    });
  }
}
