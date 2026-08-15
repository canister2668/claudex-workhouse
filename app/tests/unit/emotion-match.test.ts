import { describe,expect,it } from "vitest";
import { matchEmotion } from "../../../hooks/emotion/emotion-match.mjs";

describe("catch emotion matching",()=>{
  it.each(["뽀뽀쪽","뽀뽀해줘","쪽","쪽 해줘","쪽~","쪼옥","키스해줘"])("recognizes explicit kiss wording: %s",prompt=>{
    expect(matchEmotion(prompt)?.emotion).toBe("chu");
  });

  it.each(["이쪽","세션쪽","대화세션쪽","오른쪽","파일 쪽","이쪽 수정해줘","세션쪽 확인 바랍니다"])("does not treat directional 쪽 as a kiss: %s",prompt=>{
    expect(matchEmotion(prompt)?.emotion).not.toBe("chu");
  });
});
