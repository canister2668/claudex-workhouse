import { chromium } from "@playwright/test";
const EMAIL=process.env.PROBE_EMAIL;
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:834,height:1112},extraHTTPHeaders:{"x-claudex-workhouse-test-user":EMAIL}});
const p=await ctx.newPage();
const errs=[];p.on("pageerror",e=>errs.push(e.message));
await p.goto("http://127.0.0.1:3411/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(1500);
// Codex 탭 클릭
const codexTab=p.locator('nav.filters button',{hasText:/^Codex$/});
if(await codexTab.count()){await codexTab.first().click();await p.waitForTimeout(2500);}
const cards=p.locator('.session-card');
const nCards=await cards.count();
let report={codexCards:nCards};
if(nCards){
  await cards.first().click();await p.waitForTimeout(2000);
  report.backBtn = await p.locator('.codex-detail .task-heading .back, .codex-detail .detail-back').count();
  report.hasHeading = await p.locator('.codex-detail .task-heading').count();
  report.hasConversation = await p.locator('.codex-detail .conversation').count();
  report.hasScrollJumps = await p.locator('.codex-detail .scroll-jumps button, .scroll-jumps button').count();
  report.hasDock = await p.locator('.session-detail-dock').count();
  report.detailActions = await p.locator('.codex-detail .detail-actions button').count();
  // scroll test: does .conversation actually scroll?
  const conv=p.locator('.codex-detail .conversation').first();
  if(await conv.count()){
    report.convScrollHeight = await conv.evaluate(el=>el.scrollHeight);
    report.convClientHeight = await conv.evaluate(el=>el.clientHeight);
    report.convScrollable = report.convScrollHeight>report.convClientHeight+10;
  }
  await p.screenshot({path:"test-results/codex-detail-probe.png",fullPage:false});
}
report.errors=errs.slice(0,3);
console.log(JSON.stringify(report,null,1));
await b.close();
