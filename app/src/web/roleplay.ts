export type RoleplayTransition="stop"|"resume"|null;

export function roleplayTransition(input:unknown):RoleplayTransition{
  const value=String(input??"").replace(/\s+/g," ").trim();
  if(!value)return null;
  if(/\b(?:resume|restart|continue|start)\s+(?:the\s+)?(?:rp|role[ -]?play)\b|\b(?:rp|role[ -]?play)\s+(?:again|back\s+on)\b/i.test(value)||/(?:RP|ロールプレイ|キャラ(?:クター)?(?:口調|演技)?).{0,10}(?:再開|再び|戻して|続けて)/i.test(value))return"resume";
  if(/\b(?:stop|end|quit|drop|disable)\s+(?:the\s+)?(?:rp|role[ -]?play)\b|\b(?:rp|role[ -]?play)\s+(?:off|over|done)\b/i.test(value)||/(?:RP|ロールプレイ|キャラ(?:クター)?(?:口調|演技)?).{0,10}(?:中止|終了|やめて|解除)/i.test(value))return"stop";
  const subject="(?:rp|role[ -]?play|역할극|롤플(?:레잉)?|캐릭터(?:\\s*연기)?|이?\\s*톤|말투)";
  if(new RegExp(`${subject}.{0,10}(?:재개|다시\\s*시작|이어(?:서|가)|돌아가)`,"i").test(value)||new RegExp(`(?:재개|다시\\s*시작).{0,10}${subject}`,"i").test(value))return"resume";
  if(new RegExp(`${subject}.{0,10}(?:중지|정지|종료|그만|해제|멈춰|멈춤)`,"i").test(value)||new RegExp(`(?:중지|정지|종료|그만|해제|멈춰|멈춤).{0,10}${subject}`,"i").test(value))return"stop";
  if(/^(?:이\s*)?(?:톤|말투)\s*(?:그만|중단|종료|해제|멈춰)(?:해|하자|할게|합니다)?[.!?…\s]*$/i.test(value))return"stop";
  return null;
}

export function roleplayActiveAtRound(messages:Array<{round?:number;messageType?:string;message_type?:string;contentRef?:string;content_ref?:string}>,round:number,initial=true){
  let active=initial;
  for(const message of [...messages].filter(item=>(item.messageType??item.message_type)==="user-input"&&Number(item.round)<=round).sort((a,b)=>Number(a.round)-Number(b.round))){const transition=roleplayTransition(message.contentRef??message.content_ref);if(transition)active=transition==="resume";}
  return active;
}
