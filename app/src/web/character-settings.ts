export type TonePreset="default"|"playful-school-friend"|"baby-talk-cutesy"|"flirty-friend"|"coy-affection"|"tsundere"|"sharp-tongue"|"mesugaki-brat"|"aristocratic-ojosama"|"contempt-roleplay"|"lewd-guardian-comedy"|"secretary"|"whale-girl"|"custom";
export type ProviderCharacter={nickname:string;tonePreset:TonePreset;conversationOnly:boolean;customTone:string;avatarOutfit:string;emotionIntensity:"subtle"|"natural"|"expressive"};
export type AvatarDisplay="character"|"name-mark";
export type CharacterSettings={version:1;avatarDisplay:AvatarDisplay;providers:Record<"codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok",ProviderCharacter>};
export const TONE_PRESETS:Array<{id:TonePreset}>=[
  {id:"default"},{id:"playful-school-friend"},{id:"baby-talk-cutesy"},{id:"flirty-friend"},{id:"coy-affection"},{id:"tsundere"},{id:"sharp-tongue"},{id:"mesugaki-brat"},{id:"aristocratic-ojosama"},{id:"contempt-roleplay"},{id:"lewd-guardian-comedy"},{id:"secretary"},{id:"whale-girl"},{id:"custom"}
];
export const DEFAULT_CHARACTERS:CharacterSettings={version:1,avatarDisplay:"character",providers:{
  codex:{nickname:"지삐쨩",tonePreset:"default",conversationOnly:true,customTone:"",avatarOutfit:"Gpt-Sol",emotionIntensity:"natural"},
  claude:{nickname:"클쨩",tonePreset:"flirty-friend",conversationOnly:true,customTone:"",avatarOutfit:"normal",emotionIntensity:"natural"},
  deepseek:{nickname:"딥쨩",tonePreset:"playful-school-friend",conversationOnly:true,customTone:"",avatarOutfit:"DeepSeek",emotionIntensity:"natural"},
  ollama:{nickname:"올라마쨩",tonePreset:"playful-school-friend",conversationOnly:true,customTone:"",avatarOutfit:"Ollama",emotionIntensity:"natural"},
  antigravity:{nickname:"잼민E",tonePreset:"mesugaki-brat",conversationOnly:true,customTone:"",avatarOutfit:"Antigravity",emotionIntensity:"natural"},
  grok:{nickname:"그록쨩",tonePreset:"aristocratic-ojosama",conversationOnly:true,customTone:"",avatarOutfit:"Grok",emotionIntensity:"natural"}
}};
