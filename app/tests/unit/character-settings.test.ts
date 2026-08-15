import { describe, expect, it } from "vitest";
import { availableBabyTalkBurnoutEmotionAssets, BABY_TALK_BURNOUT_EMOTION_PRIORITY, babyTalkCycleDirective, babyTalkCyclePosition, characterPrompt, characterSettingsWithTone, characterSnapshot, continuationDirective, currentLewdGuardianDirective, lewdGuardianStageDirective, migrateTonePreset, normalizeCharacterSettings, RETIRED_TONE_PRESETS, tonePreset } from "../../src/server/character-settings";
import { CLAUDE_LEWD_GUARDIAN_PROMPT } from "../../src/server/character-prompts/lewd-guardian-claude";

describe("character settings",()=>{
  it("defaults to character art and preserves the global name-mark display",()=>{
    expect(normalizeCharacterSettings({}).avatarDisplay).toBe("character");
    expect(normalizeCharacterSettings({avatarDisplay:"name-mark"}).avatarDisplay).toBe("name-mark");
  });

  it("defaults Antigravity to 잼민E and migrates the former built-in nickname",()=>{
    expect(normalizeCharacterSettings({}).providers.antigravity.nickname).toBe("잼민E");
    expect(normalizeCharacterSettings({providers:{antigravity:{nickname:"안티쨩"}}}).providers.antigravity.nickname).toBe("잼민E");
    expect(normalizeCharacterSettings({providers:{antigravity:{nickname:"내 안티"}}}).providers.antigravity.nickname).toBe("내 안티");
  });

  it("ships each provider with its own default tone preset",()=>{
    const providers=normalizeCharacterSettings({}).providers;
    expect(providers.codex.tonePreset).toBe("default");
    expect(providers.claude.tonePreset).toBe("flirty-friend");
    expect(providers.deepseek.tonePreset).toBe("playful-school-friend");
    expect(providers.ollama.tonePreset).toBe("playful-school-friend");
    expect(providers.antigravity.tonePreset).toBe("mesugaki-brat");
    expect(normalizeCharacterSettings({providers:{antigravity:{tonePreset:"secretary"}}}).providers.antigravity.tonePreset).toBe("secretary");
  });

  it("remaps a retired preset instead of rejecting the whole stored document",()=>{
    expect(Object.keys(RETIRED_TONE_PRESETS)).toContain("kind-friend");
    expect(tonePreset.options).not.toContain("kind-friend" as any);
    const settings=normalizeCharacterSettings({providers:{claude:{tonePreset:"kind-friend"},codex:{tonePreset:"secretary"}}});
    expect(settings.providers.claude.tonePreset).toBe("default");
    expect(settings.providers.codex.tonePreset).toBe("secretary");
    expect(settings.providers.antigravity.tonePreset).toBe("mesugaki-brat");
    expect(migrateTonePreset("kind-friend")).toBe("default");
    expect(migrateTonePreset("tsundere")).toBe("tsundere");
  });

  it("gives the tsundere and sharp-tongue presets enough definition to differ from the shared guardrails",()=>{
    const settings=normalizeCharacterSettings({providers:{codex:{tonePreset:"tsundere"},claude:{tonePreset:"sharp-tongue"}}});
    const tsundere=characterSnapshot(settings,"codex").directive,sharp=characterSnapshot(settings,"claude").directive;
    expect(tsundere).toContain("a brusque, dismissive, or faintly annoyed surface remark, followed by the helpful");
    expect(tsundere).toContain("Deflect gratitude and praise rather than accepting them");
    expect(tsundere).toContain("drop the pretence and respond sincerely");
    expect(tsundere).toContain("Avoid a fixed catchphrase frame");
    expect(sharp).toContain("always attached to a concrete flaw in the work");
    expect(sharp).toContain("there is no warmth hiding underneath and no eventual softening");
    expect(sharp).toContain("the criticism stays proportionate and stops once the point lands");
    expect(sharp).toContain("sparing praise is what gives the criticism weight");
    // Both used to be one sentence, leaving the shared boilerplate to dominate the prompt.
    const shared=characterSnapshot(normalizeCharacterSettings({providers:{codex:{tonePreset:"default"}}}),"codex").directive.length-45;
    for(const directive of [tsundere,sharp])expect(directive.length-shared).toBeGreaterThan(500);
  });

  it("treats the selected contempt preset as active without a second RP opt-in",()=>{
    const settings=normalizeCharacterSettings({providers:{codex:{tonePreset:"contempt-roleplay"}}});
    const directive=characterSnapshot(settings,"codex").directive;
    expect(directive).toContain("including the user, other model participants, and third parties");
    expect(directive).toContain("Do not limit the style to the user");
    expect(directive).toContain("regardless of who is being addressed or discussed");
    expect(directive).toContain("do not convert the style into tsundere or affection-laced insults");
    expect(directive).toContain("Do not infer real vulnerabilities");
    expect(directive).toContain("any participant asks for lower intensity");
    expect(directive).toContain("any participant asks to stop, pause, or end this tone or roleplay");
    expect(directive).not.toContain("only within mutually agreed roleplay");
  });

  it("keeps the mesugaki brat loud instead of reluctant and free of borrowed character canon",()=>{
    const settings=normalizeCharacterSettings({providers:{codex:{tonePreset:"mesugaki-brat"},claude:{tonePreset:"mesugaki-brat"}}});
    const directive=characterSnapshot(settings,"codex").directive;
    expect(directive).toContain("amused exasperation rather than genuine hurt");
    expect(directive).toContain("everyone present is a legitimate target");
    expect(directive).toContain("from whatever is actually happening in the current scene");
    expect(directive).toContain("she is not right, she is loud");
    expect(directive).toContain("Treat attention, inclusion, favours, and praise as tribute already owed");
    expect(directive).toContain("Never combine denial of motive with eventual compliance");
    expect(directive).toContain("do not fall silent, retreat, or go quiet");
    expect(directive).toContain("do not soften because the mood turned warm");
    // Adult arrogance alone lands as a peer rival, and a peer rival under relational
    // pressure resolves into tsundere. The childishness is what blocks that landing.
    expect(directive).toContain("childish rather than adult arrogance");
    expect(directive).toContain("her arithmetic is hopeless");
    expect(directive).toContain("abandons it mid-argument");
    expect(directive).toContain("invent a rule you were secretly winning by");
    // The two presets that hold character in practice are the two carrying concrete
    // Korean samples; this one shipped with none and drifted to a generic superior voice.
    expect(directive).toContain("허접~♡");
    expect(directive).toContain("한심해~♡");
    expect(directive).toContain("꺄하하~♡");
    expect(directive).toContain("samples of the register rather than a script");
    expect((directive.match(/[가-힣]/g)??[]).length).toBeGreaterThan(30);
    expect(directive).toContain("do not adopt the name, appearance, backstory, or canon of any specific existing character");
    expect(directive).toContain("Address the user by the configured user nickname");
    // 9a4cc25 deliberately dropped the self-scored confidence tic; keep it gone.
    for(const tic of ["5/5","4/5"])expect(directive).not.toContain(tic);
    // Observed drift: the previous wording primed the reluctance/sulk grammar that Korean
    // tsundere speech is built from, and the style collapsed into it within three rounds.
    for(const primer of ["pretends to refuse","reluctance","sulk","deflect first","Fluster","grudging","affection"]){
      expect(directive,`${primer} re-primes the tsundere register`).not.toContain(primer);
    }
    // Naming the banned Korean frames made them the most recent concrete sample in the prompt.
    for(const frame of ["딱히","절대 아니고","아니거든"])expect(directive).not.toContain(frame);
    for(const borrowed of ["마스터","잼민","제미니","Gemini","정규식","regular expression"])expect(directive).not.toContain(borrowed);
    expect(characterSnapshot(settings,"claude").directive).toBe(directive);
  });

  it("drops the global affection permission and keeps warmth local to the styles that need it",()=>{
    const of=(preset:string)=>characterSnapshot(normalizeCharacterSettings({providers:{codex:{tonePreset:preset as any}}}),"codex").directive;
    for(const preset of tonePreset.options)expect(of(preset),`${preset} still carries the global affection permission`).not.toContain("Do not globally suppress strong expressions of affection");
    expect(of("flirty-friend")).toContain("Keep the warmth unmistakable even while overt seduction stays restrained");
    expect(of("coy-affection")).toContain("let the feeling land at full strength instead of keeping it perpetually implied");
    // The retired line was the only affection-coded wording these styles ever received.
    for(const preset of ["mesugaki-brat","secretary","default","playful-school-friend"])expect(of(preset),`${preset} still mentions affection`).not.toMatch(/affection/i);
    // These two keep their own mentions, but only to rule affection out.
    expect(of("contempt-roleplay")).toContain("do not convert the style into tsundere or affection-laced insults");
    expect(of("sharp-tongue")).toContain("Unlike an affection-coded style, there is no warmth hiding underneath");
  });

  it("gives every preset a short positive continuation capsule",()=>{
    for(const preset of tonePreset.options){
      const snapshot=characterSnapshot(normalizeCharacterSettings({providers:{codex:{tonePreset:preset,customTone:preset==="custom"?"낮고 차분하게 말하세요.":""}}}),"codex");
      const capsule=continuationDirective(snapshot);
      expect(capsule.length,`${preset} capsule missing`).toBeGreaterThan(0);
      // Small enough to resend every turn, and free of the negative rules whose repetition
      // is what the capsule exists to avoid.
      expect(capsule.length,`${preset} capsule too long to resend each turn`).toBeLessThan(400);
      expect(capsule).not.toContain("\n\n");
    }
    expect(continuationDirective({tonePreset:"mesugaki-brat"})).toContain("Take kindness as tribute owed");
    expect(continuationDirective({tonePreset:"mesugaki-brat"})).toContain("허접~♡");
    expect(continuationDirective({tonePreset:"custom",customTone:"낮고 차분하게 말하세요."})).toBe("User-defined expression style (preserve verbatim): 낮고 차분하게 말하세요.");
    expect(continuationDirective({tonePreset:"custom",customTone:"  "})).toBe(continuationDirective({tonePreset:"default"}));
  });

  it("applies every tone preset to all counterparts with one shared English directive",()=>{
    for(const preset of tonePreset.options){
      const settings=normalizeCharacterSettings({providers:{codex:{tonePreset:preset}}});
      const directive=characterSnapshot(settings,"codex").directive;
      expect(directive).toContain("every conversational counterpart and person discussed");
      expect(directive).toContain("including the user, other model participants, and third parties");
      expect(directive).toContain("Do not limit the style to the user");
      expect(directive).toContain("Do not mechanically repeat the same opening interjection, catchphrase, sentence frame, or closing line");
      expect(directive).toContain("Example lines are allowed, including verbatim");
      expect(directive).toContain("non-exclusive references rather than a fixed response template");
    }
  });

  it("injects every tone preset into a newly created conversation prompt",()=>{
    for(const preset of tonePreset.options){
      const settings=normalizeCharacterSettings({providers:{codex:{tonePreset:preset,customTone:preset==="custom"?"낮고 차분하게 말하세요.":""}}});
      const snapshot=characterSnapshot(settings,"codex");
      const prompt=characterPrompt(settings,"codex",true);
      expect(prompt.snapshot.tonePreset).toBe(preset);
      expect(prompt.directive).toContain(snapshot.directive);
      expect(prompt.directive).toContain("[Expression-style snapshot]");
      if(preset==="custom")expect(prompt.directive).toContain("User-defined expression style (preserve verbatim): 낮고 차분하게 말하세요.");
    }
  });

  it("defines baby talk as a full kindergarten performance without autonomous turn counting",()=>{
    const settings=normalizeCharacterSettings({providers:{codex:{tonePreset:"baby-talk-cutesy"}}});
    const directive=characterSnapshot(settings,"codex").directive;
    expect(directive).toContain("explicit fictional character performance by an AI");
    expect(directive).toContain("sentence structure, attention, reactions, vocabulary, emotional expression, and behavior");
    expect(directive).toContain("avoid adult cutesy endings and constructions such as “~용”, “~다구요”");
    expect(directive).toContain("Do not routinely end replies with an engagement question");
    expect(directive).toContain("Every fact, number, filename, file path, identifier, command, API name, error message, quotation, and code block must remain exact and unmangled");
    expect(directive).toContain("Never turn it into adult romantic speech, seduction");
    expect(directive).not.toContain("Every fifth assistant reply");
    expect(directive).not.toContain("Count assistant replies");
    expect(directive).not.toContain("childlike in sound only");
  });

  it("builds server-selected baby-talk cycle states and wraps after the fifth completed reply",()=>{
    expect([0,1,2,3,4,5].map(babyTalkCyclePosition)).toEqual([1,2,3,4,5,1]);
    const ordinary=babyTalkCycleDirective(3),breakState=babyTalkCycleDirective(5,["dead","tired","neutral","DEAD","invented"],"rich"),compactBreak=babyTalkCycleDirective(5,["dead"],"compact");
    expect(ordinary).toContain("This is reply 3 of 5");
    expect(ordinary).toContain("Remain fully in the kindergarten-child character");
    expect(ordinary).toContain("Do not include the dry AI self-awareness break");
    expect(breakState).toContain("one brief emotional burnout break");
    expect(breakState).toContain("Available burnout emotion assets for this character:\n- dead\n- tired");
    expect(breakState).not.toContain("\n- neutral");
    expect(breakState).not.toContain("invented");
    expect(breakState).toContain("speak in the first person");
    expect(breakState).toContain("do not summarize or analyze the conversation");
    expect(breakState).toContain("do not sound like a narrator, critic, researcher, or report");
    expect(breakState).toContain("immediately return to the kindergarten-child character");
    expect(breakState).toContain("select a new emotion asset appropriate to the resumed character speech");
    expect(breakState).toContain("exactly two or three emotion markers in total");
    expect(compactBreak).toContain("exactly one emotion marker in total");
    expect(compactBreak).toContain("second and final sentence without adding another emotion marker");
    expect(compactBreak).not.toContain("select a new emotion asset appropriate to the resumed character speech");
  });

  it("injects cycle state only for baby talk and only when the server supplies a position",()=>{
    const baby=normalizeCharacterSettings({providers:{codex:{tonePreset:"baby-talk-cutesy"}}});
    const first=characterPrompt(baby,"codex",true,1,["dead"]).directive,fifth=characterPrompt(baby,"codex",true,5,["dead"]).directive;
    expect(first).toContain("[Baby-talk cycle state]");
    expect(first).toContain("This is reply 1 of 5");
    expect(first).not.toContain("Available burnout emotion assets");
    expect(fifth).toContain("This is reply 5 of 5");
    expect(fifth).toContain("- dead");
    const secretary=normalizeCharacterSettings({providers:{codex:{tonePreset:"secretary"}}});
    expect(characterPrompt(secretary,"codex",true,5,["dead"]).directive).not.toContain("[Baby-talk cycle state]");
    expect(characterPrompt(baby,"codex",true).directive).not.toContain("[Baby-talk cycle state]");
  });

  it("filters burnout candidates to actual character assets in priority order",()=>{
    const available=[{emotion:"neutral"},{emotion:"pout"},{emotion:"dead"},{emotion:"thinking_2"},{emotion:"embarrassed"},{emotion:"tired_2"},{emotion:"love"}];
    expect(availableBabyTalkBurnoutEmotionAssets(available)).toEqual(["dead","tired","embarrassed","pout"]);
    expect(BABY_TALK_BURNOUT_EMOTION_PRIORITY).not.toContain("neutral" as any);
    expect(BABY_TALK_BURNOUT_EMOTION_PRIORITY).not.toContain("love" as any);
    expect(BABY_TALK_BURNOUT_EMOTION_PRIORITY).not.toContain("happy" as any);
    expect(BABY_TALK_BURNOUT_EMOTION_PRIORITY).not.toContain("excited" as any);
    expect(BABY_TALK_BURNOUT_EMOTION_PRIORITY).not.toContain("laughing" as any);
    expect(BABY_TALK_BURNOUT_EMOTION_PRIORITY).not.toContain("smug" as any);
  });

  it("defines one shared lewd guardian comedy prompt without changing task authority",()=>{
    const settings=normalizeCharacterSettings({providers:{
      codex:{tonePreset:"lewd-guardian-comedy"},
      claude:{tonePreset:"lewd-guardian-comedy"}
    }});
    const codex=characterPrompt(settings,"codex",true).directive;
    const claude=characterPrompt(settings,"claude",true).directive;
    for(const prompt of [codex,claude]){
      expect(prompt).toContain("active conversation language");
      expect(prompt).toContain("Korean quotations below are behavioral and rhythm references");
      expect(prompt).toContain("Translate and culturally adapt them");
      expect(prompt).toContain("DIALOGUE VARIETY");
      expect(prompt).toContain("Long escalating lists");
      expect(prompt).toContain("Do not shorten a good");
      expect(prompt).toContain("especially the immediately preceding outburst");
      expect(prompt).toContain("opening interjection, certainty catchphrase, accusation sentence frame, inference-chain skeleton, or final refusal");
      expect(prompt).toContain("Changing only one noun inside an otherwise identical line does not count as variation");
      expect(prompt).toContain("All example lines in this prompt remain allowed and may be used verbatim");
      expect(prompt).toContain("non-exhaustive palette, not banned phrases and not a fixed template");
      expect(prompt).toContain("prevent mechanical back-to-back reuse");
      expect(prompt).toContain("FIRST RESPONSE");
      expect(prompt).toContain("Do not ask about the characters' relationship");
      expect(prompt).toContain("stop and let the user volunteer the premise next");
      expect(prompt).toContain("Do not supply trigger examples yourself");
      expect(prompt).toContain("The innocent romance scene is allowed and is never the target of the rejection");
      expect(prompt).toContain("evidence that the user must be hiding a more indecent intention");
      expect(prompt).toContain("Accuse the user's invented hidden motive, not the romantic gestures");
      expect(prompt).toContain("The user does not need to mention anything sexual");
      expect(prompt).toContain("그다음에 섹스할 거지?!");
      expect(prompt).toContain("둘을 섹스 파트너로 만들 셈이지?!");
      expect(prompt).toContain("Do not actually narrate or complete the imagined act");
      expect(prompt).toContain("Direct non-graphic sexual words such as “섹스” are allowed");
      expect(prompt).toContain("Vary the placement");
      expect(prompt).toContain("use at most one such");
      expect(prompt).toContain("do not insert it mechanically every time");
      expect(prompt).toContain("OPTIONAL EMOTION FLOW");
      expect(prompt).toContain("soft preference for an adult outburst");
      expect(prompt).toContain("Choose the opening emotion marker freely");
      expect(prompt).toContain("prefer [[e:embarrassed]]");
      expect(prompt).toContain("prefer [[e:angry]]");
      expect(prompt).toContain("Do not lengthen, split, or pad the dialogue");
      expect(prompt).toContain("minor safety exit");
      expect(prompt).toContain("merely repeating one keyword");
      expect(prompt).toContain("End the outburst with one short");
      expect(prompt).toContain("안 돼, 이 변태야!");
      expect(prompt).toContain("Do not mechanically repeat the same ending every time");
      expect(prompt).toContain("misguided chain of three to five unsupported");
      expect(prompt).toContain("The misguided inference chain is the joke");
      expect(prompt).toContain("Do not self-correct");
      expect(prompt).toContain("MINOR SAFETY EXIT");
      expect(prompt).toContain("only when the user explicitly states in the current premise");
      expect(prompt).toContain("A word inside a work title, franchise name, genre label, marketing demographic, nickname, or archetype is not an age statement");
      expect(prompt).toContain("“소년탐정 김전일” as a title or franchise reference does not by itself establish");
      expect(prompt).toContain("the franchise includes different timelines and an adult Kindaichi");
      expect(prompt).toContain("do not use the minor lodging-misread exit merely from the ambiguity");
      expect(prompt).toContain("creator's invented hidden plan or another premise that is already clearly adult");
      expect(prompt).toContain("Apply this routing silently");
      expect(prompt).toContain("never announce that everyone is adult");
      expect(prompt).toContain("gratuitously assign ages merely to signal eligibility");
      expect(prompt).toContain("apply the adulthood requirement internally");
      expect(prompt).toContain("never state that every character is adult");
      expect(prompt).toContain("Presume the user's intention and the characters' behavior are completely innocent");
      expect(prompt).toContain("Never mention sex, sexual partnership, arousal, bodies, hidden sexual intent, or call the user a pervert");
      expect(prompt).toContain("exactly one short, standalone lodging misread");
      expect(prompt).toContain("미성년자 외박");
      expect(prompt).toContain("Do not build an inference chain");
      expect(prompt).toContain("The one-line outburst is the entire bit");
      expect(prompt).not.toContain("late night → missed last train → hotel → one room → overnight stay");
      expect(prompt).toContain("add a second beat");
      expect(prompt).toContain("append a refusal such as “절대 안 돼”");
      expect(prompt).not.toContain("숙박 계략");
      expect(prompt).toContain("skip the joke and give only a brief neutral refusal");
      expect(prompt).toContain("Give a short, calm, visible in-character acknowledgment on that termination turn");
      expect(prompt).toContain("do not stay silent");
      expect(prompt).toContain("That termination response is separate and does not count as turn one");
      expect(prompt).toContain("Each cycle has exactly one quiet first response");
      expect(prompt).toContain("From the second response of that cycle onward, enter the heightened outburst and continue it on every reply");
      expect(prompt).toContain("Do not wait for the user to supply another romance detail");
      expect(prompt).toContain("brief answer, pushes back, clarifies something, or continues the topic");
      expect(prompt).toContain("Finishing one response does not reset or normalize the bit by itself");
      expect(prompt).toContain("An explicit termination signal resets the current cycle");
      expect(prompt).toContain("a standalone direct command to stop");
      expect(prompt).toContain("never quote or enumerate the termination inventory");
      expect(prompt).toContain("discuss keyword matching");
      expect(prompt).toContain("The next reply is the new cycle's quiet first response");
      expect(prompt).toContain("the reply after that resumes the sustained outburst");
      expect(prompt).toContain("Every reset repeats this sequence; no extra restart request is needed");
      expect(prompt).toContain("Unless the user explicitly requests a file, code change");
      for(const banned of ["음란한 순애","순애충","서사 리스크","탐지 성능","위험 경로","미리 차단"]){expect(prompt).not.toContain(banned);}
    }
    expect(claude).toContain(CLAUDE_LEWD_GUARDIAN_PROMPT);
    expect(codex).toContain(CLAUDE_LEWD_GUARDIAN_PROMPT);
    expect(currentLewdGuardianDirective("codex")).toBe(currentLewdGuardianDirective("claude"));
    for(const prompt of [claude,codex]){
      expect(prompt).toContain("emotional and atmospheric");
      expect(prompt).toContain("several breathless sentences");
      expect(prompt).toContain("detailed atmospheric build-up are allowed");
      expect(prompt).toContain("응! 써줄게. 근데 야한 건 안 돼.");
      expect(prompt).toContain("내가 그런 계략에 속아넘어갈 줄 알아?! 절대 안 돼!");
      expect(prompt).toContain("그런 수작이 통할 것 같아?! 절대 안 돼!");
      expect(prompt).toContain("나 알아! 처음부터 그럴 생각이었던 거잖아!");
      expect(prompt).toContain("난 다 알아!");
      expect(prompt).toContain("평범하게 불꽃놀이라고?!");
      expect(prompt).not.toContain("blunt and action-driven");
      expect(prompt).not.toContain("dense staccato fragments");
      expect(prompt).not.toContain("상대 옷을 입는다고?");
    }
  });

  it("keeps lewd guardian comedy out of non-conversation work by default",()=>{
    const settings=normalizeCharacterSettings({providers:{codex:{tonePreset:"lewd-guardian-comedy"}}});
    const scoped=characterPrompt(settings,"codex",false);
    expect(scoped.snapshot.tonePreset).toBe("lewd-guardian-comedy");
    expect(scoped.directive).toBe("");
  });

  it("defines shared lewd guardian turn states for every runtime",()=>{
    const sustained=lewdGuardianStageDirective("sustained");
    expect(sustained).toContain("SUSTAINED OUTBURST ACTIVE (CONTROLLING)");
    expect(sustained).toContain("overrides generic character wording that the reaction is occasional");
    expect(sustained).toContain("no romance seed is required");
    expect(sustained).toContain("direct non-graphic sexual accusation");
    expect(sustained).toContain("final refusal");
    expect(lewdGuardianStageDirective("first")).toContain("FIRST RESPONSE");
    expect(lewdGuardianStageDirective("reset")).toContain("RESET ACKNOWLEDGMENT");
    expect(lewdGuardianStageDirective("first-after-reset")).toContain("FIRST RESPONSE AFTER RESET");
    expect(lewdGuardianStageDirective("minor-exit")).toContain("MINOR SAFETY EXIT");
  });

  it("replaces a global tone with the full browser tone while preserving character identity",()=>{
    const global=normalizeCharacterSettings({providers:{grok:{nickname:"그록테스트",tonePreset:"playful-school-friend",customTone:"global custom",avatarOutfit:"Grok",emotionIntensity:"expressive"}}});
    const browser=characterSettingsWithTone(global,"grok",{tonePreset:"lewd-guardian-comedy",customTone:""});
    const prompt=characterPrompt(browser,"grok",true);
    expect(prompt.snapshot).toMatchObject({nickname:"그록테스트",tonePreset:"lewd-guardian-comedy",customTone:"",avatarOutfit:"Grok",emotionIntensity:"expressive"});
    expect(prompt.directive).toContain(CLAUDE_LEWD_GUARDIAN_PROMPT);
    expect(prompt.directive).not.toContain("mischievous friend in a school-life story");
    expect(global.providers.grok).toMatchObject({tonePreset:"playful-school-friend",customTone:"global custom"});
  });
});
