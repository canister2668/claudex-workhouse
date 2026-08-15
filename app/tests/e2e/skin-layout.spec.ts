import { expect, test } from "@playwright/test";

test("soft, compact, and flat cards keep compact metadata above the message",async({page})=>{
  await page.route("**/api/bootstrap/owner-claim/status",async route=>route.fulfill({
    contentType:"application/json",
    body:JSON.stringify({required:false})
  }));
  await page.goto("/",{waitUntil:"domcontentloaded"});
  await page.evaluate(()=>{
    const fixture=document.createElement("section");
    fixture.id="skin-layout-fixture";
    fixture.className="conversation";
    fixture.style.cssText="width:min(760px,calc(100vw - 32px));margin:16px";
    fixture.innerHTML=`
      <article class="bubble agent has-card-copy">
        <span class="bubble-copy-anchor"><button class="copy-btn" aria-label="복사"></button></span>
        <span class="bubble-card-head">
          <span>답변</span>
          <time class="bubble-card-time">7/30 18:21</time>
        </span>
        <div class="markdown-body"><p>본문은 메타데이터 옆의 좁은 열이 아니라 카드 전체 폭을 사용합니다.</p></div>
      </article>`;
    document.body.append(fixture);
  });

  for(const skin of ["soft","compact","flat"] as const){
    await page.evaluate(value=>{
      if(value==="soft")delete document.documentElement.dataset.skin;
      else document.documentElement.dataset.skin=value;
    },skin);
    const layout=await page.locator("#skin-layout-fixture .bubble").evaluate(element=>{
      const header=element.querySelector<HTMLElement>(".bubble-card-head")!;
      const body=element.querySelector<HTMLElement>(".markdown-body")!;
      const time=element.querySelector<HTMLElement>(".bubble-card-time")!;
      const copy=element.querySelector<HTMLElement>(".bubble-copy-anchor .copy-btn")!;
      const headerRect=header.getBoundingClientRect(),bodyRect=body.getBoundingClientRect(),timeRect=time.getBoundingClientRect(),copyRect=copy.getBoundingClientRect();
      return{
        display:getComputedStyle(element).display,
        headerHeight:headerRect.height,
        headerBottom:headerRect.bottom,
        bodyTop:bodyRect.top,
        timeWidth:timeRect.width,
        copyClearance:copyRect.left-timeRect.right,
        overflow:element.scrollWidth-element.clientWidth,
        tailClip:getComputedStyle(element,"::after").clipPath,
        tailTransform:getComputedStyle(element,"::after").transform
      };
    });
    expect(layout.headerHeight,skin).toBeLessThanOrEqual(30);
    expect(layout.bodyTop,skin).toBeGreaterThanOrEqual(layout.headerBottom-1);
    expect(layout.timeWidth,skin).toBeLessThan(90);
    expect(layout.copyClearance,skin).toBeGreaterThanOrEqual(0);
    expect(layout.overflow,skin).toBeLessThanOrEqual(1);
    if(skin!=="soft")expect(layout.display,skin).toBe("block");
    else{
      expect(layout.tailClip).not.toBe("none");
      expect(layout.tailTransform).toBe("none");
    }
  }
});
