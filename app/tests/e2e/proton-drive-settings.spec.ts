import{expect,test}from"@playwright/test";

test("Proton Drive settings keep uploads explicit and preserve the remote path",async({page})=>{
  test.setTimeout(60_000);
  const origin=process.env.CLAUDEX_WORKHOUSE_E2E_BASE_URL??"http://127.0.0.1:3410",mutationHeaders={origin,"x-claudex-workhouse-request":"1"};
  // This spec mutates real server setup state, so it only runs against a server
  // that accepts the test identity. Against a Cloudflare-protected instance the
  // request would be rejected — and running it there would rewrite live setup.
  const probe=await page.request.get("/api/setup");
  test.skip(!probe.ok(),"requires a server in test auth mode (CLAUDEX_WORKHOUSE_E2E_MANAGED_SERVER=1)");
  const status=await page.request.get("/api/bootstrap/owner-claim/status");
  if((await status.json()).required){
    const local=await(await page.request.get("/api/bootstrap/owner-claim/local")).json();
    await expect((await page.request.post("/api/bootstrap/owner-claim/complete",{headers:mutationHeaders,data:{enrollmentId:local.qr.enrollmentId,claimToken:local.qr.claimToken,serverFingerprint:local.qr.serverFingerprint}})).ok()).toBeTruthy();
  }
  await expect((await page.request.put("/api/setup",{headers:{...mutationHeaders,"Idempotency-Key":crypto.randomUUID()},data:{step:10,completed:true,accessMode:"local",steps:{data:true,admin:true,host:true,runtimes:true,providers:true,root:true,project:true,workspace:true,testTask:true,remoteAccess:false}}})).ok()).toBeTruthy();
  await page.addInitScript(()=>localStorage.setItem("claudex-ui-locale","ko"));
  await page.goto("/");
  const more=page.getByRole("button",{name:"추가 작업"});if(await more.isVisible())await more.click();
  await page.getByRole("button",{name:"설정 열기"}).click();
  const settings=page.getByRole("dialog",{name:"설정"});await settings.getByRole("button",{name:"계정",exact:true}).click();await settings.getByRole("button",{name:"Proton Drive",exact:true}).click();
  const section=settings.locator(".proton-settings");await expect(section.getByRole("heading",{name:"Proton Drive"})).toBeVisible();await expect(section.locator(".proton-state strong")).toHaveText(/연결됨|로그인 필요|이 호스트와 CLI가 호환되지 않음|CLI 설치 안 됨|CLI 사용 불가/);
  await expect(section.getByLabel("원격 기본 폴더")).toHaveValue("/my-files/Claudex-Workhouse");await expect(section.getByText("항상 명시적인 확인 필요",{exact:true})).toBeVisible();
  expect(await section.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(0);
});
