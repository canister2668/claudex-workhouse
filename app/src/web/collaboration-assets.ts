import type { EmotionAsset } from "./emotion-stream";
import { assertUniqueKeys } from "./identity-selectors";
import { translate } from "./i18n";
import { INLINE_EMOTION_NAMES, isPartialInlineEmotionMarker, isReservedCanonicalEmotionMarker, normalizeInlineEmotion, parseInlineEmotionMarker, stripInlineEmotionMarkers, stripInlineReservedSyntax } from "../server/collaboration/inline-emotion-contract";

export type ConversationTurnLength="compact"|"rich";
export type InlineEmotionScene={id:string;emotion:string;text:string;sourceOffset:number};
export type InlineEmotionPresentation={leadingText:string;plainText:string;scenes:InlineEmotionScene[];hasMarkers:boolean};

export { INLINE_EMOTION_NAMES, stripInlineEmotionMarkers };
export const TONE_BURNOUT_EMOTION_PALETTES={"baby-talk-cutesy":["dead","tired","disappointed","embarrassed","facepalm","speechless","pout"]} as const;

function fenceDelimiter(value:string){return value.match(/^\s*(`{3,}|~{3,})/)?.[1]??null;}
function leadingEmotionMarker(line:string){
  const match=line.match(/^(\s*)(\[\[(?:e:)?[a-z0-9_~-]+\]\])(?:[ \t]+(.*))?$/i),marker=match?parseInlineEmotionMarker(match[2]):null;
  return marker&&match?{marker,sourceOffset:match[1].length,text:match[3]??""}:null;
}

// Conversation inline emotion scenes are part of the provider's main output.
// They are model-authored and must not depend on MCP/catch mode or avatar panel options.
export function parseInlineEmotionScenes(runId:string,messageItemId:string,content:string,mode:ConversationTurnLength="rich"):InlineEmotionPresentation{
  const cap=mode==="compact"?1:3,lines=content.match(/[^\n]*(?:\n|$)/g)?.filter(Boolean)??[],leading:string[]=[];
  const drafts:Array<{emotion:string;sourceOffset:number;parts:string[]}>=[];
  let current:{emotion:string;sourceOffset:number;parts:string[]}|null=null,overflow=false,offset=0,sawReservedMarker=false,fence:string|null=null;
  // A complete marker is itself an authored visual beat. Preserve it even when
  // the provider omitted the following dialogue so consecutive asset-only
  // beats do not collapse to the final marker or the fallback output frame.
  const flush=()=>{if(!current)return;drafts.push(current);current=null;};
  for(let index=0;index<lines.length;index++){
    const raw=lines[index],hasEnding=raw.endsWith("\n"),line=hasEnding?raw.slice(0,-1).replace(/\r$/,""):raw,ending=hasEnding?"\n":"",trimmed=line.trim(),delimiter=fenceDelimiter(line);
    if(fence){
      const preserved=line+ending;if(current)current.parts.push(preserved);else leading.push(preserved);
      if(delimiter?.[0]===fence[0]&&delimiter.length>=fence.length)fence=null;
      offset+=raw.length;continue;
    }
    if(delimiter){
      fence=delimiter;const preserved=line+ending;if(current)current.parts.push(preserved);else leading.push(preserved);
      offset+=raw.length;continue;
    }
    const leadingMarker=leadingEmotionMarker(line),marker=leadingMarker?.marker??parseInlineEmotionMarker(trimmed);
    if(marker){
      sawReservedMarker=true;
      if(!overflow)flush();
      if(drafts.length>=cap)overflow=true;
      if(!overflow)current={emotion:marker.emotion,sourceOffset:offset+(leadingMarker?.sourceOffset??line.indexOf("[[")),parts:[]};
      if(leadingMarker?.text){const text=leadingMarker.text+ending;if(overflow&&drafts.length)drafts[drafts.length-1].parts.push(text);else current?.parts.push(text);}
      offset+=raw.length;continue;
    }
    const finalUnterminatedLine=index===lines.length-1&&!hasEnding;
    if(isReservedCanonicalEmotionMarker(trimmed)||isPartialInlineEmotionMarker(trimmed,finalUnterminatedLine)){sawReservedMarker=true;offset+=raw.length;continue;}
    const cleaned=stripInlineReservedSyntax(line)+ending;
    if(overflow&&drafts.length)drafts[drafts.length-1].parts.push(cleaned);
    else if(current)current.parts.push(cleaned);
    else leading.push(cleaned);
    offset+=raw.length;
  }
  if(!overflow)flush();
  const scenes=drafts.slice(0,cap).map(scene=>({id:`${runId}:${messageItemId}:${scene.sourceOffset}`,emotion:scene.emotion,text:scene.parts.join("").trim(),sourceOffset:scene.sourceOffset}));
  if(import.meta.env?.DEV)assertUniqueKeys("inline conversation emotion scenes",scenes,scene=>scene.id);
  return{leadingText:stripInlineEmotionMarkers(leading.join("")),plainText:stripInlineEmotionMarkers(content),scenes,hasMarkers:sawReservedMarker&&scenes.length>0};
}

export function resolveInlineEmotionAsset(emotion:string,available:EmotionAsset[],seed:string):EmotionAsset|null{
  if(!available.length)return null;
  const normalized=normalizeInlineEmotion(emotion),matching=available.filter(asset=>emotionGroup(asset.emotion)===normalized).sort((left,right)=>left.file.localeCompare(right.file)),fallback=available.filter(asset=>emotionGroup(asset.emotion)==="neutral").sort((left,right)=>left.file.localeCompare(right.file)),pool=matching.length?matching:fallback.length?fallback:[...available].sort((left,right)=>left.file.localeCompare(right.file));
  return pool[hash(`${seed}:${normalized}`)%pool.length]??null;
}

function hash(value:string){let result=2166136261;for(let index=0;index<value.length;index++){result^=value.charCodeAt(index);result=Math.imul(result,16777619);}result^=result>>>16;result=Math.imul(result,0x85ebca6b);result^=result>>>13;result=Math.imul(result,0xc2b2ae35);return(result^(result>>>16))>>>0;}
export function emotionGroup(emotion:string){return emotion.replace(/_[0-9]+$/,"");}
export function emotionLabel(emotion:string){const group=emotionGroup(emotion),key=`emotion.${group}`;return translate(key)===key?group:translate(key);}

const ACTIVITY_GROUPS=new Set(["building","coding","reading","searching"]);
const STRONG_EMOTION_GROUPS=new Set(["angry","dead","crying","scared","disgusted","love","chu","gift","sleepy","tired","speechless"]);
const CONFIDENT_CUE_SCORE=2;
const STRONG_CUE_SCORE=2.5;
type EmotionCue={group:string;score:number;index:number;action?:boolean};
const KISS_META=/(?:이모티콘|이모지|이모션|에셋|트리거|키워드|단어|표현|등록|테스트|안\s*(?:뜨|나오)|emoji|emoticon|sticker)/i;
const KISS_NEGATION=/(?:안\s*(?:돼|되|해|했|할|받)|못\s*(?:해|했|할)|하지\s*마|싫어|거절|않(?:아|았|을))/i;
const KISS_HYPOTHETICAL=/(?:했(?:다|다고)\s*치자|한\s*셈|(?:이)?라면|가정|척(?:하|했)|인\s*척)/i;
const unique=(values:string[])=>[...new Set(values)];
function activityGroups(output:string){
  const groups:string[]=[];
  if(/(?:코드|코딩|구현|개발|디버깅|수정).{0,12}(?:중|하고 있|해볼게|하겠습니다|진행)|(?:작업|도구).{0,8}(?:실행|진행) 중/i.test(output))groups.push("coding");
  if(/빌드.{0,12}(?:중|하고 있|해볼게|하겠습니다|돌리)|(?:기능|앱|파일|코드|결과물|프로젝트).{0,8}(?:생성|만들|구축).{0,10}(?:중|고 있|해볼게|하겠습니다)/i.test(output))groups.push("building");
  if(/(?:문서|파일|자료|코드|결과물).{0,8}(?:읽|검토|살펴보|확인).{0,10}(?:중|고 있|어볼게|아볼게|하겠습니다)|(?:문서|파일|자료|코드|결과물).{0,8}(?:검토하|살펴보).{0,8}(?:는 중|고 있)/i.test(output))groups.push("reading");
  if(/(?:조사|검색|찾아보|알아보|자료를 찾).{0,12}(?:중|고 있|할게|하겠습니다|해볼게)/i.test(output))groups.push("searching");
  if(/(?:실행|테스트|명령을 돌리).{0,10}(?:중|고 있|해볼게|하겠습니다)/i.test(output))groups.push("building");
  return unique(groups);
}

function contextualCues(output:string){
  const cues:EmotionCue[]=[];
  const add=(pattern:RegExp,groups:Array<[string,number]>)=>{const match=output.match(pattern);if(match)for(const[group,score]of groups)cues.push({group,score,index:match.index??0});};
  add(/ㅋㅋ|ㅎㅎ|웃|재밌/i,[["laughing",1.5],["happy",1.25]]);
  add(/부끄|쑥스럽|민망|당황|얼굴.{0,6}(?:빨|화끈|뜨거)|준비.{0,5}안 [됐]|심장|(?:^|[\s…])([가-힣]),\s*\1/i,[["embarrassed",2.5]]);
  add(/놀랐|깜짝|진짜\?|헉|세상에/i,[["surprised",2.5]]);
  add(/미안|속상|슬프|서운|아쉽/i,[["sad",2.5],["disappointed",2]]);
  add(/걱정|조심|괜찮아\?|무리하지|쉬어/i,[["nervous",2],["happy",1]]);
  add(/신나|기대|좋겠다|설레/i,[["excited",2.5],["happy",1]]);
  add(/고민|생각해|헷갈|모르겠/i,[["thinking",2],["confused",2]]);
  add(/사랑해|사랑스럽|(?:널|너를|네가|당신을) 좋아|보고 싶|안아|너만|한테만|놓치기 싫|마음에 들|싫지가 않|love you/i,[["love",3]]);
  add(/😉|윙크|농담|장난|귀엽|예쁘|반칙|훅 들어|간질/i,[["wink",2.25],["smug",1.5]]);
  add(/아니거든|억울|하지 마|조금만이야/i,[["pout",2.5]]);
  add(/화났|화가\s*나|분노|짜증|빡치|열받/i,[["angry",3]]);
  add(/눈물|울고|울었|울음|울먹|[ㅠㅜ]{2,}|😭/i,[["crying",3]]);
  add(/무서|두려|겁나|공포/i,[["scared",3]]);
  add(/역겨|혐오|질색/i,[["disgusted",3]]);
  add(/녹초|기진맥진|죽을 만큼 지/i,[["dead",3]]);
  add(/피곤|지쳤|지친|고단/i,[["tired",2.5]]);
  add(/졸려|졸리|잠이\s*(?:와|온)/i,[["sleepy",3]]);
  add(/말문(?:이)?\s*막|할 말을 잃|어이없/i,[["speechless",3]]);
  add(/선물.{0,6}(?:받아|줄게|할게|가져왔)/i,[["gift",3]]);
  const kissMatches:Array<{index:number;length:number;hard:boolean;actionForm?:boolean}>=[];
  // Treat the complete performed expression as one token. Matching only the
  // leading "뽀뽀" left "쪽!" in the suffix, so the existing action boundary
  // check could not recognize compact real-world forms such as 뽀뽀쪽!.
  for(const match of output.matchAll(/뽀뽀\s*쪽+/gi))kissMatches.push({index:match.index,length:match[0].length,hard:true});
  for(const match of output.matchAll(/뽀뽀|입맞춤|키스|\bkiss\b|💋/gi))kissMatches.push({index:match.index,length:match[0].length,hard:true});
  for(const match of output.matchAll(/(?:^|[\s"'“‘([{])((?:쪽+|츄)\s*(?:했(?:어|잖아|다)?|할게|해(?:줘|줄게|볼게)?|하자))/gi)){const token=match[1],index=match.index+match[0].length-token.length;kissMatches.push({index,length:token.length,hard:false,actionForm:true});}
  for(const match of output.matchAll(/(?:^|[\s"'“‘([{])((?:쪽+|츄)|\bchu\b)(?=$|[\s!?！.,~…♡♥❤💋–—\-"'”’)\]}])/gi)){const token=match[1],index=match.index+match[0].length-token.length;kissMatches.push({index,length:token.length,hard:false});}
  for(const match of kissMatches){
    const start=Math.max(0,match.index-18),end=Math.min(output.length,match.index+match.length+18),context=output.slice(start,end),after=output.slice(match.index+match.length,match.index+match.length+12),meta=KISS_META.test(context),negated=KISS_NEGATION.test(context),hypothetical=KISS_HYPOTHETICAL.test(context),marked=/^\s*(?:[!！♡♥❤💋~…–—-]|$)/.test(after),actionSyntax=/^\s*(?:을|를)?\s*(?:해|했|할|하자|받아|줄게)/.test(after),performed=!meta&&!negated&&!hypothetical&&(match.actionForm||marked||actionSyntax||context.includes("💋"));
    let score=match.hard?3:2;if(!performed)score-=3;if(meta)score-=3;if(negated)score-=3;if(hypothetical)score-=1.5;if(performed&&context.includes("💋"))score+=1.5;else if(performed&&match.actionForm)score+=1;else if(performed&&marked)score+=.5;
    cues.push({group:"chu",score:Math.max(0,score),index:match.index,action:performed});
  }
  return cues;
}

const TECHNICAL_SIGNALS=[
  /\b(?:MCP|API|JSON|HTTP|SDK|CLI|regex|token|schema|context|cache|model)\b/i,
  /(?:토큰|스키마|컨텍스트|캐시|모델|도구|정규식|토크나이저)/i,
  /(?:입력|출력|호출|응답|프롬프트|지시문|설정|태그|이모션|후처리)/i,
  /(?:비용|과금|단가|비율|추정치|오버헤드|고정\s*비용|정의)/i,
  /(?:\d[\d,.]*\s*(?:%|토큰|배|달러)|\$[\d.]+|\/M\b)/i,
  /(?:방식|구조화|패턴|기록|압축|트리거|감지)/i,
  /`[^`]+`|\[[^\]]+\]|\*\*|(?:^|\n)\s*[-*]\s/m,
];
function technicalSignalCount(output:string){return TECHNICAL_SIGNALS.reduce((count,pattern)=>count+Number(pattern.test(output)),0);}

function toneGroups(tonePreset:string,strongAffection:boolean){
  if(tonePreset==="secretary")return["neutral","thinking","proud"];
  if(tonePreset==="tsundere")return["smug","pout","embarrassed","neutral",...(strongAffection?["love"]:[])];
  if(tonePreset==="whale-girl")return["smug","pout","embarrassed","laughing","neutral",...(strongAffection?["love"]:[])];
  if(tonePreset==="flirty-friend")return["embarrassed","happy","wink","neutral",...(strongAffection?["love"]:[])];
  if(tonePreset==="coy-affection")return["embarrassed","smug","happy","wink","neutral",...(strongAffection?["love"]:[])];
  if(tonePreset==="sharp-tongue")return["smug","facepalm","speechless","disappointed","angry","neutral"];
  if(tonePreset==="mesugaki-brat")return["smug","laughing","pout","embarrassed","tired","neutral",...(strongAffection?["love"]:[])];
  if(tonePreset==="aristocratic-ojosama")return["smug","proud","embarrassed","laughing","speechless","neutral",...(strongAffection?["love"]:[])];
  if(tonePreset==="contempt-roleplay")return["disgusted","speechless","facepalm","disappointed","smug","angry","tired","neutral"];
  if(tonePreset==="lewd-guardian-comedy")return["smug","thinking","speechless","neutral","wink"];
  if(tonePreset==="playful-school-friend")return["laughing","happy","wink","excited","smug"];
  if(tonePreset==="baby-talk-cutesy")return["happy","excited","pout","embarrassed","laughing","neutral",...(strongAffection?["love"]:[])];
  return["neutral","happy","thinking"];
}

export function selectOutputAssets(runId:string,output:string,available:EmotionAsset[],tonePreset="default",emotionIntensity:"subtle"|"natural"|"expressive"="natural",avoidGroups:string[]=[]):EmotionAsset[]{
  if(!available.length)return[];
  const rawCues=contextualCues(output),strongAffection=rawCues.some(cue=>cue.group==="chu"&&(cue.action||cue.score>=STRONG_CUE_SCORE))||/사랑해|love you/i.test(output),affection=strongAffection||/(?:널|너를|네가|당신을) 좋아|사랑스럽|보고 싶|안아/i.test(output),activities=activityGroups(output),tonal=toneGroups(tonePreset,affection);
  const safe=available.filter(asset=>{
    const group=emotionGroup(asset.emotion);
    if(!strongAffection&&(/cuu/i.test(asset.file)||group==="chu"))return false;
    return!ACTIVITY_GROUPS.has(group)||activities.includes(group);
  });
  const assets=[...safe].sort((a,b)=>a.file.localeCompare(b.file)),length=output.trim().length;
  if(!assets.length)return[];
  // Emotion cues must clear a confidence threshold. Without one, only the
  // selected tone's own palette plus neutral/thinking can be used. Strong
  // reactions always require a strong textual cue. A sharp speaking preset,
  // for example, is not evidence that the speaker is actually angry. Activity
  // assets keep their independent ongoing-action
  // gate and are never admitted as general emotional fallbacks.
  const availableGroups=unique(assets.map(asset=>emotionGroup(asset.emotion))),groupedCues=[...rawCues.filter(cue=>cue.score>=CONFIDENT_CUE_SCORE&&availableGroups.includes(cue.group)).reduce((map,cue)=>{const previous=map.get(cue.group);if(!previous||cue.score>previous.score||cue.score===previous.score&&cue.index>previous.index)map.set(cue.group,cue);return map;},new Map<string,EmotionCue>()).values()],strongCueGroups=new Set(groupedCues.filter(cue=>cue.action||cue.score>=STRONG_CUE_SCORE).map(cue=>cue.group)),technicalRegister=technicalSignalCount(output)>=2,fallbackSet=new Set([...tonal,"neutral","thinking",...(technicalRegister?["proud"]:[])]),emotionGroups=availableGroups.filter(group=>!ACTIVITY_GROUPS.has(group)&&(fallbackSet.has(group)||groupedCues.some(cue=>cue.group===group))&&(!STRONG_EMOTION_GROUPS.has(group)||strongCueGroups.has(group))),hasStrongCue=groupedCues.some(cue=>cue.action||cue.score>=STRONG_CUE_SCORE),technicalClamp=technicalRegister&&!hasStrongCue,technicalGroups=emotionGroups.filter(group=>["neutral","thinking","proud"].includes(group)),eligibleEmotionGroups=technicalClamp&&technicalGroups.length?technicalGroups:emotionGroups,eligibleSet=new Set(eligibleEmotionGroups),eligibleCues=technicalClamp?[]:groupedCues.filter(cue=>eligibleSet.has(cue.group)),allowedCues=eligibleCues.filter(cue=>cue.action||!avoidGroups.includes(cue.group)),cues=allowedCues.length?allowedCues:eligibleCues,activityCandidates=availableGroups.filter(group=>ACTIVITY_GROUPS.has(group)&&activities.includes(group)),weightedEmotionGroups=[...tonal.flatMap(group=>Array(3).fill(group)),"neutral","thinking",...eligibleEmotionGroups].filter(group=>eligibleSet.has(group)),weightedGroups=[...weightedEmotionGroups,...activityCandidates],unblocked=weightedGroups.filter(group=>!avoidGroups.includes(group));
  if(!weightedGroups.length)return[];
  const strongestScore=cues.length?Math.max(...cues.map(cue=>cue.score)):null,strongest=strongestScore===null?[]:cues.filter(cue=>cue.score===strongestScore),fallbackGroups=unblocked.length?unblocked:weightedGroups,dominant=strongest.length?strongest[hash(`${runId}:${output.slice(0,80)}:cue`)%strongest.length]:null,dominantGroup=dominant?.group??fallbackGroups[hash(`${runId}:${output.slice(0,80)}:group:0`)%fallbackGroups.length];
  const transitionCues=cues.filter(cue=>cue.score>=2).sort((a,b)=>a.index-b.index),opening=transitionCues[0],closing=[...transitionCues].reverse().find(cue=>cue.group!==opening?.group),semanticTransition=Boolean(opening&&closing&&closing.index-opening.index>=12),wanted=emotionIntensity==="subtle"?1:semanticTransition&&length>=40?2:emotionIntensity==="expressive"&&length>=160||emotionIntensity==="natural"&&length>=500?2:1,firstGroup=wanted===2&&semanticTransition?opening!.group:dominantGroup,firstPool=assets.filter(asset=>emotionGroup(asset.emotion)===firstGroup),first=firstPool[hash(`${runId}:variant:0`)%firstPool.length],selected=[first];
  if(wanted===1)return selected;
  const remainingWeighted=weightedGroups.filter(group=>group!==firstGroup&&!avoidGroups.includes(group)),remainingGroups=remainingWeighted.length?remainingWeighted:weightedGroups.filter(group=>group!==firstGroup),secondGroup=semanticTransition?closing!.group:remainingGroups.length?remainingGroups[hash(`${runId}:${output.slice(-80)}:group:1`)%remainingGroups.length]:null;
  if(secondGroup){const secondPool=assets.filter(asset=>emotionGroup(asset.emotion)===secondGroup);selected.push(secondPool[hash(`${runId}:variant:1`)%secondPool.length]);}
  return selected;
}

export function selectOutputAssetHistory(runId:string,outputs:Array<{id:string;text:string}>,available:EmotionAsset[],tonePreset="default",emotionIntensity:"subtle"|"natural"|"expressive"="natural",avoidGroups:string[]=[]){
  const recentGroups=[...avoidGroups],moments:Array<{id:string;asset:EmotionAsset|null}>=[];
  for(const output of outputs){const asset=selectOutputAssets(`${runId}:process:${output.id}`,output.text,available,tonePreset,emotionIntensity,recentGroups.slice(-2))[0]??null,group=asset?emotionGroup(asset.emotion):null;if(group&&recentGroups.at(-1)===group)moments.push({id:output.id,asset:null});else{moments.push({id:output.id,asset});if(group)recentGroups.push(group);}}
  return{moments,recentGroups};
}

let emotionAssetBaseUrl="";
export function setEmotionAssetBaseUrl(value:string){try{emotionAssetBaseUrl=new URL(value,location.origin).origin===location.origin?"":new URL(value,location.origin).origin;}catch{emotionAssetBaseUrl="";}}
export function emotionAssetUrl(outfit:string,file:string){return `${emotionAssetBaseUrl}/emoticons/${encodeURIComponent(outfit)}/${encodeURIComponent(file)}`;}
