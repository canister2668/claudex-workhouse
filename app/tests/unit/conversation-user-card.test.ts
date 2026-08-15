import { describe,expect,it } from "vitest";
import { render } from "svelte/server";
import ConversationUserCard from "../../src/web/ConversationUserCard.svelte";
import { setLocale } from "../../src/web/i18n";

describe("ConversationUserCard",()=>{
  it("renders a visibly identified conversation round with its supporting metadata",()=>{
    setLocale("ko");
    const body=render(ConversationUserCard,{props:{
      userName:"챗붕",
      content:"첫 줄\n두 번째 줄과 /workspace/아주-긴-경로",
      timestamp:"2026-07-28T01:02:23.293Z",
      roundLabel:"10라운드",
      reminderLabel:"성격 리마인드 · 둘 다"
    }}).body;

    expect(body).toContain("<article class=\"collaboration-user round-user\">");
    expect(body).toContain("내 입력");
    expect(body).toContain("챗붕");
    expect(body).toContain("10라운드");
    expect(body).toContain("성격 리마인드 · 둘 다");
    expect(body).toContain("datetime=\"2026-07-28T01:02:23.293Z\"");
    expect(body).toContain("첫 줄\n두 번째 줄과 /workspace/아주-긴-경로");
    expect(body).toContain("conversation-user-icon");
  });

  it("keeps legacy inputs valid when round and timestamp metadata are absent",()=>{
    setLocale("en");
    const body=render(ConversationUserCard,{props:{userName:"User",content:"Review <this> & report"}}).body;

    expect(body).toContain("<article class=\"collaboration-user\">");
    expect(body).toContain("My input");
    expect(body).toContain("Review &lt;this> &amp; report");
    expect(body).not.toContain("<time");
    expect(body).not.toContain("round-user");
  });
});
