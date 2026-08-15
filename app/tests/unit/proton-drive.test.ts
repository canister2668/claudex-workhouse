import fs from"node:fs";
import os from"node:os";
import path from"node:path";
import{afterEach,describe,expect,it}from"vitest";
import{escapeProtonLocalGlobPath,ProtonDriveCli,ProtonDriveLoginManager}from"../../src/server/proton-drive-cli.js";
import{DEFAULT_PROTON_DRIVE_SETTINGS,normalizeProtonDriveSettings,protonRemotePath}from"../../src/server/proton-drive-settings.js";
import{ProtonDriveUploadService}from"../../src/server/proton-drive-upload.js";

const roots:string[]=[];
const temporary=()=>{const value=fs.mkdtempSync(path.join(os.tmpdir(),"proton-drive-test-"));roots.push(value);return value;};
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

function executable(root:string,body:string){const file=path.join(root,"proton-drive-fake");fs.writeFileSync(file,`#!/bin/sh\nset -eu\n${body}\n`,{mode:0o700});return file;}

describe("Proton Drive settings",()=>{
  it("keeps the integration disabled by default and rejects paths outside My files",()=>{
    expect(normalizeProtonDriveSettings(null)).toEqual(DEFAULT_PROTON_DRIVE_SETTINGS);
    expect(()=>normalizeProtonDriveSettings({...DEFAULT_PROTON_DRIVE_SETTINGS,enabled:true,remoteRoot:"/shared"})).not.toThrow();
    const invalid=normalizeProtonDriveSettings({...DEFAULT_PROTON_DRIVE_SETTINGS,enabled:true,remoteRoot:"/shared"});expect(invalid.enabled).toBe(false);
  });
  it("uses a content suffix and sanitizes remote names",()=>expect(protonRemotePath(DEFAULT_PROTON_DRIVE_SETTINGS,"A/B","report final.zip","a".repeat(64))).toBe("/my-files/Claudex-Workhouse/A-B/report final--aaaaaaaa.zip"));
});

const cliInfo=async(cli:ProtonDriveCli)=>Number((((await cli.info("/my-files/wh업로드/tagloom.zip")).value as any)?.activeRevision?.claimedSize)??0);

describe("Proton Drive CLI adapter",()=>{
  it("isolates command construction behind a fake executable",async()=>{
    const root=temporary(),log=path.join(root,"args"),managedBin=path.join(root,"runtime","bin");fs.mkdirSync(managedBin,{recursive:true});fs.writeFileSync(path.join(managedBin,"pass"),"#!/bin/sh\\nexit 0\\n",{mode:0o700});
    const binary=executable(root,'printf "%s\\n" "$*" >> "$PROTON_TEST_LOG"\nprintf "store=%s dir=%s home=%s\\n" "$PROTON_DRIVE_CREDENTIALS_STORE" "$PASSWORD_STORE_DIR" "$GNUPGHOME" >> "$PROTON_TEST_LOG"\nif [ "$1" = version ]; then echo "Proton Drive CLI 0.7.0"; exit 0; fi\nif [ "$1 $2" = "filesystem list" ]; then echo "[]"; exit 0; fi\nif [ "$1 $2" = "filesystem upload" ]; then echo "{\\"ok\\":true}"; exit 0; fi\nexit 2');
    process.env.PROTON_TEST_LOG=log;const cli=new ProtonDriveCli({appRoot:root,dataRoot:root},binary);
    expect((await cli.connection()).connected).toBe(true);await cli.upload(path.join(root,"[file].zip"),"/my-files/Test");
    const args=fs.readFileSync(log,"utf8");expect(args).toContain("filesystem upload");expect(args).toContain("\\[file\\].zip");expect(args).toContain("--conflict-strategy skip --json");expect(args).toContain("store=pass");expect(args).toContain(`dir=${path.join(root,"data","proton-drive","password-store")}`);expect(args).toContain(`home=${path.join(root,"data","proton-drive","gnupg")}`);delete process.env.PROTON_TEST_LOG;
  });
  it("retries a mis-cased remote path against the spelling Proton actually stores",async()=>{
    // The folder exists as "WH업로드" while the caller asks for "wh업로드" — the
    // spelling a person reads back — which used to fail every command outright.
    const root=temporary(),log=path.join(root,"args");
    const script=[
      `printf "%s\\n" "$*" >> "$PROTON_TEST_LOG"`,
      `case "$*" in`,
      `  "version") echo "Proton Drive CLI 0.7.0"; exit 0;;`,
      `  "filesystem list / --json") echo '[{"name":"my-files"}]'; exit 0;;`,
      `  "filesystem list /my-files --json") echo '[{"name":"WH업로드"}]'; exit 0;;`,
      `  "filesystem list /my-files/WH업로드 --json") echo '[{"name":"tagloom.zip"}]'; exit 0;;`,
      `  "filesystem info /my-files/WH업로드/tagloom.zip --json") echo '{"activeRevision":{"claimedSize":1}}'; exit 0;;`,
      `  "filesystem upload"*) echo '{"ok":true}'; exit 0;;`,
      `esac`,
      `echo "not found" >&2`,
      `exit 1`
    ].join("\n");
    const binary=executable(root,script);
    process.env.PROTON_TEST_LOG=log;
    const info=await cliInfo(new ProtonDriveCli({appRoot:root,dataRoot:root},binary));
    expect(info).toBe(1);
    const args=fs.readFileSync(log,"utf8");
    expect(args).toContain("filesystem info /my-files/WH업로드/tagloom.zip");
    delete process.env.PROTON_TEST_LOG;
  });

  it("uploads into the folder that exists instead of creating a second one",async()=>{
    const root=temporary(),log=path.join(root,"args");
    const script=[
      `printf "%s\\n" "$*" >> "$PROTON_TEST_LOG"`,
      `case "$*" in`,
      `  "version") echo "Proton Drive CLI 0.7.0"; exit 0;;`,
      `  "filesystem list / --json") echo '[{"name":"my-files"}]'; exit 0;;`,
      `  "filesystem list /my-files --json") echo '[{"name":"WH업로드"}]'; exit 0;;`,
      `  "filesystem list /my-files/WH업로드 --json") echo '[]'; exit 0;;`,
      `  "filesystem upload"*) echo '{"ok":true}'; exit 0;;`,
      `esac`,
      `echo "not found" >&2`,
      `exit 1`
    ].join("\n");
    const binary=executable(root,script);
    process.env.PROTON_TEST_LOG=log;
    await new ProtonDriveCli({appRoot:root,dataRoot:root},binary).upload(path.join(root,"out.zip"),"/my-files/wh업로드");
    expect(fs.readFileSync(log,"utf8")).toContain("/my-files/WH업로드 --conflict-strategy");
    delete process.env.PROTON_TEST_LOG;
  });

  it("refuses to choose when two folders differ only by case",async()=>{
    const root=temporary();
    const script=[
      `case "$*" in`,
      `  "version") echo "Proton Drive CLI 0.7.0"; exit 0;;`,
      `  "filesystem list / --json") echo '[{"name":"my-files"}]'; exit 0;;`,
      `  "filesystem list /my-files --json") echo '[{"name":"Foo"},{"name":"FOO"}]'; exit 0;;`,
      `esac`,
      `echo "not found" >&2`,
      `exit 1`
    ].join("\n");
    const cli=new ProtonDriveCli({appRoot:root,dataRoot:root},executable(root,script));
    await expect(cli.upload(path.join(root,"out.zip"),"/my-files/foo")).rejects.toMatchObject({code:"PROTON_PATH_AMBIGUOUS"});
  });

  it("escapes Node glob metacharacters in local upload paths",()=>expect(escapeProtonLocalGlobPath("/tmp/[draft] report?.zip")).toBe("/tmp/\\[draft\\] report\\?.zip"));
  it("only exposes a Proton-owned login URL",async()=>{
    const root=temporary(),binary=executable(root,'echo "https://evil.example/token?secret=1"\necho "https://account.proton.me/login#code"\nexit 0'),cli=new ProtonDriveCli({appRoot:root,dataRoot:root},binary),manager=new ProtonDriveLoginManager(cli,{appRoot:root,dataRoot:root}),attempt=manager.start("00000000-0000-4000-8000-000000000001");
    await new Promise(resolve=>setTimeout(resolve,40));const result=manager.get(attempt.id)!;expect(result.status).toBe("completed");expect(result.loginUrl).toContain("account.proton.me");expect(result.loginUrl).not.toContain("evil.example");manager.close();
  });
});

describe("Proton upload service",()=>{
  it("stages a stable regular file and completes through the adapter",async()=>{
    const root=temporary(),workspaceRoot=path.join(root,"workspace"),tempDir=path.join(root,"temp");fs.mkdirSync(workspaceRoot);fs.mkdirSync(tempDir);fs.writeFileSync(path.join(workspaceRoot,"result.zip"),"artifact");
    let operation:any=null;const task={id:"task-1",provider:"codex",status:"completed",workspaceId:"workspace-1",executionHostId:"local"},db:any={getSystemSetting:async()=>({value:{...DEFAULT_PROTON_DRIVE_SETTINGS,enabled:true},updatedAt:"now"}),getTask:async()=>task,createProtonUploadOperation:async(value:any)=>(operation=value),updateProtonUploadOperation:async(value:any)=>(operation=value),getProtonUploadOperation:async()=>operation,listProtonUploadOperations:async()=>[operation],reconcileProtonUploadOperations:async()=>0},workspaces:any={requireWorkspace:async()=>({id:"workspace-1",hostId:"local",displayName:"Project",canonicalPath:workspaceRoot})},cli:any={connection:async()=>({state:"ready",connected:true,version:"0.7.0",detail:null}),upload:async()=>({}),info:async()=>({value:{activeRevision:{claimedSize:8,claimedDigests:{sha1:"1e5dcbb59b753cb1d46e234d8f6180285b8b86ad"}}}})},service=new ProtonDriveUploadService({tempDir}as any,db,workspaces,cli);
    const prepared=await service.prepare({taskId:task.id,workspaceId:task.workspaceId,relativePath:"result.zip"});expect(prepared.status).toBe("prepared");expect(prepared.sourceSha256).toMatch(/^[a-f0-9]{64}$/);expect(fs.existsSync(path.join(tempDir,"proton-uploads",prepared.id,path.basename(prepared.remotePath)))).toBe(true);
    const completed=await service.execute(prepared.id,prepared.sourceSha256);expect(completed.status).toBe("completed");expect(completed.remotePath).toContain("/Project/result--");
  });
  it("fails verification when Proton metadata differs from the staged artifact",async()=>{
    const root=temporary(),workspaceRoot=path.join(root,"workspace"),tempDir=path.join(root,"temp");fs.mkdirSync(workspaceRoot);fs.mkdirSync(tempDir);fs.writeFileSync(path.join(workspaceRoot,"result.zip"),"artifact");let operation:any=null;const task={id:"task-1",provider:"codex",status:"completed",workspaceId:"workspace-1",executionHostId:"local"},db:any={getSystemSetting:async()=>({value:{...DEFAULT_PROTON_DRIVE_SETTINGS,enabled:true},updatedAt:"now"}),getTask:async()=>task,createProtonUploadOperation:async(value:any)=>(operation=value),updateProtonUploadOperation:async(value:any)=>(operation=value),getProtonUploadOperation:async()=>operation},workspaces:any={requireWorkspace:async()=>({id:"workspace-1",hostId:"local",displayName:"Project",canonicalPath:workspaceRoot})},cli:any={connection:async()=>({state:"ready",connected:true,version:"0.7.0",detail:null}),upload:async()=>({}),info:async()=>({value:{activeRevision:{claimedSize:7,claimedDigests:{sha1:"bad"}}}})},service=new ProtonDriveUploadService({tempDir}as any,db,workspaces,cli);
    const prepared=await service.prepare({taskId:task.id,workspaceId:task.workspaceId,relativePath:"result.zip"});await expect(service.execute(prepared.id,prepared.sourceSha256)).rejects.toMatchObject({code:"PROTON_VERIFY_MISMATCH"});expect(operation.status).toBe("failed");
  });
  it("rejects symbolic links before staging",async()=>{
    const root=temporary(),workspaceRoot=path.join(root,"workspace"),tempDir=path.join(root,"temp");fs.mkdirSync(workspaceRoot);fs.mkdirSync(tempDir);fs.writeFileSync(path.join(root,"outside"),"secret");fs.symlinkSync(path.join(root,"outside"),path.join(workspaceRoot,"link"));const task={id:"task-1",provider:"codex",status:"completed",workspaceId:"workspace-1",executionHostId:"local"},db:any={getSystemSetting:async()=>({value:{...DEFAULT_PROTON_DRIVE_SETTINGS,enabled:true}}),getTask:async()=>task},workspaces:any={requireWorkspace:async()=>({id:"workspace-1",hostId:"local",displayName:"Project",canonicalPath:workspaceRoot})},service=new ProtonDriveUploadService({tempDir}as any,db,workspaces,{}as any);
    await expect(service.prepare({taskId:task.id,workspaceId:task.workspaceId,relativePath:"link"})).rejects.toMatchObject({code:"PROTON_SYMLINK_REJECTED"});
  });
});
