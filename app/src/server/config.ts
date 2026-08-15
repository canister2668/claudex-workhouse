import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import{spawnSync}from"node:child_process";
import { z } from "zod";
import type { ProjectConfig } from "./types.js";
import {isAbsoluteHostPath,resolveWorkhouseRoots}from"./platform.js";

const{appRoot:APP_ROOT,dataRoot:DATA_ROOT,legacyRoot:ROOT}=resolveWorkhouseRoots();
const env=(name:string)=>process.env[`CLAUDEX_WORKHOUSE_${name}`];
function executable(value: string): string | null {
  const candidates = /[\\/]/.test(value)
    ? [path.isAbsolute(value) ? value : path.resolve(DATA_ROOT, value)]
    : (process.env.PATH ?? "").split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, value));
  for (const candidate of candidates) {
    try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch { /* try next */ }
  }
  return null;
}

// Claudex Workhouse owns its Claude runtime. It deliberately does not inspect VS Code
// extension directories: an editor update/removal must never break this server.
export function resolveClaudeBinary(configured: string): string {
  const requested = env("CLAUDE_BIN")?.trim() || configured.trim();
  const managedName=process.platform==="win32"?"claude.exe":"claude";
  const resolved = executable(requested) || executable(path.join(DATA_ROOT, "runtime", "claude-bin", managedName)) || executable(path.join(DATA_ROOT, "runtime", "bin", managedName)) || executable(process.platform==="win32"?"claude.exe":"claude");
  // Keep the control plane bootable for the first-run installer even before a
  // runtime volume is mounted. Provider status reports unavailable and actual
  // task creation remains the authoritative failure boundary.
  return resolved ?? (path.isAbsolute(requested) ? requested : path.resolve(DATA_ROOT,requested||path.join("runtime","claude-bin",managedName)));
}

// The emotion catalog must read the very directory the static file server
// publishes as `/emoticons`. That directory is `app/dist`, both in the packaged
// Windows portable and in a built server; `app/public` only exists in a source
// checkout. Reading `public` unconditionally left the packaged catalog empty,
// so valid `[[e:...]]` markers resolved to nothing. Prefer `dist` and fall back
// to `public` for `pnpm dev`, which serves assets straight from `public`.
export function resolveEmotionAssetsDir(appRoot:string):string{
  const built=path.join(appRoot,"app","dist","emoticons"),source=path.join(appRoot,"app","public","emoticons");
  for(const candidate of[built,source])try{if(fs.statSync(candidate).isDirectory())return candidate;}catch{/* try the next candidate */}
  return built;
}

export function resolveGrokBinary(configured="grok"):string{
  const requested=env("GROK_BIN")?.trim()||configured.trim();
  const home=process.env.HOME||os.homedir();
  const versioned=path.join(home,".grok","bin");
  let managed:string|null=null;
  try{
    managed=fs.readdirSync(versioned).filter(name=>/^grok(?:-[0-9][a-z0-9._-]*)?(?:\.exe)?$/i.test(name)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true})).map(name=>executable(path.join(versioned,name))).find(Boolean)??null;
  }catch{/* Grok has not been installed for this account yet. */}
  return executable(requested)||executable(path.join(DATA_ROOT,"runtime","bin",process.platform==="win32"?"grok.exe":"grok"))||managed||executable("grok")||(path.isAbsolute(requested)?requested:path.resolve(DATA_ROOT,requested||"runtime/bin/grok"));
}

const configSchema = z.object({
  installationId: z.string().uuid().optional(),
  host: z.enum(["127.0.0.1","0.0.0.0"]),
  port: z.number().int().min(1024).max(65535),
  externalOrigin: z.string().url(),
  allowedEmail: z.string().email(),
  teamDomain: z.string(),
  audience: z.string(),
  authMode: z.enum(["cloudflare", "tailscale", "local", "test"]),
  tailscaleAllowedEmail: z.string().email().optional(),
  tailscaleRequireServeIdentity: z.boolean().default(true),
  tailscaleAllowFunnel: z.literal(false).default(false),
  promptMaxLength: z.number().int().positive().max(100000),
  commandTimeoutMs: z.number().int().min(1000).max(120000),
  commandOutputLimit: z.number().int().min(65536).max(16777216),
  claudeBinary: z.string().min(1),
  grokBinary:z.string().min(1).optional(),
  workspaceRoots:z.array(z.object({path:z.string().refine(value=>isAbsoluteHostPath(value),"Absolute host path required."),displayName:z.string().min(1).max(100),allowCreate:z.boolean().default(true),allowRegister:z.boolean().default(true),allowClone:z.boolean().default(true),allowDelete:z.boolean().default(false)})).max(20).optional()
});

const projectsSchema = z.object({
  projects: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]+$/), name: z.string().min(1), path: z.string().refine(value=>isAbsoluteHostPath(value),"Absolute host path required.") }))
});

export function assertPlatformControlPlaneConfig(config:{host:string;externalOrigin:string;authMode:string},platform:NodeJS.Platform=process.platform){
  if(platform!=="win32"||config.authMode!=="local")return;
  const hostname=new URL(config.externalOrigin).hostname;
  if(config.host!=="127.0.0.1"||!["127.0.0.1","localhost","::1"].includes(hostname))throw new Error("Windows local mode requires loopback bind and external origin.");
}

export type AppConfig = z.infer<typeof configSchema> & {
  grokBinary:string;
  root: string;
  appRoot:string;
  dataRoot:string;
  dataDir: string;
  snapshotDir: string;
  logDir: string;
  runDir: string;
  tempDir: string;
  cacheDir: string;
  dbPath: string;
  emotionStateFile: string;
  emotionAssetsDir: string;
  emotionAssetBaseUrl: string;
  projects: ProjectConfig[];
};

type AclRun=(command:string,args:string[])=>{status:number|null;error?:Error;stdout?:string;stderr?:string};
export function applyWindowsDataAcl(dataRoot:string,options:{platform?:NodeJS.Platform;identity?:string;run?:AclRun}={}){
  if((options.platform??process.platform)!=="win32")return{applied:false,reason:"not-windows" as const};
  const sidResult=options.identity?null:spawnSync("whoami",["/user","/fo","csv","/nh"],{shell:false,encoding:"utf8",windowsHide:true}),sid=String(sidResult?.stdout??"").match(/,"(S-1-[0-9-]+)"\s*$/i)?.[1];
  const environmentIdentity=[process.env.USERDOMAIN,process.env.USERNAME].filter(Boolean).join("\\");
  const identity=(options.identity??(sid?`*${sid}`:(environmentIdentity||os.userInfo().username))).trim();
  if(!identity||/[\u0000-\u001f":]/.test(identity))throw new Error("Windows data ACL requires a valid current-user identity.");
  if(!isAbsoluteHostPath(dataRoot,"win32"))throw new Error("Windows data ACL requires an absolute Windows data root.");
  const run=options.run??((command,args)=>{const result=spawnSync(command,args,{shell:false,encoding:"utf8",windowsHide:true});return{status:result.status,error:result.error,stdout:String(result.stdout??""),stderr:String(result.stderr??"")};});
  const protectedDirectories=["config","data","snapshots","logs","run","runtime"].map(name=>path.win32.join(dataRoot,name));
  const invocations=[
    [dataRoot,"/grant:r",`${identity}:(OI)(CI)F`,"/Q"],
    [dataRoot,"/inheritance:d","/remove:g","*S-1-1-0","*S-1-5-11","*S-1-5-32-545","/Q"],
    ...protectedDirectories.flatMap(directory=>[
      [directory,"/grant:r",`${identity}:(OI)(CI)F`,"/T","/Q"],
      [directory,"/inheritance:d","/remove:g","*S-1-1-0","*S-1-5-11","*S-1-5-32-545","/T","/Q"]
    ])
  ];
  for(const args of invocations){
    const result=run("icacls",args),detail=`${result.stdout??""}\n${result.stderr??""}`;
    if(result.error||result.status!==0||/Failed processing\s+[1-9]\d*\s+files?/i.test(detail)){
      const cause=result.error?.message??(result.status===null?"no exit status":`exit ${result.status}`);
      throw new Error(`Failed to restrict the Windows data-root ACL (${cause}).`);
    }
  }
  return{applied:true,reason:null};
}

export function ensureRuntimeDirectories(config: Pick<AppConfig,"dataDir"|"snapshotDir"|"logDir"|"runDir"|"tempDir"|"cacheDir"|"emotionStateFile"> & {dataRoot?:string},options:{platform?:NodeJS.Platform;identity?:string;runAcl?:AclRun}={}): void {
  const directories = [
    config.dataDir,
    config.snapshotDir,
    config.logDir,
    config.runDir,
    path.dirname(config.emotionStateFile)
  ];
  for (const directory of directories) fs.mkdirSync(directory,{recursive:true,mode:0o700});
  for(const directory of[config.tempDir,path.join(config.cacheDir,"npm"),path.join(config.cacheDir,"pnpm")]){
    fs.mkdirSync(directory,{recursive:true,mode:0o700});
    const stat=fs.lstatSync(directory);
    if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error(`Managed runtime directory is not a regular directory: ${directory}`);
    fs.chmodSync(directory,0o700);
  }
  const platform=options.platform??process.platform,dataRoot=config.dataRoot??path.dirname(config.dataDir),aclMarker=path.join(dataRoot,".windows-acl-v2");
  if(platform==="win32"&&!fs.existsSync(aclMarker)){
    applyWindowsDataAcl(dataRoot,{platform,identity:options.identity,run:options.runAcl});
    fs.writeFileSync(aclMarker,"restricted-current-user\n",{mode:0o600,flag:"wx"});
  }
}

export function applyManagedTempEnvironment(config: Pick<AppConfig,"tempDir"|"cacheDir">): void {
  process.env.TMPDIR=config.tempDir;
  process.env.TMP=config.tempDir;
  process.env.TEMP=config.tempDir;
  process.env.npm_config_cache=path.join(config.cacheDir,"npm");
  process.env.pnpm_config_store_dir=path.join(config.cacheDir,"pnpm");
}

function migrateLegacyEmotionState(root:string,legacyStateFile:unknown){
  if(typeof legacyStateFile!=="string"||!path.isAbsolute(legacyStateFile))return;
  const targetDir=path.join(root,"data","emotion"),legacyDir=path.dirname(legacyStateFile);
  fs.mkdirSync(targetDir,{recursive:true,mode:0o700});
  for(const name of ["state.json","codex-state.json","emotion-mode"]){
    const source=path.join(legacyDir,name),target=path.join(targetDir,name);
    if(fs.existsSync(target)||!fs.existsSync(source))continue;
    try{fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);}catch{/* A missing legacy file leaves the bundled default intact. */}
  }
}

export function loadConfig(): AppConfig {
  const fileConfig = JSON.parse(fs.readFileSync(path.join(DATA_ROOT,"config","claudex-workhouse.json"), "utf8"));
  migrateLegacyEmotionState(DATA_ROOT,fileConfig.emotionStateFile);
  if (env("AUTH_MODE")) fileConfig.authMode = env("AUTH_MODE");
  if (env("TEAM_DOMAIN")) fileConfig.teamDomain = env("TEAM_DOMAIN");
  if (env("AUDIENCE")) fileConfig.audience = env("AUDIENCE");
  if (env("ALLOWED_EMAIL")) fileConfig.allowedEmail = env("ALLOWED_EMAIL");
  if (env("TAILSCALE_ALLOWED_EMAIL")) fileConfig.tailscaleAllowedEmail = env("TAILSCALE_ALLOWED_EMAIL");
  if (env("PORT")) fileConfig.port = Number(env("PORT"));
  if (env("HOST")) fileConfig.host = env("HOST");
  if (env("EXTERNAL_ORIGIN")) fileConfig.externalOrigin = env("EXTERNAL_ORIGIN");
  const raw = configSchema.parse(fileConfig);
  assertPlatformControlPlaneConfig(raw);
  const projectFile = projectsSchema.parse(JSON.parse(fs.readFileSync(path.join(DATA_ROOT, "config", "projects.json"), "utf8")));
  const projects = projectFile.projects.map<ProjectConfig>((item) => {
    const configured=item.id==="claudex-workhouse"?{...item,path:APP_ROOT}:item;
    try {
      const stat = fs.statSync(configured.path);
      if (!stat.isDirectory()) return { ...configured, realPath:configured.path, enabled:false, error:"ENOTDIR" };
      fs.accessSync(configured.path,fs.constants.R_OK|fs.constants.X_OK);
      return { ...configured, realPath:configured.path, enabled:true, error:null };
    } catch (error) {
      return { ...configured, realPath: configured.path, enabled: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  return {
    ...raw,
    claudeBinary: resolveClaudeBinary(raw.claudeBinary),
    grokBinary:resolveGrokBinary(raw.grokBinary),
    emotionStateFile:path.join(DATA_ROOT,"data","emotion","state.json"),
    emotionAssetsDir:resolveEmotionAssetsDir(APP_ROOT),
    emotionAssetBaseUrl:new URL(raw.externalOrigin).origin,
    root: APP_ROOT,
    appRoot:APP_ROOT,
    dataRoot:DATA_ROOT,
    dataDir: path.join(DATA_ROOT, "data"),
    snapshotDir: path.join(DATA_ROOT, "snapshots"),
    logDir: path.join(DATA_ROOT, "logs"),
    runDir: path.join(DATA_ROOT, "run"),
    tempDir:fs.existsSync("/.dockerenv")||fs.existsSync("/run/.containerenv")
      ?path.join(os.tmpdir(),"claudex-workhouse")
      :path.join(DATA_ROOT,"runtime","tmp"),
    cacheDir: path.join(DATA_ROOT,"runtime","cache"),
    dbPath: path.join(DATA_ROOT,"data","claudex-workhouse.sqlite"),
    projects
  };
}
