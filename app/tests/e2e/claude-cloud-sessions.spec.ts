import{expect,test}from"@playwright/test";

test("Claude cloud sessions ask before running without cloud credit",async({page})=>{
  test.setTimeout(60_000);
  const origin=process.env.CLAUDEX_WORKHOUSE_E2E_BASE_URL??"http://127.0.0.1:3410",mutationHeaders={origin,"x-claudex-workhouse-request":"1"};
  // Needs a test-auth server whose Claude home caches a used-up cloud credit.
  // Against a live instance this would create a real cloud session.
  const probe=await page.request.get("/api/setup");
  test.skip(!probe.ok(),"requires a server in test auth mode (CLAUDEX_WORKHOUSE_E2E_MANAGED_SERVER=1)");
  const status=await page.request.get("/api/bootstrap/owner-claim/status");
  if((await status.json()).required){
    const local=await(await page.request.get("/api/bootstrap/owner-claim/local")).json();
    await expect((await page.request.post("/api/bootstrap/owner-claim/complete",{headers:mutationHeaders,data:{enrollmentId:local.qr.enrollmentId,claimToken:local.qr.claimToken,serverFingerprint:local.qr.serverFingerprint}})).ok()).toBeTruthy();
  }
  await expect((await page.request.put("/api/setup",{headers:{...mutationHeaders,"Idempotency-Key":crypto.randomUUID()},data:{step:10,completed:true,accessMode:"local",steps:{data:true,admin:true,host:true,runtimes:true,providers:true,root:true,project:true,workspace:true,testTask:true,remoteAccess:false}}})).ok()).toBeTruthy();
  const cloud=await(await page.request.get("/api/claude-cloud")).json();
  test.skip(cloud.credit?.state==="available","requires a Claude home without usable cloud credit");

  await page.addInitScript(()=>localStorage.setItem("claudex-ui-locale","ko"));
  await page.goto("/");
  const more=page.getByRole("button",{name:"추가 작업"});if(await more.isVisible())await more.click();
  await page.getByRole("button",{name:"설정 열기"}).click();
  const settings=page.getByRole("region",{name:"설정"});
  await settings.getByRole("button",{name:"작업공간·프로젝트",exact:true}).click();
  const section=settings.locator(".cloud-sessions");
  await expect(section.getByRole("heading",{name:"Claude 클라우드 세션"})).toBeVisible();
  await expect(section.locator(".credit")).toContainText(/소진됨|만료됨|확인 불가/);

  let created=false;
  page.on("request",request=>{if(request.method()==="POST"&&request.url().includes("/api/claude-cloud/sessions")&&request.postDataJSON()?.confirmWithoutCredit)created=true;});
  await section.getByLabel("작업 지시").fill("README 줄 수를 알려줘");
  await section.getByRole("button",{name:"클라우드 세션 시작"}).click();
  const confirm=section.getByRole("alertdialog");
  await expect(confirm).toContainText(/클라우드 크레딧이 남아 있지 않아요|잔액을 확인할 수 없어요/);
  await expect(confirm.getByRole("button",{name:"구독 사용량으로 실행"})).toBeVisible();
  await confirm.getByRole("button",{name:"취소"}).click();
  await expect(confirm).toHaveCount(0);
  expect(created).toBe(false);
  expect(await section.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(0);
});
