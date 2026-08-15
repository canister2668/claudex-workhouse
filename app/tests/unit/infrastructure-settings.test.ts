import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import InfrastructureSettings from "../../src/web/InfrastructureSettings.svelte";
import ArtifactSettings from "../../src/web/ArtifactSettings.svelte";
import ProjectWorkspaceSettings from "../../src/web/ProjectWorkspaceSettings.svelte";

const api = async () => ({});

describe("deployment and infrastructure settings UI", () => {
  it("combines the server summary and Worker management in one tab", () => {
    const body = render(InfrastructureSettings, { props:{ api } }).body;
    expect(body).toContain("서버 및 실행 장치");
    expect(body).toContain("장치 추가");
    expect(body).not.toContain("인프라 개요");
  });

  it("keeps Project and Workspace management independent from Worker pairing", () => {
    const body = render(ProjectWorkspaceSettings, { props:{ api, projects:[] } }).body;
    expect(body).toContain("실행 위치");
    expect(body).toContain("프로젝트");
    expect(body).toContain("작업공간");
    expect(body).not.toContain("pairing");
  });

  it("places recorded artifacts and recognized temporary cleanup in a dedicated settings tab",()=>{
    const body=render(ArtifactSettings,{props:{api}}).body;
    expect(body).toContain("작업공간 산출물");
    expect(body).toContain("기록된 산출물만 정확한 관리 대상입니다");
    const app=readFileSync(join(process.cwd(),"src/web/App.svelte"),"utf8");
    expect(app).toContain('{id:"storage",labelKey:"settings.storage.title",group:"storage"}');
    expect(app).toContain('{id:"artifacts",labelKey:"settings.artifacts"},{id:"snapshots",labelKey:"settings.storage"}');
    expect(app).toContain('{#if storageTab==="artifacts"}<ArtifactSettings {api}/>{:else}<SnapshotSettings {api}/>{/if}');
    const artifacts=readFileSync(join(process.cwd(),"src/web/ArtifactSettings.svelte"),"utf8");
    expect(artifacts).toContain('<details class="workspace-group">');
    expect(artifacts).toContain('<details class="temp-root">');
    expect(artifacts).toContain("function selectAll()");
    expect(artifacts).toContain('onclick={()=>removeEntries(oldEntries)}');
    expect(artifacts).toContain("tempOverview&&tempHasEntries");
    expect(artifacts).toContain("tempOverview&&!tempLoading");
    expect(artifacts).toContain("grid-auto-rows:max-content;align-content:start");
    expect(artifacts).toContain("align-self:start;height:max-content");
    expect(artifacts).toContain(".cleanup>header>button{flex:none;white-space:nowrap}");
    expect(artifacts).toContain("max-height:320px");
  });

  it("keeps the application update version in a bounded grid column",()=>{
    const app=readFileSync(join(process.cwd(),"src/web/App.svelte"),"utf8");
    const css=readFileSync(join(process.cwd(),"src/web/styles.css"),"utf8");
    expect(app).toContain('class="runtime-card application-update-card"');
    expect(app).toContain('class="application-update-current"');
    expect(css).toContain(".application-update-card{display:grid;grid-template-columns:minmax(180px,1fr)");
    expect(css).toContain(".application-update-card>.application-update-current{min-width:180px}");
    expect(app).toContain('applicationUpdate.updateAvailable&&applicationUpdate.blockers.length');
    expect(app).toContain('applicationUpdate.reason==="source-checkout-not-updatable"');
  });

  it("uses the normalized infrastructure contracts and never renders diagnostic JSON", () => {
    const root = join(process.cwd(), "src/web");
    const infrastructure = readFileSync(join(root, "InfrastructureSettings.svelte"), "utf8");
    const app = readFileSync(join(root, "App.svelte"), "utf8");
    const server = readFileSync(join(process.cwd(), "src/server/index.ts"), "utf8");
    expect(infrastructure).toContain('api("/api/infrastructure/overview")');
    expect(infrastructure).toContain('api("/api/infrastructure/health/server"');
    expect(infrastructure).toContain("/api/infrastructure/health/hosts/");
    expect(infrastructure).toContain('api("/api/infrastructure/support-bundle")');
    // Temporary-storage cleanup lives only in the storage tab; the infrastructure copy was dead code behind showTempStorage=false.
    expect(infrastructure).not.toContain("temp-storage");
    expect(infrastructure).not.toContain("showTempStorage");
    const artifactsSource=readFileSync(join(root,"ArtifactSettings.svelte"),"utf8");
    expect(artifactsSource).toContain('api("/api/infrastructure/temp-storage")');
    expect(artifactsSource).toContain('api("/api/infrastructure/temp-storage/scan"');
    expect(artifactsSource).toContain('api("/api/infrastructure/temp-storage/delete"');
    expect(infrastructure).toContain("await loadExecutionBackend();");
    expect(infrastructure).toContain("claudex-workhouse-support-");
    expect(infrastructure).toContain('api("/api/deployment/plans"');
    expect(infrastructure).toContain("serverOrigin:normalizedServerOrigin()");
    expect(infrastructure).toContain("downloadGeneratedBundle");
    expect(infrastructure).toContain("generatedBundle()?.archive");
    expect(infrastructure).toContain('min="1024"');
    expect(infrastructure).toContain("let planPort=3410");
    expect(infrastructure).not.toContain("let planPort=8787");
    expect(infrastructure).toContain('api("/api/hosts/pairings"');
    expect(infrastructure).toContain('api("/api/deployment/worker-instructions"');
    expect(infrastructure).toContain("verifiedWorkerDownload()");
    expect(infrastructure).not.toContain('href="/api/worker-package/windows"');
    expect(server).toContain('app.post("/api/deployment/plans"');
    expect(server).toContain("createDeploymentBundleArchive(bundle)");
    expect(server).toContain("archive.sha256");
    expect(server).toContain("sha256sum -c - && test ! -e");
    expect(server).toContain('app.post("/api/deployment/worker-instructions"');
    expect(server).toContain('verifyLocalWorkerPackage(path.join(config.appRoot,"packages"),metadata)');
    expect(server).toContain('code:"WORKER_PACKAGE_ARTIFACT_INVALID"');
    expect(server).toContain('app.get("/api/deployment/releases/current"');
    expect(server).toContain('app.get("/api/infrastructure/support-bundle"');
    expect(server).toContain('app.get("/api/infrastructure/temp-storage"');
    expect(server).toContain('app.post("/api/infrastructure/temp-storage/scan"');
    expect(server).toContain("tempStorage.startScan(loadTempStorageContext)");
    expect(server).toContain("db.listWorkspaces({hostId:LOCAL_HOST_ID})");
    expect(server).toContain('app.post("/api/infrastructure/temp-storage/delete"');
    expect(server).toContain("createInfrastructureSupportBundle");
    expect(server).toContain("releaseServiceConfigFromEnvironment(config.appRoot)");
    expect(server).toContain("const release=await trustedReleaseMetadata()");
    expect(server).toContain("const workerPackage=await trustedWorkerPackageMetadata(body.platform,body.architecture)");
    expect(server).toContain('!request.url.startsWith("/api/deployment/")');
    expect(infrastructure).not.toMatch(/<pre[^>]*>.*JSON\.stringify/s);
    expect(app).not.toContain('{id:"overview",labelKey:"settings.overview"}');
    expect(app).toContain('{id:"infrastructure",labelKey:"settings.infrastructure",group:"connection"}');
    expect(app).not.toContain("overviewOnly");
    expect(app).toContain("<ProjectWorkspaceSettings");
  });
});
