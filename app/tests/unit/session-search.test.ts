import {describe,expect,it} from "vitest";
import {sessionSearchMatch} from "../../src/web/session-search";

describe("session search result previews",()=>{
  it("prefers a matching output card over title and request matches",()=>{
    const match=sessionSearchMatch({
      title:"배포 오류 조사",
      prompt:"배포 오류를 찾아줘",
      result:"확인 결과 중간 설명 뒤에 배포 오류의 원인이 있습니다.",
    },"배포 오류");
    expect(match).toMatchObject({source:"result",match:"배포 오류"});
  });

  it("returns bounded context around a late output match",()=>{
    const match=sessionSearchMatch({result:`${"앞부분 ".repeat(80)}QUIC stream canceled${" 뒷부분".repeat(80)}`},"quic STREAM");
    expect(match).toMatchObject({source:"result",match:"QUIC stream"});
    expect(`${match?.before}${match?.match}${match?.after}`.length).toBeLessThan(260);
    expect(match?.leading).toBe(true);
    expect(match?.trailing).toBe(true);
  });

  it("falls back to request, title, and project without inventing a result",()=>{
    expect(sessionSearchMatch({prompt:"윈도우 서버 구축"},"서버")?.source).toBe("prompt");
    expect(sessionSearchMatch({title:"포터블 배포"},"포터블")?.source).toBe("title");
    expect(sessionSearchMatch({},"Workhouse","Claudex Workhouse")?.source).toBe("project");
    expect(sessionSearchMatch({result:"다른 내용"},"없는 단어")).toBeNull();
  });
});
