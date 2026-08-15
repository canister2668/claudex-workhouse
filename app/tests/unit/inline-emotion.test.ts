import { describe,expect,it } from "vitest";
import { conversationRelayContent } from "../../src/server/collaboration/orchestrator";
import { INLINE_EMOTION_NAMES as SERVER_EMOTIONS, inlineEmotionPrompt,stripInlineEmotionMarkers as stripServerMarkers } from "../../src/server/collaboration/inline-emotion";
import { INLINE_EMOTION_NAMES as WEB_EMOTIONS, parseInlineEmotionScenes,resolveInlineEmotionAsset,stripInlineEmotionMarkers } from "../../src/web/collaboration-assets";
import { buildInlineEmotionCards, buildOutputAssetFrames, resolveConversationScenePosition, resolveParticipantOutfit } from "../../src/web/collaboration-presentation";

describe("conversation inline emotion prompt and relay",()=>{
  it("keeps alternating scene direction while honoring explicit positions",()=>{
    expect([0,1,2,3,4].map(index=>resolveConversationScenePosition({},index))).toEqual(["left","right","left","right","left"]);
    expect(resolveConversationScenePosition({assetPosition:"right"},0)).toBe("right");
    expect(resolveConversationScenePosition({position:"left"},1)).toBe("left");
  });
  it("keeps the length contract session-scoped and strips markers from participant relay",()=>{
    expect(inlineEmotionPrompt("compact")).toContain("1–2 sentences");
    expect(inlineEmotionPrompt("compact")).toContain("active conversation language");
    expect(inlineEmotionPrompt("compact")).toContain("exactly one [[e:<emotion>]] marker");
    expect(inlineEmotionPrompt("compact")).toContain("complete [[e:<emotion>]] syntax including the e: prefix");
    expect(inlineEmotionPrompt("compact")).toContain("Never use shorthand such as [[pout]]");
    expect(inlineEmotionPrompt("rich")).toContain("2–4 sentences");
    expect(inlineEmotionPrompt("rich")).toContain("active conversation language");
    expect(inlineEmotionPrompt("rich")).toContain("exactly two or three short emotional beats");
    expect(inlineEmotionPrompt("rich")).toContain("exactly two or three markers in total");
    expect(inlineEmotionPrompt("rich")).toContain("Never use only one marker in rich mode");
    expect(inlineEmotionPrompt("rich")).toContain("including the second and third marker");
    expect(inlineEmotionPrompt("rich")).toContain("Never use shorthand such as [[pout]] or [[smug]]");
    const output="[[e:smug]]\n첫 대사.\n\n[[e:laughing]]\n둘째 대사.\n[CLAUDEX_WORKHOUSE_CONVERSATION:continue]";
    expect(conversationRelayContent(output)).toBe("첫 대사.\n\n둘째 대사.");
    expect(stripServerMarkers(output)).not.toContain("[[e:");
    expect(stripInlineEmotionMarkers(output)).not.toContain("[[e:");
    expect(WEB_EMOTIONS).toBe(SERVER_EMOTIONS);
  });

  it("strips canonical and allowlisted shorthand markers symmetrically without eating unknown brackets",()=>{
    const output="[[e:angry]]\n하나.\n[[pout]]\n둘.\n[[TODO]]\n셋.";
    const expected="하나.\n둘.\n[[TODO]]\n셋.";
    expect(stripServerMarkers(output)).toBe(expected);
    expect(stripInlineEmotionMarkers(output)).toBe(expected);
    expect(conversationRelayContent(output)).toBe(expected);
  });
});

describe("conversation inline emotion parser",()=>{
  it("uses each provider's current outfit ahead of its session snapshot",()=>{
    expect(resolveParticipantOutfit({provider:"deepseek",sessionOutfit:"DeepSeek",liveOutfit:"Ollama"})).toBe("Ollama");
    expect(resolveParticipantOutfit({provider:"ollama",sessionOutfit:"Gemma-e4b",liveOutfit:"Ollama"})).toBe("Ollama");
    expect(resolveParticipantOutfit({provider:"antigravity",sessionOutfit:"Antigravity",liveOutfit:"Gemma-e4b"})).toBe("Gemma-e4b");
    expect(resolveParticipantOutfit({provider:"claude",liveOutfit:"capy"})).toBe("capy");
    expect(resolveParticipantOutfit({provider:"codex",codexAvatar:"Gpt-Sol"})).toBe("Gpt-Sol");
  });

  it("builds fallback output frames for compatible providers from their own catalogs",()=>{
    const people:Record<string,{id:string;provider:"deepseek"|"ollama"}>={deepseek:{id:"deepseek",provider:"deepseek"},ollama:{id:"ollama",provider:"ollama"}},runs=[{id:"deep-run",participantId:"deepseek"},{id:"ollama-run",participantId:"ollama"}],outfits={deepseek:"DeepSeek",ollama:"Ollama"};
    const frames=buildOutputAssetFrames({runs,participant:id=>people[id],output:run=>run.id==="deep-run"?"기뻐.":"생각해 볼게.",outfit:person=>outfits[person.provider],available:outfit=>[{emotion:"neutral",file:`${outfit}-neutral.webp`}],roleplayActive:()=>true,toneSnapshot:()=>({tonePreset:"default",emotionIntensity:"natural"})});
    expect(frames.get("deep-run")?.[0]?.file).toBe("DeepSeek-neutral.webp");
    expect(frames.get("ollama-run")?.[0]?.file).toBe("Ollama-neutral.webp");
  });

  it("creates ordered stable scenes and converges from streaming to the completed snapshot",()=>{
    const content="[[e:smug]]\n첫 대사.\n[[e:laughing]]\n둘째 대사.";
    const streaming=parseInlineEmotionScenes("run-1","run-1",content.slice(0,-2),"rich"),completed=parseInlineEmotionScenes("run-1","run-1",content,"rich");
    expect(completed.scenes.map(scene=>scene.emotion)).toEqual(["smug","laughing"]);
    expect(completed.scenes.map(scene=>scene.id)).toEqual(streaming.scenes.map(scene=>scene.id));
    expect(new Set(completed.scenes.map(scene=>scene.id)).size).toBe(completed.scenes.length);
    expect(completed.plainText).toBe("첫 대사.\n둘째 대사.");
  });

  it("preserves every authored asset when rich markers have no dialogue",()=>{
    const run={id:"asset-only-claude",participantId:"claude",status:"completed"},person={id:"claude",provider:"claude"},output="[[e:surprised]]\n[[e:speechless]]\n[[e:facepalm]]";
    const parsed=parseInlineEmotionScenes(run.id,run.id,output,"rich");
    expect(parsed).toMatchObject({plainText:"",hasMarkers:true});
    expect(parsed.scenes.map(scene=>({emotion:scene.emotion,text:scene.text}))).toEqual([
      {emotion:"surprised",text:""},
      {emotion:"speechless",text:""},
      {emotion:"facepalm",text:""},
    ]);
    const card=buildInlineEmotionCards({runs:[run],output:()=>output,participant:()=>person,outfit:()=>"normal",available:()=>[
      {emotion:"surprised",file:"surprised.webp"},
      {emotion:"speechless",file:"speechless.webp"},
      {emotion:"facepalm",file:"facepalm.webp"},
    ],mode:"rich"}).get(run.id);
    expect(card?.scenes.map(scene=>scene.asset?.file)).toEqual(["surprised.webp","speechless.webp","facepalm.webp"]);
  });

  it("renders provider output when canonical markers share the dialogue line",()=>{
    const output=[
      "[[e:confused]] 첫 반응.",
      "[[e:laughing]] 둘째 반응.",
      "[[e:wink]] 마지막 반응.",
    ].join("\n");
    const parsed=parseInlineEmotionScenes("deepseek-run","deepseek-run",output,"rich");
    expect(parsed.scenes.map(scene=>scene.emotion)).toEqual(["confused","laughing","wink"]);
    expect(parsed.scenes.map(scene=>scene.text)).toEqual(["첫 반응.","둘째 반응.","마지막 반응."]);
    expect(parsed.plainText).toBe("첫 반응.\n둘째 반응.\n마지막 반응.");
    expect(parsed.scenes.every(scene=>!scene.text.includes("[[e:"))).toBe(true);
  });

  it("builds Ollama avatar scenes when a local DeepSeek model puts markers on the dialogue line",()=>{
    const run={id:"ollama-deepseek-run",participantId:"ollama",status:"completed"},person={id:"ollama",provider:"ollama"},output="[[e:confused]] 첫 반응.\n[[e:laughing]] 둘째 반응.\n[[e:wink]] 마지막 반응.";
    const card=buildInlineEmotionCards({runs:[run],output:()=>output,participant:()=>person,outfit:()=>"Ollama",available:()=>[{emotion:"confused",file:"confused.webp"},{emotion:"laughing",file:"laughing.webp"},{emotion:"wink",file:"wink.webp"}],mode:"rich"}).get(run.id);
    expect(card?.scenes.map(scene=>scene.asset?.file)).toEqual(["confused.webp","laughing.webp","wink.webp"]);
    expect(card?.plainText).not.toContain("[[e:");
  });

  it("hides partial markers, rejects invalid names, and normalizes the supported chu alias",()=>{
    expect(parseInlineEmotionScenes("run","run","[[e:sm","rich")).toMatchObject({plainText:"",scenes:[],hasMarkers:false});
    const parsed=parseInlineEmotionScenes("run","run","[[e:not-real]]\n보통 문장\n[[e:chu~]]\n쪽♡","rich");
    expect(parsed.leadingText).toBe("보통 문장");
    expect(parsed.scenes).toMatchObject([{emotion:"chu",text:"쪽♡"}]);
  });

  it("repairs the audited Codex shorthand drift into three rich emotion scenes",()=>{
    const output=[
      "[[e:angry]]",
      "레고 성은 함부로 밟으면 안 돼!",
      "[[pout]]",
      "미끄럼틀 올라가기는 반칙이지!",
      "[[smug]]",
      "내 성은 계속 커져!"
    ].join("\n");
    const parsed=parseInlineEmotionScenes("audited-codex","audited-codex",output,"rich");
    expect(parsed.scenes.map(scene=>scene.emotion)).toEqual(["angry","pout","smug"]);
    expect(parsed.scenes.map(scene=>scene.text)).toEqual(["레고 성은 함부로 밟으면 안 돼!","미끄럼틀 올라가기는 반칙이지!","내 성은 계속 커져!"]);
    expect(parsed.plainText).toBe("레고 성은 함부로 밟으면 안 돼!\n미끄럼틀 올라가기는 반칙이지!\n내 성은 계속 커져!");
    expect(parsed.scenes.every(scene=>!scene.text.includes("[["))).toBe(true);
  });

  it("accepts allowlisted shorthand aliases and case but preserves unknown or non-standalone brackets",()=>{
    const output=["[[Pout]]","삐졌어.","[[CHU]]","쪽!","[[chu~]]","한 번 더!","[[not-real]]","`[[pout]]`","앞 [[smug]] 뒤","- [[happy]]"].join("\n");
    const parsed=parseInlineEmotionScenes("aliases","aliases",output,"rich");
    expect(parsed.scenes.map(scene=>scene.emotion)).toEqual(["pout","chu","chu"]);
    expect(parsed.plainText).toContain("[[not-real]]");
    expect(parsed.plainText).toContain("`[[pout]]`");
    expect(parsed.plainText).toContain("앞 [[smug]] 뒤");
    expect(parsed.plainText).toContain("- [[happy]]");
  });

  it("keeps fenced examples literal while recognizing a standalone shorthand marker outside the fence",()=>{
    const output=["```text","[[pout]]","```","[[smug]]","실제 장면."].join("\n");
    const parsed=parseInlineEmotionScenes("fence","fence",output,"rich");
    expect(parsed.leadingText).toContain("[[pout]]");
    expect(parsed.scenes).toMatchObject([{emotion:"smug",text:"실제 장면."}]);
    expect(stripServerMarkers(output)).toContain("[[pout]]");
    expect(stripServerMarkers(output)).not.toContain("[[smug]]");
  });

  it("hides only a final partial shorthand marker and preserves stable earlier scene ids",()=>{
    const partial="[[e:angry]]\n첫 장면.\n[[po",completed="[[e:angry]]\n첫 장면.\n[[pout]]\n둘째 장면.";
    const streaming=parseInlineEmotionScenes("stream","stream",partial,"rich"),finished=parseInlineEmotionScenes("stream","stream",completed,"rich");
    expect(streaming.plainText).toBe("첫 장면.");
    expect(streaming.scenes).toHaveLength(1);
    expect(finished.scenes.map(scene=>scene.emotion)).toEqual(["angry","pout"]);
    expect(finished.scenes[0].id).toBe(streaming.scenes[0].id);
  });

  it("caps compact at one scene and rich at three without dropping excess dialogue",()=>{
    const output=["[[e:happy]]","하나.","[[e:smug]]","둘.","[[e:laughing]]","셋.","[[e:proud]]","넷."].join("\n");
    const compact=parseInlineEmotionScenes("compact","compact",output,"compact"),rich=parseInlineEmotionScenes("rich","rich",output,"rich");
    expect(compact.scenes).toHaveLength(1);
    expect(compact.scenes[0].text).toContain("넷.");
    expect(rich.scenes).toHaveLength(3);
    expect(rich.scenes[2].text).toContain("넷.");
    expect(rich.plainText).toBe("하나.\n둘.\n셋.\n넷.");
  });

  it("caps mixed canonical and shorthand compact output without leaking marker text",()=>{
    const output=["[[e:happy]]","하나.","[[pout]]","둘.","[[smug]]","셋."].join("\n");
    const parsed=parseInlineEmotionScenes("compact-mixed","compact-mixed",output,"compact");
    expect(parsed.scenes).toHaveLength(1);
    expect(parsed.scenes[0].text).toBe("하나.\n둘.\n셋.");
    expect(parsed.plainText).toBe("하나.\n둘.\n셋.");
  });

  it("resolves the authored emotion for each provider outfit and falls back to neutral",()=>{
    const assets=[{emotion:"neutral",file:"neutral.webp"},{emotion:"happy",file:"happy.webp"}];
    expect(resolveInlineEmotionAsset("happy",assets,"scene")?.emotion).toBe("happy");
    expect(resolveInlineEmotionAsset("laughing",assets,"scene")?.emotion).toBe("neutral");
  });

  it("builds one card presentation from production-shaped run output regardless of avatar options",()=>{
    const run={id:"run-card",participantId:"claude",status:"completed"},person={id:"claude",provider:"claude"},output="[[e:happy]]\n반가워.\n[[e:laughing]]\n그건 좀 웃기다.";
    const build=()=>buildInlineEmotionCards({runs:[run],output:()=>output,participant:()=>person,outfit:()=>"normal",available:()=>[{emotion:"neutral",file:"neutral.webp"},{emotion:"happy",file:"happy.webp"},{emotion:"laughing",file:"laughing.webp"}],mode:"rich"});
    const first=build().get(run.id),second=build().get(run.id);
    expect(first?.scenes).toHaveLength(2);
    expect(first).toEqual(second);
    expect(first?.plainText).not.toContain("[[e:");
  });
});
