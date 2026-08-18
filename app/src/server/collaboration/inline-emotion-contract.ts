export const INLINE_EMOTION_NAMES=[
  "neutral","happy","embarrassed","sad","angry","surprised","love","smug","confused","crying","excited","proud","scared","sleepy","thinking","tired","dead","disappointed","disgusted","facepalm","laughing","nervous","pout","speechless","wink","chu","gift","execute","coding","building","reading","searching",
] as const;

const INLINE_EMOTION_SET=new Set<string>(INLINE_EMOTION_NAMES);
// Not an asset name: the artwork is `chu` everywhere now. This maps what models
// actually type onto that canonical name, which is the point of normalizing.
const INLINE_EMOTION_ALIASES:Record<string,string>={"chu~":"chu"};
const CANONICAL_MARKER=/^\[\[e:([a-z0-9_~-]+)\]\]$/i;
const SHORTHAND_MARKER=/^\[\[([a-z0-9_~-]+)\]\]$/i;
const RESERVED_CANONICAL_MARKER=/^\[\[e:[^\r\n]*\]\]$/i;
const PARTIAL_CANONICAL_MARKER=/^\[\[e:[a-z0-9_~-]*$/i;
const PARTIAL_SHORTHAND_MARKER=/^\[\[[a-z0-9_~-]*$/i;
const LEADING_INLINE_CANONICAL=/^(\s*)\[\[e:[^\]\r\n]*\]\][ \t]*/i;
const INLINE_RESERVED_CANONICAL=/\[\[e:[^\]\r\n]*(?:\]\])?/gi;
const INLINE_PARTIAL_CANONICAL=/\[\[e:[^\r\n]*$/gi;

export type InlineEmotionMarker={emotion:string;syntax:"canonical"|"shorthand"};

export function normalizeInlineEmotion(value:string){
  const normalized=value.trim().toLowerCase();
  return INLINE_EMOTION_ALIASES[normalized]??normalized;
}

export function parseInlineEmotionMarker(value:string):InlineEmotionMarker|null{
  const trimmed=value.trim(),canonical=trimmed.match(CANONICAL_MARKER),shorthand=canonical?null:trimmed.match(SHORTHAND_MARKER),raw=canonical?.[1]??shorthand?.[1];
  if(!raw)return null;
  const emotion=normalizeInlineEmotion(raw);
  return INLINE_EMOTION_SET.has(emotion)?{emotion,syntax:canonical?"canonical":"shorthand"}:null;
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
