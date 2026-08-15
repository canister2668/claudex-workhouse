import{expect,test}from"@playwright/test";

for(const fixture of[
  {locale:"ko",more:"추가 작업",tab:"정보 및 라이선스",display:"화면·알림",sourceLabel:"현재 버전의 소스 코드",status:"수정본",summary:"Claudex Workhouse는 AGPL-3.0-only 라이선스를 사용합니다.",guide:"한국어 라이선스 안내",localizedLicense:"LICENSE.ko.md"},
  {locale:"en",more:"More actions",tab:"About & Licenses",display:"Display & notifications",sourceLabel:"Source code for this version",status:"Modified",summary:"Claudex Workhouse is licensed under AGPL-3.0-only.",guide:"English license guide",localizedLicense:"LICENSE"},
  {locale:"ja",more:"その他の操作",tab:"情報とライセンス",display:"表示・通知",sourceLabel:"このバージョンのソースコード",status:"変更版",summary:"Claudex Workhouse は AGPL-3.0-only でライセンスされています。",guide:"日本語ライセンス案内",localizedLicense:"LICENSE.ja.md"},
]){
  test(`${fixture.locale} modified-build legal notices remain directly accessible on mobile`,async({page})=>{
    await page.addInitScript(locale=>{localStorage.setItem("claudex-ui-locale",locale);class SilentEventSource{constructor(public url:string){}addEventListener(){}close(){}}Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});},fixture.locale);
    await page.route("**/api/**",async route=>{
      const pathname=new URL(route.request().url()).pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
      if(pathname==="/api/system-settings/locale"){
        const selected=route.request().method()==="PUT"?(route.request().postDataJSON() as {locale?:string})?.locale??fixture.locale:fixture.locale;
        return json({locale:selected,saved:true,existingInstallation:true,updatedAt:new Date().toISOString()});
      }
      if(pathname==="/api/about")return json({project:"Claudex Workhouse",copyrightYear:"2026",copyrightHolder:"Canister",license:"AGPL-3.0-only",distributionStatus:"Modified",originalProject:"Claudex Workhouse",originalRepository:"https://github.com/canister2668/claudex-workhouse",distributor:"Fixture modifier",version:"1.0.0",commitSha:"1234567",correspondingSource:"https://code.example.test/workhouse/tree/1234567"});
      if(pathname==="/api/tasks")return json({tasks:[],partial:false,warnings:[]});
      if(pathname==="/api/projects")return json({projects:[]});
      if(pathname==="/api/hosts")return json({hosts:[]});
      if(pathname==="/api/workspaces")return json({workspaces:[]});
      if(pathname==="/api/collaborations")return json({collaborations:[]});
      if(pathname==="/api/providers/codex/models")return json({catalog:{models:[],permissions:[]}});
      if(pathname==="/api/providers/claude/permissions")return json({models:[],permissions:[],efforts:[],catalog:{models:[],stale:false}});
      if(pathname==="/api/provider-connections"||pathname==="/api/provider-connections/attempts")return json({accounts:[],attempts:[]});
      if(pathname==="/api/quota")return json({claude:{},codex:{},fetchedAt:new Date().toISOString()});
      if(pathname==="/api/emotion")return json({state:{},codexState:{},outfits:[],assets:[],mode:"catch"});
      if(pathname==="/api/push")return json({preferences:{},publicKey:""});
      if(pathname.startsWith("/api/system-settings/"))return json({settings:null,candidates:{claude:[],codex:[]}});
      return json({});
    });
    await page.goto("/");
    const more=page.getByRole("button",{name:fixture.more,exact:true});
    if(await more.isVisible())await more.click();
    await page.getByRole("button",{name:/settings|설정|設定/i}).click();
    const settings=page.locator(".global-settings");
    await settings.getByRole("button",{name:fixture.tab,exact:true}).click();
    const panel=page.getByRole("region",{name:fixture.tab});
    await expect(panel).toContainText("Claudex Workhouse");
    await expect(panel).toContainText("AGPL-3.0-only");
    await expect(panel).toContainText(fixture.status);
    await expect(panel.getByText(fixture.summary,{exact:true})).toBeVisible();
    const guide=panel.getByRole("link",{name:fixture.guide,exact:true});
    await expect(guide).toHaveAttribute("href",`https://github.com/canister2668/claudex-workhouse/blob/main/docs/license.${fixture.locale}.md`);
    await expect(panel.getByRole("link",{name:fixture.localizedLicense,exact:true})).toHaveAttribute("href",`https://github.com/canister2668/claudex-workhouse/blob/main/${fixture.localizedLicense}`);
    await expect(panel.getByText("1234567",{exact:true})).toBeVisible();
    const source=panel.getByRole("link",{name:"https://code.example.test/workhouse/tree/1234567"});
    await expect(source).toBeVisible();
    await expect(source).toHaveAttribute("href","https://code.example.test/workhouse/tree/1234567");
    await expect(panel.getByText(fixture.sourceLabel,{exact:true})).toBeVisible();
    const box=await panel.boundingBox();expect(box).not.toBeNull();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual((page.viewportSize()?.width??0)+1);
    if(fixture.locale==="ko"){
      await settings.getByRole("button",{name:fixture.display,exact:true}).click();
      await settings.getByLabel("Language",{exact:true}).selectOption("en");
      await settings.getByRole("button",{name:"About & Licenses",exact:true}).click();
      const englishPanel=page.getByRole("region",{name:"About & Licenses"});
      await expect(englishPanel.getByText("Claudex Workhouse is licensed under AGPL-3.0-only.",{exact:true})).toBeVisible();
      await expect(englishPanel.getByRole("link",{name:"English license guide",exact:true})).toHaveAttribute("href","https://github.com/canister2668/claudex-workhouse/blob/main/docs/license.en.md");
    }
  });
}
