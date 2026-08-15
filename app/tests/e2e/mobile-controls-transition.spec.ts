import {expect,test}from"@playwright/test";

// The collapsing control chrome and its toggle live entirely inside
// @media(max-width:600px) in sessions.css; above that breakpoint the toggle is
// display:none and the controls never collapse. Asserting the transition at a
// tablet width was asserting behaviour the stylesheet deliberately does not have.
const MOBILE_CONTROLS_MAX_WIDTH=600;

test("mobile session controls fade before becoming hidden",async({page},testInfo)=>{
  test.skip((testInfo.project.use.viewport?.width??0)>MOBILE_CONTROLS_MAX_WIDTH,
    "the collapsing control chrome only exists below the mobile breakpoint");
  await page.emulateMedia({reducedMotion:"no-preference"});
  await page.route("**/api/bootstrap/owner-claim/status",async route=>route.fulfill({
    contentType:"application/json",
    body:JSON.stringify({required:false})
  }));
  await page.goto("/",{waitUntil:"domcontentloaded"});
  await page.evaluate(()=>{
    const fixture=document.createElement("section");
    fixture.id="mobile-control-transition-fixture";
    fixture.className="shell session-detail-open";
    fixture.innerHTML=`
      <div class="detail-actions"><button>세션 작업</button></div>
      <div class="chat-settings-bar">
        <button class="mobile-controls-toggle">작업 메뉴</button>
        <button class="setting-summary tap">모델 설정</button>
      </div>`;
    document.body.append(fixture);
  });
  const actions=page.locator("#mobile-control-transition-fixture .detail-actions");
  const setting=page.locator("#mobile-control-transition-fixture .setting-summary");
  await expect(actions).toBeVisible();
  await expect(setting).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(false);
  expect(await actions.evaluate(element=>getComputedStyle(element).transitionDuration)).not.toBe("0s");
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));

  await page.evaluate(()=>{
    document.querySelector("#mobile-control-transition-fixture .detail-actions")?.classList.add("mobile-controls-collapsed");
    document.querySelector("#mobile-control-transition-fixture .chat-settings-bar")?.classList.add("mobile-controls-collapsed");
  });
  await page.waitForTimeout(70);
  const middle=await actions.evaluate(element=>({
    display:getComputedStyle(element).display,
    opacity:Number(getComputedStyle(element).opacity),
    height:element.getBoundingClientRect().height
  }));
  expect(middle.display).not.toBe("none");
  expect(middle.opacity).toBeGreaterThan(0);
  expect(middle.opacity).toBeLessThan(1);
  expect(middle.height).toBeGreaterThan(0);

  await page.waitForTimeout(180);
  await expect(actions).toBeHidden();
  await expect(setting).toBeHidden();
});

test("the mobile control toggle stays out of the way above the breakpoint",async({page},testInfo)=>{
  test.skip((testInfo.project.use.viewport?.width??0)<=MOBILE_CONTROLS_MAX_WIDTH,
    "below the breakpoint the toggle is the control surface, not hidden chrome");
  await page.route("**/api/bootstrap/owner-claim/status",async route=>route.fulfill({
    contentType:"application/json",
    body:JSON.stringify({required:false})
  }));
  await page.goto("/",{waitUntil:"domcontentloaded"});
  await page.evaluate(()=>{
    const fixture=document.createElement("section");
    fixture.id="mobile-control-breakpoint-fixture";
    fixture.className="shell session-detail-open";
    fixture.innerHTML=`
      <div class="detail-actions"><button>세션 작업</button></div>
      <div class="chat-settings-bar">
        <button class="mobile-controls-toggle">작업 메뉴</button>
        <button class="setting-summary tap">모델 설정</button>
      </div>`;
    document.body.append(fixture);
  });
  const toggle=page.locator("#mobile-control-breakpoint-fixture .mobile-controls-toggle");
  expect(await toggle.evaluate(element=>getComputedStyle(element).display)).toBe("none");
  await expect(page.locator("#mobile-control-breakpoint-fixture .detail-actions")).toBeVisible();
  await expect(page.locator("#mobile-control-breakpoint-fixture .setting-summary")).toBeVisible();
});
