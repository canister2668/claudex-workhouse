import{z}from"zod";

const containsLoneSurrogate=(value:string)=>/[\uD800-\uDFFF]/u.test(value);
const boundedUnicodeString=(max:number)=>z.string().trim().min(1).refine(value=>Array.from(value).length<=max,`Must contain at most ${max} Unicode characters.`).refine(value=>!containsLoneSurrogate(value),"Unpaired Unicode surrogates are not allowed.");
export const promptPresetSchema=z.object({
  id:z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).refine(value=>!["fix","review","test"].includes(value),"Built-in preset ids are reserved."),
  label:boundedUnicodeString(40),
  prompt:boundedUnicodeString(4000)
}).strict();
export const promptPresetSettingsSchema=z.object({
  version:z.literal(1),
  presets:z.array(promptPresetSchema).max(20).superRefine((items,context)=>{
    const seen=new Set<string>();
    items.forEach((item,index)=>{if(seen.has(item.id))context.addIssue({code:"custom",message:"Prompt preset ids must be unique.",path:[index,"id"]});seen.add(item.id);});
  })
}).strict();
export const promptPresetPutSchema=z.object({
  settings:promptPresetSettingsSchema,
  baseUpdatedAt:z.string().datetime().nullable()
}).strict();
export const EMPTY_PROMPT_PRESET_SETTINGS={version:1 as const,presets:[]};
export function normalizeStoredPromptPresetSettings(value:unknown){
  const source=value&&typeof value==="object"&&Array.isArray((value as any).presets)?(value as any).presets:[];
  const presets:Array<z.infer<typeof promptPresetSchema>>=[],seen=new Set<string>();
  for(const item of source){
    const parsed=promptPresetSchema.safeParse(item);
    if(!parsed.success||seen.has(parsed.data.id))continue;
    seen.add(parsed.data.id);presets.push(parsed.data);
    if(presets.length>=20)break;
  }
  return{version:1 as const,presets};
}
export function nextPromptPresetUpdatedAt(baseUpdatedAt:string|null,now=Date.now()){
  const parsed=baseUpdatedAt?Date.parse(baseUpdatedAt):0,base=Number.isFinite(parsed)?parsed:0;
  return new Date(Math.max(now,base+1)).toISOString();
}
