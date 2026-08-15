import fs from "node:fs";
import path from "node:path";
import {describe,expect,it} from "vitest";
import { earlierHistoryActionVisible } from "../../src/web/running-history.js";
import { translateFor } from "../../src/web/i18n/index.js";

const web=(file:string)=>fs.readFileSync(path.join(process.cwd(),"src","web",file),"utf8");

describe("Claude transcript history UI",()=>{
  it("renders a distinct top anchor and requests the expanded turn budget",()=>{
    const conversation=web("Conversation.svelte"),app=web("App.svelte");
    expect(conversation).toContain('class="transcript-history-anchor"');
    expect(conversation).toContain('"conversation.loadEarlierTurns"');
    expect(conversation).toContain("onloadtranscripthistory?.()");
    expect(app).toContain("?transcriptTurns=${transcriptTurns}");
    expect(app).toContain("transcriptTurns=24");
  });

  it("hides the earlier loader while a running session is collapsed to the current task",()=>{
    expect(earlierHistoryActionVisible({truncatedBefore:true,runningHistoryVisible:true,runningHistoryExpanded:false})).toBe(false);
  });

  it("exposes the earlier loader in one tap once running history is expanded",()=>{
    expect(earlierHistoryActionVisible({truncatedBefore:true,runningHistoryVisible:true,runningHistoryExpanded:true})).toBe(true);
  });

  it("keeps the earlier loader for completed long sessions with truncated history",()=>{
    expect(earlierHistoryActionVisible({truncatedBefore:true,runningHistoryVisible:false,runningHistoryExpanded:false})).toBe(true);
    expect(earlierHistoryActionVisible({truncatedBefore:false,runningHistoryVisible:false,runningHistoryExpanded:false})).toBe(false);
  });

  it("gates the action on the loading and safety-limit states",()=>{
    const conversation=web("Conversation.svelte");
    expect(conversation).toContain('{#if transcriptHistoryLoading}<button type="button" disabled>');
    expect(conversation).toContain('"conversation.loadingEarlier"');
    expect(conversation).toContain('"conversation.earlierLimitReached"');
    expect(conversation).toContain("{:else if transcriptCanLoadMore}");
  });

  it("draws the anchor as theme-derived scroll-boundary rules rather than a filled card",()=>{
    const css=web("sessions.css"),rule=css.split("\n").find(line=>line.startsWith(".transcript-history-anchor{"))??"";
    expect(rule).toContain(".transcript-history-anchor::before,.transcript-history-anchor::after{content:\"\";height:1px");
    expect(rule).toContain("background:var(--line)");
    expect(rule).toContain(".transcript-history-anchor button{min-height:36px");
    expect(rule).toContain("button:focus-visible{outline:2px solid var(--accent)");
    expect(rule).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(rule.match(/color:[^;}]+/g)??[]).toEqual(expect.arrayContaining([expect.stringContaining("var(--")]));
  });

  it("composes a single self-contained action label per language",()=>{
    expect(translateFor("ko","conversation.loadEarlierTurns",{count:3})).toBe("이전 대화 3턴 불러오기");
    expect(translateFor("en","conversation.loadEarlierTurns",{count:3})).toBe("Load 3 earlier turns");
    expect(translateFor("ja","conversation.loadEarlierTurns",{count:3})).toBe("以前の会話3ターンを読み込む");
    for(const language of ["ko","en","ja"] as const){
      const label=translateFor(language,"conversation.loadEarlierTurns",{count:3});
      expect(label.includes(translateFor(language,"conversation.showHistory"))).toBe(false);
      expect(translateFor(language,"conversation.loadEarlierAll")).not.toContain("{count}");
    }
  });

  it("ships the transcript anchor copy in every supported language",()=>{
    for(const locale of ["ko.ts","en.ts","ja.ts"]){
      const source=web(path.join("i18n",locale));
      for(const key of ["conversation.loadEarlierTurns","conversation.loadEarlierAll","conversation.loadingEarlier","conversation.earlierLimitReached"])expect(source).toContain(`"${key}"`);
    }
  });
});
