import { describe, expect, it } from "vitest";
import { roleplayTransition as serverTransition } from "../../src/server/collaboration/roleplay";
import { roleplayActiveAtRound, roleplayTransition } from "../../src/web/roleplay";

describe("conversation roleplay state",()=>{
  it("recognizes direct stop and resume requests without matching ordinary discussion",()=>{
    expect(roleplayTransition("RP중지. 이제 디버깅하자")).toBe("stop");
    expect(roleplayTransition("Rp정지. 이제 평범하게 말하자")).toBe("stop");
    expect(roleplayTransition("이 톤 그만해")).toBe("stop");
    expect(roleplayTransition("RP 다시 시작하자")).toBe("resume");
    expect(roleplayTransition("이 톤 다시 시작하자")).toBe("resume");
    expect(roleplayTransition("그만")).toBeNull();
    expect(roleplayTransition("멈춰")).toBeNull();
    expect(roleplayTransition("중지 버튼 동작을 검토해줘")).toBeNull();
    expect(serverTransition("RP중지. 이제 디버깅하자")).toBe("stop");
    expect(serverTransition("RP 정지")).toBe("stop");
    expect(roleplayTransition("Stop roleplay, let's talk normally.")).toBe("stop");
    expect(serverTransition("Resume roleplay")).toBe("resume");
    expect(roleplayTransition("ロールプレイ終了")).toBe("stop");
    expect(serverTransition("ロールプレイ再開")).toBe("resume");
    expect(serverTransition("RP 다시 시작하자")).toBe("resume");
    expect(serverTransition("이 톤 다시 시작하자")).toBe("resume");
    expect(serverTransition("그만")).toBeNull();
  });
  it("keeps the stopped state across later rounds until an explicit resume",()=>{
    const messages=[{round:1,messageType:"user-input",contentRef:"시작"},{round:2,messageType:"user-input",contentRef:"RP중지"},{round:3,messageType:"user-input",contentRef:"톤을 분석하자"},{round:4,messageType:"user-input",contentRef:"RP 재개"}];
    expect(roleplayActiveAtRound(messages,1)).toBe(true);
    expect(roleplayActiveAtRound(messages,3)).toBe(false);
    expect(roleplayActiveAtRound(messages,4)).toBe(true);
  });
});
