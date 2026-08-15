export type PromptPreset={id:string;label:string;prompt:string};
export type IntakeRecommendation={kind:"single"|"review";provider:"codex"|"claude";reason:"code"|"review"|"explanation"|"default"};

// Built-in presets are UI copy, so both the chip label and the prompt it inserts
// follow the selected language. User-saved presets are stored verbatim.
export const BUILTIN_PROMPT_PRESETS=[
  {id:"fix"},{id:"review"},{id:"test"}
] as const;
export function builtinPromptPresets(translate:(key:string)=>string):PromptPreset[]{
  return BUILTIN_PROMPT_PRESETS.map(({id})=>({id,label:translate(`preset.builtin.${id}.label`),prompt:translate(`preset.builtin.${id}.prompt`)}));
}
const loneSurrogate=/[\uD800-\uDFFF]/gu;
export const codePointSlice=(value:string,max:number)=>Array.from(value.replace(loneSurrogate,"")).slice(0,max).join("");

export function normalizePromptPresets(value:unknown):PromptPreset[]{
  if(!Array.isArray(value))return[];
  const seen=new Set<string>(),presets:PromptPreset[]=[];
  for(const item of value){
    if(!item||typeof item!=="object")continue;
    const label=codePointSlice(String((item as any).label??"").trim(),40),prompt=codePointSlice(String((item as any).prompt??"").trim(),4000);
    if(!label||!prompt)continue;
    let id=String((item as any).id??crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g,"").slice(0,80)||crypto.randomUUID();
    if(BUILTIN_PROMPT_PRESETS.some(preset=>preset.id===id))id=`custom-${id}`.slice(0,80);
    if(seen.has(id))continue;
    seen.add(id);presets.push({id,label,prompt});
    if(presets.length>=20)break;
  }
  return presets;
}

export const promptPresetSignature=(value:PromptPreset[])=>JSON.stringify(normalizePromptPresets(value));
export function previewPromptPresetMerge(serverValue:unknown,localValue:unknown,snapshotValue:unknown=null){
  const server=normalizePromptPresets(serverValue),local=normalizePromptPresets(localValue),snapshot=Array.isArray(snapshotValue)?normalizePromptPresets(snapshotValue):[];
  const serverIds=new Set(server.map(item=>item.id)),localIds=new Set(local.map(item=>item.id));
  const deletedOnServer=new Set(snapshot.filter(item=>!serverIds.has(item.id)).map(item=>item.id)),deletedOnLocal=new Set(snapshot.filter(item=>!localIds.has(item.id)).map(item=>item.id));
  const retainedServer=server.filter(item=>!deletedOnLocal.has(item.id)),seen=new Set(retainedServer.map(item=>item.id));
  const candidates=[...retainedServer,...local.filter(item=>!seen.has(item.id)&&!deletedOnServer.has(item.id))];
  return{merged:candidates.slice(0,20),dropped:candidates.slice(20),deletedOnServer:[...deletedOnServer],deletedOnLocal:[...deletedOnLocal]};
}
export function mergePromptPresets(serverValue:unknown,localValue:unknown,snapshotValue:unknown=null){
  return previewPromptPresetMerge(serverValue,localValue,snapshotValue).merged;
}
export function promptPresetSyncDecision(serverValue:unknown,localValue:unknown,snapshotValue:unknown){
  const server=normalizePromptPresets(serverValue),local=normalizePromptPresets(localValue),snapshot=Array.isArray(snapshotValue)?normalizePromptPresets(snapshotValue):null;
  const serverKey=promptPresetSignature(server),localKey=promptPresetSignature(local),snapshotKey=snapshot?promptPresetSignature(snapshot):null;
  if(serverKey===localKey||(!local.length&&(snapshot===null||!snapshot.length)))return{action:"use-server" as const,server,local,merged:server};
  if(!server.length&&snapshot===null)return{action:"upload-local" as const,server,local,merged:local};
  if(snapshotKey!==null&&serverKey===snapshotKey)return{action:"upload-local" as const,server,local,merged:local};
  if(snapshotKey!==null&&localKey===snapshotKey)return{action:"use-server" as const,server,local,merged:server};
  const preview=previewPromptPresetMerge(server,local,snapshot);
  return{action:"conflict" as const,server,local,...preview};
}

export function recommendTaskIntake(prompt:string):IntakeRecommendation{
  const value=prompt.toLowerCase();
  if(/(독립|교차|다른\s*모델|두\s*모델|review|검토|감사|audit)/i.test(value))return{kind:"review",provider:"codex",reason:"review"};
  if(/(설명|문서|기획|요약|글|explain|document|design|summari[sz]e)/i.test(value)&&!/(구현|수정|코드|test|build|fix|implement)/i.test(value))return{kind:"single",provider:"claude",reason:"explanation"};
  if(/(구현|수정|버그|코드|테스트|빌드|리팩터|implement|fix|test|build|refactor)/i.test(value))return{kind:"single",provider:"codex",reason:"code"};
  return{kind:"single",provider:"codex",reason:"default"};
}
