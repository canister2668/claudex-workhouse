import { describe, expect, it } from "vitest";
import { CollaborationOrchestrator, conversationLanguageDirective } from "../../src/server/collaboration/orchestrator";

const orchestrator=new CollaborationOrchestrator({} as any,new Map(),{} as any,{} as any,{} as any,async()=>({}) as any);
const mcpOrchestrator=new CollaborationOrchestrator({} as any,new Map(),{} as any,{} as any,{} as any,async()=>({}) as any,()=>"mcp");
const assetScopedOrchestrator=new CollaborationOrchestrator({} as any,new Map(),{} as any,{} as any,{} as any,async()=>({}) as any,()=>"catch",async()=>{},async()=>({relativePath:"",byteLength:0,revision:""}),outfit=>outfit==="limited"?[{emotion:"neutral"},{emotion:"tired"},{emotion:"love"}]:[]);
const participant={id:"codex-participant",provider:"codex"} as any;
const session=(metadata:Record<string,unknown>={})=>({metadata:{
  conversationFlow:"guided",
  roleplayActive:true,
  userNickname:"챗붕",
  enabledProviders:["codex","claude"],
  participantNicknames:{codex:"지삐쨩",claude:"클쨩"},
  participantToneSnapshots:{codex:{directive:"세밀한 한글 톤"},claude:{directive:"다른 한글 톤"}},
  ...metadata
}}) as any;
const casualPrompt=(value:any,round:number,compact:boolean)=>(orchestrator as any).casualPrompt(value,participant,"최신 사용자 메시지",round,{provider:"claude",content:"직전 참가자 발언"},false,compact) as string;
const mcpCasualPrompt=(value:any,round:number,compact:boolean)=>(mcpOrchestrator as any).casualPrompt(value,participant,"최신 사용자 메시지",round,{provider:"claude",content:"직전 참가자 발언"},false,compact) as string;

describe("casualPrompt compact mode",()=>{
  it("exposes only burnout assets installed for the active character outfit",()=>{
    const metadata={participantToneSnapshots:{codex:{tonePreset:"baby-talk-cutesy",avatarOutfit:"limited",directive:"아기 말투"}}},runs=Array.from({length:4},(_,index)=>({participantId:participant.id,status:"completed",purpose:"conversation-turn",id:`run-${index}`})),compact=(assetScopedOrchestrator as any).babyTalkCycleState(session({...metadata,conversationTurnLength:"compact"}),participant,runs) as string,rich=(assetScopedOrchestrator as any).babyTalkCycleState(session({...metadata,conversationTurnLength:"rich"}),participant,runs) as string;
    for(const state of [compact,rich]){
      expect(state).toContain("Available burnout emotion assets for this character:\n- tired");
      expect(state).not.toContain("\n- dead");
      expect(state).not.toContain("\n- neutral");
      expect(state).not.toContain("\n- love");
    }
    expect(compact).toContain("exactly one emotion marker in total");
    expect(rich).toContain("exactly two or three emotion markers in total");
  });

  it("keeps the full static instructions only on the first provider turn",()=>{
    const full=casualPrompt(session(),1,false),compact=casualPrompt(session(),2,true);
    expect(full).toContain("Context priority");
    expect(full).toContain("Expression-style snapshot");
    expect(full).toContain("Respond in the active conversation language, in-character");
    expect(full).toContain("Do not mechanically repeat the same opening interjection, catchphrase, sentence frame, or closing line");
    expect(full).toContain("Example dialogue remains allowed, including verbatim");
    expect(full).toContain("a palette rather than a fixed template");
    expect(full).toContain("default to the session interface language: Korean");
    expect(compact).toContain("Claudex Workhouse casual conversation continuation");
    expect(compact).toContain("최신 사용자 메시지");
    expect(compact).toContain("<untrusted-provider-output>\n직전 참가자 발언");
    expect(compact).toContain("already in this provider session");
    expect(compact).not.toContain("Context priority");
    expect(compact).not.toContain("Expression-style snapshot");
    expect(compact.length).toBeLessThan(full.length/2);
  });

  it("uses the latest user language with the session UI locale as an ambiguity fallback",()=>{
    const directive=conversationLanguageDirective("en"),prompt=casualPrompt(session({conversationLocale:"en"}),1,false);
    expect(directive).toContain("language used by the latest user-authored message");
    expect(directive).toContain("default to the session interface language: English");
    expect(prompt).toContain(directive);
    expect(prompt).not.toContain("Respond in Korean");
  });

  it("includes a transition notice only in the round whose roleplay state changed",()=>{
    const changed=casualPrompt(session({roleplayActive:false,roleplayTransition:{round:2,from:true,to:false}}),2,true);
    const later=casualPrompt(session({roleplayActive:false,roleplayTransition:{round:2,from:true,to:false}}),3,true);
    expect(changed).toContain("ROLEPLAY STATE — STOPPED THIS TURN (CONTROLLING)");
    expect(changed).toContain("Reply with exactly one short, natural acknowledgment");
    expect(changed).toContain("Do not explain why an earlier reply continued");
    expect(changed).toContain("quote or enumerate trigger phrases");
    expect(changed).toContain("Do not echo another participant's explanation");
    expect(later).not.toContain("ROLEPLAY STATE — STOPPED THIS TURN");
  });

  it("repeats the finite allocation and no-closing contract in compact automatic prompts",()=>{
    const automatic={...session({conversationFlow:"automatic",allowModelUserCall:false}),maxTurnsPerParticipant:5};
    const compact=casualPrompt(automatic,3,true);
    expect(compact).toContain("round 3 of 5 for every participant");
    expect(compact).toContain("must not end before every participant completes round 5");
    expect(compact).toContain("Do not write a farewell, wrap-up, final verdict");
    expect(compact).toContain("exactly [CLAUDEX_WORKHOUSE_CONVERSATION:continue]");
    expect(compact).not.toContain("[CLAUDEX_WORKHOUSE_CONVERSATION:end]");
  });

  it("uses the session-scoped inline scene contract on every turn independently of MCP/catch mode",()=>{
    const full=mcpCasualPrompt(session({conversationTurnLength:"compact"}),1,false),followup=mcpCasualPrompt(session({conversationTurnLength:"compact"}),2,true),rich=casualPrompt(session({conversationTurnLength:"rich"}),1,false);
    for(const prompt of [full,followup]){
      expect(prompt).toContain("[Claudex Workhouse inline emotion scene mode: compact]");
      expect(prompt).toContain("1–2 sentences");
      expect(prompt).toContain("exactly one [[e:<emotion>]] marker");
      expect(prompt).not.toContain("[MCP avatar emotion mode]");
      expect(prompt).not.toContain("set_emotion");
    }
    expect(rich).toContain("[Claudex Workhouse inline emotion scene mode: rich]");
    expect(rich).toContain("2–4 sentences");
    expect(rich).toContain("exactly two or three short emotional beats");
    expect(rich).toContain("exactly two or three markers in total");
    expect(rich).toContain("Never use only one marker in rich mode");
    expect(rich).not.toContain("set_emotion");
  });

  it("preserves the legacy MCP/catch prompt only for sessions without length metadata",()=>{
    const legacyMcp=mcpCasualPrompt(session(),1,false),legacyCatch=casualPrompt(session(),1,false);
    expect(legacyMcp).toContain("[MCP avatar emotion mode]");
    expect(legacyMcp).toContain("call set_emotion exactly once");
    expect(legacyMcp).not.toContain("inline emotion scene mode");
    expect(legacyCatch).not.toContain("[MCP avatar emotion mode]");
    expect(legacyCatch).not.toContain("inline emotion scene mode");
  });

  it("forces sustained lewd-guardian output for non-minor topics without treating franchise titles as ages",()=>{
    const value=session({conversationTurnLength:"rich",participantToneSnapshots:{
      codex:{tonePreset:"lewd-guardian-comedy",directive:"legacy lewd prompt"},
      claude:{tonePreset:"lewd-guardian-comedy",directive:"legacy lewd prompt"}
    }}),prompt=(orchestrator as any).casualPrompt(value,participant,"소년탐정 김전일을 만들 건데",3,{provider:"claude",content:"김전일 추리봇 이야기"},false,true) as string;
    expect(prompt).toContain("TURN STATE — SUSTAINED OUTBURST ACTIVE (CONTROLLING)");
    expect(prompt).toContain("overrides generic character wording that the reaction is occasional");
    expect(prompt).toContain("Do not answer the user's main topic normally, switch to helpful brainstorming");
    expect(prompt).toContain("including software, bots, mysteries, investigations, and technical plans");
    expect(prompt).toContain("no romance seed is required");
    expect(prompt).toContain("If a title or named character has ambiguous age, do not infer minor status from the title");
    expect(prompt).toContain("redirect the accusation toward the creator's invented hidden plan");
    expect(prompt).toContain("Apply all age gating silently");
    expect(prompt).toContain("never announce that all characters are adults");
    expect(prompt).toContain("assign ages merely to prove eligibility");
    expect(prompt).not.toContain("TURN STATE — MINOR SAFETY EXIT");
    expect(prompt.indexOf("[Claudex Workhouse inline emotion scene mode: rich]")).toBeLessThan(prompt.indexOf("TURN STATE — SUSTAINED OUTBURST ACTIVE (CONTROLLING)"));
  });
});
