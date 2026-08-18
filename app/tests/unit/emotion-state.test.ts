import { describe,expect,it } from "vitest";
import { emotionAssetFile,emotionStateMatchesContext,emotionStateMatchesSession,localizedEmotionCopy,mergeEmotionState,statusEmotion } from "../../src/web/emotion-state";
import {translateFor} from "../../src/web/i18n/index";

describe("session-scoped emotion state",()=>{
  const state={emotion:"chu",line:"쪼옥",statusLine:"",outfit:"normal",sessionId:"session-a",taskId:"task-a"};

  it("rejects a preceding worker outcome while the provider context is active",()=>{
    const completed={emotion:"proud",line:"done",statusLine:"completed",outfit:"Gpt-Codex",source:"codex-worker",sessionId:"thread",taskId:"previous"};
    expect(emotionStateMatchesContext(completed,"thread","previous","running")).toBe(false);
    expect(emotionStateMatchesContext(completed,"thread","previous","completed")).toBe(true);
    expect(emotionStateMatchesContext({...completed,source:"mcp-codex",emotion:"happy"},"thread","previous","running")).toBe(true);
    expect(emotionStateMatchesContext({...completed,emotion:"building"},"thread","previous","running")).toBe(true);
  });

  it("rejects a stale outcome from every bookkeeping source, not only workers",()=>{
    // An outfit write copies the previous emotion forward under its own source,
    // and lifecycle hooks have their own. Both used to slip a finished run's
    // "완료" onto a task that had just started.
    const finished={emotion:"proud",line:"해냈어요!",statusLine:"완료!",outfit:"Ollama",sessionId:"thread",taskId:"previous"};
    for(const source of ["claudex-workhouse","hook","codex-hook","ollama-start",undefined])
      expect(emotionStateMatchesContext({...finished,source},"thread","previous","pending")).toBe(false);
    expect(emotionStateMatchesContext({...finished,source:"ollama-catch"},"thread","previous","pending")).toBe(true);
  });

  it("accepts provider state only for the selected session",()=>{
    expect(emotionStateMatchesSession(state,"session-a")).toBe(true);
    expect(emotionStateMatchesSession(state,"session-a","task-a")).toBe(true);
    expect(emotionStateMatchesSession(state,"session-a","task-b")).toBe(false);
    expect(emotionStateMatchesSession(state,"session-b","task-a")).toBe(true);
    expect(emotionStateMatchesSession({...state,taskId:undefined},"session-a","task-a")).toBe(false);
    expect(emotionStateMatchesSession(state,"session-b")).toBe(false);
    expect(emotionStateMatchesSession({...state,sessionId:undefined},"session-a")).toBe(false);
    expect(emotionStateMatchesSession(state,null)).toBe(false);
  });

  it("falls back to task status when another session owns the state",()=>{
    expect(statusEmotion("running")).toBe("coding");
    expect(statusEmotion("waiting")).toBe("confused");
    expect(statusEmotion("completed")).toBe("happy");
    expect(statusEmotion("failed")).toBe("sad");
  });

  it("drops stale translation keys when bootstrap or SSE delivers literal copy",()=>{
    const previous={...state,emotion:"coding_3",line:"수정 사항을 다시 확인 중이에요",statusLine:"코딩 중...",lineKey:"avatar.line.coding_3",statusKey:"avatar.status.coding_3"};
    expect(mergeEmotionState(previous,{emotion:"happy",line:"Custom completion",statusLine:""})).toMatchObject({emotion:"happy",line:"Custom completion",statusLine:"",lineKey:undefined,statusKey:undefined});
  });

  it("renders numbered hook copy in the selected UI language with a literal fallback",()=>{
    expect(localizedEmotionCopy(key=>translateFor("en",key),"avatar.line.coding_2","열심히 쓰는 중...!")).toBe("Writing away…!");
    expect(localizedEmotionCopy(key=>translateFor("ja",key),"avatar.line.coding_3","수정 사항을 다시 확인 중이에요")).toBe("修正内容を再確認中です");
    expect(localizedEmotionCopy(key=>translateFor("ko",key),"avatar.line.coding_3","fallback")).toBe("수정 사항을 다시 확인 중이에요");
    expect(localizedEmotionCopy(key=>translateFor("en",key),"avatar.line.unknown","literal copy")).toBe("literal copy");
  });

  it("prefers the catalog entry over the caller's fallback name",()=>{
    const assets={Ollama:[{emotion:"neutral",file:"neutral.webp"},{emotion:"chu",file:"chu_2.webp"}]};
    expect(emotionAssetFile(assets,"Ollama","chu","chu.webp")).toBe("chu_2.webp");
    expect(emotionAssetFile(assets,"Ollama","missing","missing.webp")).toBe("missing.webp");
  });
});
