import path from "node:path";
import {expect,test} from "@playwright/test";

test("session and conversation reading sizes stay independent",async({page})=>{
  await page.setContent(`
    <main>
      <section class="conversation"><article class="bubble agent"><div class="markdown-body"><p>Session body</p><pre>code</pre></div></article></section>
      <form class="composer"><textarea>Session input</textarea></form>
      <section class="collaboration-detail">
        <article class="participant-block"><div class="participant-body"><div class="provider-output markdown-body"><p>Conversation body</p><div class="markdown-code-block"><pre>code</pre></div></div><figure class="inline-emotion-scene"><figcaption><div class="scene-markdown"><p>Scene body</p></div></figcaption></figure></div></article>
        <article class="collaboration-user"><p>User body</p></article>
        <form class="conversation-input"><textarea>Conversation input</textarea></form>
      </section>
    </main>
  `);
  await page.addStyleTag({path:path.join(process.cwd(),"src/web/styles.css")});
  await page.addStyleTag({path:path.join(process.cwd(),"src/web/sessions.css")});

  const size=(selector:string)=>page.locator(selector).evaluate(node=>getComputedStyle(node).fontSize);
  await expect.poll(()=>size(".conversation .markdown-body")).toBe("14px");
  await expect.poll(()=>size(".composer textarea")).toBe("14px");
  await expect.poll(()=>size(".provider-output")).toBe("14px");
  await expect.poll(()=>size(".scene-markdown")).toBe("14px");
  await expect.poll(()=>size(".collaboration-user p")).toBe("14px");
  await expect.poll(()=>size(".conversation-input textarea")).toBe("14px");
  await expect.poll(()=>size(".participant-body .markdown-code-block pre")).toBe("13px");

  await page.evaluate(()=>document.documentElement.dataset.sessionTextSize="small");
  await expect.poll(()=>size(".conversation .markdown-body")).toBe("13px");
  await expect.poll(()=>size(".provider-output")).toBe("14px");

  await page.evaluate(()=>{
    document.documentElement.dataset.conversationTextSize="comfortable";
    document.documentElement.dataset.skin="compact";
  });
  await expect.poll(()=>size(".conversation .markdown-body")).toBe("13px");
  await expect.poll(()=>size(".provider-output")).toBe("15px");
  await expect.poll(()=>size(".scene-markdown")).toBe("15px");
  await expect.poll(()=>size(".collaboration-user p")).toBe("15px");
  await expect.poll(()=>size(".participant-body .markdown-code-block pre")).toBe("14px");

  await page.evaluate(()=>document.documentElement.dataset.conversationTextSize="large");
  await expect.poll(()=>size(".provider-output")).toBe("16px");
  await expect.poll(()=>size(".participant-body .markdown-code-block pre")).toBe("15px");
});
