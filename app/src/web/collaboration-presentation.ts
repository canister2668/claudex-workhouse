import { collaborationTurnPresentation, type CollaborationTurnPresentation } from "./conversation";
import { emotionGroup, parseInlineEmotionScenes, resolveInlineEmotionAsset, selectOutputAssets, type ConversationTurnLength, type InlineEmotionPresentation } from "./collaboration-assets";
import type { EmotionAsset } from "./emotion-stream";

export type ConversationScenePosition="left"|"right";
export type CollaborationAssetProvider="codex"|"claude"|"antigravity"|"deepseek"|"ollama"|"grok";
const defaultProviderOutfit:Record<CollaborationAssetProvider,string>={codex:"Gpt-Sol",claude:"normal",grok:"Grok",antigravity:"Antigravity",deepseek:"DeepSeek",ollama:"Ollama"};
export function resolveParticipantOutfit(input:{provider:CollaborationAssetProvider;sessionOutfit?:unknown;liveOutfit?:unknown;codexAvatar?:string}){
  const sessionOutfit=typeof input.sessionOutfit==="string"?input.sessionOutfit.trim():"",liveOutfit=typeof input.liveOutfit==="string"?input.liveOutfit.trim():"";
  return liveOutfit||sessionOutfit||(input.provider==="codex"?input.codexAvatar??defaultProviderOutfit.codex:defaultProviderOutfit[input.provider]);
}
export function resolveConversationScenePosition(scene:{assetPosition?:ConversationScenePosition|null;position?:ConversationScenePosition|null},index:number):ConversationScenePosition{
  return scene.assetPosition??scene.position??(index%2===0?"left":"right");
}

export function buildRunPresentations(
  runs:any[],
  eventsForRun:(run:any)=>any[],
  terminal:Set<string>,
  completedOutputsOnly=false,
){
  const presentations=new Map<string,CollaborationTurnPresentation>();
  for(const run of runs)presentations.set(run.id,collaborationTurnPresentation(eventsForRun(run),!terminal.has(run.status),completedOutputsOnly));
  return presentations;
}

export function buildOutputAssetFrames(input:{
  runs:any[];
  participant:(id:string)=>any;
  output:(run:any)=>string;
  outfit:(person:any)=>string;
  available:(outfit:string)=>EmotionAsset[];
  roleplayActive:(run:any)=>boolean;
  toneSnapshot:(provider:CollaborationAssetProvider)=>any;
}){
  const frames=new Map<string,ReturnType<typeof selectOutputAssets>>(),recent:Record<CollaborationAssetProvider,string[]>={codex:[],claude:[],grok:[],antigravity:[],deepseek:[],ollama:[]};
  for(const run of input.runs){
    const person=input.participant(run.participantId),provider=person?.provider as CollaborationAssetProvider;if(!person||!Object.hasOwn(defaultProviderOutfit,provider))continue;
    const snapshot=input.toneSnapshot(provider),outfit=input.outfit(person),selected=selectOutputAssets(run.id,input.output(run),input.available(outfit),input.roleplayActive(run)?snapshot?.tonePreset:"default",snapshot?.emotionIntensity,recent[provider].slice(-2));
    frames.set(run.id,selected);if(selected[0])recent[provider].push(emotionGroup(selected[0].emotion));
  }
  return frames;
}

export type InlineEmotionCardPresentation=InlineEmotionPresentation&{scenes:Array<InlineEmotionPresentation["scenes"][number]&{asset:EmotionAsset|null}>};
export function buildInlineEmotionCards(input:{
  runs:any[];
  output:(run:any)=>string;
  participant:(id:string)=>any;
  outfit:(person:any)=>string;
  available:(outfit:string)=>EmotionAsset[];
  mode:ConversationTurnLength|null;
}){
  const cards=new Map<string,InlineEmotionCardPresentation>();
  if(!input.mode)return cards;
  for(const run of input.runs){
    const output=input.output(run),parsed=parseInlineEmotionScenes(String(run.id),String(run.id),output,input.mode);
    if(!parsed.hasMarkers)continue;
    const person=input.participant(run.participantId),outfit=input.outfit(person),available=input.available(outfit),scenes=parsed.scenes.map(scene=>({...scene,asset:resolveInlineEmotionAsset(scene.emotion,available,scene.id)}));
    cards.set(run.id,{...parsed,scenes});
  }
  return cards;
}
