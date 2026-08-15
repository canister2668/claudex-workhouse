export type PushPreferenceOutcome = { applied:boolean; reason:"applied"|"failed"|"timeout"; detail:string|null };

/** Web Push permission and subscription work must never decide whether the
 * global settings save finished. `Notification.requestPermission()` stays
 * pending forever while a Windows browser keeps the permission bubble open,
 * and `PushManager.subscribe()` rejects outright on an installation without
 * VAPID keys. Both used to run inside the saving window, so the Save button
 * stayed dimmed with no success or failure message even though every settings
 * write had already been persisted. */
export const PUSH_PREFERENCE_TIMEOUT_MS = 20_000;

export async function applyPushPreference(
  enabled:boolean,
  handlers:{ enable:()=>Promise<unknown>; disable:()=>Promise<unknown> },
  timeoutMs=PUSH_PREFERENCE_TIMEOUT_MS
):Promise<PushPreferenceOutcome>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    const work=(async()=>{ await (enabled?handlers.enable():handlers.disable()); })();
    const expiry=new Promise<"timeout">(resolve=>{ timer=setTimeout(()=>resolve("timeout"),Math.max(0,timeoutMs)); });
    const result=await Promise.race([work.then(()=>"applied" as const),expiry]);
    if(result==="timeout"){
      // The pending permission or subscription promise is abandoned on purpose;
      // resolving it later must not resurrect a finished save.
      void work.catch(()=>{});
      return{applied:false,reason:"timeout",detail:null};
    }
    return{applied:true,reason:"applied",detail:null};
  }catch(error){
    return{applied:false,reason:"failed",detail:(error instanceof Error?error.message:String(error)).slice(0,300)||null};
  }finally{ if(timer!==undefined)clearTimeout(timer); }
}
