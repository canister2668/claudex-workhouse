import{expect,test}from"@playwright/test";

test("shows banked usage resets per provider with the soonest expiry",async({page},testInfo)=>{
  await page.addInitScript(()=>{localStorage.clear();localStorage.setItem("claudex-ui-locale","ko");});
  const now=Date.now(),days=(count:number)=>new Date(now+count*86_400_000+3_600_000).toISOString();
  await page.route("**/api/**",async route=>{
    const pathname=new URL(route.request().url()).pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/tasks")return json({tasks:[],partial:false,warnings:[]});
    if(pathname==="/api/codex/threads")return json({sessions:[],nextCursor:null,stale:false,syncedAt:new Date(now).toISOString(),capabilities:{delete:true}});
    if(pathname==="/api/projects")return json({projects:[]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"local",displayName:"Local",status:"online"}]});
    if(pathname==="/api/workspaces")return json({workspaces:[]});
    if(pathname==="/api/collaborations")return json({collaborations:[]});
    if(pathname==="/api/provider-connections"||pathname==="/api/provider-connections/attempts")return json({accounts:[],attempts:[]});
    if(pathname==="/api/quota")return json({
      codex:{fiveHour:{pct:12,resetsAt:days(0),durationMins:300},sevenDay:{pct:6,resetsAt:days(5),durationMins:10080},status:"ok",error:null,resetCredits:{available:3,credits:[
        {id:"c1",title:"Full reset",count:1,expiresAt:days(2),usableNow:null},
        {id:"c2",title:"Full reset",count:1,expiresAt:days(18),usableNow:null},
        {id:"c3",title:"Full reset",count:1,expiresAt:days(26),usableNow:null}
      ]}},
      claude:{fiveHour:{pct:18,resetsAt:days(0),durationMins:300},sevenDay:{pct:51,resetsAt:days(4),durationMins:10080},plan:"Max",status:"ok",error:null,resetCredits:{available:1,credits:[
        {id:"g1",title:"Claude Opus 5.5 launch: one usage-limit reset for Pro and Max",count:1,expiresAt:days(9),usableNow:true}
      ]}},
      fetchedAt:new Date(now).toISOString()
    });
    if(pathname==="/api/emotion")return json({state:{},codexState:{},outfits:[],assets:[],mode:"catch"});
    if(pathname==="/api/push")return json({preferences:{},publicKey:""});
    if(pathname.startsWith("/api/system-settings/"))return json({settings:null,candidates:{claude:[],codex:[]}});
    return json({});
  });
  await page.goto("/");
  const quotaTrigger=page.locator('[data-popup-trigger="quota"]');
  const overflow=page.locator('[data-popup-trigger="overflow"]');
  await expect(quotaTrigger.or(overflow).first()).toBeVisible({timeout:15_000});
  if(!await quotaTrigger.isVisible())await overflow.click();
  await quotaTrigger.click();
  const pop=page.locator(".quota-pop");
  await expect(pop.locator(".quota-reset-chip.codex")).toContainText("3장");
  await expect(pop.locator(".quota-reset-chip.codex")).toContainText("D-2");
  await expect(pop.locator(".quota-reset-chip.codex")).toHaveClass(/urgent/);
  await expect(pop.locator(".quota-reset-chip.claude")).toContainText("1장");
  await expect(pop.locator(".quota-reset-chip.claude")).toContainText("D-9");
  await expect(pop.locator(".quota-reset-chip.claude")).not.toHaveClass(/urgent/);
  await expect(quotaTrigger.locator(".quota-reset-badge")).toHaveText(["3","1"]);
  const codexResets=pop.locator("details.quota-resets").first(),claudeResets=pop.locator("details.quota-resets").nth(1);
  await expect(codexResets).not.toHaveAttribute("open");
  await expect(codexResets).toHaveClass(/urgent/);
  await expect(codexResets.locator("summary .quota-reset-urgent")).toContainText("1장");
  await expect(codexResets.locator(".quota-reset-credit").first()).toBeHidden();
  await expect(claudeResets.locator(".quota-reset-urgent")).toHaveCount(0);
  await pop.screenshot({path:testInfo.outputPath("quota-reset-credits-folded.png")});
  await codexResets.locator("summary").click();
  await expect(codexResets).toHaveAttribute("open");
  await expect(codexResets.locator(".quota-reset-credit.urgent")).toHaveCount(1);
  await page.screenshot({path:testInfo.outputPath("quota-reset-credits.png")});
  await pop.screenshot({path:testInfo.outputPath("quota-reset-credits-pop.png")});
});
