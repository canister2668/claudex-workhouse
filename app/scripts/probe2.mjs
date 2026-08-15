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
const info=await conv.evaluate(el=>{
  const cs=getComputedStyle(el);
  const chain=[];let n=el;
  while(n&&chain.length<6){const s=getComputedStyle(n);chain.push({cls:n.className?.toString?.().slice(0,30),disp:s.display,h:s.height,maxH:s.maxHeight,flex:s.flex,overflow:s.overflow});n=n.parentElement;}
  return {maxHeight:cs.maxHeight,height:cs.height,display:cs.display,overflow:cs.overflow,flexGrow:cs.flexGrow,chain};
});
const back=p.locator('.codex-detail .task-heading .back').first();
const backBox=await back.count()?await back.boundingBox():null;
const backVis=await back.count()?await back.isVisible():false;
console.log(JSON.stringify({conv:info,back:{box:backBox,visible:backVis}},null,1));
await b.close();
