import { describe,expect,it } from "vitest";
import { render } from "svelte/server";
import ConversationContinuation from "../../src/web/ConversationContinuation.svelte";

describe("ConversationContinuation",()=>{
  it("renders continuation actions without a separate intervention gate",()=>{const continuation={available:true,canAddRounds:true,canAutoContinue:true,canSubmitUserInput:true,canRetryFailedTurn:true};const visible=render(ConversationContinuation,{props:{continuation,mode:"closed",maximum:5}}).body;expect(visible.match(/>5턴 추가</g)).toHaveLength(1);expect(visible.match(/>5턴 자동 진행</g)).toHaveLength(1);expect(visible).not.toContain(">직접 개입<");expect(visible.match(/>실패한 턴 다시 시도</g)).toHaveLength(1);});

  it("hides every action while one continuation mutation is active",()=>{const body=render(ConversationContinuation,{props:{continuation:{available:true,canAddRounds:true,canAutoContinue:true,canSubmitUserInput:true,canRetryFailedTurn:true},mode:"auto-continuing",maximum:5}}).body;expect(body).not.toContain("5턴 추가");expect(body).not.toContain("5턴 자동 진행");expect(body).not.toContain("사용자 입력");expect(body).not.toContain("실패한 턴 다시 시도");});
});
