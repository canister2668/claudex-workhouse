export const INLINE_EMOTION_NAMES=[
  "neutral","happy","embarrassed","sad","angry","surprised","love","smug","confused","crying","excited","proud","scared","sleepy","thinking","tired","dead","disappointed","disgusted","facepalm","laughing","nervous","pout","speechless","wink","chu","gift","execute","coding","building","reading","searching",
] as const;

const INLINE_EMOTION_SET=new Set<string>(INLINE_EMOTION_NAMES);
// Not an asset name: the artwork is `chu` everywhere now. This maps what models
// actually type onto that canonical name, which is the point of normalizing.
const INLINE_EMOTION_ALIASES:Record<string,string>={"chu~":"chu"};
const CANONICAL_MARKER=/^\[\[e:([a-z0-9_~-]+)\]\]$/i;
const COMPATIBLE_EQUALS_MARKER=/^\[\[e=([a-z0-9_~-]+)\]\]$/i;
const SHORTHAND_MARKER=/^\[\[([a-z0-9_~-]+)\]\]$/i;
const RESERVED_CANONICAL_MARKER=/^\[\[e[:=][^\r\n]*\]\]$/i;
const PARTIAL_CANONICAL_MARKER=/^\[\[e[:=][a-z0-9_~-]*$/i;
const PARTIAL_SHORTHAND_MARKER=/^\[\[[a-z0-9_~-]*$/i;
const LEADING_INLINE_CANONICAL=/^(\s*)\[\[e[:=][^\]\r\n]*\]\][ \t]*/i;
const INLINE_RESERVED_CANONICAL=/\[\[e[:=][^\]\r\n]*(?:\]\])?/gi;
const INLINE_PARTIAL_CANONICAL=/\[\[e[:=][^\r\n]*$/gi;

export type InlineEmotionMarker={emotion:string;syntax:"canonical"|"compatible-equals"|"shorthand"};

export function normalizeInlineEmotion(value:string){
  const normalized=value.trim().toLowerCase();
  return INLINE_EMOTION_ALIASES[normalized]??normalized;
}

export function parseInlineEmotionMarker(value:string):InlineEmotionMarker|null{
  const trimmed=value.trim(),canonical=trimmed.match(CANONICAL_MARKER),compatible=canonical?null:trimmed.match(COMPATIBLE_EQUALS_MARKER),shorthand=canonical||compatible?null:trimmed.match(SHORTHAND_MARKER),raw=canonical?.[1]??compatible?.[1]??shorthand?.[1];
  if(!raw)return null;
  const emotion=normalizeInlineEmotion(raw);
  return INLINE_EMOTION_SET.has(emotion)?{emotion,syntax:canonical?"canonical":compatible?"compatible-equals":"shorthand"}:null;
}

export function isReservedCanonicalEmotionMarker(value:string){
  return RESERVED_CANONICAL_MARKER.test(value.trim());
}

export function isPartialInlineEmotionMarker(value:string,finalUnterminatedLine:boolean){
  const trimmed=value.trim();
  return PARTIAL_CANONICAL_MARKER.test(trimmed)||(finalUnterminatedLine&&PARTIAL_SHORTHAND_MARKER.test(trimmed));
}

export function stripInlineReservedSyntax(value:string){
  return value.replace(LEADING_INLINE_CANONICAL,"$1").replace(INLINE_RESERVED_CANONICAL,"").replace(INLINE_PARTIAL_CANONICAL,"");
}

function fenceDelimiter(value:string){
  const match=value.match(/^\s*(`{3,}|~{3,})/);
  return match?.[1]??null;
}

export function stripInlineEmotionMarkers(content:string){
  const lines=content.match(/[^\n]*(?:\n|$)/g)?.filter(Boolean)??[],output:string[]=[];
  let fence:string|null=null;
  for(let index=0;index<lines.length;index++){
    const raw=lines[index],hasEnding=raw.endsWith("\n"),line=hasEnding?raw.slice(0,-1).replace(/\r$/,""):raw,delimiter=fenceDelimiter(line);
    if(fence){
      output.push(raw);
      if(delimiter?.[0]===fence[0]&&delimiter.length>=fence.length)fence=null;
      continue;
    }
    if(delimiter){fence=delimiter;output.push(raw);continue;}
    const marker=parseInlineEmotionMarker(line),finalUnterminatedLine=index===lines.length-1&&!hasEnding;
    if(marker||isReservedCanonicalEmotionMarker(line)||isPartialInlineEmotionMarker(line,finalUnterminatedLine))continue;
    output.push(`${stripInlineReservedSyntax(line).replace(/[ \t]+$/,"")}${hasEnding?"\n":""}`);
  }
  return output.join("").replace(/\n{3,}/g,"\n\n").trim();
}

export type KissEmotionCue={index:number;score:number;performed:boolean};

const KISS_META=/(?:이모티콘|이모지|이모션|에셋|아카콘|트리거|키워드|단어|표현|등록|테스트|안\s*(?:뜨|나오)|emoji|emoticon|sticker)/i;
const KISS_NEGATION=/(?:안\s*(?:돼|되|해|했|할|받)|못\s*(?:해|했|할)|하지\s*마|싫어|거절|않(?:아|았|을))/i;
const KISS_HYPOTHETICAL=/(?:했(?:다|다고)\s*치자|한\s*셈|(?:이)?라면|가정|척(?:하|했)|인\s*척)/i;

// A kiss frame represents an action performed in the reply, not a topic word.
// Conversation assets and browser replies share this detector so meta
// discussion, negation and hypothetical phrasing cannot drift apart.
export function kissEmotionCues(output:string):KissEmotionCue[]{
  const matches:Array<{index:number;length:number;hard:boolean;actionForm?:boolean}>=[];
  for(const match of output.matchAll(/뽀뽀\s*쪽+/gi))matches.push({index:match.index,length:match[0].length,hard:true});
  for(const match of output.matchAll(/뽀뽀|입맞춤|키스|\bkiss\b|💋/gi))matches.push({index:match.index,length:match[0].length,hard:true});
  for(const match of output.matchAll(/(?:^|[\s"'“‘([{])((?:쪽+|츄)\s*(?:했(?:어|잖아|다)?|할게|해(?:줘|줄게|볼게)?|하자))/gi)){const token=match[1]!,index=match.index+match[0].length-token.length;matches.push({index,length:token.length,hard:false,actionForm:true});}
  for(const match of output.matchAll(/(?:^|[\s"'“‘([{])((?:쪽+|츄)|\bchu\b)(?=$|[\s!?！.,~…♡♥❤💋–—\-"'”’)\]}])/gi)){const token=match[1]!,index=match.index+match[0].length-token.length;matches.push({index,length:token.length,hard:false});}
  return matches.map(match=>{
    const start=Math.max(0,match.index-18),end=Math.min(output.length,match.index+match.length+18),context=output.slice(start,end),after=output.slice(match.index+match.length,match.index+match.length+12),meta=KISS_META.test(context),negated=KISS_NEGATION.test(context),hypothetical=KISS_HYPOTHETICAL.test(context),marked=/^\s*(?:[!！♡♥❤💋~…–—-]|$)/.test(after),actionSyntax=/^\s*(?:을|를)?\s*(?:해|했|할|하자|받아|줄게)/.test(after),performed=!meta&&!negated&&!hypothetical&&(match.actionForm||marked||actionSyntax||context.includes("💋"));
    let score=match.hard?3:2;if(!performed)score-=3;if(meta)score-=3;if(negated)score-=3;if(hypothetical)score-=1.5;if(performed&&context.includes("💋"))score+=1.5;else if(performed&&match.actionForm)score+=1;else if(performed&&marked)score+=.5;
    return{index:match.index,score:Math.max(0,score),performed};
  });
}

export function hasPerformedKiss(output:string){return kissEmotionCues(output).some(cue=>cue.performed);}
