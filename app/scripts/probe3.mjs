import { chromium } from "@playwright/test";
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:834,height:1112},extraHTTPHeaders:{"x-claudex-workhouse-test-user":"admin@example.com"}});
const p=await ctx.newPage();
await p.goto("http://127.0.0.1:3411/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(1500);
await p.locator('nav.filters button',{hasText:/^Codex$/}).first().click();
await p.waitForTimeout(2500);
await p.locator('.session-card').first().click();
await p.waitForTimeout(2000);
const conv=p.locator('.codex-detail .conversation').first();
const sh=await conv.evaluate(el=>el.scrollHeight), ch=await conv.evaluate(el=>el.clientHeight);
const topbarBack=await p.locator('.topbar .icon-button.back').count();
const topbarBackVisible=topbarBack?await p.locator('.topbar .icon-button.back').first().isVisible():false;
const headingBack=await p.locator('.codex-detail .task-heading .back').count();
// 스크롤 클릭 테스트
let scrolledTop=null;
if(sh>ch+10){
  await conv.evaluate(el=>el.scrollTo({top:el.scrollHeight}));
  await p.waitForTimeout(300);
  const before=await conv.evaluate(el=>el.scrollTop);
  await p.locator('.scroll-jumps button').first().click(); // toTop
  await p.waitForTimeout(600);
  const after=await conv.evaluate(el=>el.scrollTop);
  scrolledTop={before,after,worked:after<before};
}
console.log(JSON.stringify({convScrollable:sh>ch+10,scrollHeight:sh,clientHeight:ch,topbarBack,topbarBackVisible,headingBack,scrollButtonTest:scrolledTop},null,1));
await p.screenshot({path:"test-results/codex-unified.png"});
await b.close();
