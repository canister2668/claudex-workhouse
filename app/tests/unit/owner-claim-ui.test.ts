import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("owner claim UI boundary",()=>{
  it("keeps the one-time token in a scrubbed fragment and renders the QR payload",()=>{
    const source=fs.readFileSync(path.resolve("src/web/OwnerClaim.svelte"),"utf8");
    const fragmentRead=source.indexOf('new URLSearchParams(location.hash.replace(/^#/,""))');
    const fragmentScrub=source.indexOf('history.replaceState(null,"",`${location.pathname}${location.search}`)');
    const firstNetworkUse=source.indexOf('status=status??await api("/api/bootstrap/owner-claim/status")');
    expect(fragmentRead).toBeGreaterThan(0);
    expect(fragmentScrub).toBeGreaterThan(fragmentRead);
    expect(fragmentScrub).toBeLessThan(firstNetworkUse);
    expect(source).toContain("QRCode.toDataURL(JSON.stringify(qr)");
    expect(source).not.toContain("?claimToken=");
    expect(source).toContain('{$t("brand.name")} · {$t("ownerClaim.title")}');
  });

  it("lets a local user register this PC with one clear action and hides advanced transfer details",()=>{
    const source=fs.readFileSync(path.resolve("src/web/OwnerClaim.svelte"),"utf8");
    expect(source).toContain("localClaimFields()");
    expect(source).toContain('onclick={()=>completeClaim(localClaimFields())}');
    expect(source).toContain('class="continue"');
    expect(source).toContain('class="other-device"');
    expect(source).toContain('class="technical"');
    expect(source.indexOf('ownerClaim.continueThisDevice')).toBeLessThan(source.indexOf('class="other-device"'));
  });

  it("uses matching plain-language administrator copy in every supported locale",()=>{
    const locales=["en","ko","ja"].map(locale=>fs.readFileSync(path.resolve("src/web/i18n",`${locale}.ts`),"utf8"));
    for(const source of locales){
      for(const key of["ownerClaim.thisDeviceTitle","ownerClaim.thisDeviceBody","ownerClaim.continueThisDevice","ownerClaim.otherDeviceTitle","ownerClaim.otherDeviceBody","ownerClaim.technicalDetails"])expect(source).toContain(`"${key}"`);
    }
    expect(locales[0]).toContain('"ownerClaim.continueThisDevice":"Register this PC and continue"');
    expect(locales[1]).toContain('"ownerClaim.continueThisDevice":"이 PC를 관리자로 등록하고 계속"');
    expect(locales[2]).toContain('"ownerClaim.continueThisDevice":"このPCを管理者として登録して続ける"');
  });

  it("fails closed on claim-status errors and resumes setup only after claim",()=>{
    const source=fs.readFileSync(path.resolve("src/web/App.svelte"),"utf8");
    expect(source).toContain('(value as any)?.status===404');
    expect(source).toContain("ownerClaimStatusError=value instanceof Error");
    expect(source).toContain("<OwnerClaim {api} initialStatus={ownerClaimInitial} onclaimed={retryOwnerClaimStatus}/>");
    expect(source).toContain("if(disposed||ownerClaimRequired||ownerClaimStatusError)return");
    expect(source).not.toContain("onclick={()=>location.reload()}");
  });

  it("opens a pushed session from a database-only snapshot before full hydration",()=>{
    const app=fs.readFileSync(path.resolve("src/web/App.svelte"),"utf8");
    const server=fs.readFileSync(path.resolve("src/server/index.ts"),"utf8");
    expect(app).toContain("/snapshot`,{}, {caller:\"App.deepLink.snapshot\"}");
    expect(app).toContain("if(!task)return false");
    expect(app).toContain("history.replaceState(null,\"\",location.pathname)");
    expect(server).toContain('app.get("/api/tasks/:provider/:taskId/snapshot"');
    expect(server).toContain("return{task:item.task,snapshot:true}");
  });

  it("hydrates the first task list from the in-memory server snapshot",()=>{
    const app=fs.readFileSync(path.resolve("src/web/App.svelte"),"utf8");
    const server=fs.readFileSync(path.resolve("src/server/index.ts"),"utf8");
    expect(app).toContain('const params=new URLSearchParams({snapshot:"true"})');
    expect(server).toContain("if(query.snapshot)");
    expect(server).toContain("return{tasks:projectTasksWithLiveGitAttribution(tasks),partial:false,warnings:[],snapshot:true,unchanged:false,revision:taskListSnapshotRevision}");
  });

  it("mounts the heavy Codex session browser only after Codex is selected",()=>{
    const source=fs.readFileSync(path.resolve("src/web/App.svelte"),"utf8");
    expect(source).toContain('let codexMounted=false');
    expect(source).toContain('$: if(engine==="codex")codexMounted=true;');
    expect(source).toContain('{#if codexMounted}<div class="codex-session-pane"');
  });

  it("re-applies linked-session isolation after native Codex rows load",()=>{
    const source=fs.readFileSync(path.resolve("src/web/CodexSessions.svelte"),"utf8");
    expect(source).toContain("$taskState;");
    expect(source).toContain("const scoped=scopedSessions(sessions);");
    expect(source).toContain("if(scoped.length!==sessions.length){sessions=scoped;publishRecent();}");
  });
});
