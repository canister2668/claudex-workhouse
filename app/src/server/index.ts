// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Claudex Workhouse.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import os from "node:os";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import WebSocket from "ws";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import fastifyCompress from "@fastify/compress";
import{consumeShareTargetPayload,nativeShareTargetNavigation}from"./share-target.js";
import rateLimit from "@fastify/rate-limit";
import { bypassGlobalRateLimit, globalRateLimitKey } from "./rate-limit-policy.js";
import fastifyWebsocket from "@fastify/websocket";
import { z } from "zod";
import { applyManagedTempEnvironment, ensureRuntimeDirectories, loadConfig } from "./config.js";
import { DatabaseRequestError, DeckDatabase, runWithDatabaseRequestTrace, type DatabaseRequestTrace } from "./db/client.js";
import { CodexProvider } from "./providers/codex.js";
import { ClaudeProvider } from "./providers/claude.js";
import { hideOwnedProviderSessionMirrors } from "./provider-session-mirrors.js";
import { AnthropicCompatibleProvider } from "./providers/compatible.js";
import {compatibleProviderConfig,compatibleProviderPublicSettings,deepseekBalanceUrl,ollamaAccountUrl,ollamaUsageUrl,saveCompatibleProviderSettings} from "./compatible-provider-config.js";
import { AntigravityProvider } from "./providers/antigravity.js";
import{GrokProvider}from"./providers/grok.js";
import {normalizeAntigravityOutputEvents} from "./antigravity-runtime.js";
import { readClaudeRuntime } from "./claude-runtime.js";
import { authorizeLocalOwnerRequest, createAuthenticator, isLoopbackAddress, LocalEntryAuth, localEntryPublicRequest, registerLocalEntryRoutes } from "./security/auth.js";
import { codexTurnEvents, collaborationPublicEvents, mergeActiveClaudeThreadEvents, mergeHistoricalFileChanges, normalizeAgentEvent, providerThreadEvents, taskEvents, withTaskRequestIdentity } from "./events.js";
import { claudeTranscriptEvents, resolveTranscriptFile } from "./claude-transcript.js";
import { EmotionWatcher, PROVIDER_EMOTION_OUTFITS } from "./emotion.js";
import { ProviderAvatarSettings } from "./provider-avatar-settings.js";
import { resetCodexAppServerPool, setCodexAppServerDelegate, withCodexAppServer } from "./codex/app-server.js";
import { applyRuntimeUpdate, installRuntime, localRuntimeStatuses, managedRuntimeBinary } from "./runtime-updates.js";
import { ProviderStatusCache } from "./provider-status-cache.js";
import { setupProviderReadiness } from "./setup-readiness.js";
import { externalRuntimeStatuses } from "./external-runtime-status.js";
import {RuntimeUpdateCoordinator,normalizeRuntimeAutoUpdate} from "./runtime-update-coordinator.js";
import { registerEmotionMcp } from "./mcp-emotion.js";
import {MCP_REGISTRY_SETTING_KEY,externalMcpProviderSupport,mcpRegistryPutSchema,normalizeMcpRegistrySettings,publicMcpRegistrySettings} from "./mcp-registry.js";
import {McpSecretStore} from "./mcp-secrets.js";
import {registerExternalMcpProxy} from "./external-mcp-proxy.js";
import { cleanupStreamEvents, readStreamEvents, readStreamFileChanges, sseResumeSequence, STREAM_REPLAY_LIMIT } from "./stream-events.js";
import {mergePersistedImageOutputs,persistedImageOutputEvents,persistedImageOutputsFromEvents} from "./image-outputs.js";
import { mapAntigravityQuotaError, mapClaudeQuota, mapCodexQuota, mapDeepseekBalance, mapGrokQuota, mapOllamaPlan, mapOllamaQuota, quotaCacheDuration, readFreshCodexRateLimits, type ProviderBalance, type ProviderQuota } from "./quota.js";
import { ProviderAuthManager, type AuthProvider, type LoginMethod } from "./provider-auth.js";
import { HostWorkspaceManager, LOCAL_HOST_ID } from "./host-workspaces.js";
import { WorkerHub } from "./worker-hub.js";
import{DesktopWorkerClient}from"./desktop-worker/client.js";
import{saveWorkerConfig}from"./desktop-worker/config.js";
import{executionHostUsesWorker as platformExecutionHostUsesWorker,MANAGED_LOCAL_WORKER_HOST_ID,managedLocalWorkerEnabled,prepareManagedLocalWorker,syncManagedLocalWorkerConfig}from"./managed-local-worker.js";
import { HandoffManager } from "./handoff.js";
import { CollaborationBoardService, boardResumeUsesWorkerHost, isBoardWorkTask, selectBoardResumeTask } from "./collaboration-board.js";
import { boardSessionIsLive, CollaborationBoardAutomationEngine } from "./collaboration-board-automation.js";
import { registerCollaborationBoardRoutes } from "./collaboration-board-routes.js";
import type { AgentProvider, DeckTask, ProviderId } from "./types.js";
import type { ApprovalDecision } from "./approval-bridge.js";
import { resolveTaskApproval } from "./approval-resolution.js";
import { PushManager } from "./push.js";
import { EMPTY_PROMPT_PRESET_SETTINGS, nextPromptPresetUpdatedAt, normalizeStoredPromptPresetSettings, promptPresetPutSchema, promptPresetSettingsSchema } from "./prompt-presets.js";
import type { HistorySearchResult } from "./history-search.js";
import { assertAutomationSupported, automationLevel, automationLevelForNewTask, fullAccessAcknowledgementValid, isPermissionProfile, permissionForAutomation, platformAutomationDefault } from "./automation-level.js";
import { CollaborationEventBus } from "./collaboration/events.js";
import { CollaborationOrchestrator } from "./collaboration/orchestrator.js";
import { RelayArtifactStore } from "./collaboration/relay-artifacts.js";
import { characterPrompt, characterSettingsSchema, characterSettingsWithTone, DEFAULT_CHARACTER_SETTINGS, migrateTonePreset, normalizeCharacterSettings, tonePreset } from "./character-settings.js";
import { localizedTaskSuffix, normalizeStoredLocale, uiLocaleSettingsSchema } from "./ui-locale.js";
import { applyGlobalDelegationModels, compatibleDelegationDefaultsSchema, DEFAULT_DELEGATION_SETTINGS, delegationSettingsSchema, normalizeDelegationSettings, validateDelegationSettings } from "./delegation-settings.js";
import {normalizeSetupPreferences,setupPanelRequired} from "./setup-preferences.js";
import { createAutomaticDatabaseBackup } from "./database-backup.js";
import {SnapshotStore} from "./snapshot-store.js";
import {osExecutionIdentity,trustedHostSettingKey} from "./execution-policy.js";
import {applyPathDisplayPolicy} from "./path-display.js";
import{buildWindowsBootstrapStatus}from"./windows/bootstrap-status.js";
import{localHostDisplayName}from"./platform.js";
import {ManagedProviderBridge,registerManagedProviderMcp} from "./managed-provider-mcp.js";
import {ClaudeModelCatalog} from "./claude-model-catalog.js";
import {globalModelIdSchema,globalModelSettingsSchema,modelCandidates,normalizeGlobalModelSettings,requireEnabledModels,validateGlobalModelSettings,type GlobalModelSettings} from "./global-model-settings.js";
import {createSharedLoader} from "./shared-loader.js";
import {ModelCatalogAnnouncementCoordinator} from "./model-catalog-announcements.js";
import{antigravityExecutionSettingsSchema,DEFAULT_ANTIGRAVITY_EXECUTION,normalizeAntigravityExecutionSettings,parseGoogleCredentialJson,usesVertexCredentials}from"./antigravity-execution-settings.js";
import{antigravityHome}from"./antigravity-environment.js";
import { gitOperationSchema,pullRequestInputSchema } from "./git-core.js";
import { GitHubLoginManager } from "./github-login.js";
import { persistConfiguredWorkspacePath } from "./project-config-file.js";
import { assertWorkspaceManagementAllowed } from "./workspace-protection.js";
import { creditUsageSettingsSchema, DEFAULT_CREDIT_USAGE_SETTINGS, isPaidCreditConsentRequired, normalizeCreditUsageSettings, PaidCreditConsentRequiredError, providerQuotaState, quotaStateBlocksPaidCredits } from "./credit-usage-settings.js";
import { MAX_EDITABLE_WORKSPACE_FILE_BYTES } from "./workspace-file-edit.js";
import { MAX_WORKSPACE_IMAGE_PREVIEW_BYTES, workspaceImageMime } from "./workspace-image-preview.js";
import { MAX_WORKSPACE_DOWNLOAD_BYTES } from "./workspace-limits.js";
import { addBrowserUploadBytes, MAX_BROWSER_UPLOAD_BYTES } from "./upload-limits.js";
import {captureTaskImageOutput,resolveTaskImageOutput} from "./task-image-output.js";
import { renameSessionTitle } from "./session-title.js";
import {createThreadTurnGate} from "./session-turn.js";
import {createWorkspaceInstructionSnapshot,MAX_WORKSPACE_INSTRUCTION_FILE_BYTES,normalizeWorkspaceInstructionProfile,ownerEditedWorkspaceInstructionProfile,promptWithWorkspaceInstructions,repositoryWorkspaceInstructions,workspaceInstructionCompactionMetadata,workspaceInstructionFollowUpMetadata,workspaceInstructionRecoveryMetadata,workspaceInstructionSettingKey,workspaceInstructionSnapshotFromMetadata,workspaceInstructionTaskTitle} from "./workspace-instructions.js";
import {claudeExecutionSettingsSchema,DEFAULT_CLAUDE_EXECUTION_SETTINGS,normalizeClaudeExecutionSettings} from "./claude-execution-settings.js";
import {ProtonDriveCli,ProtonDriveLoginManager} from "./proton-drive-cli.js";
import {protonDriveSettingsSchema,normalizeProtonDriveSettings} from "./proton-drive-settings.js";
import {ProtonDriveUploadService} from "./proton-drive-upload.js";
import {ProtonDriveImportService} from "./proton-drive-import.js";
import { sanitizeSensitiveObject, sanitizeSensitiveText, sanitizeSensitiveValue } from "./sensitive-data.js";
import { TEMP_SWEEP_INTERVAL_MS } from "./temp-storage.js";
import { reconcileTaskSnapshot, removeProviderSessionRows, shouldSettleTaskLease, upsertTaskRows, type TaskSnapshotMutation } from "./provider-task-snapshot.js";
import {projectTaskList,projectTaskListItem} from "./task-list-projection.js";
import {mergeLiveTaskGitAttribution,taskGitAttribution} from "./task-git-attribution.js";
import { RuntimeTempStorageManager, type RuntimeTempKnownRoot } from "./runtime-temp-storage.js";
import { ArtifactRegistry } from "./artifact-registry.js";
import { initialReservationCheckAt, permissionSnapshotMatches, reservationPermissionSnapshot, reservationQuotaDecision, runQuotaReservationPump, type QuotaTaskReservation } from "./quota-task-reservations.js";
import { assertRecoveryThread, defaultRecoveryPrompt, recoveryPromptHash, retryableRecoveryPrelaunchFailure, taskRecoveryBoundary, taskRecoveryEligibility, taskRecoveryPermission } from "./task-recovery.js";
import {
  OwnerClaimManager,
  isStrictLoopbackBootstrapRequest,
  ownerClaimApiAccess
} from "./bootstrap/owner-claim.js";
import {
  createInfrastructureSupportBundle,
  healthConnectionStatus,
  isCloudflareAccessRedirect,
  normalizeExecutionHostDiagnostics,
  runMainServerHealthChecks,
  type HealthCheckRun,
  type InfrastructureHealthStatus
} from "./infrastructure/index.js";
import {
  DeploymentValidationError,
  createDeploymentBundleArchive,
  createDeploymentPlan,
  createWorkerInstallInstructions,
  generateMainServerBundle,
  publicReleaseSummary,
  releaseServiceConfigFromEnvironment,
  ReleaseManifestError,
  ReleaseService,
  ReleaseServiceError,
  renderWorkerInstallScript,
  toTrustedReleaseMetadata,
  toTrustedWorkerPackageMetadata,
  verifyLocalWorkerPackage,
  validateTrustedReleaseMetadata,
  validateTrustedWorkerPackageMetadata,
  type VerifiedRelease
} from "./deployment/index.js";
import { WORKER_PROTOCOL_VERSION } from "./worker-protocol.js";
import{legalNoticeMetadata}from"./legal-notices.js";
import{ApplicationUpdateCoordinator,applicationUpdateBlockers as collectApplicationUpdateBlockers,compareApplicationVersions,normalizeApplicationInstallMetadata,writeApplicationUpdateRequest,type ApplicationUpdateBlocker,type ApplicationUpdateStatus}from"./application-updates.js";
import{createApplicationUpdateSnapshot}from"./application-update-snapshot.js";
import{reconcileApplicationUpdateResults}from"./application-update-results.js";
import{managedConversationDocuments}from"./conversation-documents.js";
import{EventEmitter}from"node:events";
import{ExternalAccessCoordinator}from"./external-access/coordinator.js";
import{registerExternalAccessRoutes}from"./external-access/routes.js";

function bootstrapServerUrls(host:string,port:number,externalOrigin:string){
  const values:string[]=[];
  const add=(raw:string|undefined)=>{
    if(!raw)return;
    try{
      const url=new URL(raw);
      if(!["http:","https:"].includes(url.protocol)||url.username||url.password)return;
      url.pathname="/";url.search="";url.hash="";
      if(!values.includes(url.origin))values.push(url.origin);
    }catch{/* Invalid optional advertisement values are ignored. */}
  };
  add(process.env.CLAUDEX_WORKHOUSE_BOOTSTRAP_ORIGIN);
  let externalIsLoopback=true;
  try{externalIsLoopback=["127.0.0.1","localhost","::1"].includes(new URL(externalOrigin).hostname);}catch{}
  if(!externalIsLoopback)add(externalOrigin);
  if(host==="0.0.0.0"){
    for(const interfaces of Object.values(os.networkInterfaces())){
      for(const item of interfaces??[]){
        if(item.internal||item.family!=="IPv4")continue;
        add(`http://${item.address}:${port}`);
      }
    }
  }
  if(externalIsLoopback)add(externalOrigin);
  add(`http://127.0.0.1:${port}`);
  return values;
}
function packageVersion(root:string){
  const configured=process.env.CLAUDEX_WORKHOUSE_VERSION?.trim();
  if(configured&&configured!=="unknown")return configured;
  try{
    const value=JSON.parse(fs.readFileSync(path.join(root,"app","package.json"),"utf8"));
    return typeof value.version==="string"&&value.version.trim()?value.version:"unknown";
  }catch{return"unknown";}
}
function installMethod(){
  const configured=process.env.CLAUDEX_WORKHOUSE_INSTALL_METHOD?.trim();
  if(configured)return configured;
  const root=process.env.CLAUDEX_WORKHOUSE_APP_ROOT?.trim()||process.env.CLAUDEX_WORKHOUSE_ROOT?.trim()||process.cwd();
  if(fs.existsSync(path.join(root,".git")))return"source-checkout";
  // A container swaps its own image, so the container check wins even when the
  // server inside it was installed from the registry.
  if(fs.existsSync("/.dockerenv")||fs.existsSync("/run/.containerenv"))return"docker-compose";
  return isNodePackageInstall()?"node-package":"unknown";
}
// `npm install -g claudex-workhouse` places this module under a node_modules
// directory owned by the package. Reading the running module's own path keeps
// the detection independent of the working directory the service was started
// from, which for a global install is wherever the user happened to be.
function isNodePackageInstall(){
  try{
    const parts=path.dirname(url.fileURLToPath(import.meta.url)).split(path.sep);
    return parts.some((part,index)=>part==="node_modules"&&parts[index+1]==="claudex-workhouse");
  }catch{return false;}
}
function deploymentPlatform(){
  const configured=process.env.CLAUDEX_WORKHOUSE_DEPLOYMENT_PLATFORM?.trim();
  if(["synology","qnap","docker-nas","linux"].includes(configured??""))return configured!;
  return process.platform;
}
function configuredHostRoles(){
  const configured=process.env.CLAUDEX_WORKHOUSE_HOST_ROLES?.split(",").map(value=>value.trim()).filter(Boolean);
  const roles:Array<"main-server"|"worker">=["main-server"];
  if(!configured||configured.includes("worker"))roles.push("worker");
  return roles;
}
function localNetworkHostname(hostname:string){
  const value=hostname.toLowerCase();
  if(["127.0.0.1","localhost","::1"].includes(value)||value.endsWith(".local")||!value.includes("."))return true;
  const octets=value.split(".").map(Number);
  return octets.length===4&&octets.every(part=>Number.isInteger(part)&&part>=0&&part<=255)&&(
    octets[0]===10||
    (octets[0]===172&&octets[1]>=16&&octets[1]<=31)||
    (octets[0]===192&&octets[1]===168)
  );
}
function readTrustedJson(configuredPath:string|undefined,root:string,kind:"release"|"worker"){
  const configured=configuredPath?.trim();
  if(!configured)return null;
  const file=path.isAbsolute(configured)?path.normalize(configured):path.resolve(root,configured);
  try{
    const stat=fs.statSync(file);
    if(!stat.isFile()||stat.size<2||stat.size>1024*1024)throw new Error("not a bounded regular file");
    return JSON.parse(fs.readFileSync(file,"utf8")) as unknown;
  }catch{
    throw Object.assign(new Error(`Trusted ${kind} metadata is configured but cannot be read or parsed.`),{
      statusCode:503,
      code:kind==="release"?"RELEASE_METADATA_INVALID":"WORKER_PACKAGE_METADATA_INVALID"
    });
  }
}

// The long-lived server may be launched from an agent task during an update.
// Never let that parent task's capability become ambient authority for workers
// created by the server; every provider task receives a fresh scoped identity.
for(const name of["CLAUDEX_WORKHOUSE_CURRENT_TASK_ID","CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_MCP_URL","CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_TOKEN","CLAUDEX_WORKHOUSE_EXTERNAL_MCP_BUNDLE_FILE"])delete process.env[name];
const config = loadConfig();
const managedLocalWorkerRequired=managedLocalWorkerEnabled();
const executionHostUsesWorker=(hostId:string)=>platformExecutionHostUsesWorker(hostId);
/**
 * Runs a Codex session-store operation where the runtime actually lives.
 *
 * On Windows the managed local Worker owns the Codex runtime, so the server's
 * own provider adapter has nothing to talk to. Every one of these endpoints
 * used to answer `WINDOWS_PROVIDER_DISCOVERY_PENDING` for that reason, which
 * disabled session browsing, resume, fork, archive and delete wholesale. They
 * now execute over the Worker's allowlisted `provider.thread.command`, and the
 * blanket refusal is gone: an endpoint either works or reports a specific
 * provider-level reason.
 */
const CODEX_THREAD_OPERATIONS:Record<string,string>={"thread/list":"list","thread/search":"search","thread/read":"read","thread/fork":"fork","thread/archive":"archive","thread/unarchive":"unarchive","thread/delete":"delete"};
ensureRuntimeDirectories(config);
applyManagedTempEnvironment(config);
let snapshotStartupError:string|null=null;
try{createAutomaticDatabaseBackup(config.dataRoot,config.dbPath,new Date(),7,{appRoot:config.appRoot});}catch(error){snapshotStartupError=sanitizeSensitiveText(error instanceof Error?error.message:String(error));}
const idempotencyOwner=crypto.randomUUID();
// The build copies the Python worker next to the compiled server, and that is
// the only copy a distributed install has — `app/src` is not shipped. Prefer
// the built one and keep the source path as the development fallback, so a
// packaged server never depends on a checkout being present on the host.
const builtDbWorker=path.join(config.appRoot,"app","dist-server","db","sqlite-worker.py");
const dbWorker = fs.existsSync(builtDbWorker)?builtDbWorker:path.join(config.appRoot, "app", "src", "server", "db", "sqlite-worker.py");
const nodeDbWorker=path.join(config.appRoot,"app","dist-server","db","sqlite-worker.mjs");
const databasePreexisted=fs.existsSync(config.dbPath)&&fs.statSync(config.dbPath).size>0;
const db = new DeckDatabase(dbWorker,config.dbPath,{nodeWorkerPath:nodeDbWorker});
const mcpSecretStore=new McpSecretStore(config.dataRoot);
let mcpSettingsSaveQueue:Promise<void>=Promise.resolve();
function serializeMcpSettingsSave<T>(operation:()=>Promise<T>){const result=mcpSettingsSaveQueue.then(operation,operation);mcpSettingsSaveQueue=result.then(()=>{},()=>{});return result;}
const storedTempRoots=(value:unknown):RuntimeTempKnownRoot[]=>{
  if(!value||typeof value!=="object"||!Array.isArray((value as any).roots))return[];
  return(value as any).roots.flatMap((item:any)=>typeof item?.root==="string"&&path.isAbsolute(item.root)&&Array.isArray(item.workspaceIds)
    ?[{root:item.root,workspaceIds:item.workspaceIds.filter((id:unknown):id is string=>typeof id==="string").slice(0,100)}]
    :[]).slice(0,100);
};
const loadTempStorageContext=async()=>{
  const [tasks,workspaces,setting]=await Promise.all([db.listTasks(),db.listWorkspaces({hostId:LOCAL_HOST_ID}),db.getSystemSetting("infrastructure.temp-roots")]);
  return{tasks,workspaces,knownRoots:storedTempRoots(setting?.value)};
};
const tempStorage=new RuntimeTempStorageManager({
  primaryRoot:config.tempDir,
  workhouseRoot:config.dataRoot,
  onRootsChanged:roots=>db.putSystemSetting("infrastructure.temp-roots",{version:1,roots},new Date().toISOString()).then(()=>undefined)
});
const artifactRegistry=new ArtifactRegistry(db,config.tempDir);
// A fresh SQLite database performs the complete schema bootstrap before the
// worker can answer its first request. Slow NAS storage can legitimately take
// longer than the normal per-request watchdog, so give only this startup probe
// a wider bound while keeping runtime requests fail-fast.
await db.ping(60_000);
await artifactRegistry.reconcile(await db.listTasks(),await db.listWorkspaces({includeArchived:true}));
// History scans are CPU- and payload-heavy on NAS SQLite builds without FTS5.
// Keep them on a separate worker so a slow or abandoned search cannot block
// task state, workspace, collaboration, or quota writes on the primary worker.
const historyDb=new DeckDatabase(dbWorker,config.dbPath,{nodeWorkerPath:nodeDbWorker,maxPending:8});
await historyDb.ping(60_000);
const recoveryStartupAt=new Date().toISOString();
for(const attempt of await db.recoverTaskRecoveryAttempts(recoveryStartupAt)){
  if(attempt.status==="failed")await db.appendAudit({createdAt:recoveryStartupAt,actor:"system",action:"task-recovery-reconcile",provider:null,taskId:attempt.sourceTaskId,projectId:null,outcome:"failed",detail:attempt.error});
}
let integratedReleaseService:ReleaseService|null=null,integratedReleaseConfigurationError:unknown=null;
try{
  const releaseConfig=releaseServiceConfigFromEnvironment(config.appRoot);
  if(releaseConfig)integratedReleaseService=new ReleaseService(releaseConfig,db);
}catch(error){integratedReleaseConfigurationError=error;}
const applicationUpdateEvents=new EventEmitter();applicationUpdateEvents.setMaxListeners(100);
const applicationInstallMetadata=normalizeApplicationInstallMetadata({
  version:packageVersion(config.appRoot),
  installMethod:installMethod(),
  platform:process.platform,
  architecture:process.arch,
  imageDigest:process.env.CLAUDEX_WORKHOUSE_IMAGE_DIGEST,
  packageSha256:process.env.CLAUDEX_WORKHOUSE_PACKAGE_SHA256,
  updaterProtocolVersion:Number(process.env.CLAUDEX_WORKHOUSE_UPDATER_PROTOCOL_VERSION?.trim()||"1")
});
async function applicationUpdateBlockers():Promise<ApplicationUpdateBlocker[]>{
  const [tasks,sessions,maintenance,activeUpdate]=await Promise.all([db.listTasks(),db.listCollaborationSessions(false),db.getSystemSetting("infrastructure.maintenance").catch(()=>null),db.getActiveApplicationUpdateAttempt()]);
  return collectApplicationUpdateBlockers({tasks,sessions,maintenance:maintenance?.value,activeUpdate});
}
const applicationUpdates=new ApplicationUpdateCoordinator({
  current:applicationInstallMetadata,
  release:async()=>{const verified=await verifiedIntegratedRelease();if(!verified)throw Object.assign(new Error("Signed application update channel is not configured."),{statusCode:409,code:"APPLICATION_UPDATE_UNCONFIGURED"});return verified;},
  store:db,
  blockers:applicationUpdateBlockers,
  snapshot:async(attemptId,current)=>createApplicationUpdateSnapshot({attemptId,snapshotRoot:config.snapshotDir,dataRoot:config.dataRoot,dbPath:config.dbPath,metadata:current,appRoot:config.appRoot,platform:process.platform}),
  writeRequest:request=>writeApplicationUpdateRequest(path.join(config.dataRoot,"runtime","application-updates","requests"),request)
});
const applicationUpdateResultsDirectory=path.join(config.dataRoot,"runtime","application-updates","results");
await reconcileApplicationUpdateResults(applicationUpdateResultsDirectory,db).catch(()=>({processed:0,rejected:1}));
const [startupTasks,startupProjects,storedSetup,storedOwner,storedInstallationIdentity,startupHosts]=await Promise.all([
  db.listTasks(),
  db.listProjects(),
  db.getSystemSetting("setup.progress").catch(()=>null),
  db.getSystemSetting("owner.claim").catch(()=>null),
  db.getSystemSetting("installation.identity").catch(()=>null),
  db.listHosts().catch(()=>[])
]);
const existingInstallation=Boolean(
  databasePreexisted||
  storedOwner||
  storedSetup||
  startupTasks.length||
  startupProjects.length||
  startupHosts.length
);
const storedInstallationId=typeof storedInstallationIdentity?.value?.id==="string"?storedInstallationIdentity.value.id:null;
const ownerInstallationId=typeof storedOwner?.value?.installationId==="string"?storedOwner.value.installationId:null;
const installationId=storedInstallationId??ownerInstallationId??config.installationId??crypto.randomUUID();
if(storedInstallationId!==installationId){
  await db.putSystemSetting("installation.identity",{id:installationId,version:1},new Date().toISOString());
}
const forceOwnerClaim=["1","true","required"].includes(String(process.env.CLAUDEX_WORKHOUSE_OWNER_CLAIM??"").toLowerCase());
const ownerClaim=new OwnerClaimManager({
  root:config.dataRoot,
  db,
  installationId,
  serverUrls:bootstrapServerUrls(config.host,config.port,config.externalOrigin),
  forceRequired:forceOwnerClaim,
  existingInstallation,
  intendedRoles:configuredHostRoles()
});
await ownerClaim.initialize();
let snapshots:SnapshotStore|null=null;
try{snapshots=new SnapshotStore(config.snapshotDir,db,config.dataRoot);const retention=await snapshots.applyAutomaticRetention();if(retention.errors)snapshotStartupError=`${retention.errors} snapshot staging or catalog item(s) need attention.`;await snapshots.purgeExpired();}catch(error){snapshotStartupError=sanitizeSensitiveText(error instanceof Error?error.message:String(error));}
function requireSnapshots(){if(!snapshots)throw Object.assign(new Error("Snapshot storage is unavailable."),{statusCode:503,code:"SNAPSHOT_UNAVAILABLE"});return snapshots;}
let refreshModelCatalogsAfterRuntimeUpdate:()=>Promise<void>=async()=>{};
const runtimeUpdates=new RuntimeUpdateCoordinator({
  root:config.appRoot,
  dataRoot:config.dataRoot,
  load:async()=>(await db.getSystemSetting("runtime.auto-update"))?.value??null,
  save:async(value)=>{await db.putSystemSetting("runtime.auto-update",value,new Date().toISOString());},
  onUpdated:async(provider)=>{if(provider==="codex")resetCodexAppServerPool();await refreshModelCatalogsAfterRuntimeUpdate().catch(()=>{});await db.appendAudit({createdAt:new Date().toISOString(),actor:"system",action:`${provider}-runtime-auto-update`,provider,taskId:null,projectId:null,outcome:"success",detail:"automatic runtime update completed"});}
});
await runtimeUpdates.initialize();
const claudeModelCatalog=new ClaudeModelCatalog(config,db);
const storedPathDisplay=await db.getSystemSetting("ui.hide-local-paths").catch(()=>null);
const generatedDefault=storedPathDisplay?.value?.migratedDefault;
let hideLocalPaths=typeof storedPathDisplay?.value?.enabled==="boolean"?storedPathDisplay.value.enabled:existingInstallation?false:config.authMode!=="local";
if(!storedPathDisplay||(generatedDefault&&Number(storedPathDisplay.value?.version??0)<2)){
  hideLocalPaths=existingInstallation?false:config.authMode!=="local";
  await db.putSystemSetting("ui.hide-local-paths",{enabled:hideLocalPaths,version:2,migratedDefault:existingInstallation?"existing-private-install-visible":"new-public-install-hidden"},new Date().toISOString());
}
const hostWorkspaces = new HostWorkspaceManager(config,db);
const githubLogin=new GitHubLoginManager();
const localMigration = await hostWorkspaces.initializeLocal();
if(managedLocalWorkerRequired){
  const local=await db.getHost(LOCAL_HOST_ID);
  if(local)await db.upsertHost({...local,status:"connecting",updatedAt:new Date().toISOString(),capabilities:{...local.capabilities,managedLocal:true,directProviderLaunch:false}});
}
for(const host of await db.listHosts()){
  if(host.type==="worker"&&!host.disabledAt&&!host.revokedAt)await db.upsertHost({...host,status:"offline",updatedAt:new Date().toISOString()});
}
for(let index=0;index<startupTasks.length;index++){
  const task=startupTasks[index];
  if(task.executionHostId&&executionHostUsesWorker(task.executionHostId)&&["pending","queued","running","waiting"].includes(task.status)){
    startupTasks[index]=await db.upsertTask({...task,status:"unknown",metadata:{...task.metadata,lastKnownStatus:task.status,recoveryState:"awaiting-worker-snapshot"}});
  }
}
const provenCodexTasks = new Set(await db.provenTaskIds());
const startupImagesByThread=new Map<string,unknown[]>();
for (const initialTask of await db.listProviderTasks("codex")) {
  let task=initialTask;
  // Native workers have a server-generated marker that external Codex/cx
  // sessions never receive. Keep that proof across server restarts even when
  // an older audit action name is absent or audit retention changes.
  const nativeWorker = task.commandMarker?.startsWith("claudex-workhouse-codex:") === true;
  const ownership = nativeWorker || provenCodexTasks.has(task.id) ? "claudex-workhouse" : task.nativeId.startsWith("task-") ? "external-cx" : "unknown";
  const source = ownership === "claudex-workhouse" ? "claudex-workhouse" : ownership === "external-cx" ? "cx" : "unknown";
  if (task.ownership !== ownership || task.source !== source || task.owned !== (ownership === "claudex-workhouse")) {
    task=await db.upsertTask({ ...task, ownership, source, owned:ownership === "claudex-workhouse", jobId:task.nativeId.startsWith("task-") ? task.nativeId : task.jobId ?? null });
  }
  let replayImages:unknown[]=[];
  if(nativeWorker)try{
    const replay=readStreamEvents(config.dataRoot,task.id,0,STREAM_REPLAY_LIMIT).events;
    const recovered=replay.map((event:any)=>{
      if(event?.type!=="tool_completed"||event?.metadata?.itemType!=="imageGeneration"||event?.metadata?.mediaKind==="image"||!event?.itemId||!task.threadId)return event;
      const media=captureTaskImageOutput({root:config.dataRoot,taskId:task.id,threadId:task.threadId,item:{type:"imageGeneration",id:event.itemId}});
      return{...event,metadata:{...event.metadata,...media}};
    });
    replayImages=persistedImageOutputsFromEvents(recovered,{sourceTaskId:task.id,workspaceId:task.workspaceId});
  }catch{}
  const imageOutputs=mergePersistedImageOutputs(task.metadata?.imageOutputs,replayImages);
  if(JSON.stringify(imageOutputs)!==JSON.stringify(task.metadata?.imageOutputs??[]))task=await db.upsertTask({...task,metadata:{...task.metadata,imageOutputs}});
  if(task.threadId&&imageOutputs.length)startupImagesByThread.set(task.threadId,[...(startupImagesByThread.get(task.threadId)??[]),...imageOutputs]);
}
for(const[threadId,outputs]of startupImagesByThread){
  const stored=await db.getCodexThread(threadId).catch(()=>null);if(!stored)continue;
  const imageOutputs=mergePersistedImageOutputs(stored.metadata?.imageOutputs,outputs);
  if(JSON.stringify(imageOutputs)!==JSON.stringify(stored.metadata?.imageOutputs??[]))await db.upsertCodexThread({...stored,metadata:{...stored.metadata,imageOutputs}});
}

const providers = new Map<ProviderId, AgentProvider>();
const codexProvider=new CodexProvider(config, db);
const claudeProvider=new ClaudeProvider(config, db);
const deepseekProvider=new AnthropicCompatibleProvider("deepseek",config,db);
const ollamaProvider=new AnthropicCompatibleProvider("ollama",config,db);
const antigravityProvider=new AntigravityProvider(config,db);
const grokProvider=new GrokProvider(config,db);
providers.set("codex", codexProvider);
providers.set("claude", claudeProvider);
providers.set("antigravity",antigravityProvider);
providers.set("deepseek",deepseekProvider);
providers.set("ollama",ollamaProvider);
providers.set("grok",grokProvider);
// Claude's first paint is seeded from startupTasks. Give persisted Codex
// threads the same lifecycle so a cold native app-server never gates the
// browser's initial session list.
void codexProvider.warmThreadSnapshots(startupTasks).catch(()=>{});
claudeProvider.warmTaskSnapshot(startupTasks);
await claudeProvider.excludeOwnedProviderSessions(startupTasks);
deepseekProvider.warmTaskSnapshot(startupTasks);
ollamaProvider.warmTaskSnapshot(startupTasks);
antigravityProvider.warmTaskSnapshot(startupTasks);
grokProvider.warmTaskSnapshot(startupTasks);
const localEntryToken=process.env.CLAUDEX_WORKHOUSE_ENTRY_TOKEN;
delete process.env.CLAUDEX_WORKHOUSE_ENTRY_TOKEN;
const localEntry=new LocalEntryAuth({authMode:config.authMode,entryToken:localEntryToken});
const authenticate = createAuthenticator(config,{localEntry});
cleanupStreamEvents(config.dataRoot);
let streamConnections = 0;
const taskStreamConnections = new Map<string,number>();
const MAX_TASK_STREAMS = 24;
const MAX_COLLABORATION_STREAMS = 12;
let taskListSnapshot:DeckTask[]=startupTasks;
let taskListSynchronization:Promise<any>|null=null;
let taskListSnapshotRevision=1;
const taskListSnapshotMutations:Array<{revision:number;mutation:TaskSnapshotMutation}>=[];
const TASK_LIST_JOURNAL_LIMIT=4096;
const taskListSnapshotJournal:Array<{revision:number;mutation:TaskSnapshotMutation}>=[];
let taskListSnapshotJournalFloor=0;
const appendTaskListJournal=(revision:number,mutation:TaskSnapshotMutation)=>{
  taskListSnapshotJournal.push({revision,mutation});
  while(taskListSnapshotJournal.length>TASK_LIST_JOURNAL_LIMIT){const removed=taskListSnapshotJournal.shift();if(removed)taskListSnapshotJournalFloor=Math.max(taskListSnapshotJournalFloor,removed.revision);}
};
const recordTaskListMutation=(mutation:TaskSnapshotMutation)=>{const revision=++taskListSnapshotRevision;taskListSnapshotMutations.push({revision,mutation});appendTaskListJournal(revision,mutation);};
const publishTaskSnapshots=(rows:DeckTask[],provider:ProviderId|undefined,afterRevision:number)=>{
  const previousRows=taskListSnapshot.filter(task=>!provider||task.provider===provider);
  const previous=new Map(previousRows.map(task=>[task.id,JSON.stringify(projectTaskListItem(task))]));
  const mutations=taskListSnapshotMutations.filter(entry=>entry.revision>afterRevision).map(entry=>entry.mutation);
  taskListSnapshot=reconcileTaskSnapshot(taskListSnapshot,rows,provider,mutations);
  const nextRows=taskListSnapshot.filter(task=>!provider||task.provider===provider),nextIds=new Set(nextRows.map(task=>task.id));
  const changed=nextRows.filter(task=>previous.get(task.id)!==JSON.stringify(projectTaskListItem(task)));
  const removed=previousRows.filter(task=>!nextIds.has(task.id));
  if(changed.length||removed.length){const revision=++taskListSnapshotRevision;for(const task of changed)appendTaskListJournal(revision,{kind:"upsert",task});for(const task of removed)appendTaskListJournal(revision,{kind:"delete-task",provider:task.provider,taskId:task.id});}
  taskListSnapshotMutations.length=0;
};
const publishTaskSnapshot=(task:DeckTask)=>{
  const sessionId=task.providerSessionId??task.threadId;
  if(task.owned&&sessionId&&(task.provider==="deepseek"||task.provider==="ollama")){
    const mirrorId=`claude:external:${sessionId}`,mirror=taskListSnapshot.find(item=>item.id===mirrorId);
    taskListSnapshot=taskListSnapshot.filter(item=>item.id!==mirrorId);
    if(mirror)recordTaskListMutation({kind:"delete-task",provider:mirror.provider,taskId:mirror.id});
  }
  const previous=taskListSnapshot.find(item=>item.id===task.id),changed=!previous||JSON.stringify(projectTaskListItem(previous))!==JSON.stringify(projectTaskListItem(task));
  taskListSnapshot=upsertTaskRows(taskListSnapshot,[task]);if(changed)recordTaskListMutation({kind:"upsert",task});return task;
};

function limited<T>(promise:Promise<T>,timeoutMs:number,label:string):Promise<T>{
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Object.assign(new Error(`${label} timed out.`),{statusCode:503,code:"database_busy"})),timeoutMs);timer.unref?.();promise.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});});
}

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info", redact: ["req.headers.cookie", "req.headers.cf-access-jwt-assertion", "req.headers.authorization", "req.body.token", "req.body.claimToken", "req.body.ownerCredential", "req.body.pairingCode"],serializers:{req(request:any){return{method:request.method,url:sanitizeSensitiveText(request.url),host:request.hostname,remoteAddress:request.ip,remotePort:request.socket?.remotePort};},err(error:any){return sanitizeSensitiveObject(error);}} }, bodyLimit: 65536, trustProxy: false });
const sweepTempStorage=async()=>{
  try{
    const {tasks,workspaces,knownRoots}=await loadTempStorageContext();
    const result=await tempStorage.sweep(tasks,workspaces,knownRoots);
    if(result.deleted.length||result.failed.length)app.log.info({deleted:result.deleted.length,failed:result.failed.length,freedBytes:result.freedBytes},"managed temporary storage sweep completed");
  }catch(error){
    app.log.warn({err:sanitizeSensitiveObject(error)},"managed temporary storage sweep failed");
  }
};
const requestDatabaseTraces=new WeakMap<FastifyRequest,{startedAt:number;trace:DatabaseRequestTrace}>();
app.addHook("onRequest",(request,_reply,done)=>{
  const state={startedAt:Date.now(),trace:{operations:[],totalMs:0} satisfies DatabaseRequestTrace};
  requestDatabaseTraces.set(request,state);
  runWithDatabaseRequestTrace(state.trace,done);
});
app.addHook("onResponse",async(request,reply)=>{
  const state=requestDatabaseTraces.get(request),totalMs=state?Date.now()-state.startedAt:reply.elapsedTime;
  if(totalMs<5000)return;
  const clientRequestId=String(request.headers["x-claudex-request-id"]??"");
  request.log.warn({
    endpoint:request.routeOptions.url,
    method:request.method,
    url:sanitizeSensitiveText(request.url),
    requestId:request.id,
    clientRequestId:clientRequestId||null,
    caller:String(request.headers["x-claudex-request-caller"]??"")||null,
    dbOperations:state?.trace.operations??[],
    dbTotalMs:state?.trace.totalMs??0,
    totalMs
  },"slow request");
});
const requestPathname=(request:Pick<FastifyRequest,"url">)=>{
  try{return new URL(request.url,"http://claudex.invalid").pathname;}catch{return request.url.split("?")[0]??request.url;}
};
const unauthenticatedHealthRequest=(request:any)=>{
  const pathname=requestPathname(request);
  if(pathname==="/api/health/live"||pathname==="/health/live"||pathname==="/api/health/ready"||pathname==="/health/ready")return true;
  return localEntryPublicRequest(request);
};
// Authentication must run before the limiter builds its key. The previous
// preHandler assignment happened after @fastify/rate-limit's onRequest hook,
// collapsing every proxied user into the same anonymous IP bucket.
app.addHook("onRequest",async(request)=>{
  if(!request.url.startsWith("/api/")||unauthenticatedHealthRequest(request))return;
  const access=ownerClaimApiAccess(requestPathname(request),ownerClaim.isClaimed());
  if(config.authMode==="local"){
    const actor=await authorizeLocalOwnerRequest(request,{entryRequired:localEntry.required,authenticate,access,ownerAuthenticate:item=>ownerClaim.authenticate(item),ownerHasCredential:()=>ownerClaim.hasCredential()});
    if(actor)(request as any).actor=actor;
    return;
  }
  if(access==="public")return;
  if(access==="blocked")throw Object.assign(new Error("Complete the one-time owner claim before using the management API."),{statusCode:428,code:"OWNER_CLAIM_REQUIRED"});
  (request as any).actor=await authenticate(request);
});
// A single visible conversation legitimately maintains SSE plus lightweight
// approval, user-input, task and session reconciliation. Keep the global guard
// above that steady-state read traffic; sensitive mutations retain their lower
// route-specific limits below.
await app.register(rateLimit, { max: 180, timeWindow: "1 minute", allowList:bypassGlobalRateLimit, keyGenerator:globalRateLimitKey });
await app.register(fastifyMultipart, { limits: { fileSize: MAX_BROWSER_UPLOAD_BYTES, files: 5, fields: 5, fieldSize:20_000 } });
await app.register(fastifyWebsocket,{options:{maxPayload:1024*1024,perMessageDeflate:false}});
const workerHub=new WorkerHub(db,config.dataRoot);
// On Windows the managed local Worker owns the Codex runtime, so every Codex
// session-store request has to execute there. Redirecting the transport once,
// here, is what replaced the blanket `WINDOWS_PROVIDER_DISCOVERY_PENDING`
// refusal that used to disable session browsing, resume, fork, archive and
// delete on that platform.
if(managedLocalWorkerRequired)setCodexAppServerDelegate(async(method,params,timeoutMs)=>{
  const operation=CODEX_THREAD_OPERATIONS[method];
  if(!operation)throw Object.assign(new Error(`Codex ${method} is not available through the local Provider Worker.`),{statusCode:409,code:"PROVIDER_SESSION_OPERATION_UNSUPPORTED"});
  if(!workerHub.isOnline(LOCAL_HOST_ID))throw Object.assign(new Error("The local Provider Worker is offline. Start it to browse Provider sessions."),{statusCode:503,code:"LOCAL_WORKER_OFFLINE"});
  const response=await workerHub.request(LOCAL_HOST_ID,"provider.thread.command",{provider:"codex",operation,params},crypto.randomUUID(),Math.max(5_000,Math.min(60_000,timeoutMs??30_000))) as any;
  return response?.result;
});
await workerHub.register(app);
let managedLocalWorker:DesktopWorkerClient|null=null;
let managedLocalWorkerConfig:import("./desktop-worker/config.js").WorkerConfig|null=null;
// One `provider.status.read` snapshot serves every reader.
//
// `/api/setup` alone used to fire two of them — one through the runtime list
// and one through the connection accounts — and `/api/runtime-updates` and
// `/api/provider-connections` each fired a third and a fourth. Every one of
// those runs the Worker's serial version-then-authentication probe chain, so a
// single screen load could queue four chains behind one Worker while the
// client's own 15s budget expired underneath them. Caching the whole response
// rather than only the readiness slice, and joining callers onto one in-flight
// request, makes a concurrent burst cost exactly one RPC.
const providerStatusCache=new ProviderStatusCache({
  read:()=>workerHub.request(LOCAL_HOST_ID,"provider.status.read",{}) as Promise<Record<string,any>|null>,
  available:()=>managedLocalWorkerRequired&&workerHub.isOnline(LOCAL_HOST_ID)
});
const invalidateProviderStatus=()=>providerStatusCache.invalidate();
const runtimeMutation=<T>(action:()=>Promise<T>)=>providerStatusCache.duringMutation(action);
const workerProviderStatus=()=>providerStatusCache.get();
async function managedProviderReadiness(){
  const status=await workerProviderStatus();
  return status?.readiness&&typeof status.readiness==="object"?status.readiness:{};
}
async function refreshManagedLocalWorkerConfig(){
  if(!managedLocalWorkerConfig)return;
  syncManagedLocalWorkerConfig(managedLocalWorkerConfig,await db.listWorkspaceRoots(LOCAL_HOST_ID),await db.listWorkspaces({hostId:LOCAL_HOST_ID,includeArchived:true}));
  saveWorkerConfig(managedLocalWorkerConfig);
}
const collaborationEvents=new CollaborationEventBus(config.dataRoot);
const relayArtifacts=new RelayArtifactStore(config.dataRoot,db);
const emotion = new EmotionWatcher(config.emotionStateFile,config.emotionAssetsDir,process.platform,"normal",PROVIDER_EMOTION_OUTFITS.claude,"claude");
const codexEmotion = new EmotionWatcher(path.join(path.dirname(config.emotionStateFile), "codex-state.json"),config.emotionAssetsDir,process.platform,"Gpt-Sol",PROVIDER_EMOTION_OUTFITS.codex,"codex");
const deepseekEmotion = new EmotionWatcher(path.join(path.dirname(config.emotionStateFile), "deepseek-state.json"),config.emotionAssetsDir,process.platform,"DeepSeek",PROVIDER_EMOTION_OUTFITS.deepseek,"deepseek");
const ollamaEmotion = new EmotionWatcher(path.join(path.dirname(config.emotionStateFile), "ollama-state.json"),config.emotionAssetsDir,process.platform,"Ollama",PROVIDER_EMOTION_OUTFITS.ollama,"ollama");
const antigravityEmotion = new EmotionWatcher(path.join(path.dirname(config.emotionStateFile), "antigravity-state.json"),config.emotionAssetsDir,process.platform,"Antigravity",PROVIDER_EMOTION_OUTFITS.antigravity,"antigravity");
const grokEmotion=new EmotionWatcher(path.join(path.dirname(config.emotionStateFile),"grok-state.json"),config.emotionAssetsDir,process.platform,"Grok",PROVIDER_EMOTION_OUTFITS.grok,"grok");
const avatarSettings=new ProviderAvatarSettings(db,{codex:codexEmotion,claude:emotion,deepseek:deepseekEmotion,ollama:ollamaEmotion,antigravity:antigravityEmotion,grok:grokEmotion});
await avatarSettings.reconcile();
const collaboration=new CollaborationOrchestrator(db,providers,workerHub,collaborationEvents,relayArtifacts,async(participant)=>{
  const workspace=await db.getWorkspace(participant.workspaceId);if(!workspace||workspace.hostId!==participant.executionHostId)throw Object.assign(new Error("Collaboration workspace is unavailable."),{statusCode:409});
  const status:any=workspace.hostId===LOCAL_HOST_ID?await hostWorkspaces.gitStatus(workspace.id):await workerHub.request(workspace.hostId,"workspace.git.status",{workspaceId:workspace.id});
  let diffChecksum:string|null=null;
  if(status?.repository){try{if(workspace.hostId===LOCAL_HOST_ID){const diff=await hostWorkspaces.gitDiff(workspace.id);diffChecksum=crypto.createHash("sha256").update(diff.diff).digest("hex");}else diffChecksum=crypto.createHash("sha256").update(JSON.stringify(status.changedFiles??[])).digest("hex");}catch{diffChecksum=crypto.createHash("sha256").update(JSON.stringify(status.changedFiles??[])).digest("hex");}}
  const leases=await db.listCollaborationLeases(workspace.id),generation=Math.max(0,...leases.filter((item:any)=>!item.releasedAt).map((item:any)=>Number(item.leaseGeneration)||0));
  return{sourceCommit:status?.commit??null,sourceBranch:status?.branch??null,dirty:Boolean(status?.dirty),changedFiles:Array.isArray(status?.changedFiles)?status.changedFiles.map(String).slice(0,1000):[],diffChecksum,leaseGeneration:generation||null,snapshotAt:new Date().toISOString()};
},()=>emotion.getMode(),async({provider:providerId})=>assertPaidCreditConsent([providerId]),async({workspaceId,relativePath,content})=>{
  const workspace=await hostWorkspaces.requireWorkspace(workspaceId);
  if(workspace.hostId!==LOCAL_HOST_ID)throw Object.assign(new Error("Conversation Markdown creation is currently available on the local execution host only."),{statusCode:409,code:"REMOTE_MARKDOWN_UNAVAILABLE"});
  return hostWorkspaces.createWorkspaceMarkdown(workspaceId,relativePath,content);
},outfit=>emotion.assetCatalog()[outfit]??[],providerId=>({codex:codexEmotion,claude:emotion,deepseek:deepseekEmotion,ollama:ollamaEmotion,antigravity:antigravityEmotion,grok:grokEmotion}[providerId].get().outfit));
const featureHealth={core:{tier:"guaranteed",status:"ready"},collaboration:{tier:"advanced",status:"ready",recoveryError:null as string|null},handoff:{tier:"advanced",status:"ready"},conversation:{tier:"experimental",status:"ready"},character:{tier:"experimental",status:"ready"}};
async function isolatedCharacterPrompt(providerId:ProviderId,conversation=false,toneOverride?:{tonePreset:z.infer<typeof tonePreset>;customTone?:string}){try{const settings=normalizeCharacterSettings((await db.getSystemSetting("characters.providers"))?.value);return characterPrompt(toneOverride?characterSettingsWithTone(settings,providerId,toneOverride):settings,providerId,conversation);}catch(error){featureHealth.character.status="degraded";await db.appendAudit({createdAt:new Date().toISOString(),actor:"system",action:"character-module-fallback",provider:providerId,taskId:null,projectId:null,outcome:"degraded",detail:error instanceof Error?error.message:String(error)}).catch(()=>{});const settings=toneOverride?characterSettingsWithTone(DEFAULT_CHARACTER_SETTINGS,providerId,toneOverride):DEFAULT_CHARACTER_SETTINGS;return characterPrompt(settings,providerId,conversation);}}
async function currentUiLocale(){return normalizeStoredLocale((await db.getSystemSetting("ui.locale").catch(()=>null))?.value)??"ko";}
async function claudeRemoteExecutionSettings(providerId:ProviderId){if(providerId!=="claude")return{};const stored=await db.getSystemSetting("claude.execution").catch(()=>null);return{claudeSwitchModelsOnFlag:normalizeClaudeExecutionSettings(stored?.value).switchModelsOnFlag};}
const handoffs=new HandoffManager(config.dataRoot,db,hostWorkspaces,workerHub,async({source,targetHostId,targetWorkspace,targetProvider,targetModel,targetReasoningEffort,targetServiceTier,prompt,kind,artifactId,locale})=>{
  const reviewOnly=kind!=="continue",suffix=reviewOnly?{en:"Review",ko:"검토",ja:"レビュー"}[locale]:{en:"Handoff",ko:"인계",ja:"引き継ぎ"}[locale],title=`${source.title} · ${suffix}`,createdAt=new Date().toISOString(),level=reviewOnly?"read":automationLevel(source.metadata?.automationLevel,source.permissionProfile),permissionProfile=permissionForAutomation(targetProvider,level),instructionProfile=await workspaceInstructionProfile(targetWorkspace.id),workspaceInstructionSnapshot=await workspaceInstructionSnapshotFor(targetWorkspace,instructionProfile),providerPrompt=promptWithWorkspaceInstructions(prompt,workspaceInstructionSnapshot);
  if(!executionHostUsesWorker(targetHostId)){const project={id:targetWorkspace.projectId,name:targetWorkspace.displayName,path:targetWorkspace.canonicalPath,realPath:targetWorkspace.canonicalPath,enabled:true,error:null};const created=await provider(targetProvider).createTask({project,prompt:providerPrompt,title,model:targetModel,reasoningEffort:targetReasoningEffort,serviceTier:targetServiceTier,permissionProfile,automationLevel:level,executionHostId:LOCAL_HOST_ID,workspaceId:targetWorkspace.id});return db.upsertTask({...created,prompt,executionHostId:LOCAL_HOST_ID,workspaceId:targetWorkspace.id,providerSessionId:created.threadId,sourceSessionId:source.threadId??source.id,metadata:{...created.metadata,handoffArtifactId:artifactId,handoffKind:kind,workspaceInstructionSnapshot}});}
  if(targetProvider!=="codex"&&targetProvider!=="claude")throw Object.assign(new Error(`${targetProvider} handoff is unavailable on worker hosts.`),{statusCode:409,code:"REMOTE_PROVIDER_UNAVAILABLE"});
  if(targetHostId===LOCAL_HOST_ID)await refreshManagedLocalWorkerConfig();
  const id=`${targetProvider}:${targetHostId===LOCAL_HOST_ID?"worker":"remote"}:${crypto.randomUUID()}`,remote=await workerHub.request(targetHostId,"provider.task.start",{taskId:id,provider:targetProvider,workspaceId:targetWorkspace.id,prompt:providerPrompt,title,model:targetModel,reasoningEffort:targetReasoningEffort,serviceTier:targetServiceTier,permissionProfile,automationLevel:level,...await claudeRemoteExecutionSettings(targetProvider)}) as any;
  return db.upsertTask({id,provider:targetProvider,nativeId:String(remote?.hostTaskId??id),threadId:remote?.threadId??null,projectId:targetWorkspace.projectId,title,prompt,status:remote?.status??"running",createdAt,updatedAt:createdAt,result:null,error:null,log:"Remote handoff task started.",owned:true,pid:null,pgid:null,processStart:null,commandMarker:null,parentThreadId:source.threadId??source.id,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:targetHostId,workspaceId:targetWorkspace.id,remoteWorkerId:targetHostId,hostTaskId:String(remote?.hostTaskId??id),providerSessionId:remote?.threadId??null,sourceSessionId:source.threadId??source.id,requestedModel:targetModel,requestedReasoningEffort:targetReasoningEffort,requestedServiceTier:targetServiceTier,permissionProfile,metadata:{handoffArtifactId:artifactId,handoffKind:kind,automationLevel:level,workspaceInstructionSnapshot,...(remote?.executionPolicy?{requestedAutomation:remote.executionPolicy.requestedAutomation,effectiveSandbox:remote.executionPolicy.effectiveSandbox,effectiveApprovalPolicy:remote.executionPolicy.effectiveApprovalPolicy,executionBackend:remote.executionPolicy.executionBackend,executionUiLabel:remote.executionPolicy.uiLabel}:{})}});
});
const pushManager=new PushManager(config.dataRoot,db);
workerHub.onHostOffline(async hostId=>{
  const detectedAt=new Date().toISOString();
  for(const task of await db.listTasks())if(task.executionHostId===hostId&&["pending","queued","running","waiting","unknown"].includes(task.status))await db.upsertTask({...task,status:"unknown",updatedAt:detectedAt,metadata:{...task.metadata,lastKnownStatus:task.status,recoveryState:"awaiting-worker-snapshot",workerDisconnectedAt:detectedAt}});
  await pushManager.notifyHostOffline(hostId);
});

app.addHook("onSend", async (request, reply, payload) => {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Referrer-Policy", "no-referrer");
  reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  let frameAncestors="'none'";
  let scriptSrc="'self'";
  reply.header("Content-Security-Policy", `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors ${frameAncestors}; form-action 'self'`);
  if (request.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
  // Deployment artifacts are executable text generated from an operator's
  // explicit path choice. Applying display-only path masking would corrupt the
  // Compose files and Worker commands.
  const protonDriveResponse=request.url.startsWith("/api/proton-drive/")||request.url.startsWith("/api/system-settings/proton-drive")||request.url.includes("/proton-uploads/");
  if(hideLocalPaths&&request.url.startsWith("/api/")&&!request.url.includes("/events/stream")&&!request.url.startsWith("/api/deployment/")&&!protonDriveResponse){
    const text=Buffer.isBuffer(payload)?payload.toString("utf8"):typeof payload==="string"?payload:null;
    if(text&&/^[\[{]/.test(text.trim()))try{return JSON.stringify(applyPathDisplayPolicy(JSON.parse(text),true));}catch{/* Non-JSON and streamed bodies pass through unchanged. */}
  }
  return payload;
});
await app.register(fastifyCompress,{global:true,threshold:1024,encodings:["gzip"]});

app.addHook("preHandler", async (request) => {
  if (unauthenticatedHealthRequest(request)) return;
  if (!request.url.startsWith("/api/")) return;
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    const allowedOrigins=new Set([
      config.externalOrigin,
      ...ownerClaim.publicStatus().serverUrls,
      ...(config.authMode==="test"?["http://127.0.0.1:3410"]:[])
    ]);
    const bootstrapPublic=ownerClaimApiAccess(requestPathname(request),ownerClaim.isClaimed())==="public",nativeShareTarget=nativeShareTargetNavigation(request as any,allowedOrigins);
    if (!nativeShareTarget&&((!request.headers.origin&&!bootstrapPublic)||(request.headers.origin&&!allowedOrigins.has(request.headers.origin)))) {
      throw Object.assign(new Error("Origin is not allowed."), { statusCode: 403 });
    }
    if (!nativeShareTarget&&request.headers["sec-fetch-site"] && request.headers["sec-fetch-site"] !== "same-origin") throw Object.assign(new Error("Cross-site request rejected."), { statusCode: 403 });
    if (request.headers["x-claudex-workhouse-request"] !== "1"&&!nativeShareTarget) throw Object.assign(new Error("Missing request guard header."), { statusCode: 403 });
  }
});

const providerParam = z.enum(["codex", "claude", "deepseek", "ollama", "antigravity", "grok"]);
const authProviderParam = z.enum(["codex", "claude"]);
const connectionAuthProviderParam = z.enum(["codex", "claude", "antigravity", "grok"]);
const taskListQuery = z.object({
  provider:providerParam.optional(),
  scope:z.enum(["all"]).optional(),
  snapshot:z.enum(["true","false"]).transform(value=>value==="true").optional(),
  revision:z.coerce.number().int().nonnegative().optional()
});
const promptBody = z.object({ prompt: z.string().trim().min(1).max(config.promptMaxLength) });
const createBody = promptBody.extend({
  provider: providerParam, projectId: z.string().regex(/^[a-z0-9-]+$/), title: z.string().trim().max(100).optional(),
  executionHostId:z.string().min(1).max(100).optional(),workspaceId:z.string().min(1).max(100),
  model:z.string().min(1).max(100).nullable().optional(), reasoningEffort:z.string().min(1).max(30).nullable().optional(),
  serviceTier:z.string().min(1).max(50).nullable().optional(), permissionProfile:z.string().min(1).max(80).nullable().optional(), workMode:z.enum(["default","plan"]).optional(),automationLevel:z.enum(["full","auto","confirm","read"]).optional(),
  googleSearchMode:z.enum(["off","auto","always"]).optional(),
  dangerConfirmation:z.boolean().optional(),fullAccessAcknowledged:z.boolean().optional(),acknowledgementVersion:z.number().int().optional()
}).superRefine((value, context) => {
  if (value.provider !== "codex" && value.serviceTier) context.addIssue({ code:z.ZodIssueCode.custom, message:"Service tier is a Codex-only setting." });
  if (value.provider !== "antigravity" && value.googleSearchMode) context.addIssue({ code:z.ZodIssueCode.custom, message:"Google Search mode is an Antigravity-only setting." });
  if (value.provider !== "codex" && value.reasoningEffort && value.reasoningEffort !== "default" && (!ClaudeProvider.validEfforts.has(value.reasoningEffort) || value.provider === "antigravity" && !["low","medium","high"].includes(value.reasoningEffort))) context.addIssue({ code:z.ZodIssueCode.custom, message:"Unknown compatible-runtime reasoning effort." });
  if (value.provider !== "codex" && value.permissionProfile && !ClaudeProvider.validProfiles.has(value.permissionProfile)) context.addIssue({ code:z.ZodIssueCode.custom, message:"Unknown compatible-runtime permission profile." });
  if (value.provider === "codex" && value.permissionProfile && !isPermissionProfile("codex",value.permissionProfile)) context.addIssue({ code:z.ZodIssueCode.custom, message:"Unknown Codex permission profile." });
  if ((value.permissionProfile === ":danger-full-access"||value.automationLevel==="full") && !fullAccessAcknowledgementValid(value)) context.addIssue({ code:z.ZodIssueCode.custom, message:"Danger-full-access requires fullAccessAcknowledged=true and acknowledgementVersion=1." });
  if(value.provider!=="codex"&&value.automationLevel==="confirm")context.addIssue({code:z.ZodIssueCode.custom,message:"Confirm-then-run is not supported by this compatible runtime."});
});
type CreateTaskBody=z.infer<typeof createBody>;
const taskParams = z.object({ provider: providerParam, taskId: z.string().min(3).max(200).regex(/^[a-zA-Z0-9:._-]+$/) });
const threadParams = z.object({ threadId:z.string().uuid() });
const threadQuery = z.object({ cursor:z.string().uuid().optional(), limit:z.coerce.number().int().min(10).max(100).default(50), archived:z.enum(["true","false"]).transform((v)=>v==="true").optional(), projectId:z.string().regex(/^[a-z0-9-]+$/).optional(), source:z.string().max(40).optional(), ownership:z.enum(["claudex-workhouse","external-cx","external","unknown"]).optional(), status:z.string().max(30).optional(), model:z.string().max(100).optional(), search:z.string().trim().max(500).optional() });
const turnQuery = z.object({ cursor:z.string().max(1000).optional(), limit:z.coerce.number().int().min(1).max(20).default(10) });
const sessionLocationFields={projectId:z.string().regex(/^[a-z0-9-]+$/).optional(),workspaceId:z.string().min(1).max(100).optional()};
const codexSettingsFields = { model:z.string().min(1).max(100).nullable().optional(), reasoningEffort:z.string().min(1).max(30).nullable().optional(), serviceTier:z.string().min(1).max(50).nullable().optional(), permissionProfile:z.string().min(1).max(80).nullable().optional(), workMode:z.enum(["default","plan"]).optional(),automationLevel:z.enum(["full","auto","confirm","read"]).optional(), dangerConfirmation:z.boolean().optional(),fullAccessAcknowledged:z.boolean().optional(),acknowledgementVersion:z.number().int().optional(),...sessionLocationFields };
const fullAcknowledged=fullAccessAcknowledgementValid;
const codexSettings = z.object(codexSettingsFields).superRefine((v,c)=>{ if(v.permissionProfile&&!isPermissionProfile("codex",v.permissionProfile))c.addIssue({code:z.ZodIssueCode.custom,message:"Unknown Codex permission profile."});if((v.permissionProfile===":danger-full-access"||v.automationLevel==="full")&&!fullAcknowledged(v))c.addIssue({code:z.ZodIssueCode.custom,message:"Danger-full-access requires fullAccessAcknowledged=true and acknowledgementVersion=1."}); });
const codexMessageBody = z.object({ prompt:z.string().trim().min(1).max(config.promptMaxLength), ...codexSettingsFields }).superRefine((v,c)=>{ if(v.permissionProfile&&!isPermissionProfile("codex",v.permissionProfile))c.addIssue({code:z.ZodIssueCode.custom,message:"Unknown Codex permission profile."});if((v.permissionProfile===":danger-full-access"||v.automationLevel==="full")&&!fullAcknowledged(v))c.addIssue({code:z.ZodIssueCode.custom,message:"Danger-full-access requires fullAccessAcknowledged=true and acknowledgementVersion=1."}); });
const codex = providers.get("codex") as CodexProvider;
const claude = providers.get("claude") as ClaudeProvider;
const deepseek = providers.get("deepseek") as AnthropicCompatibleProvider;
const ollama = providers.get("ollama") as AnthropicCompatibleProvider;
const antigravity = providers.get("antigravity") as AntigravityProvider;
const grok=providers.get("grok")as GrokProvider;

const modelAnnouncements=new ModelCatalogAnnouncementCoordinator(async()=>(await db.getSystemSetting("models.catalog-announcements"))?.value??null,async value=>{await db.putSystemSetting("models.catalog-announcements",value,new Date().toISOString());});
await modelAnnouncements.initialize();
const unavailableCatalog=(source:string)=>({models:[],fetchedAt:new Date().toISOString(),stale:true,source});
const observeModelCatalog=(provider:ProviderId,snapshot:any)=>modelAnnouncements.observe(provider,{...snapshot,models:(snapshot.models??[]).filter((item:any)=>item.source!=="custom"&&item.id!=="default")}).catch(()=>null);
const currentModelCatalogs=createSharedLoader(async(force=false)=>{const[codexCatalog,claudeCatalog,deepseekCatalog,ollamaCatalog,antigravityCatalog,grokCatalog]=await Promise.all([codex.getModels(force),claudeModelCatalog.get(force),deepseek.getModelCatalog(force).catch(()=>unavailableCatalog("unavailable:deepseek")),ollama.getModelCatalog(force).catch(()=>unavailableCatalog("unavailable:ollama")),antigravity.getModelCatalog(force).catch(()=>unavailableCatalog("unavailable:antigravity")),grok.getModelCatalog(force).catch(()=>unavailableCatalog("unavailable:grok"))]);const snapshots={codex:codexCatalog,claude:claudeCatalog,deepseek:deepseekCatalog,ollama:ollamaCatalog,antigravity:antigravityCatalog,grok:grokCatalog};await Promise.all((Object.entries(snapshots) as Array<[ProviderId,any]>).map(([provider,snapshot])=>observeModelCatalog(provider,snapshot)));const deepseekModels=deepseekCatalog.models,ollamaModels=ollamaCatalog.models,antigravityModels=antigravityCatalog.models,grokModels=grokCatalog.models;return{codexCatalog,claudeCatalog,deepseekCatalog,ollamaCatalog,antigravityCatalog,grokCatalog,deepseekModels,ollamaModels,antigravityModels,grokModels,candidates:modelCandidates(codexCatalog.models,claudeCatalog.models,deepseekModels,ollamaModels,antigravityModels,grokModels)};});
refreshModelCatalogsAfterRuntimeUpdate=async()=>{await currentModelCatalogs(true);};
async function globalModelSettings(){const catalogs=await currentModelCatalogs(),stored=await db.getSystemSetting("models.global-catalog"),settings=normalizeGlobalModelSettings(stored?.value,catalogs.candidates);return{...catalogs,settings};}
async function requireGlobalModels(selections:Array<{provider:ProviderId;model?:string|null}>){const requested=selections.filter(item=>item.model&&item.model!=="default").map(item=>({provider:item.provider,model:item.model}));if(!requested.length)return;const stored=await db.getSystemSetting("models.global-catalog"),parsed=globalModelSettingsSchema.safeParse(stored?.value),settings=parsed.success?parsed.data:(await globalModelSettings()).settings;requireEnabledModels(settings,requested);}
async function requireGlobalModel(provider:ProviderId,model:string|null|undefined){return requireGlobalModels([{provider,model}]);}
function enabledCodexCatalog(global:GlobalModelSettings,catalog:any[]){const base=catalog.find(item=>item.isDefault&&!item.hidden)??catalog.find(item=>!item.hidden);return global.codex.models.map(entry=>catalog.find(item=>item.id===entry.id)??{...base,id:entry.id,model:entry.id,displayName:entry.displayName,isDefault:false,hidden:false});}

async function verifyCustomModel(providerId:ProviderId,model:string){
  if(providerId==="deepseek"||providerId==="ollama"||providerId==="antigravity"||providerId==="grok")return{valid:false,detail:`${providerId} models must be selected from the backend catalog.`};
  const probeDir=path.join(config.dataDir,"model-validation-probe");fs.mkdirSync(probeDir,{recursive:true,mode:0o700});
  const managedCodexBinary=managedRuntimeBinary(config.dataRoot,"codex"),command=providerId==="claude"?config.claudeBinary:process.env.CLAUDEX_WORKHOUSE_CODEX_BIN??(fs.existsSync(managedCodexBinary)?managedCodexBinary:process.platform==="win32"?null:"/usr/local/bin/codex"),args=providerId==="claude"?["-p","--no-session-persistence","--safe-mode","--no-chrome","--permission-mode","plan","--tools","","--model",model,"--output-format","json","Reply exactly MODEL_OK."]:["exec","--ephemeral","--ignore-user-config","--ignore-rules","--skip-git-repo-check","--sandbox","read-only","--model",model,"--json","-C",probeDir,"Reply exactly MODEL_OK."];
  if(!command)return{valid:false,detail:"Managed Codex runtime is not installed."};
  return new Promise<{valid:boolean;detail:string;detailKey?:string}>((resolve)=>{const child=spawn(command,args,{cwd:probeDir,shell:false,windowsHide:true,env:{...process.env,DISABLE_AUTOUPDATER:"1"},stdio:["ignore","pipe","pipe"]});let stdout="",stderr="",settled=false;const finish=(valid:boolean,detail:string,detailKey?:string)=>{if(settled)return;settled=true;clearTimeout(timer);resolve({valid,detail:sanitizeSensitiveText(detail).replace(/[\r\n]+/g," ").slice(0,300),...(detailKey?{detailKey}:{})});};const timer=setTimeout(()=>{child.kill("SIGTERM");finish(false,"The validation request timed out.","model.validation.timeout");},60_000);timer.unref?.();child.stdout.setEncoding("utf8");child.stderr.setEncoding("utf8");child.stdout.on("data",chunk=>stdout=`${stdout}${chunk}`.slice(-65536));child.stderr.on("data",chunk=>stderr=`${stderr}${chunk}`.slice(-4000));child.once("error",error=>finish(false,error.message));child.once("exit",code=>finish(code===0,code===0?"The real runtime used this model successfully.":stderr||stdout||`Provider exited with ${code}.`,code===0?"model.validation.runtimeSuccess":undefined));});
}

function provider(id: string) {
  const parsed = providerParam.parse(id);
  return providers.get(parsed)!;
}
async function taskFromParams(raw: unknown) {
  const params = taskParams.parse(raw);
  let task = await db.getTask(params.taskId);
  if(params.provider==="claude"&&(!task||!task.owned||task.ownership==="external")){
    const encoded=params.taskId.startsWith("claude:external:")?params.taskId.slice("claude:external:".length):null;
    const sessionId=task?.threadId??(encoded&&/^[0-9a-f-]{36}$/i.test(encoded)?encoded:null);
    if(sessionId){
      const links=await db.listProviderTaskLinksByThreads("claude",[sessionId]);
      const owned=links.filter(item=>item.owned||item.ownership==="claudex-workhouse").sort((left,right)=>String(right.createdAt??"").localeCompare(String(left.createdAt??"")))[0];
      if(owned)task=await db.getTask(owned.id);
    }
  }
  if (!task || task.provider !== params.provider) throw Object.assign(new Error("Task not found."), { statusCode: 404 });
  return { params, task, provider: provider(params.provider) };
}
async function selectedWorkspace(projectId:string,executionHostId?:string,workspaceId?:string){
  const hostId=executionHostId??LOCAL_HOST_ID;
  if(workspaceId){const workspace=await hostWorkspaces.requireWorkspace(workspaceId,hostId);return{hostId,workspace};}
  if(hostId!==LOCAL_HOST_ID)throw Object.assign(new Error("A workspace is required for a remote host."),{statusCode:400});
  const workspace=await hostWorkspaces.localWorkspaceForProject(projectId);if(!workspace)throw Object.assign(new Error("Local workspace mapping is unavailable."),{statusCode:503});return{hostId,workspace};
}
const activeTaskStatus=(status:string)=>["pending","queued","running","waiting","unknown"].includes(status);
function withoutLegacyWorkspaceApprovalMetadata(metadata:Record<string,unknown>|null|undefined){const{accessContract:_accessContract,nextAccessContract:_nextAccessContract,primaryWorkspaceId:_primaryWorkspaceId,primaryWorkspacePath:_primaryWorkspacePath,workspaceAccessMode:_workspaceAccessMode,approvedExternalPaths:_approvedExternalPaths,externalPathScopes:_externalPathScopes,externalWorkspaceModification:_externalWorkspaceModification,executionPolicyResolvedAt:_executionPolicyResolvedAt,...remaining}=metadata??{};return remaining;}
async function workspaceInstructionProfile(workspaceId:string){try{return normalizeWorkspaceInstructionProfile((await db.getSystemSetting(workspaceInstructionSettingKey(workspaceId)))?.value);}catch(error){app.log.warn({workspaceId,err:sanitizeSensitiveObject(error)},"Ignoring an invalid Workspace instruction profile.");return normalizeWorkspaceInstructionProfile(undefined);}}
function workspacePromptForTask(task:DeckTask,prompt:string){return promptWithWorkspaceInstructions(prompt,workspaceInstructionSnapshotFromMetadata(task.metadata),{referenceOnly:task.metadata?.workspaceInstructionPendingInjection!==true});}
async function remoteRepositoryInstructionSources(hostId:string,workspaceId:string){
  const root=await workerHub.request(hostId,"workspace.files.browse",{workspaceId}) as any,files:Array<{name:string;text:string}>=[];
  const candidates:Array<{name:string;id:string}>=(root?.entries??[]).filter((item:any)=>item.type==="file"&&["AGENTS.md","CLAUDE.md"].includes(item.name)).map((item:any)=>({name:item.name,id:item.id}));
  const docs=(root?.entries??[]).find((item:any)=>item.type==="directory"&&item.name==="docs");
  if(docs){const listing=await workerHub.request(hostId,"workspace.files.browse",{workspaceId,entryId:docs.id}) as any,runbook=(listing?.entries??[]).find((item:any)=>item.type==="file"&&item.name==="WORKSPACE_RUNBOOK.md");if(runbook)candidates.push({name:"docs/WORKSPACE_RUNBOOK.md",id:runbook.id});}
  for(const candidate of candidates){const file=await workerHub.request(hostId,"workspace.files.read",{workspaceId,fileId:candidate.id,offset:0,limit:MAX_WORKSPACE_INSTRUCTION_FILE_BYTES+1}) as any;if(!file?.binary&&typeof file?.content==="string"&&file.nextOffset==null&&Buffer.byteLength(file.content,"utf8")<=MAX_WORKSPACE_INSTRUCTION_FILE_BYTES&&file.content.trim())files.push({name:candidate.name,text:file.content.trim()});}
  return files;
}
async function workspaceInstructionSnapshotFor(workspace:{id:string;hostId:string;displayName:string;canonicalPath:string},profile:ReturnType<typeof normalizeWorkspaceInstructionProfile>){
  let repositorySources:Array<{name:string;text:string}>|undefined;
  if(profile.enabled&&workspace.hostId!==LOCAL_HOST_ID&&profile.sourceMode!=="managed")try{repositorySources=await remoteRepositoryInstructionSources(workspace.hostId,workspace.id);}catch(error){app.log.warn({workspaceId:workspace.id,hostId:workspace.hostId,err:sanitizeSensitiveObject(error)},"Continuing without remote repository Workspace instructions.");repositorySources=[];}
  return createWorkspaceInstructionSnapshot({workspaceId:workspace.id,workspaceName:workspace.displayName,canonicalPath:workspace.hostId===LOCAL_HOST_ID?workspace.canonicalPath:null,repositorySources,profile});
}
async function releasePreviousTaskWorkspaceLease(task:DeckTask,nextWorkspaceId:string){if(!task.workspaceId||task.workspaceId===nextWorkspaceId)return;for(const lease of await db.listWorkspaceLeases(task.workspaceId))if(!lease.releasedAt&&(lease.sessionId===task.id||lease.sessionId===task.threadId))await db.releaseWorkspaceLease(lease.id,new Date().toISOString());}
async function relocateTask(task:DeckTask,projectId?:string,workspaceId?:string,persist=true):Promise<DeckTask>{
  if(!projectId&&!workspaceId)return task;
  if(activeTaskStatus(task.status))throw Object.assign(new Error("A session that is running, or whose state cannot be confirmed, cannot change its project."),{statusCode:409,code:"SESSION_LOCATION_BUSY"});
  const hostId=task.executionHostId??LOCAL_HOST_ID,targetProjectId=projectId??task.projectId;
  const selection=await selectedWorkspace(targetProjectId,hostId,workspaceId);
  if(selection.hostId!==hostId)throw Object.assign(new Error("The execution host cannot be changed inside a session. Use a handoff to move to another host."),{statusCode:409,code:"SESSION_HOST_CHANGE_REQUIRES_HANDOFF"});
  const timestamp=new Date().toISOString();
  const{workspaceInstructionSnapshot:_oldSnapshot,workspaceInstructionPendingInjection:_oldPending,...metadata}=withoutLegacyWorkspaceApprovalMetadata(task.metadata),profile=await workspaceInstructionProfile(selection.workspace.id),workspaceInstructionSnapshot=await workspaceInstructionSnapshotFor(selection.workspace,profile);
  const updated:DeckTask={...task,projectId:selection.workspace.projectId,workspaceId:selection.workspace.id,cwd:hostId===LOCAL_HOST_ID?selection.workspace.canonicalPath:null,updatedAt:timestamp,metadata:{...metadata,...(workspaceInstructionSnapshot?{workspaceInstructionSnapshot,workspaceInstructionPendingInjection:true}:{}),workspaceChangedAt:timestamp,previousProjectId:task.projectId,previousWorkspaceId:task.workspaceId??null}};
  if(!persist)return updated;const saved=await db.upsertTask(updated);await releasePreviousTaskWorkspaceLease(task,selection.workspace.id).catch(()=>{});return saved;
}
async function setTaskLocationForNextRequest(task:DeckTask,projectId?:string,workspaceId?:string,persist=true){
  if(!projectId&&!workspaceId)return task;
  const hostId=task.executionHostId??LOCAL_HOST_ID,targetProjectId=projectId??task.projectId;
  const selection=await selectedWorkspace(targetProjectId,hostId,workspaceId);
  if(selection.hostId!==hostId)throw Object.assign(new Error("The execution host cannot be changed inside a session. Use a handoff to move to another host."),{statusCode:409,code:"SESSION_HOST_CHANGE_REQUIRES_HANDOFF"});
  if(!activeTaskStatus(task.status))return relocateTask(task,targetProjectId,selection.workspace.id,persist);
  const timestamp=new Date().toISOString();
  // Reserving the next Workspace is not an execution-setting change. Bumping
  // settingsUpdatedAt here made the running task's old model/effort look newer
  // than the thread settings saved in the same request.
  const updated={...task,metadata:{...withoutLegacyWorkspaceApprovalMetadata(task.metadata),nextProjectId:selection.workspace.projectId,nextWorkspaceId:selection.workspace.id,nextCanonicalWorkspacePath:selection.workspace.canonicalPath,nextWorkspaceChangedAt:timestamp}};
  return persist?db.upsertTask(updated):updated;
}
async function applyPendingTaskLocation(task:DeckTask){
  const projectId=typeof task.metadata?.nextProjectId==="string"?task.metadata.nextProjectId:null,workspaceId=typeof task.metadata?.nextWorkspaceId==="string"?task.metadata.nextWorkspaceId:null;
  if(!projectId||!workspaceId)return task;
  if(activeTaskStatus(task.status))throw Object.assign(new Error("Send the next request after the current one finishes."),{statusCode:409,code:"SESSION_STILL_ACTIVE"});
  const {nextProjectId:_project,nextWorkspaceId:_workspace,nextCanonicalWorkspacePath:_path,nextWorkspaceChangedAt:_changed,...metadata}=withoutLegacyWorkspaceApprovalMetadata(task.metadata);
  return relocateTask({...task,metadata},projectId,workspaceId);
}
async function remoteTaskCommand(task:DeckTask,command:"provider.task.status"|"provider.task.stop"|"provider.session.resume"|"provider.session.fork"|"provider.session.compact",payload:Record<string,unknown>={}){
  if(!task.executionHostId||!executionHostUsesWorker(task.executionHostId))throw new Error("Worker-backed task expected.");
  const executionCommand=["provider.session.resume","provider.session.fork","provider.session.compact"].includes(command);
  if(executionCommand&&task.workspaceId)await hostWorkspaces.requireWorkspace(task.workspaceId,task.executionHostId);
  if(executionCommand&&task.executionHostId===LOCAL_HOST_ID)await refreshManagedLocalWorkerConfig();
  const executionSettings=executionCommand?{model:task.requestedModel,reasoningEffort:task.requestedReasoningEffort,serviceTier:task.requestedServiceTier,permissionProfile:task.permissionProfile,workMode:task.metadata?.workMode??"default",automationLevel:automationLevel(task.metadata?.automationLevel,task.permissionProfile)}:{};
  const executionPayload=executionCommand&&typeof payload.prompt==="string"?{...payload,prompt:workspacePromptForTask(task,payload.prompt)}:payload;
  const result=await workerHub.request(task.executionHostId,command,{taskId:task.hostTaskId??task.id,provider:task.provider,workspaceId:task.workspaceId,...executionSettings,...executionPayload,...(executionCommand?await claudeRemoteExecutionSettings(task.provider):{})}) as any;
  return db.upsertTask({...task,status:result?.status??task.status,threadId:result?.threadId??task.threadId,providerSessionId:result?.threadId??task.providerSessionId,result:result?.result??task.result,error:result?.error??null,updatedAt:result?.updatedAt??new Date().toISOString(),metadata:{...(command==="provider.session.resume"?workspaceInstructionFollowUpMetadata(withoutLegacyWorkspaceApprovalMetadata(task.metadata),undefined):withoutLegacyWorkspaceApprovalMetadata(task.metadata)),...(result?.errorCategory!==undefined?{errorCategory:result.errorCategory}:{}),...(result?.contextUsage!==undefined?{contextUsage:result.contextUsage}:{}),contextCapabilities:result?.contextCapabilities??task.metadata?.contextCapabilities,...(result?.interruptionCause!==undefined?{interruptionCause:result.interruptionCause}:{}),...(result?.interruptionDetectedAt!==undefined?{interruptionDetectedAt:result.interruptionDetectedAt}:{}),...(result?.executionPolicy?{requestedAutomation:result.executionPolicy.requestedAutomation,effectiveSandbox:result.executionPolicy.effectiveSandbox,effectiveApprovalPolicy:result.executionPolicy.effectiveApprovalPolicy,executionBackend:result.executionPolicy.executionBackend,executionUiLabel:result.executionPolicy.uiLabel}:{})}});
}
async function latestQueuedThreadTask(providerId:ProviderId,threadId:string){
  let task=await db.latestThreadTask(providerId,threadId);if(!task)return null;
  if(activeTaskStatus(task.status)){
    try{task=task.executionHostId&&executionHostUsesWorker(task.executionHostId)?await remoteTaskCommand(task,"provider.task.status"):await db.upsertTask(await provider(providerId).getTask(task));}catch{}
  }
  return task;
}
const{dispatching:threadTurnDispatch,withThreadTurn}=createThreadTurnGate({
  latestThreadTask:latestQueuedThreadTask,
  activeTasks:()=>db.listActiveTasks(),
  refresh:async task=>task.executionHostId&&executionHostUsesWorker(task.executionHostId)?remoteTaskCommand(task,"provider.task.status"):db.upsertTask(await provider(task.provider).getTask(task))
});
// The queue dispatcher and the direct turn paths must exclude each other, so
// both take the same per-session key.
const queueDispatching=threadTurnDispatch;
async function dispatchQueuedMessage(queueId:string,sendNow=false,confirmedProviders=new Set<ProviderId>()){
  const queued=await db.getSessionMessage(queueId);if(!queued||queued.status!=="queued")throw Object.assign(new Error("The queued message could not be found."),{statusCode:404,code:"QUEUED_MESSAGE_NOT_FOUND"});
  if(queued.error===`paid-credit-approved:${queued.provider}`)confirmedProviders=new Set([...confirmedProviders,queued.provider as ProviderId]);
  const key=`${queued.provider}:${queued.threadId}`;if(queueDispatching.has(key))throw Object.assign(new Error("Another message in this session is being processed."),{statusCode:409,code:"SESSION_MESSAGE_IN_PROGRESS"});queueDispatching.add(key);
  let claimed:any=null,providerDispatchStarted=false;
  try{
    let source=await latestQueuedThreadTask(queued.provider,queued.threadId);if(!source)throw Object.assign(new Error("The source session for the queue could not be found."),{statusCode:404,code:"QUEUE_SOURCE_SESSION_NOT_FOUND"});
    if(activeTaskStatus(source.status)&&!sendNow)return{queued:true,item:queued,task:source};
    try{await assertPaidCreditConsent([queued.provider],confirmedProviders);}catch(error){
      if(!isPaidCreditConsentRequired(error))throw error;
      const queueProvider=queued.provider as ProviderId,reason=String((queueProvider==="codex"||queueProvider==="claude"||queueProvider==="grok")?error.reasons[queueProvider]??"unknown":"unknown"),item=await db.deferSessionMessageCredit(queueId,`paid-credit-consent-required:${queueProvider}:${reason}`,new Date().toISOString());
      return{queued:true,waitingCreditConsent:true,item,task:source};
    }
    claimed=await db.claimSessionMessage(queueId,new Date().toISOString());if(!claimed)throw Object.assign(new Error("The queued message state has already changed."),{statusCode:409,code:"QUEUED_MESSAGE_STATE_CHANGED"});
    source=await latestQueuedThreadTask(queued.provider,queued.threadId)??source;
    if(activeTaskStatus(source.status)){
      if(!sendNow){await db.finishSessionMessage(queueId,"queued",new Date().toISOString());return{queued:true,item:queued,task:source};}
      source=source.executionHostId&&executionHostUsesWorker(source.executionHostId)?await remoteTaskCommand(source,"provider.task.stop"):await provider(source.provider).stopTask(source);
    }
    source=await applyPendingTaskLocation(source);

    providerDispatchStarted=true;
    let next=source.executionHostId&&executionHostUsesWorker(source.executionHostId)?await remoteTaskCommand(source,"provider.session.resume",{prompt:claimed.prompt,model:source.requestedModel,reasoningEffort:source.requestedReasoningEffort,serviceTier:source.requestedServiceTier,permissionProfile:source.permissionProfile,workMode:source.metadata?.workMode??"default",automationLevel:automationLevel(source.metadata?.automationLevel,source.permissionProfile)}):await provider(source.provider).sendMessage(source,workspacePromptForTask(source,claimed.prompt));
    next=await db.upsertTask({...next,...(next.id!==source.id?{prompt:claimed.prompt}:{}),metadata:{...withoutLegacyWorkspaceApprovalMetadata(source.metadata),...withoutLegacyWorkspaceApprovalMetadata(next.metadata)}});
    // A follow-up turn is a new task row. Without publishing it the in-memory
    // list snapshot — the only list the browser polls — keeps reporting the
    // finished turn, so an open session cannot follow the turn that is really
    // running and its status badge contradicts the live provider state.
    publishTaskSnapshot(next);
    await db.finishSessionMessage(queueId,"sent",new Date().toISOString(),next.id,null);
    await db.appendAudit({createdAt:new Date().toISOString(),actor:"system",action:sendNow?"queued-message-send-now":"queued-message-dispatch",provider:next.provider,taskId:next.id,projectId:next.projectId,hostId:next.executionHostId??null,workspaceId:next.workspaceId??null,outcome:"success",detail:`queue=${queueId};thread=${queued.threadId}`});
    return{queued:false,item:{...claimed,status:"sent",dispatchedTaskId:next.id},task:next};
  }catch(error){if(claimed)await db.finishSessionMessage(queueId,providerDispatchStarted?"delivery-uncertain":"failed",new Date().toISOString(),null,error instanceof Error?`Provider delivery could not be confirmed: ${error.message}`:String(error)).catch(()=>{});throw error;}finally{queueDispatching.delete(key);}
}
let queuePumpBusy=false;
async function pumpSessionMessageQueue(){
  if(queuePumpBusy)return;queuePumpBusy=true;
  // Every caller fires this without awaiting, so a rejection here becomes an
  // unhandled one and takes the whole server down. A busy database is a normal
  // transient condition -- skip this tick and let the 1s interval try again.
  try{const rows=await db.listQueuedSessionMessages(100),seen=new Set<string>();for(const item of rows){const key=`${item.provider}:${item.threadId}`;if(seen.has(key))continue;seen.add(key);try{await dispatchQueuedMessage(item.id,false);}catch{}}}
  catch(error){app.log.warn({err:sanitizeSensitiveObject(error)},"Skipping a session message queue pump.");}
  finally{queuePumpBusy=false;}
}
const gitRefreshedTerminalTasks=new Set<string>();
function projectTasksWithLiveGitAttribution(tasks:DeckTask[]){const capturedAt=new Date().toISOString();return projectTaskList(tasks.map(task=>{if(!activeTaskStatus(task.status))return task;const attribution=mergeLiveTaskGitAttribution(readStreamFileChanges(config.dataRoot,task.id),task.metadata?.gitAttribution,capturedAt);return attribution?{...task,metadata:{...task.metadata,gitAttribution:attribution}}:task;}));}
async function settleTaskLeases(task:DeckTask){if(!task.workspaceId||!["completed","failed","stopped"].includes(task.status))return;for(const lease of await db.listWorkspaceLeases(task.workspaceId))if(!lease.releasedAt&&(lease.sessionId===task.id||lease.sessionId===task.threadId))await db.releaseWorkspaceLease(lease.id,new Date().toISOString());if(gitRefreshedTerminalTasks.has(task.id))return;gitRefreshedTerminalTasks.add(task.id);if(gitRefreshedTerminalTasks.size>10_000)gitRefreshedTerminalTasks.delete(gitRefreshedTerminalTasks.values().next().value!);try{const workspace=await hostWorkspaces.requireWorkspace(task.workspaceId,task.executionHostId??LOCAL_HOST_ID);let status:Record<string,unknown>;if(workspace.hostId===LOCAL_HOST_ID)status=await hostWorkspaces.gitStatus(workspace.id);else{status=await workerHub.request(workspace.hostId,"workspace.git.status",{workspaceId:workspace.id}) as Record<string,unknown>;const timestamp=new Date().toISOString();await db.upsertWorkspace({...workspace,gitRemote:(status as any).remote??null,defaultBranch:(status as any).branch??null,lastKnownCommit:(status as any).commit??null,lastGitStatus:status,lastVerifiedAt:timestamp,updatedAt:timestamp});}const attribution=taskGitAttribution(readStreamFileChanges(config.dataRoot,task.id),status,new Date().toISOString());if(attribution)await db.upsertTask({...task,metadata:{...task.metadata,gitAttribution:attribution}});}catch{gitRefreshedTerminalTasks.delete(task.id);}}
function hash(value: unknown) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function attachmentDisposition(name:string){const encoded=encodeURIComponent(name).replace(/['()*]/g,value=>`%${value.charCodeAt(0).toString(16).toUpperCase()}`),extension=path.extname(name).replace(/[^A-Za-z0-9.]/g,"").slice(0,16);return `attachment; filename="download${extension}"; filename*=UTF-8''${encoded}`;}
function inlineDisposition(name:string){const encoded=encodeURIComponent(name).replace(/['()*]/g,value=>`%${value.charCodeAt(0).toString(16).toUpperCase()}`);return `inline; filename="image"; filename*=UTF-8''${encoded}`;}
const completedIdempotency=new Map<string,{requestHash:string;response:unknown;expiresAt:number}>();
async function audit(request: FastifyRequest, action: string, outcome: string, task?: DeckTask, detail?: string) {
  const entry={ createdAt: new Date().toISOString(), actor: (request as any).actor ?? "system", action, provider: task?.provider ?? null, taskId: task?.id ?? null, projectId: task?.projectId ?? null, hostId:task?.executionHostId??null,workspaceId:task?.workspaceId??null,outcome, detail: detail?.slice(0, 500) ?? null };
  try{await db.appendAudit(entry);}
  catch(error){
    if(!(error instanceof DatabaseRequestError))throw error;
    const retry=setTimeout(()=>{void db.appendAudit(entry).catch(()=>{});},1000);retry.unref?.();
  }
}
async function idempotent(request: FastifyRequest, action: string, body: unknown, run: () => Promise<unknown>) {
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    throw Object.assign(new Error("A UUID Idempotency-Key header is required."), { statusCode: 400 });
  }
  const requestHash = hash(body);
  const memoryKey=`${action}:${key}`,remembered=completedIdempotency.get(memoryKey);
  if(remembered&&remembered.expiresAt>Date.now()){
    if(remembered.requestHash!==requestHash)throw Object.assign(new Error("Idempotency key was used for a different request."),{statusCode:409});
    return remembered.response;
  }
  if(remembered)completedIdempotency.delete(memoryKey);
  const timestamp=new Date(),claim = await db.claimIdempotency({key,action,requestHash,ownerToken:idempotencyOwner,now:timestamp.toISOString(),staleBefore:new Date(timestamp.getTime()-2*60_000).toISOString(),pruneBefore:new Date(timestamp.getTime()-7*24*60*60_000).toISOString()});
  if (!claim.claimed) {
    if (claim.requestHash !== requestHash) throw Object.assign(new Error("Idempotency key was used for a different request."), { statusCode: 409 });
    if(claim.state==="completed")return claim.response;
    if(claim.state==="failed"){
      const recorded=claim.response as any;
      throw Object.assign(new Error(typeof recorded?.error==="string"?recorded.error:"The original request failed."),{statusCode:Number(recorded?.statusCode)||500,code:typeof recorded?.code==="string"?recorded.code:"REQUEST_FAILED"});
    }
    throw Object.assign(new Error("The original request is still pending; it was not repeated."), { statusCode: 409, code: "REQUEST_PENDING" });
  }
  let response:unknown;
  try{response=await run();}
  catch(error){await db.finishIdempotency({key,action,ownerToken:idempotencyOwner,state:"failed",response:{error:error instanceof Error?error.message:String(error),statusCode:Number((error as any)?.statusCode)||500,code:typeof (error as any)?.code==="string"?(error as any).code:null},now:new Date().toISOString()}).catch(()=>{});throw error;}
  completedIdempotency.set(memoryKey,{requestHash,response,expiresAt:Date.now()+5*60_000});
  setTimeout(()=>{const item=completedIdempotency.get(memoryKey);if(item&&item.expiresAt<=Date.now())completedIdempotency.delete(memoryKey);},5*60_000).unref?.();
  try{await db.finishIdempotency({key,action,ownerToken:idempotencyOwner,state:"completed",response,now:new Date().toISOString()});}
  catch(error){if(!(error instanceof DatabaseRequestError))throw error;}
  return response;
}

// Provider login responses can temporarily contain a verification URL or a
// one-time device code. Keep auth idempotency in memory so those values never
// enter the SQLite idempotency table.
const authIdempotency=new Map<string,{action:string;requestHash:string;response:unknown;expiresAt:number}>();
async function authIdempotent(request:FastifyRequest,action:string,body:unknown,run:()=>Promise<unknown>){
  const key=request.headers["idempotency-key"];
  if(typeof key!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key))throw Object.assign(new Error("A UUID Idempotency-Key header is required."),{statusCode:400});
  const requestHash=hash(body),mapKey=`${action}:${key}`,existing=authIdempotency.get(mapKey);
  if(existing&&existing.expiresAt>Date.now()){
    if(existing.requestHash!==requestHash)throw Object.assign(new Error("Idempotency key was used for a different request."),{statusCode:409});
    return existing.response;
  }
  const response=await run();authIdempotency.set(mapKey,{action,requestHash,response,expiresAt:Date.now()+5*60_000});
  setTimeout(()=>authIdempotency.delete(mapKey),5*60_000).unref?.();return response;
}

const providerAuth=new ProviderAuthManager(config,async(entry)=>{
  await db.appendAudit({createdAt:entry.finishedAt??entry.startedAt,actor:entry.actor,action:"provider-auth-login",provider:entry.provider,taskId:null,projectId:null,outcome:entry.outcome,detail:`method=${entry.method};category=${entry.category??"none"}`});
},{antigravityExecution:async()=>normalizeAntigravityExecutionSettings((await db.getSystemSetting("antigravity.execution"))?.value)});
const externalAccess=new ExternalAccessCoordinator(config,db);
await externalAccess.reconcile();
registerExternalAccessRoutes(app,{coordinator:externalAccess,idempotent,audit:(request,action,outcome,detail)=>audit(request,action,outcome,undefined,detail)});
const protonDriveCli=new ProtonDriveCli({appRoot:config.appRoot,dataRoot:config.dataRoot});
const protonDriveLogin=new ProtonDriveLoginManager(protonDriveCli,{appRoot:config.appRoot,dataRoot:config.dataRoot});
const protonDriveUploads=new ProtonDriveUploadService(config,db,hostWorkspaces,protonDriveCli);
const protonDriveImport=new ProtonDriveImportService(protonDriveCli,{uploadsDir:path.join(config.dataDir,"uploads"),tempDir:config.tempDir},async()=>normalizeProtonDriveSettings((await db.getSystemSetting("proton-drive.v1"))?.value));
await protonDriveUploads.reconcile();
if(!managedLocalWorkerRequired)void providerAuth.refreshAll().catch(()=>{});
let authStreamConnections=0;
const authAttemptStreams=new Map<string,number>();
const workhouseVersion=packageVersion(config.appRoot);
const infrastructureHealthRuns=new Map<string,HealthCheckRun>();
function ownerClaimState(){
  const state=ownerClaim.publicStatus();
  if(state.claimed)return"claimed";
  return state.enrollment?.expired?"expired":"pending";
}
function configuredPublicAccess(){
  const configured=String(process.env.CLAUDEX_WORKHOUSE_PUBLIC_ACCESS??"");
  if(["local-only","cloudflare-existing","tailscale-existing","custom-reverse-proxy"].includes(configured))return configured as "local-only"|"cloudflare-existing"|"tailscale-existing"|"custom-reverse-proxy";
  let hostname="";
  try{hostname=new URL(config.externalOrigin).hostname.toLowerCase();}catch{}
  if(config.authMode==="cloudflare")return"cloudflare-existing" as const;
  if(hostname.endsWith(".ts.net"))return"tailscale-existing" as const;
  if(localNetworkHostname(hostname))return"local-only" as const;
  return"custom-reverse-proxy" as const;
}
function configuredExternalUrl(){
  if(configuredPublicAccess()==="local-only")return null;
  try{
    const url=new URL(config.externalOrigin);
    return url.origin;
  }catch{return null;}
}
function configuredInternalUrl(){
  try{
    const configured=new URL(config.externalOrigin);
    if(localNetworkHostname(configured.hostname))return configured.origin;
  }catch{}
  for(const raw of ownerClaim.publicStatus().serverUrls){
    try{const url=new URL(raw);if(localNetworkHostname(url.hostname)&&!["127.0.0.1","localhost","::1"].includes(url.hostname))return url.origin;}catch{}
  }
  return`http://127.0.0.1:${config.port}`;
}
function healthSummary(targetId:string):{healthStatus:InfrastructureHealthStatus;lastDiagnosticAt:string|null}{
  const run=infrastructureHealthRuns.get(targetId);
  return{healthStatus:run?.overall??"unknown",lastDiagnosticAt:run?.completedAt??null};
}
async function probeSseTransport(origin:string,pathname="/api/health/sse"){
  try{
    const response=await fetch(new URL(pathname,origin),{
      headers:{accept:"text/event-stream"},
      redirect:"manual",
      signal:AbortSignal.timeout(5_000)
    });
    if(isCloudflareAccessRedirect(response.status,response.headers.get("location"))){
      return{ok:false,status:response.status,protectedBy:"cloudflare-access" as const};
    }
    const contentType=response.headers.get("content-type")??"",body=(await response.text()).slice(0,1024);
    const ok=response.ok&&contentType.toLowerCase().includes("text/event-stream")&&body.includes("event: health")&&body.includes('"ok":true');
    return{ok,status:response.status,detail:ok?"Loopback SSE event received.":`Unexpected SSE response (HTTP ${response.status}).`};
  }catch(error){
    return{ok:false,error:sanitizeSensitiveText(error instanceof Error?error.message:String(error))};
  }
}
function probeWorkerWebSocket(origin:string){
  type ProbeResult={ok:boolean;detail?:string;error?:string;status?:number;protectedBy?:"cloudflare-access"};
  return new Promise<ProbeResult>((resolve)=>{
    const url=new URL("/worker/connect?hostId=00000000-0000-4000-8000-000000000000",origin);
    url.protocol=url.protocol==="https:"?"wss:":"ws:";
    let settled=false;
    const socket=new WebSocket(url);
    const finish=(result:ProbeResult)=>{
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      try{socket.terminate();}catch{}
      resolve(result);
    };
    const timer=setTimeout(()=>finish({ok:false,error:"Worker WebSocket upgrade timed out."}),5_000);
    timer.unref?.();
    socket.once("open",()=>finish({ok:true,detail:"Loopback WebSocket upgrade succeeded."}));
    socket.once("error",(error)=>finish({ok:false,error:sanitizeSensitiveText(error.message)}));
    socket.once("unexpected-response",(_request,response)=>{
      if(isCloudflareAccessRedirect(response.statusCode,response.headers.location))finish({ok:false,status:response.statusCode,protectedBy:"cloudflare-access"});
      else finish({ok:false,error:`Unexpected WebSocket HTTP ${response.statusCode}.`});
    });
  });
}
async function probeExternalHealth(origin:string|null){
  if(!origin)return undefined;
  try{
    const response=await fetch(new URL("/api/health/live",origin),{
      redirect:"manual",
      signal:AbortSignal.timeout(8_000)
    });
    if(isCloudflareAccessRedirect(response.status,response.headers.get("location"))){
      return{ok:false,status:response.status,protectedBy:"cloudflare-access" as const};
    }
    return{
      ok:response.ok,
      status:response.status,
      detail:response.ok?"External health endpoint responded.":`External health endpoint returned HTTP ${response.status}.`
    };
  }catch(error){
    return{ok:false,error:sanitizeSensitiveText(error instanceof Error?error.message:String(error))};
  }
}
async function infrastructureOverview(){
  const hosts=await db.listHosts(),local=hosts.find(item=>item.id===LOCAL_HOST_ID);
  const serverHealth=healthSummary(LOCAL_HOST_ID);
  return{
    server:{
      id:LOCAL_HOST_ID,
      displayName:local?.displayName??os.hostname(),
      roles:configuredHostRoles(),
      platform:deploymentPlatform(),
      architecture:process.arch,
      operatingSystemVersion:os.release(),
      appVersion:workhouseVersion,
      internalUrl:configuredInternalUrl(),
      externalUrl:configuredExternalUrl(),
      installMethod:installMethod(),
      publicAccess:configuredPublicAccess(),
      connectionStatus:"online" as const,
      ...serverHealth,
      ownerClaimStatus:ownerClaimState()
    },
    hosts:hosts.filter(item=>item.id!==LOCAL_HOST_ID).map(host=>({
      id:host.id,
      type:"worker" as const,
      displayName:host.displayName,
      roles:["worker"] as const,
      platform:host.platform,
      architecture:host.architecture,
      operatingSystemVersion:host.operatingSystemVersion,
      workerVersion:host.workerVersion,
      appVersion:host.workerVersion,
      connectionStatus:healthConnectionStatus(workerHub.isOnline(host.id)?"online":host.status),
      ...healthSummary(host.id),
      lastSeenAt:host.lastSeenAt,
      disabledAt:host.disabledAt,
      revokedAt:host.revokedAt,
      capabilities:host.capabilities
    })),
    support:{
      mainServerPlatforms:["synology","qnap","docker-nas","linux"],
      workerPlatforms:["windows","linux"]
    }
  };
}
async function runServerInfrastructureHealth(){
  const spoolDir=path.join(config.dataDir,"stream-events");
  fs.mkdirSync(spoolDir,{recursive:true,mode:0o700});
  const internalOrigin=`http://127.0.0.1:${config.port}`;
  const externalOrigin=configuredExternalUrl();
  const [sse,websocket,externalHealth,externalSse,externalWebsocket]=await Promise.all([
    probeSseTransport(internalOrigin,"/health/sse"),
    probeWorkerWebSocket(internalOrigin),
    probeExternalHealth(externalOrigin),
    externalOrigin?probeSseTransport(externalOrigin,"/health/sse"):Promise.resolve(undefined),
    externalOrigin?probeWorkerWebSocket(externalOrigin):Promise.resolve(undefined)
  ]);
  const run=await runMainServerHealthChecks({
    targetId:LOCAL_HOST_ID,
    dataDir:config.dataDir,
    appRoot:config.appRoot,
    spoolDir,
    dbPath:config.dbPath,
    database:db,
    version:workhouseVersion,
    installMethod:installMethod(),
    internalUrl:internalOrigin,
    externalUrl:externalOrigin,
    externalHealth,
    externalSse,
    externalWebsocket,
    publicAccess:configuredPublicAccess(),
    claimState:ownerClaimState(),
    localWorker:{enabled:configuredHostRoles().includes("worker"),status:(await db.getHost(LOCAL_HOST_ID))?.status},
    sse:{...sse,connections:streamConnections,limit:24},
    websocket
  });
  infrastructureHealthRuns.set(LOCAL_HOST_ID,run);
  return run;
}
async function runExecutionHostInfrastructureHealth(hostId:string){
  const host=await db.getHost(hostId);
  if(!host)throw Object.assign(new Error("Execution host not found."),{statusCode:404,code:"HOST_NOT_FOUND"});
  const tasks=(await db.listTasks()).filter(item=>(item.executionHostId??LOCAL_HOST_ID)===hostId).slice(0,100).map(item=>({provider:item.provider,status:item.status,updatedAt:item.updatedAt}));
  let report:Record<string,unknown>;
  let connectionStatus=hostId===LOCAL_HOST_ID&&!managedLocalWorkerRequired?"local":workerHub.isOnline(hostId)?"online":host.status;
  if(hostId===LOCAL_HOST_ID&&!managedLocalWorkerRequired){
    const[runtimes,accounts,roots,git]=await Promise.all([
      localRuntimeStatuses(config.appRoot,config.dataRoot),
      providerAuth.refreshAll(),
      db.listWorkspaceRoots(LOCAL_HOST_ID),
      hostWorkspaces.gitHostStatus()
    ]);
    const disk=fs.statfsSync(config.dataDir);
    report={
      workerConnection:connectionStatus,
      workerVersion:workhouseVersion,
      operatingSystem:`${process.platform} ${os.release()}`,
      architecture:process.arch,
      workspaceRoots:roots.map(item=>({name:item.displayName,path:item.canonicalPath})),
      runtimes,
      accounts,
      git:(git as any).git,
      githubCli:(git as any).githubCli,
      eventSpool:"normal",
      diskFreeBytes:Number(disk.bavail)*Number(disk.bsize),
      tasks
    };
  }else if(workerHub.isOnline(hostId)){
    try{
      const remote=await workerHub.request(hostId,"host.diagnostics.read",{}) as Record<string,unknown>;
      report={...remote,tasks};
    }catch(error){
      report={workerConnection:"online",eventSpool:{status:"failed",error:sanitizeSensitiveText(error)},tasks};
    }
  }else{
    report={workerConnection:connectionStatus,tasks};
  }
  const run=normalizeExecutionHostDiagnostics(report,{
    targetId:hostId,
    connectionStatus,
    capabilities:host.capabilities,
    expectedProtocolVersion:WORKER_PROTOCOL_VERSION
  });
  infrastructureHealthRuns.set(hostId,run);
  return run;
}

const mainServerDeploymentRequest=z.object({
  target:z.literal("main-server"),
  platform:z.enum(["synology","qnap","docker-nas","linux"]),
  architecture:z.enum(["x64","arm64"]).optional(),
  installMethod:z.literal("docker-compose").optional(),
  roles:z.array(z.enum(["main-server","worker"])).min(1).max(2),
  dataPath:z.string().min(1).max(1024),
  port:z.number().int(),
  publicAccess:z.enum(["local-only","cloudflare-existing","tailscale-existing","custom-reverse-proxy"]),
  serverOrigin:z.string().min(1).max(2048)
}).strict();
const workerInstallRequest=z.object({
  platform:z.enum(["windows","linux"]),
  architecture:z.enum(["x64","arm64"]),
  installMethod:z.enum(["portable-worker","powershell-worker","shell-worker"]).optional(),
  pairingCode:z.string().min(8).max(32)
}).strict();
function legacyTrustedReleaseMetadata(){
  const raw=readTrustedJson(
    process.env.CLAUDEX_WORKHOUSE_TRUSTED_RELEASE_METADATA_FILE,
    config.appRoot,
    "release"
  );
  if(raw===null)throw Object.assign(new Error("Trusted release metadata is not configured."),{
    statusCode:409,
    code:"RELEASE_METADATA_REQUIRED"
  });
  try{return validateTrustedReleaseMetadata(raw);}
  catch(error){
    if(error instanceof DeploymentValidationError)throw Object.assign(new Error("Trusted release metadata failed validation."),{
      statusCode:503,
      code:"RELEASE_METADATA_INVALID"
    });
    throw error;
  }
}
function legacyTrustedWorkerPackageMetadata(platform:"windows"|"linux",architecture:"x64"|"arm64"){
  const configured=process.env.CLAUDEX_WORKHOUSE_TRUSTED_WORKER_PACKAGE_METADATA_DIR?.trim();
  if(!configured)throw Object.assign(new Error("Trusted Worker package metadata is not configured."),{
    statusCode:409,
    code:"WORKER_PACKAGE_METADATA_REQUIRED"
  });
  const directory=path.isAbsolute(configured)?path.normalize(configured):path.resolve(config.appRoot,configured);
  const file=path.join(directory,`${platform}-${architecture}.json`);
  if(!fs.existsSync(file))throw Object.assign(new Error(`No trusted ${platform} ${architecture} Worker package is configured.`),{
    statusCode:409,
    code:"WORKER_PACKAGE_METADATA_REQUIRED"
  });
  const raw=readTrustedJson(file,config.appRoot,"worker");
  try{return validateTrustedWorkerPackageMetadata(raw);}
  catch(error){
    if(error instanceof DeploymentValidationError)throw Object.assign(new Error("Trusted Worker package metadata failed validation."),{
      statusCode:503,
      code:"WORKER_PACKAGE_METADATA_INVALID"
    });
    throw error;
  }
}
function integratedReleaseError(error:unknown):never{
  if(error instanceof ReleaseManifestError||error instanceof ReleaseServiceError){
    const conflict=["RELEASE_DOWNGRADE","RELEASE_EQUIVOCATION","RELEASE_CHANNEL_MISMATCH"].includes(error.code);
    throw Object.assign(new Error(error.message),{statusCode:conflict?409:503,code:error.code});
  }
  throw error;
}
async function verifiedIntegratedRelease():Promise<VerifiedRelease|null>{
  if(integratedReleaseConfigurationError)integratedReleaseError(integratedReleaseConfigurationError);
  if(!integratedReleaseService)return null;
  try{return await integratedReleaseService.current();}
  catch(error){integratedReleaseError(error);}
}
async function applicationUpdateStatus():Promise<ApplicationUpdateStatus>{
  await reconcileApplicationUpdateResults(applicationUpdateResultsDirectory,db).catch(()=>({processed:0,rejected:1}));
  const [blockers,recentAttempts]=await Promise.all([applicationUpdateBlockers(),db.listApplicationUpdateAttempts(10)]);
  if(integratedReleaseConfigurationError)return{state:"failed",current:applicationInstallMetadata,target:null,updateAvailable:false,reason:typeof integratedReleaseConfigurationError==="object"&&integratedReleaseConfigurationError!==null&&"code"in integratedReleaseConfigurationError?String((integratedReleaseConfigurationError as any).code):"release-configuration-invalid",blockers,recentAttempts};
  if(!integratedReleaseService)return{state:"unconfigured",current:applicationInstallMetadata,target:null,updateAvailable:false,reason:"signed-release-channel-not-configured",blockers,recentAttempts};
  try{return await applicationUpdates.check();}
  catch(error){return{state:"failed",current:applicationInstallMetadata,target:null,updateAvailable:false,reason:typeof error==="object"&&error!==null&&"code"in error?String((error as any).code):"release-check-failed",blockers,recentAttempts};}
}
async function trustedReleaseMetadata(){
  const verified=await verifiedIntegratedRelease();
  return verified?toTrustedReleaseMetadata(verified):legacyTrustedReleaseMetadata();
}
async function trustedWorkerPackageMetadata(platform:"windows"|"linux",architecture:"x64"|"arm64"){
  const verified=await verifiedIntegratedRelease();
  return verified
    ?toTrustedWorkerPackageMetadata(verified,platform,architecture)
    :legacyTrustedWorkerPackageMetadata(platform,architecture);
}
function deploymentRequestError(error:unknown,code:string):never{
  if(error instanceof DeploymentValidationError)throw Object.assign(error,{statusCode:400,code});
  throw error;
}

app.get("/health/live", async () => ({ ok: true, status: "live" }));
app.get("/api/health/live", async () => ({ ok: true, status: "live" }));
app.get("/api/about",async()=>legalNoticeMetadata({root:config.appRoot,version:packageVersion(config.appRoot)}));
registerLocalEntryRoutes(app,{auth:localEntry,externalOrigin:config.externalOrigin,snapshot:async()=>{
  const base={product:"claudex-workhouse",platform:process.platform,architecture:process.arch,server:{status:"running",origin:config.externalOrigin,host:config.host,port:config.port},ownerClaim:{claimed:ownerClaim.isClaimed()},health:{live:"/api/health/live",ready:"/api/health/ready"},defaults:{codexAutomation:platformAutomationDefault("codex",process.platform)}};
  if(!managedLocalWorkerRequired)return base;
  const readiness=await managedProviderReadiness(),providerStates=Object.fromEntries((["codex","claude"] as const).flatMap(provider=>typeof readiness?.[provider]?.state==="string"?[[provider,readiness[provider].state]]:[]));
  return{...base,launcher:buildWindowsBootstrapStatus({payloadReady:fs.existsSync(path.join(config.appRoot,"dist-server","index.js")),dataReady:fs.existsSync(config.dataRoot),databaseReady:true,serverReady:true,workerStatus:workerHub.isOnline(LOCAL_HOST_ID)?"online":managedLocalWorkerConfig?"connecting":"failed",providers:providerStates,workspaceCount:managedLocalWorkerConfig?.workspaces.length??0,internalUrl:`http://127.0.0.1:${config.port}`,externalUrl:configuredExternalUrl()})};
}});
const readinessDirectories=[
  path.join(config.dataRoot,"config"),
  config.dataDir,
  config.logDir,
  config.runDir,
  path.join(config.dataRoot,"runtime"),
  config.snapshotDir,
  path.join(config.dataRoot,"workspaces")
];
const readinessApplicationDirectories=[
  path.join(config.appRoot,"app","dist"),
  path.join(config.appRoot,"app","dist-server")
];
async function readinessResponse(reply:FastifyReply){
  try{
    await limited(db.ping(),3_000,"Database readiness check");
    for(const directory of readinessDirectories){
      fs.accessSync(directory,fs.constants.R_OK|fs.constants.W_OK|fs.constants.X_OK);
    }
    for(const directory of readinessApplicationDirectories)fs.accessSync(directory,fs.constants.R_OK|fs.constants.X_OK);
    return{ok:true,status:"ready"};
  }catch{
    reply.code(503);
    return{ok:false,status:"not-ready"};
  }
}
app.get("/health/ready",async(_request,reply)=>readinessResponse(reply));
app.get("/api/health/ready",async(_request,reply)=>readinessResponse(reply));
app.get("/health/sse",async(_request,reply)=>{
  reply.hijack();
  reply.raw.writeHead(200,{
    "Content-Type":"text/event-stream; charset=utf-8",
    "Cache-Control":"no-store",
    "Connection":"close"
  });
  reply.raw.end('event: health\ndata: {"ok":true}\n\n');
});
app.get("/api/health/sse",async(request,reply)=>{
  if(!isLoopbackAddress(request.ip||(request.raw.socket.remoteAddress??"")))throw Object.assign(new Error("The SSE health probe is available only through loopback."),{statusCode:403,code:"HEALTH_PROBE_LOCAL_ONLY"});
  reply.hijack();
  reply.raw.writeHead(200,{
    "Content-Type":"text/event-stream; charset=utf-8",
    "Cache-Control":"no-store",
    "Connection":"close"
  });
  reply.raw.end('event: health\ndata: {"ok":true}\n\n');
});
app.get("/api/bootstrap/owner-claim/status",{config:{rateLimit:{max:60,timeWindow:"1 minute"}}},async()=>ownerClaim.publicStatus());
app.get("/api/bootstrap/owner-claim/local",{config:{rateLimit:{max:30,timeWindow:"1 minute"}}},async(request)=>{
  if(!isStrictLoopbackBootstrapRequest(request))throw Object.assign(new Error("The raw owner claim payload is available only through a direct loopback connection on the server."),{statusCode:403,code:"OWNER_CLAIM_LOCAL_ONLY"});
  if(ownerClaim.isClaimed())return{...ownerClaim.publicStatus(),localAccess:true};
  try{return{...ownerClaim.localPayload(),localAccess:true};}
  catch(error){
    if((error as any)?.code==="OWNER_CLAIM_EXPIRED")return{...ownerClaim.publicStatus(),localAccess:true,claimUrl:null,qr:null};
    throw error;
  }
});
app.post("/api/bootstrap/owner-claim/renew",{config:{rateLimit:{max:3,timeWindow:"10 minutes"}}},async(request)=>{
  if(!isStrictLoopbackBootstrapRequest(request))throw Object.assign(new Error("Owner claim renewal is available only through a direct loopback connection on the server."),{statusCode:403,code:"OWNER_CLAIM_LOCAL_ONLY"});
  z.object({confirm:z.literal(true)}).parse(request.body);
  return ownerClaim.rotate();
});
app.post("/api/bootstrap/owner-claim/recover",{config:{rateLimit:{max:3,timeWindow:"10 minutes"}}},async(request)=>{
  if(!isStrictLoopbackBootstrapRequest(request))throw Object.assign(new Error("Owner recovery is available only through a direct loopback connection on the server."),{statusCode:403,code:"OWNER_CLAIM_LOCAL_ONLY"});
  const proof=z.object({
    issuedAt:z.number().int().safe(),
    nonce:z.string().uuid(),
    signature:z.string().regex(/^[A-Za-z0-9_-]{80,100}$/)
  }).strict().parse(request.body);
  return ownerClaim.recover(proof);
});
app.post("/api/bootstrap/owner-claim/complete",{config:{rateLimit:{max:8,timeWindow:"10 minutes"}}},async(request,reply)=>{
  const body=z.object({
    enrollmentId:z.string().uuid(),
    claimToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    serverFingerprint:z.string().regex(/^[a-f0-9]{64}$/)
  }).parse(request.body);
  const result=await ownerClaim.complete(body);
  const secure=request.protocol==="https"||String(request.headers.origin??"").startsWith("https://");
  reply.header("Set-Cookie",ownerClaim.ownerCookie(result.ownerCredential,secure));
  return result;
});
app.get("/api/infrastructure/overview",async()=>infrastructureOverview());
app.get("/api/infrastructure/temp-storage",{config:{rateLimit:{max:20,timeWindow:"10 minutes"}}},async()=>{
  return{scan:tempStorage.status()};
});
app.get("/api/infrastructure/artifacts",{config:{rateLimit:{max:10,timeWindow:"10 minutes"}}},async()=>{
  const[tasks,workspaces]=await Promise.all([db.listTasks(),db.listWorkspaces({includeArchived:true})]);
  return artifactRegistry.reconcile(tasks,workspaces);
});
app.post("/api/infrastructure/temp-storage/scan",{config:{rateLimit:{max:5,timeWindow:"10 minutes"}}},async(request,reply)=>{
  z.object({confirmReadOnly:z.literal(true)}).strict().parse(request.body);
  const result=tempStorage.startScan(loadTempStorageContext);
  reply.code(202);
  return result;
});
app.post("/api/infrastructure/temp-storage/delete",{config:{rateLimit:{max:5,timeWindow:"10 minutes"}}},async(request)=>{
  const body=z.object({
    entryIds:z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(5_000),
    confirm:z.literal(true)
  }).strict().parse(request.body);
  return idempotent(request,"temp-storage-delete",body,async()=>{
    const result=await tempStorage.remove([...new Set(body.entryIds)]);
    await audit(request,"temp-storage-delete",result.failed.length?"partial":"success",undefined,`deleted=${result.deleted.length};failed=${result.failed.length};freedBytes=${result.freedBytes}`);
    return result;
  });
});
app.post("/api/infrastructure/health/server",{config:{rateLimit:{max:10,timeWindow:"10 minutes"}}},async()=>({run:await runServerInfrastructureHealth()}));
app.post("/api/infrastructure/health/hosts/:hostId",{config:{rateLimit:{max:20,timeWindow:"10 minutes"}}},async(request)=>{
  const{hostId}=z.object({hostId:z.string().min(1).max(100)}).parse(request.params);
  return{run:await runExecutionHostInfrastructureHealth(hostId)};
});
app.get("/api/infrastructure/support-bundle",{config:{rateLimit:{max:5,timeWindow:"10 minutes"}}},async(_request,reply)=>{
  const overview=await infrastructureOverview();
  const serverHealth=infrastructureHealthRuns.get(LOCAL_HOST_ID)??await runServerInfrastructureHealth();
  reply.header("Cache-Control","no-store");
  return{bundle:createInfrastructureSupportBundle({
    generatedAt:new Date().toISOString(),
    appVersion:workhouseVersion,
    installMethod:installMethod(),
    publicAccess:configuredPublicAccess(),
    ownerClaimStatus:ownerClaimState(),
    roles:overview.server.roles,
    platform:overview.server.platform,
    architecture:process.arch,
    operatingSystemVersion:os.release(),
    nodeVersion:process.version,
    serverHealth,
    executionHosts:overview.hosts.map(host=>({
      platform:host.platform,
      architecture:host.architecture,
      workerVersion:host.workerVersion,
      connectionStatus:host.connectionStatus,
      healthStatus:host.healthStatus,
      disabledAt:host.disabledAt,
      revokedAt:host.revokedAt,
      lastSeenAt:host.lastSeenAt,
      lastHealthCheck:infrastructureHealthRuns.get(host.id)??null
    }))
  })};
});
app.get("/api/deployment/releases/current",{config:{rateLimit:{max:20,timeWindow:"10 minutes"}}},async()=>{
  const verified=await verifiedIntegratedRelease();
  if(verified)return publicReleaseSummary(verified);
  const legacy=legacyTrustedReleaseMetadata();
  return{
    verification:"legacy-trusted-metadata" as const,
    channel:null,
    version:legacy.version,
    releaseSequence:null,
    publishedAt:null,
    expiresAt:null,
    server:{image:legacy.image.repository,digest:legacy.image.digest},
    workers:null,
    requirements:null,
    keyId:null,
    manifestSha256:legacy.manifest.sha256,
    verifiedAt:null
  };
});
let applicationUpdateStreams=0,applicationUpdateSequence=0;
function emitApplicationUpdate(status:ApplicationUpdateStatus){applicationUpdateEvents.emit("status",{sequence:++applicationUpdateSequence,occurredAt:new Date().toISOString(),status});}
app.get("/api/application-updates",{config:{rateLimit:{max:30,timeWindow:"10 minutes"}}},async()=>applicationUpdateStatus());
app.post("/api/application-updates/check",{config:{rateLimit:{max:10,timeWindow:"10 minutes"}}},async(request)=>{
  const status=await applicationUpdateStatus();emitApplicationUpdate(status);await audit(request,"application-update-check",status.state==="failed"?"failed":"success",undefined,`state=${status.state};target=${status.target?.version??"none"};manifest=${status.target?.manifestSha256??"none"}`);return status;
});
app.post("/api/application-updates/apply",{config:{rateLimit:{max:3,timeWindow:"30 minutes"}}},async(request)=>{
  const body=z.object({targetVersion:z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/),manifestSha256:z.string().regex(/^[a-f0-9]{64}$/),confirm:z.literal(true)}).strict().parse(request.body);
  return idempotent(request,"application-update-apply",body,async()=>{
    try{const attempt=await applicationUpdates.apply(body),status=await applicationUpdateStatus();emitApplicationUpdate(status);await audit(request,"application-update-apply","accepted",undefined,`attempt=${attempt.id};source=${attempt.sourceVersion};target=${attempt.targetVersion};manifest=${attempt.manifestSha256};snapshot=${attempt.snapshotId}`);return{attempt,status};}
    catch(error){await audit(request,"application-update-apply","failed",undefined,`target=${body.targetVersion};manifest=${body.manifestSha256};code=${typeof error==="object"&&error&&"code"in error?String((error as any).code):"unknown"}`);emitApplicationUpdate(await applicationUpdateStatus());throw error;}
  });
});
app.get("/api/application-updates/events",{config:{rateLimit:{max:20,timeWindow:"5 minutes"}}},async(request,reply)=>{
  if(applicationUpdateStreams>=8)throw Object.assign(new Error("Too many application update streams."),{statusCode:429});
  applicationUpdateStreams++;reply.hijack();const response=reply.raw;response.writeHead(200,{"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-store, no-cache, must-revalidate","Connection":"keep-alive","X-Accel-Buffering":"no","Content-Encoding":"identity"});response.write("retry: 5000\n\n");
  let closed=false;const send=(event:any)=>{if(closed||response.destroyed||response.writableLength>128*1024)return;response.write(`id: ${event.sequence}\nevent: application-update\ndata: ${JSON.stringify(sanitizeSensitiveValue(event))}\n\n`);};
  const listener=(event:any)=>send(event);applicationUpdateEvents.on("status",listener);void applicationUpdateStatus().then(status=>send({sequence:++applicationUpdateSequence,occurredAt:new Date().toISOString(),status})).catch(()=>{});
  const heartbeat=setInterval(()=>{if(!closed&&!response.destroyed)response.write(`: heartbeat ${Date.now()}\n\n`);},15000);heartbeat.unref?.();
  const close=()=>{if(closed)return;closed=true;clearInterval(heartbeat);applicationUpdateEvents.off("status",listener);applicationUpdateStreams=Math.max(0,applicationUpdateStreams-1);};request.raw.once("close",close);response.once("close",close);response.once("error",close);
});
app.post("/api/deployment/plans",{config:{rateLimit:{max:10,timeWindow:"10 minutes"}}},async(request)=>{
  const body=mainServerDeploymentRequest.parse(request.body);
  return authIdempotent(request,"main-server-deployment-plan",body,async()=>{
    let plan;
    try{
      plan=createDeploymentPlan({
        target:body.target,
        platform:body.platform,
        architecture:body.architecture,
        installMethod:body.installMethod,
        roles:body.roles,
        dataPath:body.dataPath,
        port:body.port,
        publicAccess:body.publicAccess
      });
    }catch(error){deploymentRequestError(error,"DEPLOYMENT_PLAN_INVALID");}
    const release=await trustedReleaseMetadata();
    let bundle;
    try{bundle=generateMainServerBundle(plan,{release,serverOrigin:body.serverOrigin});}
    catch(error){deploymentRequestError(error,"DEPLOYMENT_PLAN_INVALID");}
    const archive=createDeploymentBundleArchive(bundle);
    await audit(request,"main-server-deployment-plan","success",undefined,`plan=${plan.id};platform=${plan.platform};roles=${plan.roles.join(",")}`);
    return{
      plan,
      artifacts:{
        kind:bundle.kind,
        formatVersion:bundle.formatVersion,
        files:bundle.artifacts,
        installCommand:`printf '%s  %s\\n' '${archive.sha256}' './${archive.fileName}' | sha256sum -c - && test ! -e './${archive.directoryName}' && tar -xzf './${archive.fileName}' && cd './${archive.directoryName}' && sh ./install.sh`,
        archive
      },
      release:bundle.release
    };
  });
});
app.post("/api/deployment/worker-instructions",{config:{rateLimit:{max:10,timeWindow:"10 minutes"}}},async(request)=>{
  const body=workerInstallRequest.parse(request.body);
  return authIdempotent(request,"worker-install-instructions",body,async()=>{
    if(body.platform==="windows"&&body.architecture!=="x64")throw Object.assign(new Error("Windows arm64 Worker is not supported in this release."),{statusCode:400,code:"DEPLOYMENT_PLAN_INVALID"});
    let plan;
    try{
      plan=createDeploymentPlan({
        target:"worker",
        platform:body.platform,
        architecture:body.architecture,
        installMethod:body.installMethod,
        publicAccess:configuredPublicAccess()
      });
    }catch(error){deploymentRequestError(error,"DEPLOYMENT_PLAN_INVALID");}
    const workerPackage=await trustedWorkerPackageMetadata(body.platform,body.architecture);
    const serverOrigin=typeof request.headers.origin==="string"?request.headers.origin:config.externalOrigin;
    const access=serverOrigin.startsWith("http:")?"local-only":configuredPublicAccess();
    if(plan.publicAccess!==access)plan=createDeploymentPlan({...plan,publicAccess:access});
    let instructions;
    try{instructions=createWorkerInstallInstructions(plan,{workerPackage,serverOrigin,pairingCode:body.pairingCode});}
    catch(error){deploymentRequestError(error,"WORKER_INSTALL_INSTRUCTIONS_INVALID");}
    const verifiedDownload=body.platform==="windows"
      ?await verifyLocalWorkerPackage(
        path.join(config.appRoot,"packages"),
        workerPackage
      ).then(item=>({
        url:"/api/worker-package/windows",
        fileName:item.fileName,
        size:item.size,
        sha256:item.sha256
      })).catch(()=>null)
      :null;
    return{
      plan,
      instructions,
      installScript:renderWorkerInstallScript(instructions),
      ...(body.platform==="windows"&&verifiedDownload?{verifiedDownload}:{})
    };
  });
});
app.post("/api/hosts/:hostId/execution-backend/reprobe",{config:{rateLimit:{max:5,timeWindow:"10 minutes"}}},async(request)=>{const {hostId}=z.object({hostId:z.literal(LOCAL_HOST_ID)}).parse(request.params),body=z.object({confirm:z.literal(true)}).parse(request.body);return idempotent(request,`sandbox-reprobe:${hostId}`,body,async()=>({hostId,nativeSandbox:await codex.probeNativeExecution(config.appRoot,true)}));});
app.get("/api/health", async () => ({ ok: true, database: await db.ping(), accessConfigured: Boolean(config.teamDomain && config.audience), providers: Object.fromEntries(await Promise.all([...providers].map(async ([id, item]) => [id, await item.healthCheck()]))) }));
// The setup screen must render inside the client's own request budget. A probe
// that is still running is reported as `checking` against the last known
// snapshot rather than holding the whole response until the client gives up —
// raising the client limit instead would only make the storm last longer.
const SETUP_PROBE_BUDGET_MS=6_000;
// `pending` is reported per probe rather than inferred from an empty result.
// The runtime list and the connection accounts have independent costs — the
// accounts alone reach the auth refresh and the DeepSeek/Ollama health checks —
// so one of them can answer well inside the budget while the other is still
// running. Deciding "still checking" from both being empty made the fast one's
// answer mean the slow one had reported "nothing there", which showed an
// installed, signed-in provider as needing diagnosis.
function withinBudget<T>(work:Promise<T>,fallback:T):Promise<{value:T;pending:boolean}>{
  return Promise.race([
    work.then(value=>({value,pending:false}),()=>({value:fallback,pending:false})),
    new Promise<{value:T;pending:boolean}>(resolve=>{const timer=setTimeout(()=>resolve({value:fallback,pending:true}),SETUP_PROBE_BUDGET_MS);timer.unref?.();})
  ]);
}
app.get("/api/setup",async()=>{
  const[stored,preferenceSetting,workspaces,runtimeResult,accountResult,testSetting]=await Promise.all([
    db.getSystemSetting("setup.progress"),db.getSystemSetting("setup.preferences"),db.listWorkspaces(),withinBudget(displayedRuntimeStatuses(),[] as any[]),withinBudget(providerConnectionAccounts(),[] as any[]),db.getSystemSetting("setup.first-test")
  ]);
  const testTaskId=typeof testSetting?.value?.taskId==="string"?testSetting.value.taskId:null,testTask=testTaskId?await db.getTask(testTaskId):null;
  // A probe that was still running when the budget expired is not the same as
  // "no runtime is installed". Reporting it as `checking` keeps the screen
  // honest instead of telling the user their working installation disappeared.
  const providers=setupProviderReadiness(runtimeResult,accountResult);
  const testState=testTask?.status??"not-started",testSucceeded=testState==="completed";
  const progress=stored?.value??{step:1,completed:false,accessMode:"local",steps:{}};
  const preferences=normalizeSetupPreferences(preferenceSetting?.value);
  return{required:setupPanelRequired(progress,preferences),progress,preferences,readiness:{server:"ready",providers,workspaces:workspaces.filter(item=>!item.archivedAt).map(item=>({id:item.id,projectId:item.projectId,displayName:item.displayName,hostId:item.hostId})),executable:providers.some(item=>item.state==="ready")&&workspaces.some(item=>!item.archivedAt),firstTest:{taskId:testTaskId,status:testState,succeeded:testSucceeded,error:testTask?.error??null}}};
});
app.put("/api/setup",async(request)=>{const body=z.object({step:z.number().int().min(1).max(10),completed:z.boolean().default(false),accessMode:z.enum(["local","tailscale","cloudflare","reverse-proxy","current"]),steps:z.record(z.string(),z.boolean()).default({})}).parse(request.body);return idempotent(request,"setup-progress",body,async()=>{if(body.completed&&config.authMode!=="test"){const setting=await db.getSystemSetting("setup.first-test"),taskId=typeof setting?.value?.taskId==="string"?setting.value.taskId:null,task=taskId?await db.getTask(taskId):null;if(task?.status!=="completed")throw Object.assign(new Error("첫 테스트 작업이 성공한 뒤 설정을 완료할 수 있습니다."),{statusCode:409,code:"SETUP_TEST_REQUIRED"});}const value={...body,updatedAt:new Date().toISOString()};await db.putSystemSetting("setup.progress",value,value.updatedAt);return{progress:value};});});
app.get("/api/system-settings/setup",async()=>{const stored=await db.getSystemSetting("setup.preferences");return{preferences:normalizeSetupPreferences(stored?.value),updatedAt:stored?.updatedAt??null};});
app.put("/api/system-settings/setup",async(request)=>{const preferences=z.object({version:z.literal(1).default(1),showOnStartup:z.boolean()}).parse(request.body);return idempotent(request,"setup-preferences",preferences,async()=>{const updatedAt=new Date().toISOString();await db.putSystemSetting("setup.preferences",preferences,updatedAt);return{preferences,updatedAt};});});
app.get("/api/system-settings/mcp-servers",async()=>{const stored=await db.getSystemSetting(MCP_REGISTRY_SETTING_KEY),settings=normalizeMcpRegistrySettings(stored?.value);return{settings:publicMcpRegistrySettings(settings,mcpSecretStore),providerSupport:{...externalMcpProviderSupport(),grok:false},updatedAt:stored?.updatedAt??null};});
app.put("/api/system-settings/mcp-servers",{config:{rateLimit:{max:10,timeWindow:"10 minutes"}}},async(request)=>{const body=mcpRegistryPutSchema.parse(request.body);return idempotent(request,"external-mcp-settings",body,()=>serializeMcpSettingsSave(async()=>{
  const updatedAt=new Date().toISOString(),retained=new Set(body.settings.servers.map(server=>server.id)),previousSecrets=mcpSecretStore.snapshot();
  mcpSecretStore.applyForSettings(body.secretUpdates,retained);
  let saved:{updated:boolean};try{saved=await db.putSystemSettingIfUpdated(MCP_REGISTRY_SETTING_KEY,body.settings,updatedAt,body.baseUpdatedAt);}catch(error){mcpSecretStore.restore(previousSecrets);throw error;}
  if(!saved.updated){mcpSecretStore.restore(previousSecrets);throw Object.assign(new Error("External MCP settings changed in another session. Reload before saving."),{statusCode:409,code:"MCP_SETTINGS_CONFLICT"});}
  await db.appendAudit({createdAt:updatedAt,actor:(request as any).actor,action:"external-mcp-settings",provider:null,taskId:null,projectId:null,outcome:"success",detail:`servers=${body.settings.servers.length};enabled=${body.settings.servers.filter(server=>server.enabled).length};secretsChanged=${body.secretUpdates.length}`});
  return{settings:publicMcpRegistrySettings(body.settings,mcpSecretStore),providerSupport:{...externalMcpProviderSupport(),grok:false},updatedAt};
}));});
app.get("/api/system-settings/characters",async()=>avatarSettings.read());
app.put("/api/system-settings/characters",async(request)=>{const settings=characterSettingsSchema.parse(request.body);return idempotent(request,"character-settings",settings,()=>avatarSettings.save(settings));});
app.get("/api/system-settings/prompt-presets",async(request)=>{
  const stored=await db.getSystemSetting("ui.prompt-presets");
  if(!stored)return{settings:EMPTY_PROMPT_PRESET_SETTINGS,updatedAt:null,degraded:false};
  const parsed=promptPresetSettingsSchema.safeParse(stored.value);
  if(parsed.success)return{settings:parsed.data,updatedAt:stored.updatedAt,degraded:false};
  const settings=normalizeStoredPromptPresetSettings(stored.value),updatedAt=nextPromptPresetUpdatedAt(stored.updatedAt);
  await db.putSystemSetting("ui.prompt-presets.corrupt-backup",{version:1,originalValue:stored.value,originalUpdatedAt:stored.updatedAt,recoveredAt:updatedAt},updatedAt);
  const recovery=await db.putSystemSettingIfUpdated("ui.prompt-presets",settings,updatedAt,stored.updatedAt);
  if(recovery.updated){
    const sourceCount=stored.value&&typeof stored.value==="object"&&Array.isArray((stored.value as any).presets)?(stored.value as any).presets.length:0;
    await db.appendAudit({createdAt:updatedAt,actor:(request as any).actor,action:"prompt-preset-settings-recovered",provider:null,taskId:null,projectId:null,outcome:"degraded",detail:`kept=${settings.presets.length};discarded=${Math.max(0,sourceCount-settings.presets.length)};backup=ui.prompt-presets.corrupt-backup`});
    return{settings,updatedAt,degraded:true};
  }
  const current=recovery.current,currentParsed=current?promptPresetSettingsSchema.safeParse(current.value):null;
  return{settings:currentParsed?.success?currentParsed.data:current?normalizeStoredPromptPresetSettings(current.value):EMPTY_PROMPT_PRESET_SETTINGS,updatedAt:current?.updatedAt??null,degraded:Boolean(current&&!currentParsed?.success)};
});
app.put("/api/system-settings/prompt-presets",async(request)=>{const body=promptPresetPutSchema.parse(request.body);return idempotent(request,"prompt-preset-settings",body,async()=>{
  const updatedAt=nextPromptPresetUpdatedAt(body.baseUpdatedAt),result=await db.putSystemSettingIfUpdated("ui.prompt-presets",body.settings,updatedAt,body.baseUpdatedAt);
  if(!result.updated)throw Object.assign(new Error("Prompt presets changed on another device. Reload and review the merged values."),{statusCode:409,code:"PROMPT_PRESETS_STALE"});
  await db.appendAudit({createdAt:updatedAt,actor:(request as any).actor,action:"prompt-preset-settings",provider:null,taskId:null,projectId:null,outcome:"success",detail:`count=${body.settings.presets.length}`});
  return{settings:body.settings,updatedAt};
});});
app.get("/api/system-settings/locale",async()=>{const[stored,setup,projects]=await Promise.all([db.getSystemSetting("ui.locale"),db.getSystemSetting("setup.progress"),db.listProjects()]);const saved=normalizeStoredLocale(stored?.value);const existingInstallation=Boolean(setup||projects.length);return{locale:saved??(!stored&&existingInstallation?"ko":null),saved:Boolean(saved),existingInstallation,updatedAt:stored?.updatedAt??null};});
app.put("/api/system-settings/locale",async(request)=>{const settings=uiLocaleSettingsSchema.parse(request.body);return idempotent(request,"ui-locale",settings,async()=>{const updatedAt=new Date().toISOString();await db.putSystemSetting("ui.locale",settings,updatedAt);return{locale:settings.locale,updatedAt};});});
app.get("/api/system-settings/claude-execution",async()=>{const stored=await db.getSystemSetting("claude.execution");return{settings:stored?normalizeClaudeExecutionSettings(stored.value):DEFAULT_CLAUDE_EXECUTION_SETTINGS,updatedAt:stored?.updatedAt??null};});
app.put("/api/system-settings/claude-execution",async(request)=>{const settings=claudeExecutionSettingsSchema.parse(request.body);return idempotent(request,"claude-execution-settings",settings,async()=>{const updatedAt=new Date().toISOString();await db.putSystemSetting("claude.execution",settings,updatedAt);await db.appendAudit({createdAt:updatedAt,actor:(request as any).actor,action:"claude-execution-settings",provider:"claude",taskId:null,projectId:null,outcome:"success",detail:`switchModelsOnFlag=${settings.switchModelsOnFlag}`});return{settings,updatedAt};});});
app.get("/api/system-settings/antigravity-execution",async()=>{const stored=await db.getSystemSetting("antigravity.execution"),settings=stored?normalizeAntigravityExecutionSettings(stored.value):DEFAULT_ANTIGRAVITY_EXECUTION;return{settings,updatedAt:stored?.updatedAt??null,adc:{environmentConfigured:Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS),credentialsPathConfigured:Boolean(settings.vertex.credentialsPath)}};});
app.put("/api/system-settings/antigravity-execution",async(request)=>{const settings=antigravityExecutionSettingsSchema.parse(request.body);if(usesVertexCredentials(settings.backend)&&settings.vertex.credentialsPath){let stat:fs.Stats;try{stat=fs.statSync(settings.vertex.credentialsPath);fs.accessSync(settings.vertex.credentialsPath,fs.constants.R_OK);}catch{throw Object.assign(new Error("The configured Vertex ADC credentials file is not readable."),{statusCode:400,code:"VERTEX_ADC_UNREADABLE"});}if(!stat.isFile())throw Object.assign(new Error("The configured Vertex ADC credentials path is not a file."),{statusCode:400,code:"VERTEX_ADC_NOT_FILE"});}return idempotent(request,"antigravity-execution-settings",settings,async()=>{const updatedAt=new Date().toISOString();await db.putSystemSetting("antigravity.execution",settings,updatedAt);quotaCache=null;await db.appendAudit({createdAt:updatedAt,actor:(request as any).actor,action:"antigravity-execution-settings",provider:"antigravity",taskId:null,projectId:null,outcome:"success",detail:usesVertexCredentials(settings.backend)?`backend=${settings.backend};project=${settings.vertex.projectId};location=${settings.vertex.location};adc=${settings.vertex.credentialsPath?"file":"environment"}`:"backend=consumer"});return{settings,updatedAt};});});
app.post("/api/system-settings/antigravity-execution/credentials",{config:{rateLimit:{max:5,timeWindow:"10 minutes"}}},async(request)=>{const query=z.object({projectId:z.string().trim().max(128).optional(),location:z.string().trim().max(64).optional()}).parse(request.query),part=await request.file({limits:{files:1,fileSize:1024*1024,fields:0}});if(!part)throw Object.assign(new Error("Select a Google credentials JSON file."),{statusCode:400,code:"VERTEX_CREDENTIALS_REQUIRED"});if(!part.filename.toLowerCase().endsWith(".json"))throw Object.assign(new Error("The Google credentials file must use the .json extension."),{statusCode:400,code:"VERTEX_CREDENTIALS_NOT_JSON"});const buffer=await part.toBuffer();if(!buffer.length||buffer.length>1024*1024)throw Object.assign(new Error("The Google credentials JSON must be between 1 byte and 1 MiB."),{statusCode:400,code:"VERTEX_CREDENTIALS_SIZE"});let value:unknown;try{value=JSON.parse(buffer.toString("utf8").replace(/^\uFEFF/,""));}catch{throw Object.assign(new Error("The uploaded Google credentials file is not valid JSON."),{statusCode:400,code:"VERTEX_CREDENTIALS_INVALID_JSON"});}let summary;try{summary=parseGoogleCredentialJson(value);}catch(error){throw Object.assign(error instanceof Error?error:new Error(String(error)),{statusCode:400,code:"VERTEX_CREDENTIALS_INVALID"});}if(summary.type!=="service_account")throw Object.assign(new Error("Vertex direct mode currently requires a service_account key JSON."),{statusCode:400,code:"VERTEX_SERVICE_ACCOUNT_REQUIRED"});const digest=crypto.createHash("sha256").update(buffer).digest("hex");return idempotent(request,"antigravity-vertex-credentials",{digest,type:summary.type},async()=>{const stored=await db.getSystemSetting("antigravity.execution"),current=stored?normalizeAntigravityExecutionSettings(stored.value):DEFAULT_ANTIGRAVITY_EXECUTION,home=antigravityHome(config,"vertex"),directory=path.join(home,"credentials"),destination=path.join(directory,"google-credentials.json"),projectId=summary.projectId??query.projectId??current.vertex.projectId;fs.mkdirSync(directory,{recursive:true,mode:0o700});try{fs.chmodSync(directory,0o700);}catch{}const settings=antigravityExecutionSettingsSchema.parse({version:1,backend:current.backend==="vertex-agent"?"vertex-agent":"vertex",vertex:{projectId,location:query.location||current.vertex.location||"global",credentialsPath:destination,creditsUrl:current.vertex.creditsUrl}}),temporary=path.join(directory,`.google-credentials.${crypto.randomUUID()}.tmp`);try{fs.writeFileSync(temporary,buffer,{mode:0o600,flag:"wx"});fs.renameSync(temporary,destination);fs.chmodSync(destination,0o600);}finally{try{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}catch{}}const updatedAt=new Date().toISOString();await db.putSystemSetting("antigravity.execution",settings,updatedAt);quotaCache=null;await db.appendAudit({createdAt:updatedAt,actor:(request as any).actor,action:"antigravity-vertex-credentials-upload",provider:"antigravity",taskId:null,projectId:settings.vertex.projectId,outcome:"success",detail:`type=${summary.type};bytes=${buffer.length};sha256=${digest.slice(0,12)}`});return{settings,updatedAt,credential:{configured:true,type:summary.type,accountLabel:summary.accountLabel,fileName:"google-credentials.json"}};});});
app.post("/api/system-settings/antigravity-execution/test",async()=>{const stored=await db.getSystemSetting("antigravity.execution"),settings=stored?normalizeAntigravityExecutionSettings(stored.value):DEFAULT_ANTIGRAVITY_EXECUTION;const readiness=settings.backend==="vertex-agent"?antigravity.geminiCliReadiness(settings):null;try{const models=await antigravity.getModels(true);return{ok:models.length>0&&(!readiness||readiness.installed),backend:settings.backend,models:models.length,...(readiness?{geminiCli:readiness,...(readiness.installed?{}:{error:"The Gemini CLI is not installed for this Workhouse runtime."})}:{})};}catch(error){return{ok:false,backend:settings.backend,models:0,...(readiness?{geminiCli:readiness}:{}),error:error instanceof Error?sanitizeSensitiveText(error.message):String(error)};}});
app.get("/api/system-settings/compatible-providers",async()=>({settings:{deepseek:compatibleProviderPublicSettings("deepseek",config.dataRoot),ollama:compatibleProviderPublicSettings("ollama",config.dataRoot)}}));
app.put("/api/system-settings/compatible-providers/:provider",{config:{rateLimit:{max:10,timeWindow:"10 minutes"}}},async(request)=>{const{provider}=z.object({provider:z.enum(["deepseek","ollama"])}).parse(request.params),body=z.object({baseUrl:z.string().trim().min(1).max(2048),secret:z.string().max(4096).optional(),clearSecret:z.boolean().optional()}).parse(request.body);return idempotent(request,`compatible-provider-settings:${provider}`,body,async()=>{const settings=saveCompatibleProviderSettings(config.dataRoot,provider,body),updatedAt=new Date().toISOString();await db.appendAudit({createdAt:updatedAt,actor:(request as any).actor,action:"compatible-provider-settings",provider,taskId:null,projectId:null,outcome:"success",detail:`baseOrigin=${new URL(settings.baseUrl).origin};secretChanged=${Boolean(body.secret||body.clearSecret)}`});return{settings,updatedAt};});});
app.get("/api/system-settings/models",async(request)=>{const query=z.object({snapshot:z.enum(["true","false"]).transform(value=>value==="true").optional()}).parse(request.query),stored=await db.getSystemSetting("models.global-catalog"),saved=globalModelSettingsSchema.safeParse(stored?.value);if(query.snapshot&&saved.success){const settings=saved.data,candidates=Object.fromEntries((["codex","claude","deepseek","ollama","antigravity","grok"] as ProviderId[]).map(provider=>[provider,settings[provider].models]));return{settings,candidates,catalogs:null,updatedAt:stored?.updatedAt??null,snapshot:true};}const{codexCatalog,claudeCatalog,deepseekModels,ollamaModels,antigravityModels,grokModels,candidates}=await currentModelCatalogs(),settings=normalizeGlobalModelSettings(stored?.value,candidates),antigravityExecution=normalizeAntigravityExecutionSettings((await db.getSystemSetting("antigravity.execution"))?.value);let updatedAt=stored?.updatedAt??null;if(!stored||JSON.stringify(stored.value)!==JSON.stringify(settings)){updatedAt=new Date().toISOString();await db.putSystemSetting("models.global-catalog",settings,updatedAt);}return{settings,candidates,catalogs:{codex:{fetchedAt:codexCatalog.fetchedAt,stale:codexCatalog.stale},claude:{fetchedAt:claudeCatalog.fetchedAt,stale:claudeCatalog.stale,source:claudeCatalog.source},deepseek:{count:deepseekModels.length,source:"deepseek-api"},ollama:{count:ollamaModels.length,source:"ollama"},antigravity:{count:antigravityModels.length,source:usesVertexCredentials(antigravityExecution.backend)?"vertex-api":"antigravity-cli"},grok:{count:grokModels.length,source:"grok-cli"}},updatedAt,snapshot:false};});
app.put("/api/system-settings/models",async(request)=>{const wrapped=z.object({settings:globalModelSettingsSchema,compatibleDefaults:compatibleDelegationDefaultsSchema}).strict().safeParse(request.body),input=wrapped.success?wrapped.data.settings:request.body,compatibleDefaults=wrapped.success?wrapped.data.compatibleDefaults:undefined,[catalogs,storedDelegation]=await Promise.all([currentModelCatalogs(),db.getSystemSetting("delegation.launch-modes")]),settings=validateGlobalModelSettings(input,catalogs.candidates),idempotencyBody={settings,compatibleDefaults:compatibleDefaults??null};return idempotent(request,"global-model-settings",idempotencyBody,async()=>{const updatedAt=new Date().toISOString(),delegation=applyGlobalDelegationModels(normalizeDelegationSettings(storedDelegation?.value),settings,catalogs.codexCatalog.models,compatibleDefaults);await db.putSystemSetting("models.global-catalog",settings,updatedAt);await db.putSystemSetting("delegation.launch-modes",delegation,updatedAt);await db.appendAudit({createdAt:updatedAt,actor:(request as any).actor,action:"global-model-settings",provider:null,taskId:null,projectId:null,outcome:"success",detail:`claude=${settings.claude.models.map(item=>item.id).join(",")};codex=${settings.codex.models.map(item=>item.id).join(",")};deepseekDefault=${delegation.deepseek.model??"none"};ollamaDefault=${delegation.ollama.model??"none"};antigravityDefault=${delegation.antigravity.model??"none"}`});return{settings,delegation,updatedAt};});});
app.post("/api/system-settings/models/validate",{config:{rateLimit:{max:6,timeWindow:"10 minutes"}}},async(request)=>{const body=z.object({provider:providerParam,model:globalModelIdSchema}).parse(request.body),catalogs=await currentModelCatalogs(true),candidate=catalogs.candidates[body.provider].find(item=>item.id===body.model&&item.source==="runtime");if(candidate)return{valid:true,method:"runtime-catalog",detail:"Confirmed against the official runtime model list.",detailKey:"model.validation.runtimeCatalog",validatedAt:new Date().toISOString()};const result=await verifyCustomModel(body.provider,body.model);return{...result,method:"live-read-only-probe",validatedAt:result.valid?new Date().toISOString():null};});
app.get("/api/system-settings/delegation",async()=>{const stored=await db.getSystemSetting("delegation.launch-modes"),models=await globalModelSettings(),normalized=applyGlobalDelegationModels(normalizeDelegationSettings(stored?.value),models.settings,models.codexCatalog.models),settings=validateDelegationSettings(normalized,enabledCodexCatalog(models.settings,models.codexCatalog.models),true,models.settings.claude.models);let updatedAt=stored?.updatedAt??null;if(!stored||JSON.stringify(stored.value)!==JSON.stringify(settings)){updatedAt=new Date().toISOString();await db.putSystemSetting("delegation.launch-modes",settings,updatedAt);}return{settings,updatedAt,catalogValidated:{codex:true,claude:!models.claudeCatalog.stale}};});
app.put("/api/system-settings/delegation",async(request)=>{const parsed=delegationSettingsSchema.parse(request.body),models=await globalModelSettings(),settings=applyGlobalDelegationModels(validateDelegationSettings(parsed,enabledCodexCatalog(models.settings,models.codexCatalog.models),false,models.settings.claude.models),models.settings,models.codexCatalog.models);return idempotent(request,"delegation-settings",settings,async()=>{const updatedAt=new Date().toISOString();await db.putSystemSetting("delegation.launch-modes",settings,updatedAt);await db.appendAudit({createdAt:updatedAt,actor:(request as any).actor,action:"delegation-settings-v3",provider:null,taskId:null,projectId:null,outcome:"success",detail:`claude=${settings.claude.launchMode}:${settings.claude.model}:${settings.claude.reasoningEffort};codex=${settings.codex.launchMode}:${settings.codex.model??"runtime-default"}:${settings.codex.reasoningEffort??"runtime-default"}:${settings.codex.serviceTier??"standard"};deepseek=${settings.deepseek.model??"global-default"};ollama=${settings.ollama.model??"global-default"};antigravity=${settings.antigravity.model??"global-default"}`});return{settings,updatedAt};});});
app.get("/api/system-settings/path-display",async()=>({hideLocalPaths,scope:"authenticated-user-ui",secretsAlwaysRedacted:true,updatedAt:(await db.getSystemSetting("ui.hide-local-paths"))?.updatedAt??null}));
app.put("/api/system-settings/path-display",async(request)=>{const body=z.object({hideLocalPaths:z.boolean()}).parse(request.body);return idempotent(request,"path-display",body,async()=>{const updatedAt=new Date().toISOString();await db.putSystemSetting("ui.hide-local-paths",{enabled:body.hideLocalPaths,version:1},updatedAt);hideLocalPaths=body.hideLocalPaths;await db.appendAudit({createdAt:updatedAt,actor:(request as any).actor,action:"path-display-setting",provider:null,taskId:null,projectId:null,outcome:"success",detail:`hideLocalPaths=${body.hideLocalPaths}`});return{hideLocalPaths,secretsAlwaysRedacted:true,updatedAt};});});
app.get("/api/system-settings/credit-usage",async()=>{const stored=await db.getSystemSetting("billing.credit-usage");return{settings:stored?normalizeCreditUsageSettings(stored.value):DEFAULT_CREDIT_USAGE_SETTINGS,updatedAt:stored?.updatedAt??null};});
app.get("/api/system-settings/proton-drive",async()=>{const stored=await db.getSystemSetting("proton-drive.v1");return{settings:normalizeProtonDriveSettings(stored?.value),updatedAt:stored?.updatedAt??null};});
app.put("/api/system-settings/proton-drive",async(request)=>{const body=z.object({settings:protonDriveSettingsSchema,baseUpdatedAt:z.string().datetime().nullable()}).parse(request.body);return idempotent(request,"proton-drive-settings",body,async()=>{const updatedAt=new Date().toISOString(),saved=await db.putSystemSettingIfUpdated("proton-drive.v1",body.settings,updatedAt,body.baseUpdatedAt);if(!saved.updated)throw Object.assign(new Error("Proton Drive settings changed in another session. Reload before saving."),{statusCode:409,code:"PROTON_SETTINGS_CONFLICT"});await audit(request,"proton-drive-settings","success",undefined,`enabled=${body.settings.enabled};verify=${body.settings.verifyAfterUpload}`);return{settings:body.settings,updatedAt};});});
app.get("/api/proton-drive/status",async()=>{const stored=await db.getSystemSetting("proton-drive.v1"),settings=normalizeProtonDriveSettings(stored?.value);return protonDriveCli.connection(settings.remoteRoot);});
app.post("/api/proton-drive/auth/attempts",{config:{rateLimit:{max:3,timeWindow:"10 minutes"}}},async(request)=>authIdempotent(request,"proton-drive-login",{},async()=>({attempt:protonDriveLogin.start(crypto.randomUUID())})));
app.get("/api/proton-drive/auth/attempts/:attemptId",async(request)=>{const{attemptId}=z.object({attemptId:z.string().uuid()}).parse(request.params),attempt=protonDriveLogin.get(attemptId);if(!attempt)throw Object.assign(new Error("Proton Drive login attempt not found."),{statusCode:404});return{attempt};});
app.post("/api/proton-drive/auth/attempts/:attemptId/cancel",async(request)=>{const{attemptId}=z.object({attemptId:z.string().uuid()}).parse(request.params),attempt=protonDriveLogin.cancel(attemptId);if(!attempt)throw Object.assign(new Error("Proton Drive login attempt not found."),{statusCode:404});return{attempt};});
app.post("/api/proton-drive/logout",async(request)=>idempotent(request,"proton-drive-logout",{},async()=>{const result=await protonDriveCli.logout();await audit(request,"proton-drive-logout","success");return result;}));
// A file already in the user's Drive does not need to travel through the
// browser, so importing it server-side sidesteps the 90 MiB total multipart cap that is
// right for a phone upload and wrong for a 58MB archive. Only a file the user
// picked below the configured root is ever fetched.
app.get("/api/proton-drive/inbox",async(request)=>{
  const{path:subPath}=z.object({path:z.string().max(1024).default("")}).parse(request.query);
  return protonDriveImport.candidates(subPath);
});
app.post("/api/proton-drive/imports",{config:{rateLimit:{max:10,timeWindow:"5 minutes"}}},async(request)=>{
  const body=z.object({remotePath:z.string().trim().min(1).max(1024)}).parse(request.body);
  return idempotent(request,`proton-drive-import:${body.remotePath}`,body,async()=>{
    const attachment=await protonDriveImport.importFile(body.remotePath);
    await audit(request,"proton-drive-import","success",undefined,`${attachment.name} (${attachment.size} bytes)`);
    return{attachment};
  });
});
app.get("/api/proton-drive/uploads",async(request)=>{const{limit}=z.object({limit:z.coerce.number().int().min(1).max(200).default(50)}).parse(request.query);return{uploads:await protonDriveUploads.list(limit)};});
app.get("/api/proton-drive/uploads/:uploadId",async(request)=>{const{uploadId}=z.object({uploadId:z.string().uuid()}).parse(request.params),upload=await protonDriveUploads.get(uploadId);if(!upload)throw Object.assign(new Error("Upload operation not found."),{statusCode:404});return{upload};});
app.post("/api/tasks/:provider/:taskId/proton-uploads/prepare",{config:{rateLimit:{max:10,timeWindow:"10 minutes"}}},async(request)=>{const{provider,taskId}=z.object({provider:z.enum(["codex","claude","deepseek","ollama","antigravity","grok"]),taskId:z.string().min(1).max(200)}).parse(request.params),body=z.object({workspaceId:z.string().min(1).max(100),relativePath:z.string().trim().min(1).max(4096),confirmExternalUpload:z.literal(true)}).parse(request.body),task=await db.getTask(taskId);if(!task||task.provider!==provider)throw Object.assign(new Error("Task not found."),{statusCode:404});return idempotent(request,`proton-upload-prepare:${taskId}`,body,async()=>{const upload=await protonDriveUploads.prepare({taskId,workspaceId:body.workspaceId,relativePath:body.relativePath});await audit(request,"proton-upload-prepare","success",task,`upload=${upload.id};bytes=${upload.sourceSize}`);return{upload};});});
app.post("/api/proton-drive/uploads/:uploadId/execute",{config:{rateLimit:{max:5,timeWindow:"10 minutes"}}},async(request)=>{const{uploadId}=z.object({uploadId:z.string().uuid()}).parse(request.params),body=z.object({expectedSha256:z.string().regex(/^[a-f0-9]{64}$/),confirmUpload:z.literal(true)}).parse(request.body);return idempotent(request,`proton-upload-execute:${uploadId}`,body,async()=>{try{const upload=await protonDriveUploads.execute(uploadId,body.expectedSha256),task=await db.getTask(upload.taskId);await audit(request,"proton-upload-execute","success",task??undefined,`upload=${upload.id};remote=${upload.remotePath};sha256=${upload.sourceSha256}`);return{upload};}catch(error){const upload=(error as any)?.operation??await protonDriveUploads.get(uploadId);let task=null;if(upload)task=await db.getTask(upload.taskId);await audit(request,"proton-upload-execute","failed",task??undefined,`upload=${uploadId};code=${typeof(error as any)?.code==="string"?(error as any).code:"unknown"}`).catch(()=>{});throw error;}});});
app.post("/api/proton-drive/uploads/:uploadId/cancel",async(request)=>{const{uploadId}=z.object({uploadId:z.string().uuid()}).parse(request.params),body=z.object({confirmCancel:z.literal(true)}).parse(request.body);return idempotent(request,`proton-upload-cancel:${uploadId}`,body,async()=>({upload:await protonDriveUploads.cancel(uploadId)}));});
app.put("/api/system-settings/credit-usage",async(request)=>{const settings=creditUsageSettingsSchema.parse(request.body);return idempotent(request,"credit-usage-settings",settings,async()=>{const updatedAt=new Date().toISOString();await db.putSystemSetting("billing.credit-usage",settings,updatedAt);await db.appendAudit({createdAt:updatedAt,actor:(request as any).actor,action:"credit-usage-settings",provider:null,taskId:null,projectId:null,outcome:"success",detail:`allowPaidCredits=${settings.allowPaidCredits}`});if(settings.allowPaidCredits)void pumpCreditConsentWaits();return{settings,updatedAt};});});
app.get("/api/snapshots",async(request)=>{const query=z.object({state:z.enum(["ready","trashed","error","purged"]).optional()}).parse(request.query),items=await requireSnapshots().list();return{items:query.state?items.filter(item=>item.state===query.state):items.filter(item=>item.state!=="purged")};});
app.get("/api/snapshots/summary",async()=>({summary:await requireSnapshots().summary(),status:snapshotStartupError?"degraded":"ready",error:snapshotStartupError}));
app.post("/api/snapshots/scan",{config:{rateLimit:{max:2,timeWindow:"10 minutes"}}},async(request)=>{const body=z.object({confirmReadOnly:z.literal(true)}).parse(request.body);return idempotent(request,"snapshot-legacy-scan",body,async()=>({legacy:requireSnapshots().legacyInventory()}));});
app.post("/api/snapshots/imports",{config:{rateLimit:{max:3,timeWindow:"10 minutes"}}},async(request)=>{const body=z.object({legacyId:z.string().regex(/^[0-9a-f]{24}$/),confirmMove:z.literal(true)}).parse(request.body);return idempotent(request,`snapshot-legacy-import:${body.legacyId}`,body,async()=>{const item=await requireSnapshots().importLegacy(body.legacyId);await db.appendAudit({createdAt:new Date().toISOString(),actor:(request as any).actor,action:"snapshot-legacy-import",provider:null,taskId:null,projectId:null,outcome:"success",detail:`snapshot=${item.id};legacy=${body.legacyId};filesDeleted=false;sourceMoved=true`});return{item};});});
app.patch("/api/snapshots/:snapshotId",async(request)=>{const{snapshotId}=z.object({snapshotId:z.string().uuid()}).parse(request.params),body=z.object({pinned:z.boolean()}).parse(request.body);return idempotent(request,`snapshot-pin:${snapshotId}`,body,async()=>{const item=await requireSnapshots().setPinned(snapshotId,body.pinned);await db.appendAudit({createdAt:new Date().toISOString(),actor:(request as any).actor,action:body.pinned?"snapshot-pin":"snapshot-unpin",provider:null,taskId:null,projectId:null,outcome:"success",detail:`snapshot=${snapshotId}`});return{item};});});
app.post("/api/snapshots/:snapshotId/trash",{config:{rateLimit:{max:10,timeWindow:"10 minutes"}}},async(request)=>{const{snapshotId}=z.object({snapshotId:z.string().uuid()}).parse(request.params),body=z.object({confirm:z.literal(true)}).parse(request.body);return idempotent(request,`snapshot-trash:${snapshotId}`,body,async()=>{const item=await requireSnapshots().trash(snapshotId);await db.appendAudit({createdAt:new Date().toISOString(),actor:(request as any).actor,action:"snapshot-trash",provider:null,taskId:null,projectId:null,outcome:"success",detail:`snapshot=${snapshotId};filesDeleted=false`});return{item};});});
app.post("/api/snapshots/:snapshotId/untrash",{config:{rateLimit:{max:10,timeWindow:"10 minutes"}}},async(request)=>{const{snapshotId}=z.object({snapshotId:z.string().uuid()}).parse(request.params),body=z.object({confirm:z.literal(true)}).parse(request.body);return idempotent(request,`snapshot-untrash:${snapshotId}`,body,async()=>{const item=await requireSnapshots().untrash(snapshotId);await db.appendAudit({createdAt:new Date().toISOString(),actor:(request as any).actor,action:"snapshot-untrash",provider:null,taskId:null,projectId:null,outcome:"success",detail:`snapshot=${snapshotId}`});return{item};});});
app.post("/api/snapshots/:snapshotId/purge",{config:{rateLimit:{max:5,timeWindow:"10 minutes"}}},async(request)=>{const{snapshotId}=z.object({snapshotId:z.string().uuid()}).parse(request.params),body=z.object({confirmation:z.string()}).parse(request.body);if(body.confirmation!==`PURGE ${snapshotId}`)throw Object.assign(new Error("Permanent deletion confirmation did not match."),{statusCode:409,code:"SNAPSHOT_CONFIRMATION_MISMATCH"});return idempotent(request,`snapshot-purge:${snapshotId}`,body,async()=>{const item=await requireSnapshots().purge(snapshotId);await db.appendAudit({createdAt:new Date().toISOString(),actor:(request as any).actor,action:"snapshot-purge",provider:null,taskId:null,projectId:null,outcome:"success",detail:`snapshot=${snapshotId};filesDeleted=true`});return{item};});});
app.get("/api/system/diagnostics",async()=>{const [databaseResult,runtimes,accounts,hosts,roots,workspaces,pushSubscriptions]=await Promise.all([db.ping().then(value=>({ok:true as const,value}),error=>({ok:false as const,error})),displayedRuntimeStatuses(),providerConnectionAccounts(),db.listHosts().catch(()=>[]),db.listWorkspaceRoots().catch(()=>[]),db.listWorkspaces().catch(()=>[]),db.listPushSubscriptions().catch(()=>[])]);const disk=fs.statfsSync(config.dataDir),git=await new Promise<string>(resolve=>{const child=spawn("git",["--version"],{shell:false,windowsHide:true,stdio:["ignore","pipe","ignore"]});let value="";child.stdout.on("data",chunk=>value+=String(chunk));child.once("error",()=>resolve("unavailable"));child.once("close",code=>resolve(code===0?value.trim().slice(0,80):"unavailable"));});const queue=db.diagnostics();return{report:{server:"ok",database:databaseResult.ok?{ok:true,...databaseResult.value}:{ok:false,error:databaseResult.error instanceof DatabaseRequestError?databaseResult.error.kind:"unavailable"},databaseQueue:queue,storage:{dataDirectory:config.dataDir,logDirectory:config.logDir,freeBytes:Number(disk.bavail)*Number(disk.bsize)},sse:{connections:streamConnections,limit:24},serviceWorker:"push-only-no-cache",push:{subscriptions:pushSubscriptions.length,configured:Boolean(pushManager.publicKey)},localHost:hosts.find(item=>item.id===LOCAL_HOST_ID)?.status??"unknown",desktopWorkers:hosts.filter(item=>item.type==="worker").map(item=>({id:item.id.slice(0,8),status:item.status,platform:item.platform,workerVersion:item.workerVersion,lastSeenAt:item.lastSeenAt})),runtimes:runtimes.map(item=>({provider:item.provider,current:item.current,managed:item.managed,source:item.source})),providerAccounts:accounts.map(item=>({provider:item.provider,state:item.state,accountType:item.accountType,planType:item.planType,errorCategory:item.errorCategory})),workspace:{roots:roots.map(item=>item.canonicalPath),registered:workspaces.map(item=>item.canonicalPath)},git,cloudflareAccess:{mode:config.authMode,configured:Boolean(config.teamDomain&&config.audience)},mcpEmotion:{bundled:true,state:emotion.get()?.emotion??"unknown",outfits:emotion.outfits().length},pathDisplay:{hideLocalPaths,secretsAlwaysRedacted:true}}};});
app.get("/api/push",async()=>({supported:true,publicKey:pushManager.publicKey,preferences:await pushManager.preferences(),subscriptions:(await db.listPushSubscriptions()).map(item=>({id:item.id,endpointHash:item.endpointHash,browserLabel:item.browserLabel,lastUsedAt:item.lastUsedAt}))}));
app.post("/api/push/subscriptions",{config:{rateLimit:{max:10,timeWindow:"10 minutes"}}},async(request)=>{const body=z.object({subscription:z.object({endpoint:z.string().url().max(4096),expirationTime:z.number().nullable().optional(),keys:z.object({p256dh:z.string().min(16).max(512),auth:z.string().min(8).max(256)})}),browserLabel:z.string().max(80).default("Browser")}).parse(request.body);return authIdempotent(request,"push-subscribe",{endpointHash:hash(body.subscription.endpoint)},()=>pushManager.subscribe(body.subscription,body.browserLabel));});
app.post("/api/push/unsubscribe",async(request)=>{const body=z.object({endpoint:z.string().url().max(4096)}).parse(request.body);return authIdempotent(request,"push-unsubscribe",{endpointHash:hash(body.endpoint)},()=>pushManager.unsubscribe(body.endpoint));});
app.post("/api/push/unsubscribe-all",async(request)=>{const body=z.object({confirm:z.literal(true)}).parse(request.body);return idempotent(request,"push-unsubscribe-all",body,()=>pushManager.unsubscribeAll());});
app.put("/api/push/preferences",async(request)=>{const body=z.object({approvals:z.boolean(),userInput:z.boolean(),completed:z.boolean(),failed:z.boolean(),hostOffline:z.boolean(),handoff:z.boolean(),vibration:z.boolean(),quietStart:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),quietEnd:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable()}).parse(request.body);return idempotent(request,"push-preferences",body,async()=>({preferences:await pushManager.savePreferences(body)}));});
app.post("/api/push/presence",{config:{rateLimit:{max:60,timeWindow:"1 minute"}}},async(request)=>{const body=z.object({browserId:z.string().uuid(),visible:z.boolean()}).parse(request.body);return authIdempotent(request,"push-presence",body,async()=>{pushManager.markForeground(body.browserId,body.visible);return{ok:true};});});
app.get("/api/providers", async () => ({ providers: [...providers.values()].map((item) => ({ id: item.id, name:{codex:"Codex",claude:"Claude",deepseek:"DeepSeek",ollama:"Ollama",antigravity:"Gemini",grok:"Grok"}[item.id], capabilities: item.id === "codex" ? ["create", "detail", "resume", "fork", "stop"] : ["create", "detail-owned", "resume-owned", "fork-owned", "stop-owned"], ...item.capabilities })) }));
app.get("/api/features",async()=>({features:featureHealth}));
app.get("/api/providers/codex/models", async (request) => {const catalog=await codex.getModels((request.query as any)?.refresh === "true");await observeModelCatalog("codex",catalog);return{catalog};});
app.get("/api/providers/claude/permissions",{config:{rateLimit:{max:10,timeWindow:"10 minutes"}}},async(request)=>{const catalog=await claudeModelCatalog.get((request.query as any)?.refresh==="true");await observeModelCatalog("claude",catalog);return{permissions:ClaudeProvider.permissions,models:catalog.models,efforts:ClaudeProvider.efforts,runtime:readClaudeRuntime(config.dataRoot),catalog};});
app.get("/api/providers/deepseek/models",{config:{rateLimit:{max:10,timeWindow:"10 minutes"}}},async(request)=>{const catalog=await deepseek.getModelCatalog((request.query as any)?.refresh==="true");await observeModelCatalog("deepseek",catalog);return{models:catalog.models,catalog,permissions:ClaudeProvider.permissions,efforts:ClaudeProvider.efforts,health:await deepseek.healthCheck()};});
app.get("/api/providers/ollama/models",{config:{rateLimit:{max:10,timeWindow:"10 minutes"}}},async(request)=>{const catalog=await ollama.getModelCatalog((request.query as any)?.refresh==="true");await observeModelCatalog("ollama",catalog);return{models:catalog.models,catalog,permissions:ClaudeProvider.permissions,efforts:ClaudeProvider.efforts,health:await ollama.healthCheck()};});
app.get("/api/providers/antigravity/models",{config:{rateLimit:{max:10,timeWindow:"10 minutes"}}},async(request)=>{const catalog=await antigravity.getModelCatalog((request.query as any)?.refresh==="true");await observeModelCatalog("antigravity",catalog);return{models:catalog.models,catalog,permissions:ClaudeProvider.permissions,efforts:[{id:"default",displayName:"Default"},{id:"low",displayName:"Low"},{id:"medium",displayName:"Medium"},{id:"high",displayName:"High"}],health:await antigravity.healthCheck()};});
app.get("/api/providers/grok/models",{config:{rateLimit:{max:10,timeWindow:"10 minutes"}}},async(request)=>{const catalog=await grok.getModelCatalog((request.query as any)?.refresh==="true");await observeModelCatalog("grok",catalog);return{models:catalog.models,catalog,permissions:GrokProvider.permissions,efforts:[{id:"default",displayName:"Default"},...[...GrokProvider.validEfforts].map(id=>({id,displayName:id}))],health:await grok.healthCheck()};});
async function providerConnectionAccounts(){
  const compatibleAccount=async(provider:"deepseek"|"ollama")=>{
    const checkedAt=new Date().toISOString(),accountType="api-key";
    if(managedLocalWorkerRequired)return{provider,state:"unavailable" as const,accountType,planType:null,emailMasked:null,errorCategory:"local-runtime-required",checkedAt};
    const health=await({antigravity,deepseek,ollama}[provider].healthCheck()),detail=health.detail as any,runtime=detail?.runtime===true;
    const connected=health.ok;
    const errorCategory=connected?null:!runtime?"runtime_unavailable":provider==="deepseek"?"api_key_required":"ollama_api_key_required";
    return{provider,state:connected?"connected" as const:runtime?"disconnected" as const:"unavailable" as const,accountType,planType:null,emailMasked:null,errorCategory,checkedAt};
  };
  const compatibleAccounts=()=>Promise.all((["deepseek","ollama"] as const).map(compatibleAccount));
  if(!managedLocalWorkerRequired)return[...await providerAuth.refreshAll(),...await compatibleAccounts()];
  const status=await workerProviderStatus() as any,checkedAt=new Date().toISOString();
  return[...(["codex","claude"] as const).map(provider=>({provider,state:status?.accounts?.[provider]?.state??"unknown",accountType:status?.accounts?.[provider]?.accountType??null,planType:status?.accounts?.[provider]?.planType??null,emailMasked:null,errorCategory:status?.accounts?.[provider]?.errorCategory??null,checkedAt,readiness:status?.readiness?.[provider]??null})),{provider:"antigravity" as const,state:"unavailable" as const,accountType:"google-oauth",planType:null,emailMasked:null,errorCategory:"local-runtime-required",checkedAt},{provider:"grok"as const,state:"unavailable"as const,accountType:"grok-oauth",planType:null,emailMasked:null,errorCategory:"local-runtime-required",checkedAt},...await compatibleAccounts()];
}
function assertManagedWindowsProviderLoginUnavailable(provider:AuthProvider){
  if(managedLocalWorkerRequired&&!(["codex","claude"] as string[]).includes(provider))throw Object.assign(new Error("Complete Provider login in the official CLI, then refresh its status."),{statusCode:409,code:"WINDOWS_PROVIDER_LOGIN_EXTERNAL"});
}
app.get("/api/provider-connections",{config:{rateLimit:{max:20,timeWindow:"10 minutes"}}},async(request)=>({accounts:await providerConnectionAccounts(),attempts:providerAuth.listRecent((request as any).actor),singleUser:true}));
app.get("/api/provider-connections/attempts",{config:{rateLimit:{max:90,timeWindow:"1 minute"}}},async(request)=>({attempts:providerAuth.listRecent((request as any).actor)}));
app.post("/api/provider-connections/:provider/login",{config:{rateLimit:{max:5,timeWindow:"10 minutes"}}},async(request)=>{
  const provider=connectionAuthProviderParam.parse((request.params as any).provider) as AuthProvider;
  assertManagedWindowsProviderLoginUnavailable(provider);
  const body=z.object({method:z.enum(["device","browser","subscription","console","sso","google-oauth","google-cloud"])}).parse(request.body) as{method:LoginMethod};
  if(provider==="codex"&&!(["device","browser"] as string[]).includes(body.method))throw Object.assign(new Error("This Codex login method is not supported."),{statusCode:400,code:"CODEX_LOGIN_METHOD_UNSUPPORTED"});
  if(provider==="claude"&&!(["subscription","console","sso"] as string[]).includes(body.method))throw Object.assign(new Error("This Claude login method is not supported."),{statusCode:400,code:"CLAUDE_LOGIN_METHOD_UNSUPPORTED"});
  if(provider==="antigravity"&&body.method!=="google-oauth"&&body.method!=="google-cloud")throw Object.assign(new Error("This Gemini login method is not supported."),{statusCode:400,code:"ANTIGRAVITY_LOGIN_METHOD_UNSUPPORTED"});
  if(provider==="grok"&&body.method!=="google-oauth"&&body.method!=="device")throw Object.assign(new Error("This Grok login method is not supported."),{statusCode:400,code:"GROK_LOGIN_METHOD_UNSUPPORTED"});
  return authIdempotent(request,`provider-auth-start:${provider}`,body,async()=>({attempt:await providerAuth.start(provider,body.method,(request as any).actor)}));
});
app.post("/api/provider-connections/:provider/attempts/:attemptId/code",{config:{rateLimit:{max:5,timeWindow:"5 minutes"}}},async(request)=>{
  const params=z.object({provider:connectionAuthProviderParam,attemptId:z.string().uuid()}).parse(request.params);
  assertManagedWindowsProviderLoginUnavailable(params.provider);
  const body=z.object({nonce:z.string().min(16).max(128),code:z.string().min(1).max(512).regex(/^[A-Za-z0-9._~+/=:#-]+$/)}).parse(request.body);
  return authIdempotent(request,`provider-auth-code:${params.provider}:${params.attemptId}`,body,async()=>({attempt:await providerAuth.submitCode(params.provider,params.attemptId,body.nonce,body.code)}));
});
app.post("/api/provider-connections/:provider/attempts/:attemptId/cancel",{config:{rateLimit:{max:10,timeWindow:"10 minutes"}}},async(request)=>{
  const params=z.object({provider:connectionAuthProviderParam,attemptId:z.string().uuid()}).parse(request.params);const body=z.object({confirm:z.literal(true)}).parse(request.body);
  assertManagedWindowsProviderLoginUnavailable(params.provider);
  return authIdempotent(request,`provider-auth-cancel:${params.provider}:${params.attemptId}`,body,async()=>({attempt:await providerAuth.cancel(params.provider,params.attemptId)}));
});
app.post("/api/provider-connections/:provider/logout",{config:{rateLimit:{max:3,timeWindow:"10 minutes"}}},async(request)=>{
  const provider=connectionAuthProviderParam.parse((request.params as any).provider) as AuthProvider;const body=z.object({confirm:z.literal(true)}).parse(request.body);
  assertManagedWindowsProviderLoginUnavailable(provider);
  return authIdempotent(request,`provider-auth-logout:${provider}`,body,async()=>{const account=await providerAuth.logout(provider);await db.appendAudit({createdAt:new Date().toISOString(),actor:(request as any).actor,action:"provider-auth-logout",provider,taskId:null,projectId:null,outcome:"success",detail:null});return{account};});
});
app.get("/api/provider-connections/:provider/attempts/:attemptId/events",{config:{rateLimit:{max:12,timeWindow:"5 minutes"}}},async(request,reply)=>{
  const params=z.object({provider:connectionAuthProviderParam,attemptId:z.string().uuid()}).parse(request.params);const allowedOrigins=new Set([config.externalOrigin,...(config.authMode==="test"?["http://127.0.0.1:3410"]:[])]);
  assertManagedWindowsProviderLoginUnavailable(params.provider);
  if(typeof request.headers.origin==="string"&&!allowedOrigins.has(request.headers.origin))throw Object.assign(new Error("Origin is not allowed for authentication streams."),{statusCode:403});
  providerAuth.view(params.provider,params.attemptId);const perAttempt=authAttemptStreams.get(params.attemptId)??0;
  if(authStreamConnections>=4||perAttempt>=2)throw Object.assign(new Error("Too many authentication stream connections."),{statusCode:429});
  authStreamConnections++;authAttemptStreams.set(params.attemptId,perAttempt+1);reply.hijack();const response=reply.raw;
  response.writeHead(200,{"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-store, no-cache, must-revalidate","Connection":"keep-alive","X-Accel-Buffering":"no","Content-Encoding":"identity"});response.write("retry: 5000\n\n");
  let closed=false,unsubscribe=()=>{};const close=()=>{if(closed)return;closed=true;unsubscribe();clearInterval(heartbeat);authStreamConnections=Math.max(0,authStreamConnections-1);const next=Math.max(0,(authAttemptStreams.get(params.attemptId)??1)-1);if(next)authAttemptStreams.set(params.attemptId,next);else authAttemptStreams.delete(params.attemptId);};
  const terminal=new Set(["completed","failed","cancelled","timeout"]);unsubscribe=providerAuth.subscribe(params.provider,params.attemptId,event=>{if(closed||response.destroyed||response.writableLength>128*1024)return;response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);if(terminal.has(event.state))setTimeout(()=>{if(!response.destroyed)response.end();close();},50).unref?.();});
  const heartbeat=setInterval(()=>{if(!closed&&!response.destroyed)response.write(`: heartbeat ${Date.now()}\n\n`);},15000);heartbeat.unref?.();request.raw.once("close",close);response.once("close",close);response.once("error",close);
});
let lastRuntimeCheck:Awaited<ReturnType<typeof localRuntimeStatuses>>|null=null;
async function displayedRuntimeStatuses(){
  const local=await localRuntimeStatuses(config.appRoot,config.dataRoot);
  const external=await externalRuntimeStatuses(config.appRoot,config.dataRoot,local).catch(()=>[]);
  if(!managedLocalWorkerRequired)return[...local.map(item=>({...item,...lastRuntimeCheck?.find(cached=>cached.provider===item.provider)})),...external];
  const status=await workerProviderStatus().catch(()=>null) as any;
  // The Worker enforces one capability table at launch. Attaching the matching
  // row to every runtime the screen renders is what keeps the six-provider list
  // from advertising something the Worker would refuse — the runtime screen
  // classifies a provider, this says whether it can actually run right now.
  const capability=(provider:string)=>(status?.capabilities as any[])?.find(entry=>entry.provider===provider)??null;
  return[...local.map(item=>{const checked=lastRuntimeCheck?.find(cached=>cached.provider===item.provider),worker=status?.runtimes?.[item.provider],discovery=worker?.discovery;return{...item,...checked,current:item.current??discovery?.version??worker?.version??null,managed:item.managed,canUpdate:item.managed,source:item.managed?item.source:discovery?.source??discovery?.errorCategory??item.source,activeBinary:worker?.binaryPath??discovery?.binaryPath??null,activeVersion:discovery?.version??worker?.version??null,updateInProgress:status?.updateInProgress===true,readiness:status?.readiness?.[item.provider]??null,capability:capability(item.provider)};}),
    ...external.map(item=>({...item,capability:capability(item.provider)}))];
}
app.get("/api/runtime-updates",async()=>({runtimes:await displayedRuntimeStatuses(),autoUpdate:runtimeUpdates.settings()}));
app.post("/api/runtime-updates/check",{config:{rateLimit:{max:10,timeWindow:"10 minutes"}}},async()=>{lastRuntimeCheck=await runtimeUpdates.checkNow();return{runtimes:await displayedRuntimeStatuses(),autoUpdate:runtimeUpdates.settings()};});
app.put("/api/runtime-updates/settings",async(request)=>{
  const body=z.object({version:z.literal(1).default(1),providers:z.object({codex:z.boolean(),claude:z.boolean()})}).parse(request.body);
  const autoUpdate=await runtimeUpdates.setSettings(normalizeRuntimeAutoUpdate(body));
  await audit(request,"runtime-auto-update-settings","success",undefined,`codex=${autoUpdate.providers.codex};claude=${autoUpdate.providers.claude}`);
  return{autoUpdate};
});
let runtimeUpdateStreams=0;
app.get("/api/runtime-updates/events",{config:{rateLimit:{max:20,timeWindow:"5 minutes"}}},async(request,reply)=>{
  if(runtimeUpdateStreams>=8)throw Object.assign(new Error("Too many runtime update streams."),{statusCode:429});
  runtimeUpdateStreams++;reply.hijack();const response=reply.raw;
  response.writeHead(200,{"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-store, no-cache, must-revalidate","Connection":"keep-alive","X-Accel-Buffering":"no","Content-Encoding":"identity"});response.write("retry: 5000\n\n");
  let closed=false;const rawLast=request.headers["last-event-id"],after=typeof rawLast==="string"&&/^\d+$/.test(rawLast)?Number(rawLast):0;
  const send=(event:any)=>{if(closed||response.destroyed||response.writableLength>128*1024)return;response.write(`id: ${event.sequence}\nevent: runtime-update\ndata: ${JSON.stringify(sanitizeSensitiveValue(event))}\n\n`);};
  const unsubscribe=runtimeUpdates.subscribe(after,send),heartbeat=setInterval(()=>{if(!closed&&!response.destroyed)response.write(`: heartbeat ${Date.now()}\n\n`);},15000);heartbeat.unref?.();
  const close=()=>{if(closed)return;closed=true;unsubscribe();clearInterval(heartbeat);runtimeUpdateStreams=Math.max(0,runtimeUpdateStreams-1);};
  request.raw.once("close",close);response.once("close",close);response.once("error",close);
});
let modelCatalogStreams=0;
app.get("/api/model-catalog/events",{config:{rateLimit:{max:20,timeWindow:"5 minutes"}}},async(request,reply)=>{
  if(modelCatalogStreams>=8)throw Object.assign(new Error("Too many model catalog streams."),{statusCode:429});
  modelCatalogStreams++;reply.hijack();const response=reply.raw;
  response.writeHead(200,{"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-store, no-cache, must-revalidate","Connection":"keep-alive","X-Accel-Buffering":"no","Content-Encoding":"identity"});response.write("retry: 5000\n\n");
  let closed=false;const rawLast=request.headers["last-event-id"],after=typeof rawLast==="string"&&/^\d+$/.test(rawLast)?Number(rawLast):0;
  const send=(event:any)=>{if(closed||response.destroyed||response.writableLength>128*1024)return;response.write(`id: ${event.sequence}\nevent: model-catalog\ndata: ${JSON.stringify(sanitizeSensitiveValue(event))}\n\n`);};
  const unsubscribe=modelAnnouncements.subscribe(after,send),heartbeat=setInterval(()=>{if(!closed&&!response.destroyed)response.write(`: heartbeat ${Date.now()}\n\n`);},15000);heartbeat.unref?.();
  const close=()=>{if(closed)return;closed=true;unsubscribe();clearInterval(heartbeat);modelCatalogStreams=Math.max(0,modelCatalogStreams-1);};request.raw.once("close",close);response.once("close",close);response.once("error",close);
});
app.post("/api/runtime-updates/:provider",{config:{rateLimit:{max:3,timeWindow:"10 minutes"}}},async(request)=>{
  const provider=authProviderParam.parse((request.params as any).provider);z.object({confirm:z.literal(true)}).parse(request.body);
  lastRuntimeCheck=await runtimeMutation(()=>applyRuntimeUpdate(config.appRoot,provider,config.dataRoot));const runtimes=await displayedRuntimeStatuses();
  if(provider==="codex")resetCodexAppServerPool();
  await refreshModelCatalogsAfterRuntimeUpdate().catch(()=>{});
  await audit(request,`${provider}-runtime-update`,"success",undefined,runtimes.find(item=>item.provider===provider)?.current??"unknown");
  return{runtimes,autoUpdate:runtimeUpdates.settings()};
});
app.post("/api/runtime-installs/:provider",{config:{rateLimit:{max:3,timeWindow:"10 minutes"}}},async(request)=>{
  const provider=authProviderParam.parse((request.params as any).provider);z.object({confirm:z.literal(true)}).parse(request.body);
  const runtimes=await runtimeMutation(()=>installRuntime(config.appRoot,provider,config.dataRoot));
  if(provider==="codex")resetCodexAppServerPool();
  if(managedLocalWorkerConfig){
    const binary=managedRuntimeBinary(config.dataRoot,provider);
    managedLocalWorkerConfig[provider==="claude"?"claudeBinary":"codexBinary"]=binary;
    managedLocalWorkerConfig.providerBinaries={...(managedLocalWorkerConfig.providerBinaries??{}),[provider]:{selectedPath:binary,verifiedPath:null,source:"user-selected",interfaceKind:"cli",version:null,verifiedAt:null,lastError:null}};
    saveWorkerConfig(managedLocalWorkerConfig);
    if(workerHub.isOnline(LOCAL_HOST_ID))await workerHub.request(LOCAL_HOST_ID,"provider.binary.select",{provider,path:binary},crypto.randomUUID(),60_000);
    invalidateProviderStatus();
  }
  await audit(request,`${provider}-runtime-install`,"success",undefined,runtimes.find(item=>item.provider===provider)?.current??"unknown");
  return{runtimes:await displayedRuntimeStatuses().catch(()=>runtimes),accounts:await providerConnectionAccounts().catch(()=>[])};
});

// Mobile attachments (screenshots, logs). Files land in data/uploads and are
// referenced by absolute path in the prompt; agents read them with their own
// file tools. Old uploads are pruned on boot (7 days).
const uploadsDir = path.join(config.dataDir, "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });
try { for (const name of fs.readdirSync(uploadsDir)) { const file = path.join(uploadsDir, name); if (Date.now() - fs.statSync(file).mtimeMs > 7 * 86400000) fs.rmSync(file, { force: true }); } } catch { /* ignore */ }
async function saveUploadPart(part:any){
  const safe=(path.basename(part.filename??"file").replace(/[^\w.\- ()가-힣]/g,"_").slice(0,80))||"file",dest=path.join(uploadsDir,`${crypto.randomUUID().slice(0,8)}-${safe}`);
  await pipeline(part.file,fs.createWriteStream(dest,{mode:0o600}));
  if(part.file.truncated){fs.rmSync(dest,{force:true});throw Object.assign(new Error("File exceeds the 90 MiB browser upload limit."),{statusCode:413,code:"UPLOAD_TOO_LARGE"});}
  return{path:dest,name:safe,size:fs.statSync(dest).size};
}
// The conversation timeline shows what the user attached, and an attachment is
// worth showing only when it can be looked at. Serving is deliberately narrow:
// one file directly inside the uploads directory, matched against the exact
// name shape saveUploadPart writes, and only when the bytes really are an
// image. Anything else stays a text reference.
app.get("/api/uploads/:name",{config:{rateLimit:{max:120,timeWindow:"1 minute"}}},async(request,reply)=>{
  const{name}=z.object({name:z.string().min(1).max(200).regex(/^[0-9a-f]{8}-[^/\\]+$/)}).parse(request.params);
  const real=path.join(uploadsDir,name);
  if(path.dirname(path.resolve(real))!==path.resolve(uploadsDir))throw Object.assign(new Error("Upload was not found."),{statusCode:404,code:"UPLOAD_NOT_FOUND"});
  let size=0;
  try{const stat=fs.statSync(real);if(!stat.isFile())throw new Error("not a file");size=stat.size;}
  catch{throw Object.assign(new Error("Upload was not found."),{statusCode:404,code:"UPLOAD_NOT_FOUND"});}
  const signature=Buffer.alloc(Math.min(32,size)),fd=fs.openSync(real,"r");
  try{if(signature.length)fs.readSync(fd,signature,0,signature.length,0);}finally{fs.closeSync(fd);}
  const mime=workspaceImageMime(signature);
  if(!mime)throw Object.assign(new Error("Upload is not a supported image."),{statusCode:415,code:"UPLOAD_NOT_IMAGE"});
  reply.header("Cache-Control","private, max-age=300");reply.header("Content-Type",mime);reply.header("Content-Length",String(size));reply.header("Content-Disposition",inlineDisposition(name));
  return reply.send(fs.createReadStream(real));
});
app.post("/api/uploads", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request) => {
  const saved: Array<{ path: string; name: string; size: number }> = [];
  let total=0;
  try{
    for await (const part of request.files()) {
      const file=await saveUploadPart(part);
      try{total=addBrowserUploadBytes(total,file.size);}catch(error){fs.rmSync(file.path,{force:true});throw error;}
      saved.push(file);
    }
    if (!saved.length) throw Object.assign(new Error("No file received."), { statusCode: 400 });
    await audit(request, "upload", "success", undefined, saved.map((item) => item.name).join(", "));
    return { files: saved };
  }catch(error){for(const file of saved)fs.rmSync(file.path,{force:true});throw error;}
});
type ShareTargetPayload={title:string;text:string;url:string;files:Array<{path:string;name:string;size:number}>;expiresAt:number;consumed:boolean};
const shareTargetPayloads=new Map<string,ShareTargetPayload>();
app.post("/api/share-target",{config:{rateLimit:{max:10,timeWindow:"1 minute"}}},async(request,reply)=>{
  const fields:Record<string,string>={},files:ShareTargetPayload["files"]=[];let total=0;
  try{
    for await(const part of request.parts()){
      if(part.type==="file"){if(part.fieldname==="files"){const file=await saveUploadPart(part);try{total=addBrowserUploadBytes(total,file.size);}catch(error){fs.rmSync(file.path,{force:true});throw error;}files.push(file);}else part.file.resume();}
      else if(["title","text","url"].includes(part.fieldname))fields[part.fieldname]=String(part.value??"").slice(0,20_000);
    }
    if(!fields.title?.trim()&&!fields.text?.trim()&&!fields.url?.trim()&&!files.length)throw Object.assign(new Error("No shared content received."),{statusCode:400});
    const token=crypto.randomUUID(),expiresAt=Date.now()+10*60_000;
    shareTargetPayloads.set(token,{title:fields.title??"",text:fields.text??"",url:fields.url??"",files,expiresAt,consumed:false});
    setTimeout(()=>{const payload=shareTargetPayloads.get(token);shareTargetPayloads.delete(token);if(payload&&!payload.consumed)for(const file of payload.files)fs.rmSync(file.path,{force:true});},10*60_000).unref?.();
    await audit(request,"share-target-receive","success",undefined,`files=${files.length};text=${Boolean(fields.text?.trim())};url=${Boolean(fields.url?.trim())}`);
    return reply.code(303).header("Location",`/?share=${encodeURIComponent(token)}`).send();
  }catch(error){for(const file of files)fs.rmSync(file.path,{force:true});throw error;}
});
app.get("/api/share-target/:token",async(request)=>{
  const {token}=z.object({token:z.string().uuid()}).parse(request.params),payload=consumeShareTargetPayload(shareTargetPayloads.get(token));
  if(!payload)throw Object.assign(new Error("Shared content expired or was already opened."),{statusCode:404,code:"SHARE_TARGET_EXPIRED"});
  return{title:payload.title,text:payload.text,url:payload.url,files:payload.files};
});

// Usage readout: Claude through the official CLI's /usage screen in an isolated
// safe-mode PTY, Codex through app-server account/rateLimits/read. Cached 60s.
type ObservedProviderUsage={inputTokens:number;outputTokens:number;totalTokens:number;taskCount:number;periodDays:number;updatedAt:string|null};
type QuotaResult = ProviderQuota & { error: "rate_limited" | "unavailable" | null; retryAt: string | null; usage?:ObservedProviderUsage|null; limitsAvailable?:boolean; balance?:ProviderBalance|null; quotaMode?:"vertex-credit"; projectId?:string; location?:string; creditsUrl?:string };
type QuotaData={claude:QuotaResult;codex:QuotaResult;antigravity:QuotaResult;deepseek:QuotaResult;ollama:QuotaResult;grok:QuotaResult;fetchedAt:string};
let quotaCache: { data: QuotaData; at: number } | null = null;
let quotaPending: Promise<QuotaData> | null = null;
const QUOTA_WAIT_MS=8000;
const UNVERIFIED_QUOTA:QuotaResult={fiveHour:null,sevenDay:null,status:"partial",error:"unavailable",retryAt:null};
const NO_ACCOUNT_LIMITS:QuotaResult={fiveHour:null,sevenDay:null,status:"partial",error:null,retryAt:null,limitsAvailable:false,usage:null};
async function observedProviderUsage(providerId:Extract<ProviderId,"antigravity"|"deepseek"|"ollama">,modelBackend?:string):Promise<QuotaResult>{
  const cutoff=Date.now()-7*24*60*60_000,rows=(await db.listProviderTasks(providerId)).filter(task=>Date.parse(task.updatedAt)>=cutoff&&(!modelBackend||task.metadata?.modelBackend===modelBackend)),number=(...values:unknown[])=>{for(const value of values){const parsed=Number(value);if(Number.isFinite(parsed)&&parsed>=0)return parsed;}return 0;};let inputTokens=0,outputTokens=0,taskCount=0,updatedAt:string|null=null;
  // Gemini reports conversation-cumulative totals rather than per-turn ones, and
  // one conversation spans many tasks here. Summing those would count every
  // earlier turn again on each follow-up, so cumulative readings collapse to the
  // largest snapshot per thread while per-turn readings still add up.
  const cumulativeByThread=new Map<string,{input:number;output:number;tasks:number}>();
  for(const task of rows){
    const usage=task.metadata?.outputUsage as Record<string,unknown>|undefined,cumulativeOnly=!usage||usage.outputTokens===undefined;
    const source=(cumulativeOnly?(task.metadata?.conversationUsage as Record<string,unknown>|undefined)??usage:usage) as Record<string,unknown>|undefined;
    if(!source)continue;
    const input=number(source.inputTokens,source.input_tokens,source.promptEvalCount,source.prompt_eval_count),output=number(source.outputTokens,source.output_tokens,source.evalCount,source.eval_count);
    if(!input&&!output)continue;
    if(!updatedAt||task.updatedAt>updatedAt)updatedAt=task.updatedAt;
    if(!cumulativeOnly){inputTokens+=input;outputTokens+=output;taskCount++;continue;}
    const key=task.threadId??task.id,previous=cumulativeByThread.get(key),tasks=(previous?.tasks??0)+1;
    cumulativeByThread.set(key,previous&&previous.input+previous.output>=input+output?{...previous,tasks}:{input,output,tasks});
  }
  for(const value of cumulativeByThread.values()){inputTokens+=value.input;outputTokens+=value.output;taskCount+=value.tasks;}
  return{...NO_ACCOUNT_LIMITS,usage:{inputTokens,outputTokens,totalTokens:inputTokens+outputTokens,taskCount,periodDays:7,updatedAt}};
}
async function antigravityQuota():Promise<QuotaResult>{
  const execution=normalizeAntigravityExecutionSettings((await db.getSystemSetting("antigravity.execution"))?.value);
  if(usesVertexCredentials(execution.backend)){const observed=await observedProviderUsage("antigravity",execution.backend==="vertex-agent"?"gemini-cli-vertex":"vertex-api");return{...observed,plan:"Google Cloud",limitsAvailable:true,quotaMode:"vertex-credit",projectId:execution.vertex.projectId,location:execution.vertex.location,creditsUrl:execution.vertex.creditsUrl};}
  const observed=await observedProviderUsage("antigravity"),tasks=(await db.listProviderTasks("antigravity")).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  for(const task of tasks){
    const observedAt=Date.parse(task.updatedAt),signal=`${task.error??""}\n${String(task.log??"").slice(-16_384)}`,mapped=mapAntigravityQuotaError(signal,Number.isFinite(observedAt)?observedAt:Date.now());
    if(mapped){
      const resetsAt=mapped.fiveHour?.resetsAt??mapped.sevenDay?.resetsAt;
      if(resetsAt&&Date.parse(resetsAt)>Date.now())return{...mapped,error:null,retryAt:null,limitsAvailable:true,usage:observed.usage};
    }
    // A newer successful request proves that an older exhausted-bucket signal
    // no longer describes the account's current usable state.
    if(task.status==="completed")break;
  }
  return observed;
}
let lastDeepseekBalance: ProviderBalance | null = null;
// DeepSeek sells prepaid credit instead of a plan window, so the remaining
// balance is the only account-level figure it can report.
async function deepseekQuota(): Promise<QuotaResult> {
  const observed = await observedProviderUsage("deepseek");
  const backend = compatibleProviderConfig("deepseek", config.dataRoot);
  if (!backend.apiKey) return observed;
  try {
    const response = await fetch(deepseekBalanceUrl(backend.baseUrl), { headers:{ Authorization:`Bearer ${backend.apiKey}` }, signal:AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`DeepSeek balance returned HTTP ${response.status}.`);
    const balance = mapDeepseekBalance(await response.json());
    if (balance) lastDeepseekBalance = balance;
    return { ...observed, balance:balance ?? lastDeepseekBalance };
  } catch { return { ...observed, balance:lastDeepseekBalance }; }
}
let lastOllamaQuota: ProviderQuota | null = null;
let lastOllamaPlan: string | null = null;
async function ollamaPlan(backend:{baseUrl:string;apiKey:string}){
  try{
    const response=await fetch(ollamaAccountUrl(backend.baseUrl),{method:"POST",headers:{ Authorization:`Bearer ${backend.apiKey}`, "Content-Type":"application/json" },body:"{}",signal:AbortSignal.timeout(8000)});
    if(response.ok)lastOllamaPlan=mapOllamaPlan(await response.json())??lastOllamaPlan;
  }catch{/* the plan label is decoration; a stale or missing one is harmless */}
  return lastOllamaPlan;
}
// Ollama Cloud is a subscription with real session and weekly limits, so it gets
// an actual quota reading. The observed-token tally is only a stand-in for
// providers that publish no limits, so it is computed here solely as the
// fallback for a failed probe.
async function ollamaQuota(): Promise<QuotaResult> {
  const backend = compatibleProviderConfig("ollama", config.dataRoot);
  if (!backend.apiKey) return observedProviderUsage("ollama");
  const failed = async (error:"rate_limited"|"unavailable"):Promise<QuotaResult> => ({
    ...(lastOllamaQuota ?? { fiveHour:null, sevenDay:null, status:"partial" as const }),
    plan:lastOllamaPlan, error, retryAt:null, limitsAvailable:true, usage:(await observedProviderUsage("ollama")).usage
  });
  try {
    const [response,plan] = await Promise.all([
      fetch(ollamaUsageUrl(backend.baseUrl), { headers:{ Authorization:`Bearer ${backend.apiKey}` }, signal:AbortSignal.timeout(8000) }),
      ollamaPlan(backend)
    ]);
    if (response.status === 429) return failed("rate_limited");
    if (!response.ok) throw new Error(`Ollama Cloud usage returned HTTP ${response.status}.`);
    const mapped = mapOllamaQuota(await response.json());
    if (!mapped) throw new Error("Ollama Cloud usage did not report account limits.");
    lastOllamaQuota = mapped;
    return { ...mapped, plan, error:null, retryAt:null, limitsAvailable:true };
  } catch { return failed("unavailable"); }
}
let lastClaudeQuota: ProviderQuota | null = null;
async function claudeQuota(): Promise<QuotaResult> {
  try {
    const result = await new Promise<string>((resolve,reject)=>{
      const helper=path.join(config.appRoot,"bin","claude-usage.py");
      const probeDir=path.join(config.dataDir,"claude-usage-probe");
      const child=spawn("python3",[helper,config.claudeBinary,probeDir],{cwd:config.appRoot,shell:false,windowsHide:true,env:{...process.env,DISABLE_AUTOUPDATER:"1"},stdio:["ignore","pipe","pipe"]});
      let stdout="",stderr="";
      let settled=false;
      const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(stdout);};
      // Measured at ~30.0s on this host, which sat exactly on the old 30s
      // budget and so failed about as often as it succeeded.
      const timer=setTimeout(()=>{child.kill("SIGTERM");finish(new Error("Claude usage probe timed out."));},90000);timer.unref?.();
      child.stdout.setEncoding("utf8");child.stderr.setEncoding("utf8");
      child.stdout.on("data",(chunk)=>{stdout=`${stdout}${chunk}`.slice(-65536);});
      child.stderr.on("data",(chunk)=>{stderr=`${stderr}${chunk}`.slice(-2000);});
      child.once("error",(error)=>finish(error));
      child.once("exit",(code)=>code===0?finish():finish(new Error(`Claude usage probe failed (${code}): ${stderr}`)));
    });
    const body: any = JSON.parse(result);
    if(!body?.ok)throw new Error("Claude CLI did not return usage data.");
    lastClaudeQuota = mapClaudeQuota(body);
    return { ...lastClaudeQuota, error:null, retryAt:null };
  } catch { return { ...(lastClaudeQuota ?? { fiveHour:null, sevenDay:null, status:"partial" as const }), error:"unavailable", retryAt:null }; }
}
let lastGrokQuota:(ProviderQuota&{balance?:ProviderBalance|null})|null=null;
async function grokQuota():Promise<QuotaResult>{
  try{
    const output=await new Promise<string>((resolve,reject)=>{
      const helper=path.join(config.appRoot,"bin","grok-usage.py"),probeDir=path.join(config.dataDir,"grok-usage-probe"),child=spawn("python3",[helper,config.grokBinary,probeDir],{cwd:config.appRoot,shell:false,windowsHide:true,env:{...process.env,GROK_AUTO_UPDATE:"0"},stdio:["ignore","pipe","pipe"]});let stdout="",stderr="",settled=false;const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(stdout);},timer=setTimeout(()=>{child.kill("SIGTERM");finish(new Error("Grok usage probe timed out."));},90_000);timer.unref?.();child.stdout.setEncoding("utf8");child.stderr.setEncoding("utf8");child.stdout.on("data",chunk=>{stdout=`${stdout}${chunk}`.slice(-65_536);});child.stderr.on("data",chunk=>{stderr=`${stderr}${chunk}`.slice(-2_000);});child.once("error",finish);child.once("exit",code=>code===0?finish():finish(new Error(`Grok usage probe failed (${code}): ${stderr}`)));
    });
    const body=JSON.parse(output);if(!body?.ok)throw new Error("Grok CLI did not return usage data.");const mapped=mapGrokQuota(body);if(!mapped)throw new Error("Grok usage data was incomplete.");lastGrokQuota=mapped;return{...mapped,error:null,retryAt:null,limitsAvailable:true};
  }catch{return{...(lastGrokQuota??{fiveHour:null,sevenDay:null,status:"partial"as const}),error:"unavailable",retryAt:null,limitsAvailable:true};}
}
let lastCodexQuota: ProviderQuota | null = null;
async function codexQuota(): Promise<QuotaResult> {
  try {
    // A cold `codex app-server` initialize measured 38-81s on this host, so the
    // old 20s connect budget could never succeed from a cold pool. This probe
    // no longer sits on any request's critical path (see currentQuotaData), so
    // it can afford to wait long enough to actually return -- and warming the
    // pool here is what keeps the thread list fast afterwards.
    const result = await withCodexAppServer(config.appRoot, 150000, (client) => readFreshCodexRateLimits(client.request.bind(client)));
    const mapped = mapCodexQuota(result);
    if (!mapped) return { ...(lastCodexQuota ?? { fiveHour:null, sevenDay:null, status:"partial" as const }), error:"unavailable", retryAt:null };
    lastCodexQuota = mapped;
    return { ...mapped, error:null, retryAt:null };
  } catch { return { ...(lastCodexQuota ?? { fiveHour:null, sevenDay:null, status:"partial" as const }), error:"unavailable", retryAt:null }; }
}
async function currentQuotaData(allowStale=false):Promise<QuotaData>{
  // Keep the provider calls throttled even when an older client sends
  // ?refresh=true. Reopening the popover used to hammer Anthropic into 429s.
  if (quotaCache && Date.now() - quotaCache.at < quotaCacheDuration(quotaCache.data)) return quotaCache.data;
  // Mutations only need the same bounded-staleness guarantee as the quota UI.
  // Once we have a snapshot, do not put a slow provider usage probe on the
  // critical path of every follow-up submission. Refresh it in the background
  // and let the next request observe the newer snapshot.
  if(allowStale&&quotaCache){
    if(!quotaPending)void refreshQuotaData().catch(()=>{});
    return quotaCache.data;
  }
  // Both probes can legitimately run for a minute or more here, which is far
  // past the quick browser request budget and should not hold the quota loader.
  // Never hold the caller open for them: start or join the refresh, wait only
  // a short while, then answer with whatever is known. The refresh keeps
  // running and populates the cache, and the client's existing quota retry
  // (App.svelte scheduleQuotaRetry) picks up the newer snapshot.
  const refresh=refreshQuotaData().catch(()=>null);
  const settled=await Promise.race([refresh,new Promise<null>(resolve=>{const timer=setTimeout(()=>resolve(null),QUOTA_WAIT_MS);timer.unref?.();})]);
  if(settled)return settled;if(quotaCache)return quotaCache.data;
  const execution=normalizeAntigravityExecutionSettings((await db.getSystemSetting("antigravity.execution"))?.value),antigravity=usesVertexCredentials(execution.backend)?{...NO_ACCOUNT_LIMITS,limitsAvailable:true,plan:"Google Cloud",quotaMode:"vertex-credit" as const,projectId:execution.vertex.projectId,location:execution.vertex.location,creditsUrl:execution.vertex.creditsUrl}:NO_ACCOUNT_LIMITS;
  return{claude:UNVERIFIED_QUOTA,codex:UNVERIFIED_QUOTA,antigravity,deepseek:NO_ACCOUNT_LIMITS,ollama:{...UNVERIFIED_QUOTA,limitsAvailable:true},grok:{...UNVERIFIED_QUOTA,limitsAvailable:true},fetchedAt:new Date().toISOString()};
}
async function refreshQuotaData():Promise<QuotaData>{
  if(quotaPending)return quotaPending;
  quotaPending=Promise.all([claudeQuota(),codexQuota(),antigravityQuota(),deepseekQuota(),ollamaQuota(),grokQuota()]).then(([claude,codexUsage,antigravity,deepseek,ollama,grok])=>{
    const data={claude,codex:codexUsage,antigravity,deepseek,ollama,grok,fetchedAt:new Date().toISOString()};
    quotaCache={data,at:Date.now()};return data;
  }).finally(()=>{quotaPending=null;});
  return quotaPending;
}
function confirmedPaidCreditProviders(request:FastifyRequest){
  const raw=request.headers["x-claudex-workhouse-paid-credits"],value=Array.isArray(raw)?raw.join(","):String(raw??"");
  return new Set(value.split(",").map(item=>item.trim()).filter((item):item is ProviderId=>item==="codex"||item==="claude"||item==="grok"));
}
async function requirePaidCreditConsent(request:FastifyRequest,providersToCheck:ProviderId[]){
  return assertPaidCreditConsent(providersToCheck,confirmedPaidCreditProviders(request));
}
async function assertPaidCreditConsent(providersToCheck:ProviderId[],confirmed=new Set<ProviderId>()){
  const unique=[...new Set(providersToCheck)],remaining=unique.filter((providerId):providerId is "codex"|"claude"|"grok"=>(providerId==="codex"||providerId==="claude"||providerId==="grok")&&!confirmed.has(providerId));
  if(!remaining.length)return;
  const stored=await db.getSystemSetting("billing.credit-usage"),settings=stored?normalizeCreditUsageSettings(stored.value):DEFAULT_CREDIT_USAGE_SETTINGS;
  if(settings.allowPaidCredits)return;
  const quota=await currentQuotaData(true),reasons:Partial<Record<"codex"|"claude"|"grok","exhausted"|"unknown">>={};
  for(const providerId of remaining){const state=providerQuotaState(quota[providerId]);if(state!=="available")reasons[providerId]=state;}
  const blocked=remaining.filter(providerId=>quotaStateBlocksPaidCredits(providerQuotaState(quota[providerId])));
  if(!blocked.length){
    const unverified=remaining.filter(providerId=>reasons[providerId]==="unknown");
    if(unverified.length)app.log.warn({providers:unverified},"Proceeding without a verified included-quota reading.");
    return;
  }
  throw new PaidCreditConsentRequiredError(blocked,reasons);
}
async function validateQuotaReservationBody(body:CreateTaskBody){
  if(body.provider!=="codex"&&body.provider!=="claude")throw Object.assign(new Error("Quota reservations are available only for Codex and Claude subscription runtimes."),{statusCode:400,code:"QUOTA_PROVIDER_UNSUPPORTED"});
  await requireGlobalModel(body.provider,body.model);
  const level=automationLevelForNewTask(body.provider,body.automationLevel,body.permissionProfile);
  assertAutomationSupported(body.provider,level);
  await selectedWorkspace(body.projectId,body.executionHostId,body.workspaceId);
}
function publicQuotaReservation(reservation:QuotaTaskReservation){
  const{request:_request,permissionSnapshot:_permission,idempotencyKey:_key,...safe}=reservation;
  return safe;
}
async function startClaimedQuotaReservation(reservation:QuotaTaskReservation){
  try{
    if(!permissionSnapshotMatches(reservation))throw Object.assign(new Error("The reserved permission snapshot does not match the request."),{code:"RESERVATION_PERMISSION_MISMATCH"});
    const body=createBody.parse(reservation.request);
    const predictedTaskId=reservation.executionHostId===LOCAL_HOST_ID?(managedLocalWorkerRequired?`${reservation.provider}:worker:${reservation.id}`:(reservation.provider==="codex"?`codex:deck:${reservation.id}`:`claude:${reservation.id}`)):`${reservation.provider}:remote:${reservation.id}`;
    const starting=await db.markQuotaTaskReservationStarting(reservation.id,new Date().toISOString(),predictedTaskId);
    if(!starting)throw Object.assign(new Error("The reservation state changed, so execution did not start."),{code:"RESERVATION_STATE_CHANGED"});
    const task=await createTaskFromBody(body,reservation.id);
    const updated=await db.markQuotaTaskReservationStarted(reservation.id,new Date().toISOString(),task.id);
    if(!updated)throw Object.assign(new Error("The reservation state of the created task could not be committed."),{code:"RESERVATION_COMMIT_FAILED"});
    await db.appendAudit({createdAt:new Date().toISOString(),actor:"system",action:"quota-reservation-start",provider:task.provider,taskId:task.id,projectId:task.projectId,hostId:task.executionHostId??null,workspaceId:task.workspaceId??null,outcome:"success",detail:`reservation=${reservation.id}`});
    void pushManager.notifyQuotaReservation("started",reservation.id,task);
    return{reservation:updated,task};
  }catch(error){
    const safe=sanitizeSensitiveText(error instanceof Error?error.message:String(error)).slice(0,500);
    const failed=await db.failQuotaTaskReservation(reservation.id,new Date().toISOString(),safe);
    await db.appendAudit({createdAt:new Date().toISOString(),actor:"system",action:"quota-reservation-start",provider:reservation.provider,taskId:null,projectId:reservation.projectId,hostId:reservation.executionHostId,workspaceId:reservation.workspaceId,outcome:"failed",detail:`reservation=${reservation.id};error=${safe}`});
    if(failed)void pushManager.notifyQuotaReservation("failed",reservation.id);
    throw error;
  }
}
let quotaReservationPumpBusy=false;
async function pumpQuotaTaskReservations(){
  if(quotaReservationPumpBusy)return;quotaReservationPumpBusy=true;
  try{
    const now=new Date(),staleBefore=new Date(now.getTime()-5*60_000).toISOString();
    for(const recovered of await db.recoverQuotaTaskReservations(now.toISOString(),staleBefore))if(recovered.status==="failed")void pushManager.notifyQuotaReservation("failed",recovered.id);
    const due=await db.listDueQuotaTaskReservations(new Date().toISOString(),100);
    if(!due.length)return;
    // A probe that began before the reservation became due is not the required
    // post-reset observation. Let it settle, then start a new provider read.
    if(quotaPending)await quotaPending.catch(()=>null);
    const quota=await refreshQuotaData();
    for(const row of due as QuotaTaskReservation[]){if(row.provider!=="codex"&&row.provider!=="claude")continue;const weekly=quota[row.provider]?.sevenDay?.pct;if(typeof weekly==="number"&&weekly>=90&&weekly<100)app.log.warn({provider:row.provider,reservationId:row.id,weeklyPercent:weekly},"Starting a quota reservation while weekly usage is high.");}
    await runQuotaReservationPump({store:db,quota,start:async claimed=>{try{await startClaimedQuotaReservation(claimed);}catch{/* failure is persisted and reported by startClaimedQuotaReservation */}}});
  }catch(error){app.log.warn({err:sanitizeSensitiveObject(error)},"Skipping a quota reservation pump.");}
  finally{quotaReservationPumpBusy=false;}
}
let creditResumePumpBusy=false;
async function pumpCreditConsentWaits(){
  if(creditResumePumpBusy)return;creditResumePumpBusy=true;
  try{
    const stored=await db.getSystemSetting("billing.credit-usage"),settings=stored?normalizeCreditUsageSettings(stored.value):DEFAULT_CREDIT_USAGE_SETTINGS,quota=settings.allowPaidCredits?null:await currentQuotaData();
    const canRun=async(providerId:ProviderId)=>providerId!=="codex"&&providerId!=="claude"&&providerId!=="grok"?true:settings.allowPaidCredits||!quotaStateBlocksPaidCredits(providerQuotaState(quota?.[providerId]));
    for(const item of await db.listCreditWaitingSessionMessages(100))if(await canRun(item.provider))await db.clearSessionMessageCreditWait(item.id,new Date().toISOString());
    await collaboration.resumeCreditWaiting(canRun);
    void pumpSessionMessageQueue();
  }
  // Also only ever called without awaiting -- see pumpSessionMessageQueue.
  catch(error){app.log.warn({err:sanitizeSensitiveObject(error)},"Skipping a paid-credit resume pump.");}
  finally{creditResumePumpBusy=false;}
}
app.get("/api/quota", async () => currentQuotaData());
app.get("/api/quota-reservations",async()=>({reservations:(await db.listQuotaTaskReservations({includeTerminal:false,includeFailed:true,limit:200})).map(publicQuotaReservation)}));
app.post("/api/quota-reservations",{config:{rateLimit:{max:6,timeWindow:"1 minute"}}},async(request)=>{
  const body=createBody.parse(request.body);
  if(body.provider!=="codex"&&body.provider!=="claude")throw Object.assign(new Error("Quota reservations are available only for Codex and Claude subscription runtimes."),{statusCode:400,code:"QUOTA_PROVIDER_UNSUPPORTED"});
  const quotaProvider: "codex"|"claude"=body.provider;
  await validateQuotaReservationBody(body);
  return idempotent(request,"quota-reservation-create",body,async()=>{
    const now=new Date().toISOString(),quota=await currentQuotaData(true),id=crypto.randomUUID(),idempotencyKey=String(request.headers["idempotency-key"]);
    const reservation=await db.createQuotaTaskReservation({id,provider:quotaProvider,projectId:body.projectId,executionHostId:body.executionHostId??LOCAL_HOST_ID,workspaceId:body.workspaceId,title:body.title??body.prompt.replace(/\s+/g," ").slice(0,80),request:body,permissionSnapshot:reservationPermissionSnapshot(body),status:"waiting-quota",idempotencyKey,createdAt:now,updatedAt:now,nextCheckAt:initialReservationCheckAt(quota[quotaProvider]),lastQuotaCheckAt:quota.fetchedAt,lastQuotaStatus:reservationQuotaDecision(quota[quotaProvider]).reason,claimStartedAt:null,taskId:null,error:null});
    await db.appendAudit({createdAt:now,actor:(request as any).actor??"owner",action:"quota-reservation-create",provider:body.provider,taskId:null,projectId:body.projectId,hostId:body.executionHostId??LOCAL_HOST_ID,workspaceId:body.workspaceId,outcome:"success",detail:`reservation=${id};criterion=next-five-hour-reset`});
    return{reservation:publicQuotaReservation(reservation),quota:quota[quotaProvider]};
  });
});
app.post("/api/quota-reservations/:reservationId/cancel",async(request)=>{
  const {reservationId}=z.object({reservationId:z.string().uuid()}).parse(request.params),body=z.object({confirm:z.literal(true)}).parse(request.body);
  return idempotent(request,`quota-reservation-cancel:${reservationId}`,body,async()=>{
    const reservation=await db.cancelQuotaTaskReservation(reservationId,new Date().toISOString());
    if(!reservation)throw Object.assign(new Error("Only a waiting reservation can be cancelled."),{statusCode:409,code:"RESERVATION_NOT_WAITING_CANCEL"});
    await db.appendAudit({createdAt:new Date().toISOString(),actor:(request as any).actor??"owner",action:"quota-reservation-cancel",provider:reservation.provider,taskId:null,projectId:reservation.projectId,hostId:reservation.executionHostId,workspaceId:reservation.workspaceId,outcome:"success",detail:`reservation=${reservationId}`});
    void pushManager.notifyQuotaReservation("cancelled",reservationId);
    return{reservation:publicQuotaReservation(reservation)};
  });
});
app.post("/api/quota-reservations/:reservationId/start-now",async(request)=>{
  const {reservationId}=z.object({reservationId:z.string().uuid()}).parse(request.params),body=z.object({confirm:z.literal(true)}).parse(request.body);
  const current=await db.getQuotaTaskReservation(reservationId) as QuotaTaskReservation|null;
  if(!current)throw Object.assign(new Error("The reservation could not be found."),{statusCode:404,code:"RESERVATION_NOT_FOUND"});
  await requirePaidCreditConsent(request,[current.provider]);
  return idempotent(request,`quota-reservation-start-now:${reservationId}`,body,async()=>{
    const claimed=await db.claimQuotaTaskReservation(reservationId,new Date().toISOString(),"manual-start");
    if(!claimed){
      const latest=await db.getQuotaTaskReservation(reservationId);
      if(latest?.status==="started"&&latest.taskId)return{reservation:publicQuotaReservation(latest),task:await db.getTask(latest.taskId)};
      throw Object.assign(new Error("Only a waiting reservation can be started now."),{statusCode:409,code:"RESERVATION_NOT_WAITING_START"});
    }
    const result=await startClaimedQuotaReservation(claimed);
    return{...result,reservation:publicQuotaReservation(result.reservation)};
  });
});
app.post("/api/quota-reservations/:reservationId/retry",async(request)=>{
  const {reservationId}=z.object({reservationId:z.string().uuid()}).parse(request.params),body=z.object({confirm:z.literal(true)}).parse(request.body);
  return idempotent(request,`quota-reservation-retry:${reservationId}`,body,async()=>{
    const reservation=await db.retryQuotaTaskReservation(reservationId,new Date().toISOString());
    if(!reservation)throw Object.assign(new Error("Only a failed reservation whose execution was never confirmed can be queued again."),{statusCode:409,code:"RESERVATION_NOT_RETRYABLE"});
    await db.appendAudit({createdAt:new Date().toISOString(),actor:(request as any).actor??"owner",action:"quota-reservation-retry",provider:reservation.provider,taskId:null,projectId:reservation.projectId,hostId:reservation.executionHostId,workspaceId:reservation.workspaceId,outcome:"success",detail:`reservation=${reservationId}`});
    return{reservation:publicQuotaReservation(reservation)};
  });
});

registerEmotionMcp(app, { watcher: emotion, codexWatcher: codexEmotion, deepseekWatcher:deepseekEmotion, ollamaWatcher:ollamaEmotion, antigravityWatcher:antigravityEmotion,grokWatcher:grokEmotion, stateFile: config.emotionStateFile, assetsDir:config.emotionAssetsDir, baseUrl: config.emotionAssetBaseUrl,selectOutfit:async(provider,outfit)=>{await avatarSettings.select(provider,outfit);} });
registerExternalMcpProxy(app,{db,secrets:mcpSecretStore});
const managedProviderBridge=new ManagedProviderBridge(db,collaboration,async task=>task.executionHostId&&executionHostUsesWorker(task.executionHostId)?remoteTaskCommand(task,"provider.task.status"):db.upsertTask(await provider(task.provider).getTask(task)),async(task,prompt)=>withThreadTurn(task.provider,task.threadId,async()=>{if(task.executionHostId&&executionHostUsesWorker(task.executionHostId))return remoteTaskCommand(task,"provider.session.resume",{prompt});const next=await provider(task.provider).sendMessage(task,workspacePromptForTask(task,prompt));return db.upsertTask({...next,...(next.id!==task.id?{prompt}:{}),metadata:workspaceInstructionFollowUpMetadata(task.metadata,next.metadata)});}),async(providerId,model)=>{await assertPaidCreditConsent([providerId]);await requireGlobalModel(providerId,model);});
let managedProviderMcpExtension:unknown;
registerManagedProviderMcp(app,managedProviderBridge,managedProviderMcpExtension);
let emotionStreams = 0;
app.get("/api/emotion", async () => ({ state: emotion.get(), codexState: codexEmotion.get(), deepseekState:deepseekEmotion.get(), ollamaState:ollamaEmotion.get(), antigravityState:antigravityEmotion.get(),grokState:grokEmotion.get(), taskStates:{codex:codexEmotion.taskStates(),claude:emotion.taskStates(),antigravity:antigravityEmotion.taskStates(),deepseek:deepseekEmotion.taskStates(),ollama:ollamaEmotion.taskStates(),grok:grokEmotion.taskStates()}, outfits:emotion.outfits(), outfitsByProvider:{codex:codexEmotion.outfits(),claude:emotion.outfits(),antigravity:antigravityEmotion.outfits(),deepseek:deepseekEmotion.outfits(),ollama:ollamaEmotion.outfits(),grok:grokEmotion.outfits()}, assets:emotion.assetCatalog(), assetBaseUrl:"", mode: emotion.getMode() }));
app.post("/api/emotion/mode", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request) => {
  const body = z.object({ mode: z.enum(["mcp", "catch"]) }).parse(request.body);
  return { mode: emotion.setMode(body.mode) };
});
app.post("/api/emotion/outfit", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request) => {
  const body = z.object({ provider:z.enum(["codex","claude","deepseek","ollama","antigravity","grok"]).default("claude"),outfit: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/) }).parse(request.body);
  const result=await avatarSettings.select(body.provider,body.outfit);
  return {provider:result.provider,state:result.state,settings:result.settings,updatedAt:result.updatedAt};
});
app.get("/api/emotion/stream", { config:{ rateLimit:{ max:60, timeWindow:"1 minute" } } }, async (request, reply) => {
  const allowedOrigins = new Set([config.externalOrigin, ...(config.authMode === "test" ? ["http://127.0.0.1:3410"] : [])]);
  if (typeof request.headers.origin === "string" && !allowedOrigins.has(request.headers.origin)) throw Object.assign(new Error("Origin is not allowed for event streams."), { statusCode:403 });
  if (emotionStreams >= 8) throw Object.assign(new Error("Too many emotion stream connections."), { statusCode:429 });
  emotionStreams++;
  reply.hijack();
  const response = reply.raw;
  response.writeHead(200,{ "Content-Type":"text/event-stream; charset=utf-8", "Cache-Control":"no-store, no-cache, must-revalidate", "Connection":"keep-alive", "X-Accel-Buffering":"no", "Content-Encoding":"identity" });
  response.write("retry: 3000\n\n");
  let closed = false;
  const send = (event: string, state: unknown) => { if (!closed && !response.destroyed) response.write(`event: ${event}\ndata: ${JSON.stringify(sanitizeSensitiveValue(state))}\n\n`); };
  send("emotion", emotion.get());
  send("codex-emotion", codexEmotion.get());
  send("deepseek-emotion",deepseekEmotion.get());
  send("ollama-emotion",ollamaEmotion.get());
  send("antigravity-emotion",antigravityEmotion.get());
  send("grok-emotion",grokEmotion.get());
  const unsubscribe = emotion.subscribe((state) => send("emotion", state));
  const unsubscribeCodex = codexEmotion.subscribe((state) => send("codex-emotion", state));
  const unsubscribeDeepseek=deepseekEmotion.subscribe(state=>send("deepseek-emotion",state));
  const unsubscribeOllama=ollamaEmotion.subscribe(state=>send("ollama-emotion",state));
  const unsubscribeAntigravity=antigravityEmotion.subscribe(state=>send("antigravity-emotion",state));
  const unsubscribeGrok=grokEmotion.subscribe(state=>send("grok-emotion",state));
  const heartbeat = setInterval(() => { if (!closed && !response.destroyed) response.write(`: heartbeat ${Date.now()}\n\n`); }, 15000);
  heartbeat.unref?.();
  const close = () => { if (closed) return; closed = true; unsubscribe(); unsubscribeCodex(); unsubscribeDeepseek(); unsubscribeOllama(); unsubscribeAntigravity(); unsubscribeGrok(); clearInterval(heartbeat); emotionStreams = Math.max(0, emotionStreams - 1); };
  request.raw.once("close", close); response.once("close", close); response.once("error", close);
});
app.get("/api/providers/codex/capabilities", async () => ({ capabilities:{ list:true,search:true,transcriptTurns:true,archive:true,unarchive:true,delete:true,settings:true,items:false,serviceTier:true,externalResume:true,externalFork:true,ownedLiveStreaming:true,externalLiveStreaming:false,approvals:true,supportsMcpEvents:true,supportsEmotionRendering:true } }));
app.get("/api/hosts",async()=>{const hosts=await db.listHosts(),providerIds:ProviderId[]=["codex","claude","deepseek","ollama","antigravity","grok"];return{hosts:hosts.map(host=>{const configured=Array.isArray(host.capabilities?.providers)?host.capabilities.providers.map(String):host.id===LOCAL_HOST_ID?providerIds:["codex","claude"],managed=Array.isArray(host.capabilities?.managedSourceProviders)?host.capabilities.managedSourceProviders.map(String):host.id===LOCAL_HOST_ID?providerIds:["codex","claude"];return{...host,capabilities:{...host.capabilities,providers:configured,managedSourceProviders:managed,providerExecution:providerIds.map(providerId=>({provider:providerId,create:configured.includes(providerId),resume:configured.includes(providerId),managedSource:managed.includes(providerId),reason:configured.includes(providerId)?null:host.id===LOCAL_HOST_ID?"provider-unavailable":"worker-provider-unsupported"}))}};}),localMigration};});
app.get("/api/hosts/:hostId/execution-backend",async(request)=>{const {hostId}=z.object({hostId:z.string().min(1).max(100)}).parse(request.params),host=await db.getHost(hostId);if(!host)throw Object.assign(new Error("Host not found."),{statusCode:404});const trusted=(await db.getSystemSetting(trustedHostSettingKey(hostId,"codex")))?.value??null;return{hostId,nativeSandbox:host.capabilities?.nativeSandbox??null,isolatedWorker:{available:host.capabilities?.isolatedExecution===true},trustedHost:{enabled:trusted?.enabled===true&&trusted?.osIdentity===osExecutionIdentity(),provider:trusted?.provider??null,version:trusted?.version??null,enabledAt:trusted?.enabledAt??null,identityCurrent:trusted?.osIdentity===osExecutionIdentity(),warning:"Workspace boundaries are not OS-enforced; commands run as the service OS user."}};});
app.put("/api/hosts/:hostId/trusted-auto",{config:{rateLimit:{max:5,timeWindow:"10 minutes"}}},async(request)=>{const {hostId}=z.object({hostId:z.string().min(1).max(100)}).parse(request.params),body=z.object({enabled:z.boolean(),provider:z.literal("codex"),confirmNoSandbox:z.literal(true),version:z.literal(1)}).parse(request.body),host=await db.getHost(hostId);if(!host)throw Object.assign(new Error("Host not found."),{statusCode:404});if(hostId!==LOCAL_HOST_ID)throw Object.assign(new Error("Remote trusted-host policy must be configured on that Worker."),{statusCode:409});const timestamp=new Date().toISOString(),value={enabled:body.enabled,hostId,provider:body.provider,osIdentity:osExecutionIdentity(),version:body.version,enabledAt:body.enabled?timestamp:null,updatedAt:timestamp};await db.putSystemSetting(trustedHostSettingKey(hostId,body.provider),value,timestamp);await db.appendAudit({createdAt:timestamp,actor:(request as any).actor,action:body.enabled?"trusted-host-auto-enabled":"trusted-host-auto-revoked",provider:"codex",taskId:null,projectId:null,outcome:"success",detail:`host=${hostId};provider=${body.provider};version=1;sandbox=false`,hostId});return{trustedHost:value};});
app.get("/api/worker-package/windows",{config:{rateLimit:{max:2,timeWindow:"10 minutes"}}},async(_request,reply)=>{
  const metadata=await trustedWorkerPackageMetadata("windows","x64");
  let verified;
  try{
    verified=await verifyLocalWorkerPackage(path.join(config.appRoot,"packages"),metadata);
  }catch(error){
    if(error instanceof DeploymentValidationError)throw Object.assign(new Error("The local Windows Worker package does not match trusted release metadata."),{
      statusCode:503,
      code:"WORKER_PACKAGE_ARTIFACT_INVALID"
    });
    throw error;
  }
  reply.header("Cache-Control","no-store");
  reply.header("Content-Type","application/zip");
  reply.header("Content-Length",String(verified.size));
  reply.header("Content-Disposition",`attachment; filename="${verified.fileName}"`);
  reply.header("X-Content-Type-Options","nosniff");
  reply.header("X-Claudex-Artifact-Sha256",verified.sha256);
  return reply.send(verified.content);
});
app.post("/api/hosts/pairings",{config:{rateLimit:{max:5,timeWindow:"10 minutes"}}},async(request)=>authIdempotent(request,"worker-pairing",request.body??{},async()=>({pairing:workerHub.createPairing()})));
app.get("/api/hosts/pairings/:attemptId",async(request)=>{const {attemptId}=z.object({attemptId:z.string().uuid()}).parse(request.params);const pairing=workerHub.pairingStatus(attemptId);if(!pairing)throw Object.assign(new Error("Pairing attempt not found."),{statusCode:404});return{pairing};});
app.post("/api/hosts/:hostId/revoke",{config:{rateLimit:{max:5,timeWindow:"10 minutes"}}},async(request)=>{const {hostId}=z.object({hostId:z.union([z.string().uuid(),z.literal("local")])}).parse(request.params);if(hostId===LOCAL_HOST_ID&&!managedLocalWorkerRequired)throw Object.assign(new Error("The direct local host has no Worker credential."),{statusCode:409});const body=z.object({confirm:z.literal(true)}).parse(request.body);return idempotent(request,`worker-revoke:${hostId}`,body,async()=>{await workerHub.revoke(hostId);await db.appendAudit({createdAt:new Date().toISOString(),actor:(request as any).actor,action:"worker-revoke",provider:null,taskId:null,projectId:null,outcome:"success",detail:`host=${hostId}`});return{revoked:true};});});
app.post("/api/hosts/:hostId/credential/rotate",{config:{rateLimit:{max:3,timeWindow:"10 minutes"}}},async(request)=>{const {hostId}=z.object({hostId:z.union([z.string().uuid(),z.literal("local")])}).parse(request.params);if(hostId===LOCAL_HOST_ID&&!managedLocalWorkerRequired)throw Object.assign(new Error("The direct local host has no Worker credential."),{statusCode:409});const body=z.object({confirm:z.literal(true)}).parse(request.body);return authIdempotent(request,`worker-rotate:${hostId}`,body,async()=>{const result=await workerHub.request(hostId,"host.credential.rotate",{}) as any;if(!/^[a-f0-9]{64}$/.test(result?.credentialHash??""))throw Object.assign(new Error("Worker credential rotation failed."),{statusCode:502});await db.putWorkerCredential({hostId,credentialHash:result.credentialHash,credentialVersion:Number(result.credentialVersion)||2,createdAt:new Date().toISOString(),rotatedAt:new Date().toISOString()});await db.appendAudit({createdAt:new Date().toISOString(),actor:(request as any).actor,action:"worker-credential-rotate",provider:null,taskId:null,projectId:null,outcome:"success",detail:`host=${hostId}`,hostId});workerHub.reconnectAfterCredentialRotation(hostId);return{rotated:true,reconnecting:true};});});
async function workerApplicationUpdateStatus(hostId:string){
  const host=await db.getHost(hostId);if(!host||host.type!=="worker")throw Object.assign(new Error("Worker host not found."),{statusCode:404});
  const stored=await db.getSystemSetting(`worker.application-update.${hostId}`).catch(()=>null);let attempt=stored?.value??null;const capabilities=host.capabilities??{},reported=capabilities.applicationUpdateResult as any;
  if(attempt?.schemaVersion===1&&reported?.attemptId===attempt.attemptId&&["completed","rolled-back","failed"].includes(reported.state)){attempt={...attempt,state:reported.state,rollbackPerformed:reported.rollbackPerformed===true,error:reported.error??null,updatedAt:reported.completedAt??new Date().toISOString(),completedAt:reported.completedAt??new Date().toISOString()};await db.putSystemSetting(`worker.application-update.${hostId}`,attempt,attempt.updatedAt);}
  else if(attempt?.schemaVersion===1&&attempt.state==="restarting"&&host.workerVersion===attempt.targetVersion&&capabilities.packageSha256===attempt.artifactSha256){attempt={...attempt,state:"completed",rollbackPerformed:false,error:null,updatedAt:new Date().toISOString(),completedAt:new Date().toISOString()};await db.putSystemSetting(`worker.application-update.${hostId}`,attempt,attempt.updatedAt);}
  const platform=host.platform==="win32"||host.platform==="windows"?"windows":host.platform,architecture=host.architecture==="x64"||host.architecture==="arm64"?host.architecture:null;if((platform!=="windows"&&platform!=="linux")||!architecture)return{state:"unsupported",hostId,currentVersion:host.workerVersion,target:null,reason:"worker-platform-unsupported",attempt};
  const metadata=await trustedWorkerPackageMetadata(platform,architecture);if(!metadata)return{state:"unconfigured",hostId,currentVersion:host.workerVersion,target:null,reason:"signed-release-channel-not-configured",attempt};const protocol=Number(capabilities.updaterProtocolVersion??0),minimum=metadata.artifact.minimumUpdaterProtocolVersion??1,identity=typeof capabilities.packageSha256==="string"?capabilities.packageSha256:null,available=Boolean(host.workerVersion&&compareApplicationVersions(host.workerVersion,metadata.version)<0);return{state:["applying","restarting"].includes(attempt?.state)?attempt.state:protocol<minimum?"blocked":available?"available":"up-to-date",hostId,currentVersion:host.workerVersion,currentPackageSha256:identity,target:{version:metadata.version,artifactSha256:metadata.artifact.sha256,size:metadata.artifact.size,minimumUpdaterProtocolVersion:minimum},updateAvailable:available&&protocol>=minimum,reason:protocol<minimum?"worker-updater-protocol-too-old":null,attempt};
}
app.get("/api/hosts/:hostId/application-update",async(request)=>{const {hostId}=z.object({hostId:z.string().uuid()}).parse(request.params);return workerApplicationUpdateStatus(hostId);});
app.post("/api/hosts/:hostId/application-update",{config:{rateLimit:{max:3,timeWindow:"10 minutes"}}},async(request)=>{const {hostId}=z.object({hostId:z.string().uuid()}).parse(request.params),body=z.object({targetVersion:z.string().min(1).max(80),artifactSha256:z.string().regex(/^[a-f0-9]{64}$/),confirm:z.literal(true)}).strict().parse(request.body);return authIdempotent(request,`worker-application-update:${hostId}`,body,async()=>{const host=await db.getHost(hostId);if(!host||host.type!=="worker")throw Object.assign(new Error("Worker host not found."),{statusCode:404});if(!workerHub.isOnline(hostId))throw Object.assign(new Error("Worker is offline."),{statusCode:503,code:"HOST_OFFLINE"});const active=(await db.listTasks()).filter(task=>task.executionHostId===hostId&&["pending","queued","running","waiting","unknown"].includes(task.status));if(active.length)throw Object.assign(new Error("Worker update is blocked by active jobs."),{statusCode:409,code:"WORKER_UPDATE_ACTIVE_TASKS"});const platform=host.platform==="win32"||host.platform==="windows"?"windows":host.platform,architecture=host.architecture;if((platform!=="windows"&&platform!=="linux")||(architecture!=="x64"&&architecture!=="arm64"))throw Object.assign(new Error("Worker platform is not supported for signed updates."),{statusCode:409,code:"WORKER_UPDATE_UNSUPPORTED"});const metadata=await trustedWorkerPackageMetadata(platform,architecture);if(!metadata)throw Object.assign(new Error("Signed Worker release channel is not configured."),{statusCode:503,code:"WORKER_UPDATE_UNCONFIGURED"});if(metadata.version!==body.targetVersion||metadata.artifact.sha256!==body.artifactSha256)throw Object.assign(new Error("The confirmed Worker update target changed."),{statusCode:409,code:"WORKER_UPDATE_TARGET_CHANGED"});if(!host.workerVersion||compareApplicationVersions(host.workerVersion,metadata.version)>=0)throw Object.assign(new Error("Worker update is not available."),{statusCode:409,code:"WORKER_UPDATE_NOT_AVAILABLE"});const protocol=Number(host.capabilities?.updaterProtocolVersion??0),minimum=metadata.artifact.minimumUpdaterProtocolVersion??1;if(protocol<minimum)throw Object.assign(new Error("Worker updater protocol is too old."),{statusCode:409,code:"WORKER_UPDATER_PROTOCOL_TOO_OLD"});const attemptId=crypto.randomUUID(),createdAt=new Date().toISOString(),attempt={schemaVersion:1,attemptId,hostId,sourceVersion:host.workerVersion,targetVersion:metadata.version,artifactSha256:metadata.artifact.sha256,state:"applying",createdAt,updatedAt:createdAt};await db.putSystemSetting(`worker.application-update.${hostId}`,attempt,createdAt);const result=await workerHub.request(hostId,"host.update.apply",{attemptId,targetVersion:metadata.version,metadata},crypto.randomUUID(),60_000),restarting={...attempt,state:"restarting",updatedAt:new Date().toISOString()};await db.putSystemSetting(`worker.application-update.${hostId}`,restarting,restarting.updatedAt);await db.appendAudit({createdAt,actor:(request as any).actor,action:"worker-application-update",provider:null,taskId:null,projectId:null,outcome:"success",detail:`host=${hostId};attempt=${attemptId};target=${metadata.version};artifact=${metadata.artifact.sha256}`,hostId});return{attempt:restarting,worker:result};});});
app.patch("/api/hosts/:hostId",async(request)=>{const {hostId}=z.object({hostId:z.string().min(1).max(100)}).parse(request.params);const body=z.object({displayName:z.string().trim().min(1).max(80)}).parse(request.body);return idempotent(request,`host-rename:${hostId}`,body,async()=>{const host=await db.getHost(hostId);if(!host)throw Object.assign(new Error("Host not found."),{statusCode:404});const updated=await db.upsertHost({...host,displayName:body.displayName,updatedAt:new Date().toISOString()});await db.appendAudit({createdAt:new Date().toISOString(),actor:(request as any).actor,action:"host-rename",provider:null,taskId:null,projectId:null,outcome:"success",detail:`host=${hostId}`,hostId});return{host:updated};});});
app.post("/api/hosts/:hostId/disable",async(request)=>{const {hostId}=z.object({hostId:z.string().uuid()}).parse(request.params);const body=z.object({disabled:z.boolean(),confirm:z.literal(true)}).parse(request.body);return idempotent(request,`host-disable:${hostId}`,body,async()=>{const host=await db.getHost(hostId);if(!host)throw Object.assign(new Error("Host not found."),{statusCode:404});const timestamp=new Date().toISOString();if(body.disabled){const active=(await db.listTasks()).some(task=>task.executionHostId===hostId&&["pending","queued","running","waiting","unknown"].includes(task.status));if(active)throw Object.assign(new Error("Host has active or unconfirmed tasks."),{statusCode:409});}const updated=await db.upsertHost({...host,status:body.disabled?"disabled":workerHub.isOnline(hostId)?"online":"offline",disabledAt:body.disabled?timestamp:null,updatedAt:timestamp});if(body.disabled)workerHub.disconnectDisabled(hostId);await db.appendAudit({createdAt:timestamp,actor:(request as any).actor,action:body.disabled?"host-disable":"host-enable",provider:null,taskId:null,projectId:null,outcome:"success",detail:`host=${hostId}`,hostId});return{host:updated};});});
app.get("/api/hosts/:hostId/diagnostics",async(request)=>{const {hostId}=z.object({hostId:z.string().min(1).max(100)}).parse(request.params);if(!executionHostUsesWorker(hostId)){const [runtimes,accounts]=await Promise.all([localRuntimeStatuses(config.appRoot,config.dataRoot),providerAuth.refreshAll()]);return{report:{hostId,displayName:localHostDisplayName(),workerConnection:"local",platform:process.platform,architecture:process.arch,runtimes,accounts:accounts.map(item=>({...item,emailMasked:null})),workspaceRoots:(await db.listWorkspaceRoots(hostId)).map(item=>({displayName:item.displayName,path:item.canonicalPath})),spool:"ok",pathDisplay:{hideLocalPaths,secretsAlwaysRedacted:true}}};}return{report:await workerHub.request(hostId,"host.diagnostics.read",{})};});
app.get("/api/hosts/:hostId/provider-status",async(request)=>{const {hostId}=z.object({hostId:z.string().min(1).max(100)}).parse(request.params);return !executionHostUsesWorker(hostId)?{accounts:await providerAuth.refreshAll(),runtimes:await localRuntimeStatuses(config.appRoot,config.dataRoot)}:workerHub.request(hostId,"provider.status.read",{});});
app.put("/api/hosts/:hostId/providers/:provider/binary",{config:{rateLimit:{max:5,timeWindow:"10 minutes"}}},async(request)=>{
  const{hostId,provider}=z.object({hostId:z.string().min(1).max(100),provider:z.enum(["codex","claude"])}).parse(request.params),body=z.object({path:z.string().trim().min(1).max(4096)}).parse(request.body);
  if(!executionHostUsesWorker(hostId))throw Object.assign(new Error("Provider binary selection requires a Windows or remote Worker host."),{statusCode:409,code:"PLATFORM_UNSUPPORTED"});
  return idempotent(request,`provider-binary:${hostId}:${provider}`,body,async()=>{
    if(hostId===LOCAL_HOST_ID)await refreshManagedLocalWorkerConfig();
    const status=await workerHub.request(hostId,"provider.binary.select",{provider,path:body.path});
    await db.appendAudit({createdAt:new Date().toISOString(),actor:(request as any).actor,action:"provider-binary-select",provider,taskId:null,projectId:null,outcome:"success",detail:`host=${hostId};path-selected=true`,hostId});
    return status;
  });
});
app.get("/api/hosts/:hostId/git",async(request)=>{const {hostId}=z.object({hostId:z.string().min(1).max(100)}).parse(request.params),state=hostId===LOCAL_HOST_ID?await hostWorkspaces.gitHostStatus():await workerHub.request(hostId,"git.host.status",{}) as any;const stored=await db.getSystemSetting(`git.github.connection.${hostId}`).catch(()=>null),connection=stored?.value??{},enabled=connection.enabled!==false,hostAuthenticated=state.github?.connected===true,accountMatches=typeof connection.username==="string"&&typeof state.github?.username==="string"&&connection.username.toLowerCase()===state.github.username.toLowerCase(),tokenConnected=enabled&&hostAuthenticated&&connection.method==="token"&&accountMatches;return{...state,github:{...state.github,hostAuthenticated,connected:enabled&&hostAuthenticated,hiddenByClaudexWorkhouse:!enabled&&hostAuthenticated,connectionMethod:enabled&&hostAuthenticated?(tokenConnected?"token":typeof connection.method==="string"?connection.method:"host"):null,tokenConnected,tokenConnectedAt:tokenConnected&&typeof connection.connectedAt==="string"?connection.connectedAt:null,tokenProtocol:tokenConnected&&(connection.protocol==="https"||connection.protocol==="ssh")?connection.protocol:null}};});
app.put("/api/hosts/:hostId/git/identity",async(request)=>{const {hostId}=z.object({hostId:z.string().min(1).max(100)}).parse(request.params),body=z.object({name:z.string().trim().min(1).max(200),email:z.string().trim().email().max(320)}).parse(request.body);return idempotent(request,`git-identity:${hostId}`,body,()=>hostId===LOCAL_HOST_ID?hostWorkspaces.setGitIdentity(body):workerHub.request(hostId,"git.host.identity",body));});
app.get("/api/hosts/:hostId/github/repositories",async(request)=>{const {hostId}=z.object({hostId:z.string().min(1).max(100)}).parse(request.params),query=z.object({limit:z.coerce.number().int().min(1).max(200).default(100),visibility:z.enum(["all","public","private"]).default("all"),owner:z.string().trim().max(100).optional(),search:z.string().trim().max(200).optional()}).parse(request.query);return hostId===LOCAL_HOST_ID?hostWorkspaces.listGitHubRepositories(query):workerHub.request(hostId,"git.github.repositories",query);});
app.post("/api/hosts/:hostId/github/connect",async(request)=>{const {hostId}=z.object({hostId:z.string().min(1).max(100)}).parse(request.params),body=z.object({protocol:z.enum(["https","ssh"]).default("https")}).parse(request.body),current=hostId===LOCAL_HOST_ID?await hostWorkspaces.gitHostStatus():await workerHub.request(hostId,"git.host.status",{}) as any;if(current.github?.connected){const connectedAt=new Date().toISOString();await db.putSystemSetting(`git.github.connection.${hostId}`,{enabled:true,method:"host",username:current.github.username??null,protocol:body.protocol,connectedAt},connectedAt);return{alreadyConnected:true,status:current};}if(hostId!==LOCAL_HOST_ID)throw Object.assign(new Error("Start GitHub CLI login directly on the Desktop Worker host, then recheck the connection."),{statusCode:409,code:"GITHUB_LOGIN_ON_HOST_REQUIRED"});return{alreadyConnected:false,attempt:githubLogin.start(config.appRoot,body.protocol)};});
app.get("/api/hosts/:hostId/github/connect/:attemptId",async(request)=>{const {hostId,attemptId}=z.object({hostId:z.string().min(1).max(100),attemptId:z.string().uuid()}).parse(request.params);if(hostId!==LOCAL_HOST_ID)throw Object.assign(new Error("GitHub login attempt is not hosted here."),{statusCode:404});const attempt=githubLogin.get(attemptId);if(!attempt)throw Object.assign(new Error("GitHub login attempt not found."),{statusCode:404});if(attempt.status==="completed"){const connectedAt=new Date().toISOString(),status=await hostWorkspaces.gitHostStatus();await db.putSystemSetting(`git.github.connection.${hostId}`,{enabled:true,method:"browser",username:status.github?.username??null,protocol:"https",connectedAt},connectedAt);}return{attempt};});
app.post("/api/hosts/:hostId/github/token",{config:{rateLimit:{max:3,timeWindow:"10 minutes"}}},async(request)=>{
  const {hostId}=z.object({hostId:z.string().min(1).max(100)}).parse(request.params);
  if(hostId!==LOCAL_HOST_ID)throw Object.assign(new Error("Enter GitHub tokens only in the Desktop Worker local settings on that host."),{statusCode:409,code:"GITHUB_TOKEN_LOCAL_ONLY"});
  const body=z.object({username:z.string().trim().min(1).max(39),token:z.string().trim().min(20).max(1024),protocol:z.enum(["https","ssh"]).default("https")}).parse(request.body);
  const tokenHash=crypto.createHash("sha256").update(body.token).digest("hex");
  return authIdempotent(request,`github-token-connect:${hostId}`,{username:body.username.toLowerCase(),protocol:body.protocol,tokenHash},async()=>{
    try{
      const github=await githubLogin.connectToken(config.appRoot,body);
      const connectedAt=new Date().toISOString();
      await db.putSystemSetting(`git.github.connection.${hostId}`,{enabled:true,method:"token",username:github.username,protocol:github.protocol,connectedAt},connectedAt);
      await audit(request,"github-token-connect","success",undefined,`host=${hostId};username=${github.username};protocol=${github.protocol};tokenStoredBy=gh`);
      return{github:{...github,connected:true,hostAuthenticated:true,connectionMethod:"token",tokenConnected:true,tokenConnectedAt:connectedAt,tokenProtocol:github.protocol},tokenStoredBy:"gh"};
    }catch(error){
      await audit(request,"github-token-connect","failed",undefined,`host=${hostId};username=${body.username};category=${typeof (error as any)?.code==="string"?(error as any).code:"unknown"}`);
      throw error;
    }
  });
});
app.post("/api/hosts/:hostId/github/disconnect",async(request)=>{const {hostId}=z.object({hostId:z.string().min(1).max(100)}).parse(request.params),body=z.object({hostLogout:z.literal(false).default(false)}).parse(request.body);await db.putSystemSetting(`git.github.connection.${hostId}`,{enabled:false,hostAuthRetained:true},new Date().toISOString());return{disconnected:true,hostAuthRetained:true};});
app.get("/api/hosts/:hostId/sessions",async(request)=>{const {hostId}=z.object({hostId:z.string().uuid()}).parse(request.params);return workerHub.request(hostId,"provider.sessions.list",{});});

app.get("/api/workspace-roots",async(request)=>{const query=z.object({hostId:z.string().min(1).max(100).default(LOCAL_HOST_ID)}).parse(request.query);if(query.hostId===LOCAL_HOST_ID)return{roots:await db.listWorkspaceRoots(query.hostId)};const remote=await workerHub.request(query.hostId,"workspace.list",{}) as any[];const roots=[];for(const item of remote)roots.push(await db.upsertWorkspaceRoot({...item,hostId:query.hostId}));return{roots};});
app.get("/api/workspace-roots/:rootId/browse",async(request)=>{const {rootId}=z.object({rootId:z.string().min(1).max(100)}).parse(request.params);const query=z.object({hostId:z.string().min(1).max(100).default(LOCAL_HOST_ID),entryId:z.string().max(2048).optional()}).parse(request.query);return query.hostId===LOCAL_HOST_ID?hostWorkspaces.browseLocalRoot(rootId,query.entryId):workerHub.request(query.hostId,"workspace.browse",{rootId,entryId:query.entryId});});
app.get("/api/workspaces",async(request)=>{const query=z.object({hostId:z.string().min(1).max(100).optional(),projectId:z.string().regex(/^[a-z0-9-]+$/).optional(),includeArchived:z.enum(["true","false"]).transform(v=>v==="true").optional()}).parse(request.query);return{workspaces:await db.listWorkspaces(query)};});
app.get("/api/workspaces/:workspaceId/instructions",async(request)=>{
  const {workspaceId}=z.object({workspaceId:z.string().min(1).max(100)}).parse(request.params),workspace=await hostWorkspaces.requireWorkspace(workspaceId),stored=await db.getSystemSetting(workspaceInstructionSettingKey(workspaceId)),profile=await workspaceInstructionProfile(workspaceId);
  const snapshot=await workspaceInstructionSnapshotFor(workspace,profile),repository=snapshot?.sources.filter(source=>source.name!=="managed")??(workspace.hostId===LOCAL_HOST_ID?repositoryWorkspaceInstructions(workspace.canonicalPath).map(({name,digest})=>({name,digest})):[]);
  return{profile,updatedAt:stored?.updatedAt??null,repository,snapshot};
});
app.put("/api/workspaces/:workspaceId/instructions",{config:{rateLimit:{max:20,timeWindow:"10 minutes"}}},async(request)=>{
  const {workspaceId}=z.object({workspaceId:z.string().min(1).max(100)}).parse(request.params),body=z.object({profile:z.unknown(),expectedRevision:z.number().int().min(0)}).parse(request.body),workspace=await hostWorkspaces.requireWorkspace(workspaceId),stored=await db.getSystemSetting(workspaceInstructionSettingKey(workspaceId)),current=await workspaceInstructionProfile(workspaceId);
  if(current.revision!==body.expectedRevision)throw Object.assign(new Error("Workspace instructions changed in another session. Reload before saving."),{statusCode:409,code:"WORKSPACE_INSTRUCTIONS_REVISION_CONFLICT"});
  const updatedAt=new Date().toISOString(),profile=ownerEditedWorkspaceInstructionProfile(body.profile,current.revision,updatedAt);
  const saved=await db.putSystemSettingIfUpdated(workspaceInstructionSettingKey(workspaceId),profile,updatedAt,stored?.updatedAt??null);
  if(!saved.updated)throw Object.assign(new Error("Workspace instructions changed in another session. Reload before saving."),{statusCode:409,code:"WORKSPACE_INSTRUCTIONS_REVISION_CONFLICT"});
  await db.appendAudit({createdAt:updatedAt,actor:(request as any).actor,action:"workspace-instructions-update",provider:null,taskId:null,projectId:workspace.projectId,hostId:workspace.hostId,workspaceId,outcome:"success",detail:`enabled=${profile.enabled};sourceMode=${profile.sourceMode};revision=${profile.revision};restart=${profile.completionPolicy.restart}`});
  return{profile,updatedAt};
});
app.patch("/api/workspaces/:workspaceId",async(request)=>{const {workspaceId}=z.object({workspaceId:z.string().min(1).max(100)}).parse(request.params),body=z.object({displayName:z.string().trim().min(1).max(100),rootId:z.string().min(1).max(100).optional(),canonicalPath:z.string().trim().min(1).max(4096).optional(),confirmPathChange:z.literal(true).optional()}).superRefine((value,context)=>{if(value.canonicalPath&&value.confirmPathChange!==true)context.addIssue({code:z.ZodIssueCode.custom,message:"Workspace path change requires confirmation."});}).parse(request.body);return idempotent(request,`workspace-update:${workspaceId}`,body,async()=>{const before=await hostWorkspaces.requireWorkspace(workspaceId);assertWorkspaceManagementAllowed(before.projectId);const timestamp=new Date().toISOString();let updated,pathChanged=false;if(before.hostId===LOCAL_HOST_ID){const result=await hostWorkspaces.updateLocalWorkspace(workspaceId,body);updated=result.workspace;pathChanged=result.pathChanged;if(pathChanged){try{persistConfiguredWorkspacePath(config,before.projectId,before.canonicalPath,updated.canonicalPath);}catch(error){await hostWorkspaces.updateLocalWorkspace(workspaceId,{displayName:before.displayName,rootId:before.rootId,canonicalPath:before.canonicalPath}).catch(()=>{});throw error;}}}else{const result=await workerHub.request(before.hostId,"workspace.update",{workspaceId,...body}) as any;updated=await db.upsertWorkspace({...before,...result.workspace,updatedAt:timestamp});pathChanged=updated.canonicalPath!==before.canonicalPath||updated.rootId!==before.rootId;}await db.appendAudit({createdAt:timestamp,actor:(request as any).actor,action:"workspace-update",provider:null,taskId:null,projectId:updated.projectId,hostId:updated.hostId,workspaceId:updated.id,outcome:"success",detail:`displayName=true;pathChanged=${pathChanged}`});return{workspace:updated,pathChanged};});});
const workspaceCreate=z.object({hostId:z.string().min(1).max(100),projectId:z.string().regex(/^[a-z0-9-]+$/),rootId:z.string().min(1).max(100),folderName:z.string().min(1).max(80),displayName:z.string().trim().min(1).max(100).optional(),mode:z.enum(["empty","git-init"]),readme:z.boolean().optional(),defaultBranch:z.string().max(100).optional()});
app.post("/api/workspaces/create",{config:{rateLimit:{max:10,timeWindow:"10 minutes"}}},async(request)=>{const body=workspaceCreate.parse(request.body);assertWorkspaceManagementAllowed(body.projectId);return idempotent(request,"workspace-create",body,async()=>{if(body.hostId===LOCAL_HOST_ID)return{workspace:await hostWorkspaces.createLocal(body)};const result=await workerHub.request(body.hostId,"workspace.create",body) as any;return{workspace:await db.upsertWorkspace(result.workspace)};});});
app.post("/api/workspaces/register",{config:{rateLimit:{max:10,timeWindow:"10 minutes"}}},async(request)=>{const body=z.object({hostId:z.string().min(1).max(100),projectId:z.string().regex(/^[a-z0-9-]+$/),rootId:z.string().min(1).max(100),entryId:z.string().min(1).max(2048),displayName:z.string().trim().min(1).max(100).optional()}).parse(request.body);assertWorkspaceManagementAllowed(body.projectId);return idempotent(request,"workspace-register",body,async()=>{if(body.hostId===LOCAL_HOST_ID)return{workspace:await hostWorkspaces.registerLocal(body)};const result=await workerHub.request(body.hostId,"workspace.register",body) as any;return{workspace:await db.upsertWorkspace(result.workspace)};});});
app.post("/api/workspaces/clone",{config:{rateLimit:{max:3,timeWindow:"10 minutes"}}},async(request)=>{const body=z.object({hostId:z.string().min(1).max(100),projectId:z.string().regex(/^[a-z0-9-]+$/),rootId:z.string().min(1).max(100),folderName:z.string().min(1).max(80),displayName:z.string().trim().min(1).max(100).optional(),repository:z.string().min(8).max(2048),branch:z.string().trim().max(200).optional(),shallow:z.boolean().default(false)}).parse(request.body);assertWorkspaceManagementAllowed(body.projectId);return idempotent(request,"workspace-clone",body,async()=>{let workspace;if(body.hostId===LOCAL_HOST_ID)workspace=await hostWorkspaces.cloneLocal(body);else{const result=await workerHub.request(body.hostId,"workspace.git.clone",body,undefined,10*60_000) as any;workspace=await db.upsertWorkspace(result.workspace);}return{workspace};});});
app.post("/api/workspaces/:workspaceId/worktree",{config:{rateLimit:{max:6,timeWindow:"10 minutes"}}},async(request)=>{const {workspaceId}=z.object({workspaceId:z.string().min(1).max(100)}).parse(request.params),body=z.object({folderName:z.string().min(1).max(80),displayName:z.string().trim().min(1).max(100).optional(),branch:z.string().trim().min(1).max(100).optional()}).parse(request.body),source=await hostWorkspaces.requireWorkspace(workspaceId);assertWorkspaceManagementAllowed(source.projectId);return idempotent(request,`workspace-worktree:${workspaceId}`,body,async()=>{let workspace;if(source.hostId===LOCAL_HOST_ID)workspace=await hostWorkspaces.createLocalWorktree(workspaceId,body);else{const result=await workerHub.request(source.hostId,"workspace.git.worktree",{workspaceId,...body}) as any;workspace=await db.upsertWorkspace(result.workspace);}return{workspace};});});
app.get("/api/workspaces/:workspaceId/git-status",async(request)=>{const {workspaceId}=z.object({workspaceId:z.string().min(1).max(100)}).parse(request.params);const workspace=await hostWorkspaces.requireWorkspace(workspaceId);return{status:workspace.hostId===LOCAL_HOST_ID?await hostWorkspaces.gitStatus(workspaceId):await workerHub.request(workspace.hostId,"workspace.git.status",{workspaceId})};});
app.get("/api/workspaces/:workspaceId/files",async(request)=>{const {workspaceId}=z.object({workspaceId:z.string().min(1).max(100)}).parse(request.params);const query=z.object({entryId:z.string().max(2048).optional()}).parse(request.query);const workspace=await hostWorkspaces.requireWorkspace(workspaceId);return workspace.hostId===LOCAL_HOST_ID?hostWorkspaces.browseWorkspace(workspaceId,query.entryId):workerHub.request(workspace.hostId,"workspace.files.browse",{workspaceId,entryId:query.entryId});});
app.get("/api/workspaces/:workspaceId/files/download",{config:{rateLimit:{max:30,timeWindow:"1 minute"}}},async(request,reply)=>{
  const {workspaceId}=z.object({workspaceId:z.string().min(1).max(100)}).parse(request.params),query=z.object({path:z.string().min(1).max(4096)}).parse(request.query),workspace=await hostWorkspaces.requireWorkspace(workspaceId),actor=(request as any).actor;
  if(workspace.hostId===LOCAL_HOST_ID){
    const file=await hostWorkspaces.resolveWorkspaceDownload(workspaceId,query.path);
    await db.appendAudit({createdAt:new Date().toISOString(),actor,action:"workspace-file-download",provider:null,taskId:null,projectId:file.workspace.projectId,hostId:file.workspace.hostId,workspaceId:file.workspace.id,outcome:"success",detail:`path=${file.relative};size=${file.size}`}).catch(()=>{});
    reply.header("Cache-Control","no-store");reply.header("Content-Type","application/octet-stream");reply.header("Content-Length",String(file.size));reply.header("Content-Disposition",attachmentDisposition(file.name));return reply.send(fs.createReadStream(file.real));
  }
  const prepared=z.object({transferId:z.string().uuid(),name:z.string().min(1).max(512),relativePath:z.string().min(1).max(4096),size:z.number().int().min(0).max(MAX_WORKSPACE_DOWNLOAD_BYTES),modifiedAt:z.string().datetime()}).parse(await workerHub.request(workspace.hostId,"workspace.files.download.prepare",{workspaceId,path:query.path}));
  const chunks=async function*(){
    let offset=0,completed=false;
    try{
      while(offset<prepared.size){
        const result=z.object({offset:z.number().int().min(0),dataBase64:z.string().max(400000),done:z.boolean()}).parse(await workerHub.request(workspace.hostId,"workspace.files.download.chunk",{transferId:prepared.transferId,offset}));
        if(result.offset!==offset||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(result.dataBase64))throw new Error("Worker download returned an invalid chunk.");
        const chunk=Buffer.from(result.dataBase64,"base64");if(!chunk.length||chunk.length>256*1024||offset+chunk.length>prepared.size)throw new Error("Worker download returned an invalid chunk size.");
        offset+=chunk.length;if(result.done!==(offset===prepared.size))throw new Error("Worker download completion did not match the declared size.");yield chunk;
      }
      completed=true;await db.appendAudit({createdAt:new Date().toISOString(),actor,action:"workspace-file-download",provider:null,taskId:null,projectId:workspace.projectId,hostId:workspace.hostId,workspaceId:workspace.id,outcome:"success",detail:`path=${prepared.relativePath};size=${prepared.size}`}).catch(()=>{});
    }catch(error){
      await db.appendAudit({createdAt:new Date().toISOString(),actor,action:"workspace-file-download",provider:null,taskId:null,projectId:workspace.projectId,hostId:workspace.hostId,workspaceId:workspace.id,outcome:"failure",detail:`path=${prepared.relativePath};size=${prepared.size};error=${sanitizeSensitiveText(error instanceof Error?error.message:String(error)).slice(0,200)}`}).catch(()=>{});throw error;
    }finally{
      if(!completed||prepared.size===0)await workerHub.request(workspace.hostId,"workspace.files.download.cancel",{transferId:prepared.transferId}).catch(()=>{});
    }
  };
  reply.header("Cache-Control","no-store");reply.header("Content-Type","application/octet-stream");reply.header("Content-Length",String(prepared.size));reply.header("Content-Disposition",attachmentDisposition(prepared.name));return reply.send(Readable.from(chunks()));
});
app.get("/api/workspaces/:workspaceId/files/preview",{config:{rateLimit:{max:60,timeWindow:"1 minute"}}},async(request,reply)=>{
  const {workspaceId}=z.object({workspaceId:z.string().min(1).max(100)}).parse(request.params),query=z.object({path:z.string().trim().min(1).max(4096),pathBase:z.enum(["workspace","task-cwd"]),sourceTaskId:z.string().min(1).max(200).optional()}).superRefine((value,context)=>{if(value.pathBase==="task-cwd"&&!value.sourceTaskId)context.addIssue({code:z.ZodIssueCode.custom,message:"sourceTaskId is required for task-relative paths."});}).parse(request.query),workspace=await hostWorkspaces.requireWorkspace(workspaceId),actor=(request as any).actor;
  let relativePath=query.path;
  if(query.pathBase==="task-cwd"){
    if(workspace.hostId===LOCAL_HOST_ID){const resolved=await hostWorkspaces.resolveWorkspaceFile(workspaceId,query);relativePath=resolved.entry.relativePath!;}
    else{
      const source=await db.getTask(query.sourceTaskId!);
      if(!source||source.workspaceId!==workspace.id||(source.executionHostId??LOCAL_HOST_ID)!==workspace.hostId)throw Object.assign(new Error("Source task does not belong to this workspace."),{statusCode:409,code:"SOURCE_TASK_WORKSPACE_MISMATCH"});
      const resolved=z.object({entry:z.object({relativePath:z.string().min(1).max(4096)})}).parse(await workerHub.request(workspace.hostId,"workspace.files.resolve",{workspaceId,path:query.path,pathBase:query.pathBase,sourceTaskId:source.hostTaskId??source.id}));relativePath=resolved.entry.relativePath;
    }
  }
  if(workspace.hostId===LOCAL_HOST_ID){
    const file=await hostWorkspaces.resolveWorkspaceDownload(workspaceId,relativePath);
    if(!file.size||file.size>MAX_WORKSPACE_IMAGE_PREVIEW_BYTES)throw Object.assign(new Error("Image preview must be between 1 byte and 20 MiB."),{statusCode:413,code:"WORKSPACE_IMAGE_PREVIEW_TOO_LARGE"});
    const signature=Buffer.alloc(Math.min(32,file.size)),fd=fs.openSync(file.real,"r");try{fs.readSync(fd,signature,0,signature.length,0);}finally{fs.closeSync(fd);}const mime=workspaceImageMime(signature);
    if(!mime)throw Object.assign(new Error("File is not a supported PNG, JPEG, GIF, WebP, or AVIF image."),{statusCode:415,code:"WORKSPACE_IMAGE_PREVIEW_UNSUPPORTED"});
    await db.appendAudit({createdAt:new Date().toISOString(),actor,action:"workspace-file-preview",provider:null,taskId:query.sourceTaskId??null,projectId:file.workspace.projectId,hostId:file.workspace.hostId,workspaceId:file.workspace.id,outcome:"success",detail:`path=${file.relative};size=${file.size};type=${mime}`}).catch(()=>{});
    reply.header("Cache-Control","private, max-age=60");reply.header("Content-Type",mime);reply.header("Content-Length",String(file.size));reply.header("Content-Disposition",inlineDisposition(file.name));return reply.send(fs.createReadStream(file.real));
  }
  const prepared=z.object({transferId:z.string().uuid(),name:z.string().min(1).max(512),relativePath:z.string().min(1).max(4096),size:z.number().int().min(0).max(MAX_WORKSPACE_DOWNLOAD_BYTES),modifiedAt:z.string().datetime()}).parse(await workerHub.request(workspace.hostId,"workspace.files.download.prepare",{workspaceId,path:relativePath}));
  if(!prepared.size||prepared.size>MAX_WORKSPACE_IMAGE_PREVIEW_BYTES){await workerHub.request(workspace.hostId,"workspace.files.download.cancel",{transferId:prepared.transferId}).catch(()=>{});throw Object.assign(new Error("Image preview must be between 1 byte and 20 MiB."),{statusCode:413,code:"WORKSPACE_IMAGE_PREVIEW_TOO_LARGE"});}
  const readChunk=async(offset:number)=>{const result=z.object({offset:z.number().int().min(0),dataBase64:z.string().max(400000),done:z.boolean()}).parse(await workerHub.request(workspace.hostId,"workspace.files.download.chunk",{transferId:prepared.transferId,offset}));if(result.offset!==offset||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(result.dataBase64))throw new Error("Worker preview returned an invalid chunk.");const chunk=Buffer.from(result.dataBase64,"base64");if(!chunk.length||chunk.length>256*1024||offset+chunk.length>prepared.size)throw new Error("Worker preview returned an invalid chunk size.");if(result.done!==(offset+chunk.length===prepared.size))throw new Error("Worker preview completion did not match the declared size.");return{chunk,done:result.done};};
  let first:{chunk:Buffer;done:boolean};try{first=await readChunk(0);}catch(error){await workerHub.request(workspace.hostId,"workspace.files.download.cancel",{transferId:prepared.transferId}).catch(()=>{});throw error;}const mime=workspaceImageMime(first.chunk.subarray(0,32));
  if(!mime){await workerHub.request(workspace.hostId,"workspace.files.download.cancel",{transferId:prepared.transferId}).catch(()=>{});throw Object.assign(new Error("File is not a supported PNG, JPEG, GIF, WebP, or AVIF image."),{statusCode:415,code:"WORKSPACE_IMAGE_PREVIEW_UNSUPPORTED"});}
  const chunks=async function*(){let offset=0,next=first,completed=false;try{while(offset<prepared.size){yield next.chunk;offset+=next.chunk.length;if(offset<prepared.size)next=await readChunk(offset);}completed=true;await db.appendAudit({createdAt:new Date().toISOString(),actor,action:"workspace-file-preview",provider:null,taskId:query.sourceTaskId??null,projectId:workspace.projectId,hostId:workspace.hostId,workspaceId:workspace.id,outcome:"success",detail:`path=${prepared.relativePath};size=${prepared.size};type=${mime}`}).catch(()=>{});}finally{if(!completed)await workerHub.request(workspace.hostId,"workspace.files.download.cancel",{transferId:prepared.transferId}).catch(()=>{});}};
  reply.header("Cache-Control","private, max-age=60");reply.header("Content-Type",mime);reply.header("Content-Length",String(prepared.size));reply.header("Content-Disposition",inlineDisposition(prepared.name));return reply.send(Readable.from(chunks()));
});
app.get("/api/task-image-output",{config:{rateLimit:{max:60,timeWindow:"1 minute"}}},async(request,reply)=>{
  const query=z.object({taskId:z.string().min(1).max(200),path:z.string().trim().min(1).max(4096)}).parse(request.query),task=await db.getTask(query.taskId),actor=(request as any).actor;
  if(!task||task.provider!=="codex")throw Object.assign(new Error("Codex task was not found."),{statusCode:404,code:"TASK_NOT_FOUND"});
  const hostId=task.executionHostId??LOCAL_HOST_ID,hostTaskId=task.hostTaskId??task.id;
  if(!executionHostUsesWorker(hostId)){
    const file=resolveTaskImageOutput(config.dataRoot,hostTaskId,query.path);
    await db.appendAudit({createdAt:new Date().toISOString(),actor,action:"task-image-output-preview",provider:"codex",taskId:task.id,projectId:task.projectId,hostId,workspaceId:task.workspaceId,outcome:"success",detail:`path=${query.path};size=${file.size};type=${file.mime}`}).catch(()=>{});
    reply.header("Cache-Control","private, max-age=60");reply.header("Content-Type",file.mime);reply.header("Content-Length",String(file.size));reply.header("Content-Disposition",inlineDisposition(file.name));return reply.send(fs.createReadStream(file.real));
  }
  const prepared=z.object({transferId:z.string().uuid(),name:z.string().min(1).max(512),relativePath:z.string().min(1).max(4096),size:z.number().int().min(0).max(MAX_WORKSPACE_IMAGE_PREVIEW_BYTES),modifiedAt:z.string().datetime()}).parse(await workerHub.request(hostId,"task.image-output.prepare",{taskId:hostTaskId,path:query.path}));
  if(!prepared.size){await workerHub.request(hostId,"task.image-output.cancel",{transferId:prepared.transferId}).catch(()=>{});throw Object.assign(new Error("Task image output is empty."),{statusCode:404,code:"TASK_IMAGE_OUTPUT_NOT_FOUND"});}
  const readChunk=async(offset:number)=>{const result=z.object({offset:z.number().int().min(0),dataBase64:z.string().max(400000),done:z.boolean()}).parse(await workerHub.request(hostId,"task.image-output.chunk",{transferId:prepared.transferId,offset}));if(result.offset!==offset)throw new Error("Worker image output returned an invalid offset.");const chunk=Buffer.from(result.dataBase64,"base64");if(!chunk.length||chunk.length>256*1024||offset+chunk.length>prepared.size)throw new Error("Worker image output returned an invalid chunk.");return{chunk,done:result.done};};
  let first:{chunk:Buffer;done:boolean};try{first=await readChunk(0);}catch(error){await workerHub.request(hostId,"task.image-output.cancel",{transferId:prepared.transferId}).catch(()=>{});throw error;}const mime=workspaceImageMime(first.chunk.subarray(0,32));
  if(!mime){await workerHub.request(hostId,"task.image-output.cancel",{transferId:prepared.transferId}).catch(()=>{});throw Object.assign(new Error("Task output is not a supported image."),{statusCode:415,code:"TASK_IMAGE_OUTPUT_UNSUPPORTED"});}
  const chunks=async function*(){let offset=0,next=first,completed=false;try{while(offset<prepared.size){yield next.chunk;offset+=next.chunk.length;if(offset<prepared.size)next=await readChunk(offset);}completed=true;await db.appendAudit({createdAt:new Date().toISOString(),actor,action:"task-image-output-preview",provider:"codex",taskId:task.id,projectId:task.projectId,hostId,workspaceId:task.workspaceId,outcome:"success",detail:`path=${query.path};size=${prepared.size};type=${mime}`}).catch(()=>{});}finally{if(!completed)await workerHub.request(hostId,"task.image-output.cancel",{transferId:prepared.transferId}).catch(()=>{});}};
  reply.header("Cache-Control","private, max-age=60");reply.header("Content-Type",mime);reply.header("Content-Length",String(prepared.size));reply.header("Content-Disposition",inlineDisposition(prepared.name));return reply.send(Readable.from(chunks()));
});
app.post("/api/workspaces/:workspaceId/files/resolve",{config:{rateLimit:{max:60,timeWindow:"1 minute"}}},async(request)=>{const {workspaceId}=z.object({workspaceId:z.string().min(1).max(100)}).parse(request.params),body=z.object({path:z.string().trim().min(1).max(4096),pathBase:z.enum(["workspace","task-cwd"]),sourceTaskId:z.string().min(1).max(200).optional()}).superRefine((value,context)=>{if(value.pathBase==="task-cwd"&&!value.sourceTaskId)context.addIssue({code:z.ZodIssueCode.custom,message:"sourceTaskId is required for task-relative paths."});}).parse(request.body),workspace=await hostWorkspaces.requireWorkspace(workspaceId);if(workspace.hostId===LOCAL_HOST_ID)return hostWorkspaces.resolveWorkspaceFile(workspaceId,body);let sourceTaskId:string|undefined;if(body.pathBase==="task-cwd"){const source=await db.getTask(body.sourceTaskId!);if(!source||source.workspaceId!==workspace.id||(source.executionHostId??LOCAL_HOST_ID)!==workspace.hostId)throw Object.assign(new Error("Source task does not belong to this workspace."),{statusCode:409,code:"SOURCE_TASK_WORKSPACE_MISMATCH"});sourceTaskId=source.hostTaskId??source.id;}return workerHub.request(workspace.hostId,"workspace.files.resolve",{workspaceId,path:body.path,pathBase:body.pathBase,sourceTaskId});});
app.post("/api/workspaces/:workspaceId/files/edit/read",{config:{rateLimit:{max:60,timeWindow:"1 minute"}}},async(request)=>{const {workspaceId}=z.object({workspaceId:z.string().min(1).max(100)}).parse(request.params),body=z.object({fileId:z.string().min(1).max(2048)}).parse(request.body),workspace=await hostWorkspaces.requireWorkspace(workspaceId);return workspace.hostId===LOCAL_HOST_ID?hostWorkspaces.readEditableWorkspaceFile(workspaceId,body.fileId):workerHub.request(workspace.hostId,"workspace.files.edit.read",{workspaceId,...body});});
app.put("/api/workspaces/:workspaceId/files/write",{bodyLimit:768*1024,config:{rateLimit:{max:30,timeWindow:"1 minute"}}},async(request)=>{const {workspaceId}=z.object({workspaceId:z.string().min(1).max(100)}).parse(request.params),body=z.object({fileId:z.string().min(1).max(2048),content:z.string().max(MAX_EDITABLE_WORKSPACE_FILE_BYTES),expectedRevision:z.string().regex(/^[a-f0-9]{64}$/),expectedCurrentRevision:z.string().regex(/^[a-f0-9]{64}$/).optional()}).parse(request.body);if(Buffer.byteLength(body.content,"utf8")>MAX_EDITABLE_WORKSPACE_FILE_BYTES)throw Object.assign(new Error("Edited file exceeds the 256 KiB limit."),{statusCode:413,code:"WORKSPACE_FILE_EDIT_TOO_LARGE"});const workspace=await hostWorkspaces.requireWorkspace(workspaceId);return idempotent(request,`workspace-file-write:${workspaceId}`,body,async()=>{const result:any=workspace.hostId===LOCAL_HOST_ID?await hostWorkspaces.writeWorkspaceFile(workspaceId,body):await workerHub.request(workspace.hostId,"workspace.files.write",{workspaceId,...body});if(workspace.hostId!==LOCAL_HOST_ID&&result?.status){const timestamp=new Date().toISOString();await db.upsertWorkspace({...workspace,gitRemote:result.status.remote??null,defaultBranch:result.status.branch??null,lastKnownCommit:result.status.commit??null,lastGitStatus:result.status,lastVerifiedAt:timestamp,updatedAt:timestamp});}await db.appendAudit({createdAt:new Date().toISOString(),actor:(request as any).actor,action:"workspace-file-write",provider:null,taskId:null,projectId:workspace.projectId,hostId:workspace.hostId,workspaceId:workspace.id,outcome:"success",detail:`path=${String(result.relativePath??"").slice(0,300)};before=${String(result.previousRevision??"").slice(0,64)};after=${String(result.revision??"").slice(0,64)};bytes=${Number(result.byteLength)||0}`});return result;});});
app.post("/api/workspaces/:workspaceId/files/read",{config:{rateLimit:{max:60,timeWindow:"1 minute"}}},async(request)=>{const {workspaceId}=z.object({workspaceId:z.string().min(1).max(100)}).parse(request.params);const body=z.object({fileId:z.string().min(1).max(2048),offset:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),limit:z.number().int().min(1).max(128*1024).default(65536),confirmSensitive:z.boolean().default(false)}).parse(request.body);return authIdempotent(request,`workspace-file-read:${workspaceId}`,body,async()=>{const workspace=await hostWorkspaces.requireWorkspace(workspaceId);return workspace.hostId===LOCAL_HOST_ID?hostWorkspaces.readWorkspaceFile(workspaceId,body.fileId,body.offset,body.limit,body.confirmSensitive):workerHub.request(workspace.hostId,"workspace.files.read",{workspaceId,...body});});});
app.post("/api/workspaces/:workspaceId/files/html-preview",{config:{rateLimit:{max:20,timeWindow:"1 minute"}}},async(request)=>{
  const {workspaceId}=z.object({workspaceId:z.string().min(1).max(100)}).parse(request.params),body=z.object({fileId:z.string().min(1).max(2048),confirmSensitive:z.boolean().default(false)}).parse(request.body),workspace=await hostWorkspaces.requireWorkspace(workspaceId),actor=(request as any).actor;
  if(workspace.hostId!==LOCAL_HOST_ID)throw Object.assign(new Error("HTML preview is available only for local workspaces."),{statusCode:409,code:"HTML_PREVIEW_LOCAL_ONLY"});
  try{
    const result=await hostWorkspaces.readHtmlPreview(workspaceId,body.fileId,body.confirmSensitive);
    await db.appendAudit({createdAt:new Date().toISOString(),actor,action:"workspace-html-preview-read",provider:null,taskId:null,projectId:workspace.projectId,hostId:workspace.hostId,workspaceId:workspace.id,outcome:"success",detail:`path=${result.relativePath};bytes=${result.byteLength}`}).catch(()=>{});
    return result;
  }catch(error){
    await db.appendAudit({createdAt:new Date().toISOString(),actor,action:"workspace-html-preview-read",provider:null,taskId:null,projectId:workspace.projectId,hostId:workspace.hostId,workspaceId:workspace.id,outcome:"failure",detail:`code=${typeof (error as any)?.code==="string"?(error as any).code:"unknown"}`}).catch(()=>{});
    throw error;
  }
});
app.post("/api/workspaces/:workspaceId/git-diff",{config:{rateLimit:{max:30,timeWindow:"1 minute"}}},async(request)=>{const {workspaceId}=z.object({workspaceId:z.string().min(1).max(100)}).parse(request.params);const body=z.object({fileId:z.string().min(1).max(2048).optional()}).parse(request.body);return authIdempotent(request,`workspace-git-diff:${workspaceId}`,body,async()=>{const workspace=await hostWorkspaces.requireWorkspace(workspaceId);return workspace.hostId===LOCAL_HOST_ID?hostWorkspaces.gitDiff(workspaceId,body.fileId):workerHub.request(workspace.hostId,"workspace.git.diff",{workspaceId,...body});});});
app.post("/api/workspaces/:workspaceId/git/diff",{config:{rateLimit:{max:30,timeWindow:"1 minute"}}},async(request)=>{const {workspaceId}=z.object({workspaceId:z.string().min(1).max(100)}).parse(request.params),body=z.object({path:z.string().min(1).max(1000).optional(),staged:z.boolean().default(false)}).parse(request.body),workspace=await hostWorkspaces.requireWorkspace(workspaceId);return workspace.hostId===LOCAL_HOST_ID?hostWorkspaces.gitDiffPath(workspaceId,body):workerHub.request(workspace.hostId,"workspace.git.diff-path",{workspaceId,...body});});
app.get("/api/workspaces/:workspaceId/git/log",async(request)=>{const {workspaceId}=z.object({workspaceId:z.string().min(1).max(100)}).parse(request.params),query=z.object({limit:z.coerce.number().int().min(1).max(200).default(50)}).parse(request.query),workspace=await hostWorkspaces.requireWorkspace(workspaceId);return workspace.hostId===LOCAL_HOST_ID?hostWorkspaces.gitLog(workspaceId,query.limit):workerHub.request(workspace.hostId,"workspace.git.log",{workspaceId,limit:query.limit});});
app.get("/api/workspaces/:workspaceId/git/branches",async(request)=>{const {workspaceId}=z.object({workspaceId:z.string().min(1).max(100)}).parse(request.params),workspace=await hostWorkspaces.requireWorkspace(workspaceId);return workspace.hostId===LOCAL_HOST_ID?hostWorkspaces.gitBranches(workspaceId):workerHub.request(workspace.hostId,"workspace.git.branches",{workspaceId});});
app.post("/api/workspaces/:workspaceId/git/operation",{config:{rateLimit:{max:60,timeWindow:"1 minute"}}},async(request)=>{const {workspaceId}=z.object({workspaceId:z.string().min(1).max(100)}).parse(request.params),operation=gitOperationSchema.parse(request.body),workspace=await hostWorkspaces.requireWorkspace(workspaceId);return idempotent(request,`git-operation:${workspaceId}:${operation.type}`,operation,async()=>{const result=workspace.hostId===LOCAL_HOST_ID?await hostWorkspaces.gitOperation(workspaceId,operation):await workerHub.request(workspace.hostId,"workspace.git.operation",{workspaceId,operation},undefined,["clone","fetch","pull","push"].includes(operation.type)?10*60_000:60_000) as any;if(workspace.hostId!==LOCAL_HOST_ID&&result?.status)await db.upsertWorkspace({...workspace,gitRemote:result.status.remote,defaultBranch:result.status.branch,lastKnownCommit:result.status.commit,lastGitStatus:result.status,lastVerifiedAt:new Date().toISOString(),updatedAt:new Date().toISOString()});await db.appendAudit({createdAt:new Date().toISOString(),actor:(request as any).actor,action:`git-${operation.type}`,provider:null,taskId:null,projectId:workspace.projectId,hostId:workspace.hostId,workspaceId:workspace.id,outcome:"success",detail:`typed operation=${operation.type}`});return result;});});
const pullRequestCreationLocks=new Set<string>();
app.get("/api/tasks/:provider/:taskId/pull-request/preview",async(request)=>{
  const item=await taskFromParams(request.params);
  if(item.task.status!=="completed")throw Object.assign(new Error("Pull requests are available after the task completes."),{statusCode:409,code:"PR_TASK_NOT_COMPLETED"});
  if(!item.task.workspaceId)throw Object.assign(new Error("This task has no Workspace."),{statusCode:409,code:"PR_WORKSPACE_REQUIRED"});
  const workspace=await hostWorkspaces.requireWorkspace(item.task.workspaceId,item.task.executionHostId??LOCAL_HOST_ID);
  const preview=workspace.hostId===LOCAL_HOST_ID?await hostWorkspaces.githubPullRequestPreview(workspace.id):await workerHub.request(workspace.hostId,"workspace.github.pr.preview",{workspaceId:workspace.id});
  return{preview,pullRequestUrl:item.task.metadata?.pullRequestUrl??null};
});
app.post("/api/tasks/:provider/:taskId/pull-request",{config:{rateLimit:{max:3,timeWindow:"10 minutes"}}},async(request)=>{
  const item=await taskFromParams(request.params),body=pullRequestInputSchema.extend({confirm:z.literal(true)}).parse(request.body);
  if(item.task.status!=="completed")throw Object.assign(new Error("Pull requests are available after the task completes."),{statusCode:409,code:"PR_TASK_NOT_COMPLETED"});
  if(!item.task.workspaceId)throw Object.assign(new Error("This task has no Workspace."),{statusCode:409,code:"PR_WORKSPACE_REQUIRED"});
  const workspace=await hostWorkspaces.requireWorkspace(item.task.workspaceId,item.task.executionHostId??LOCAL_HOST_ID);
  return idempotent(request,`pull-request-create:${item.task.id}`,body,async()=>{
    if(pullRequestCreationLocks.has(item.task.id))throw Object.assign(new Error("A pull request creation is already in progress for this task."),{statusCode:409,code:"PR_CREATE_IN_PROGRESS"});
    pullRequestCreationLocks.add(item.task.id);
    try{
      const input={title:body.title,body:body.body,base:body.base,draft:body.draft},result:any=workspace.hostId===LOCAL_HOST_ID?await hostWorkspaces.createGithubPullRequest(workspace.id,input):await workerHub.request(workspace.hostId,"workspace.github.pr.create",{workspaceId:workspace.id,input},undefined,90_000);
      const timestamp=new Date().toISOString(),task=await db.upsertTask({...item.task,updatedAt:timestamp,metadata:{...item.task.metadata,pullRequestUrl:result.url,pullRequestCreatedAt:timestamp,pullRequestRepository:result.preview?.repository??null}});
      await db.appendAudit({createdAt:timestamp,actor:(request as any).actor,action:"pull-request-create",provider:task.provider,taskId:task.id,projectId:task.projectId,hostId:workspace.hostId,workspaceId:workspace.id,outcome:result.reused?"reused":"success",detail:`repository=${String(result.preview?.repository??"").slice(0,200)};base=${body.base};draft=${body.draft}`});
      return{url:result.url,reused:result.reused,preview:result.preview,task};
    }finally{pullRequestCreationLocks.delete(item.task.id);}
  });
});
app.post("/api/workspaces/:workspaceId/unregister",async(request)=>{const {workspaceId}=z.object({workspaceId:z.string().min(1).max(100)}).parse(request.params);const body=z.object({confirm:z.literal(true),filesRemain:z.literal(true)}).parse(request.body);return idempotent(request,`workspace-unregister:${workspaceId}`,body,async()=>{const workspace=await hostWorkspaces.requireWorkspace(workspaceId);assertWorkspaceManagementAllowed(workspace.projectId);const active=(await db.listTasks()).some(task=>task.workspaceId===workspaceId&&["pending","queued","running","waiting","unknown"].includes(task.status));if(active)throw Object.assign(new Error("Workspace has an active or unconfirmed task."),{statusCode:409});if(workspace.hostId!==LOCAL_HOST_ID)await workerHub.request(workspace.hostId,"workspace.unregister",{workspaceId});await db.archiveWorkspace(workspaceId,new Date().toISOString());return{unregistered:true,filesDeleted:false};});});
app.post("/api/workspaces/:workspaceId/delete",{config:{rateLimit:{max:2,timeWindow:"10 minutes"}}},async(request)=>{const {workspaceId}=z.object({workspaceId:z.string().min(1).max(100)}).parse(request.params);const body=z.object({confirm:z.literal(true),confirmName:z.string().min(1).max(100),understandFilesAreDeleted:z.literal(true)}).parse(request.body);return idempotent(request,`workspace-delete:${workspaceId}`,body,async()=>{const workspace=await hostWorkspaces.requireWorkspace(workspaceId);assertWorkspaceManagementAllowed(workspace.projectId);const active=(await db.listTasks()).some(task=>task.workspaceId===workspaceId&&["pending","queued","running","waiting","unknown"].includes(task.status));if(active)throw Object.assign(new Error("Workspace has an active or unconfirmed task."),{statusCode:409});const linked=(await db.listWorkspaces({includeArchived:true})).filter(item=>item.id!==workspace.id&&item.canonicalPath===workspace.canonicalPath&&!item.archivedAt);if(linked.length)throw Object.assign(new Error("Another workspace still references this directory."),{statusCode:409});const result=workspace.hostId===LOCAL_HOST_ID?await hostWorkspaces.deleteLocal(workspaceId,body.confirmName):await workerHub.request(workspace.hostId,"workspace.delete",{workspaceId,confirmName:body.confirmName});await db.archiveWorkspace(workspaceId,new Date().toISOString());await db.appendAudit({createdAt:new Date().toISOString(),actor:(request as any).actor,action:"workspace-delete",provider:null,taskId:null,projectId:workspace.projectId,outcome:"success",detail:`host=${workspace.hostId};workspace=${workspace.id}`,hostId:workspace.hostId,workspaceId:workspace.id});return result;});});

const handoffDraft=z.object({sourceTaskId:z.string().min(3).max(200),targetHostId:z.string().min(1).max(100),targetWorkspaceId:z.string().min(1).max(100),targetProvider:providerParam,targetModel:z.string().trim().min(1).max(120).nullable().optional(),targetReasoningEffort:z.string().trim().min(1).max(30).nullable().optional(),targetServiceTier:z.enum(["priority"]).nullable().optional(),kind:z.enum(["continue","review","review-return"]),includePatch:z.boolean().default(false),purpose:z.string().max(20000).default(""),completed:z.string().max(20000).default(""),tests:z.string().max(20000).default(""),remaining:z.string().max(20000).default(""),warnings:z.string().max(20000).default(""),lastDecision:z.string().max(20000).default("")});
app.post("/api/handoffs",{config:{rateLimit:{max:10,timeWindow:"10 minutes"}}},async(request)=>{const body=handoffDraft.parse(request.body);await requireGlobalModel(body.targetProvider,body.targetModel);return authIdempotent(request,"handoff-create",body,async()=>{const result=await handoffs.create(body);await db.appendAudit({createdAt:new Date().toISOString(),actor:(request as any).actor,action:"handoff-draft",provider:body.targetProvider,taskId:body.sourceTaskId,projectId:null,outcome:"success",detail:`targetHost=${body.targetHostId};kind=${body.kind};patch=${body.includePatch};model=${body.targetModel??"default"}`});return result;});});
app.get("/api/handoffs/:artifactId",async(request)=>{const {artifactId}=z.object({artifactId:z.string().uuid()}).parse(request.params);return handoffs.read(artifactId);});
app.patch("/api/handoffs/:artifactId",async(request)=>{const {artifactId}=z.object({artifactId:z.string().uuid()}).parse(request.params);const body=z.object({markdown:z.string().min(10).max(100000)}).parse(request.body);return authIdempotent(request,`handoff-update:${artifactId}`,body,()=>handoffs.update(artifactId,body.markdown));});
app.post("/api/handoffs/:artifactId/validate",async(request)=>{const {artifactId}=z.object({artifactId:z.string().uuid()}).parse(request.params);const body=z.object({confirm:z.literal(true)}).parse(request.body);return idempotent(request,`handoff-validate:${artifactId}`,body,()=>handoffs.validate(artifactId));});
app.post("/api/handoffs/:artifactId/execute",{config:{rateLimit:{max:5,timeWindow:"10 minutes"}}},async(request)=>{const {artifactId}=z.object({artifactId:z.string().uuid()}).parse(request.params);const body=z.object({confirmNewSession:z.literal(true),confirmNoAutomaticPatch:z.literal(true)}).parse(request.body),artifact=await handoffs.read(artifactId);await requirePaidCreditConsent(request,[artifact.artifact.targetProvider]);await requireGlobalModel(artifact.artifact.targetProvider,artifact.artifact.targetExecution?.model);return idempotent(request,`handoff-execute:${artifactId}`,body,async()=>{const result=await handoffs.execute(artifactId);await db.appendAudit({createdAt:new Date().toISOString(),actor:(request as any).actor,action:"handoff-execute",provider:result.targetTask.provider,taskId:result.targetTask.id,projectId:result.targetTask.projectId,outcome:"success",detail:`artifact=${artifactId};chain=${result.chainId};targetHost=${result.targetTask.executionHostId}`});void pushManager.notifyHandoff(result.targetTask);return{artifact:result.artifact,targetTask:{...result.targetTask,prompt:"",log:""},chainId:result.chainId};});});
app.post("/api/handoffs/:artifactId/retry",{config:{rateLimit:{max:5,timeWindow:"10 minutes"}}},async(request)=>{const {artifactId}=z.object({artifactId:z.string().uuid()}).parse(request.params);const body=z.object({confirmNewSession:z.literal(true),confirmNoAutomaticPatch:z.literal(true)}).parse(request.body),artifact=await handoffs.read(artifactId);await requirePaidCreditConsent(request,[artifact.artifact.targetProvider]);await requireGlobalModel(artifact.artifact.targetProvider,artifact.artifact.targetExecution?.model);return idempotent(request,`handoff-retry:${artifactId}`,body,async()=>{const result=await handoffs.execute(artifactId);return{artifact:result.artifact,targetTask:{...result.targetTask,prompt:"",log:""},chainId:result.chainId};});});
app.post("/api/handoffs/:artifactId/expire",async(request)=>{const {artifactId}=z.object({artifactId:z.string().uuid()}).parse(request.params);const body=z.object({confirm:z.literal(true)}).parse(request.body);return idempotent(request,`handoff-expire:${artifactId}`,body,()=>handoffs.expire(artifactId));});
app.get("/api/work-chains/:chainId",async(request)=>{const {chainId}=z.object({chainId:z.string().uuid()}).parse(request.params);return handoffs.chain(chainId);});

const collaborationParams=z.object({collaborationId:z.string().uuid()});
const collaborationParticipantInput=z.object({provider:providerParam,executionHostId:z.string().min(1).max(100),workspaceId:z.string().min(1).max(100),permissionMode:z.enum(["read","plan","write"]),model:z.string().min(1).max(100).nullable().optional(),reasoningEffort:z.string().min(1).max(30).nullable().optional(),serviceTier:z.enum(["priority"]).nullable().optional(),automationLevel:z.enum(["full","auto","confirm","read"]).optional(),tonePreset:z.preprocess(migrateTonePreset,tonePreset).optional(),customTone:z.string().trim().max(2000).optional()});
function collaborationRunEventSlices(events:any[],runCount:number){
  if(runCount<=1)return[events];
  const turns:any[][]=[];let current:any[]=[];
  for(const event of events){if(event.type==="turn_started"&&current.some(item=>item.type!=="task_started")){turns.push(current);current=[];}current.push(event);}
  if(current.some(item=>item.type!=="task_started"))turns.push(current);
  return turns.length>=runCount?turns.slice(-runCount):[];
}
app.get("/api/collaborations",async(request)=>{const query=z.object({archived:z.enum(["true","false"]).transform(value=>value==="true").optional()}).parse(request.query);return{collaborations:await collaboration.list(query.archived??false)};});
app.get("/api/conversation-documents",async()=>({documents:managedConversationDocuments(await collaboration.list(true))}));
app.post("/api/collaborations",{config:{rateLimit:{max:6,timeWindow:"1 minute"}}},async(request)=>{
  const body=z.object({projectId:z.string().regex(/^[a-z0-9-]+$/),title:z.string().trim().min(1).max(100),mode:z.enum(["parallel","review","debate","conversation"]),prompt:z.string().trim().min(1).max(config.promptMaxLength),primaryProvider:providerParam,participants:z.array(collaborationParticipantInput).min(1).max(6),maxCalls:z.number().int().min(1).max(500).optional(),reviewDepth:z.enum(["basic","deep"]).optional(),reviewFinalization:z.enum(["primary","side-by-side","raw"]).optional(),applyReviewFixes:z.boolean().optional(),maxTurnsPerParticipant:z.number().int().min(1).max(100).nullable().optional(),maxRounds:z.number().int().min(1).max(100).nullable().optional(),unlimitedConfirmation:z.boolean().optional(),debateKind:z.enum(["discussion","artifact-review"]).optional(),conversationFlow:z.enum(["guided","automatic"]).optional(),conversationKind:z.enum(["casual","artifact-review"]).optional(),conversationTurnLength:z.enum(["compact","rich"]).optional(),participantOrder:z.array(providerParam).min(1).max(6).optional(),relationshipPreset:z.string().trim().min(1).max(80).optional(),userNickname:z.string().trim().min(1).max(40).optional(),allowModelUserCall:z.boolean().optional(),conclusionRequested:z.boolean().optional(),conclusionRelativePath:z.string().trim().min(3).max(1024).refine(value=>value.toLowerCase().endsWith(".md"),"Markdown filename required.").optional(),conversationTone:z.enum(["comfortable","warm","playful","serious","concise"]).optional(),timeoutMs:z.number().int().min(30_000).max(8*60*60_000).optional(),dangerConfirmation:z.boolean().optional(),fullAccessAcknowledged:z.boolean().optional(),acknowledgementVersion:z.number().int().optional()}).superRefine((value,context)=>{const conversation=value.mode==="debate"||value.mode==="conversation",primary=value.participants.find(item=>item.provider===value.primaryProvider),writes=value.participants.filter(item=>item.permissionMode==="write"),providers=value.participants.map(item=>item.provider);if(new Set(providers).size!==providers.length)context.addIssue({code:z.ZodIssueCode.custom,message:"Conversation providers must be unique."});if(!providers.includes(value.primaryProvider))context.addIssue({code:z.ZodIssueCode.custom,message:"Primary provider must be an enabled participant."});if(conversation&&value.participants.some(item=>item.permissionMode!=="read"||(item.automationLevel??"read")!=="read"))context.addIssue({code:z.ZodIssueCode.custom,message:"Conversation participants and execution must be read-only."});if(!conversation&&(value.conclusionRequested||value.conclusionRelativePath))context.addIssue({code:z.ZodIssueCode.custom,message:"Conclusion Markdown is available only for conversations."});if(value.mode==="parallel"&&value.participants.some(item=>item.permissionMode!=="read"))context.addIssue({code:z.ZodIssueCode.custom,message:"Independent review participants must retain a read-only collaboration role."});if(value.mode==="review"&&(writes.length>1||writes.some(item=>item!==primary)||value.participants.some(item=>item.permissionMode==="plan")))context.addIssue({code:z.ZodIssueCode.custom,message:"Only the primary cross-review participant may hold the write role."});if(writes.length&&value.dangerConfirmation!==true)context.addIssue({code:z.ZodIssueCode.custom,message:"Review changes require explicit risk confirmation."});if(value.applyReviewFixes===true&&(value.mode!=="review"||value.reviewFinalization!=="primary"||primary?.permissionMode!=="write"||(primary.automationLevel??"read")==="read"))context.addIssue({code:z.ZodIssueCode.custom,message:"Review fixes require a writable automated primary finalization."});if(!conversation&&value.participants.some(item=>item.automationLevel==="full")&&!fullAccessAcknowledgementValid(value))context.addIssue({code:z.ZodIssueCode.custom,message:"Full-auto review requires the current explicit risk acknowledgement."});if(conversation&&(value.maxRounds===null||value.maxTurnsPerParticipant===null)&&value.unlimitedConfirmation!==true)context.addIssue({code:z.ZodIssueCode.custom,message:"Unlimited conversation requires explicit confirmation."});if(!conversation&&value.participants.length<2)context.addIssue({code:z.ZodIssueCode.custom,message:"Independent and cross review require at least two participants."});for(const item of value.participants){if(item.provider==="claude"&&item.reasoningEffort&&item.reasoningEffort!=="default"&&!ClaudeProvider.validEfforts.has(item.reasoningEffort))context.addIssue({code:z.ZodIssueCode.custom,message:"Unknown Claude reasoning effort."});if(item.provider==="claude"&&item.automationLevel==="confirm")context.addIssue({code:z.ZodIssueCode.custom,message:"Claude confirmation automation is not supported."});if(item.provider==="claude"&&item.serviceTier)context.addIssue({code:z.ZodIssueCode.custom,message:"Claude review does not support a Codex service tier."});}}).parse(request.body);
  await requirePaidCreditConsent(request,body.participants.map(item=>item.provider));
  await requireGlobalModels(body.participants);
  return idempotent(request,"collaboration-create",body,async()=>{const mode=body.mode==="conversation"?"debate":body.mode,result=await collaboration.create({...body,mode,creditApprovedProviders:[...confirmedPaidCreditProviders(request)],participants:body.participants.map(item=>({...item,role:item.provider===body.primaryProvider?"primary":mode==="review"?"reviewer":mode==="debate"?"debater":"assistant"}))});await db.appendAudit({createdAt:new Date().toISOString(),actor:(request as any).actor,action:"collaboration-create",provider:null,taskId:null,projectId:body.projectId,outcome:"success",detail:`collaboration=${result.session.id};mode=${mode};participants=${body.participants.length};turnLimit=${mode==="debate"?(body.maxRounds??body.maxTurnsPerParticipant??"server-safety-cap"):"n/a"}`});return result;});
});
app.get("/api/collaborations/:collaborationId",async(request)=>{
  const detail=await collaboration.detail(collaborationParams.parse(request.params).collaborationId),runEvents:Record<string,unknown[]>={};
  const runsByTask=new Map<string,any[]>();
  for(const run of detail.runs as any[]){if(!run.providerTaskId)continue;const rows=runsByTask.get(run.providerTaskId)??[];rows.push(run);runsByTask.set(run.providerTaskId,rows);}
  for(const[taskId,runs]of runsByTask){
    runs.sort((left,right)=>left.sequence-right.sequence);const events=readStreamEvents(config.dataRoot,taskId,0,STREAM_REPLAY_LIMIT).events,slices=collaborationRunEventSlices(events,runs.length);
    for(let index=0;index<runs.length;index++){
      const run=runs[index],next=runs[index+1],started=Date.parse(run.startedAt??run.createdAt),ended=next?Date.parse(next.startedAt??next.createdAt):Number.POSITIVE_INFINITY;
      const timestampSlice=events.filter(event=>{const at=Date.parse(event.timestamp??"");return Number.isFinite(at)&&at>=started&&at<ended;});
      runEvents[run.id]=collaborationPublicEvents(slices[index]?.length?slices[index]:timestampSlice);
    }
  }
  return{...detail,runEvents};
});
app.post("/api/collaborations/:collaborationId/cancel",{config:{rateLimit:{max:10,timeWindow:"1 minute"}}},async(request)=>{const {collaborationId}=collaborationParams.parse(request.params);const body=z.object({confirm:z.literal(true)}).parse(request.body);return idempotent(request,`collaboration-cancel:${collaborationId}`,body,async()=>{const result=await collaboration.cancel(collaborationId);await db.appendAudit({createdAt:new Date().toISOString(),actor:(request as any).actor,action:"collaboration-cancel",provider:null,taskId:null,projectId:result.session.projectId,outcome:"success",detail:`collaboration=${collaborationId};status=${result.session.status}`});return result;});});
app.post("/api/collaborations/:collaborationId/archive",async(request)=>{const {collaborationId}=collaborationParams.parse(request.params);const body=z.object({confirm:z.literal(true)}).parse(request.body);return idempotent(request,`collaboration-archive:${collaborationId}`,body,()=>collaboration.archive(collaborationId));});
app.delete("/api/collaborations/:collaborationId",async(request)=>{const {collaborationId}=collaborationParams.parse(request.params);const body=z.object({confirmDelete:z.literal(true),deleteLinkedProviderSessions:z.literal(true)}).parse(request.body);return idempotent(request,`collaboration-delete:${collaborationId}`,body,async()=>{const result=await collaboration.delete(collaborationId);await db.appendAudit({createdAt:new Date().toISOString(),actor:(request as any).actor,action:"collaboration-delete",provider:null,taskId:null,projectId:result.projectId,outcome:"success",detail:`collaboration=${collaborationId};providerSessionsDeleted=${result.providerSessionsDeleted};providerSessionCount=${result.providerSessionCount};filesDeleted=false`});return result;});});
app.post("/api/collaborations/:collaborationId/accept-partial",async(request)=>{const {collaborationId}=collaborationParams.parse(request.params);const body=z.object({confirm:z.literal(true)}).parse(request.body);return idempotent(request,`collaboration-accept:${collaborationId}`,body,()=>collaboration.acceptPartial(collaborationId));});
app.post("/api/collaborations/:collaborationId/resume",async(request)=>{const {collaborationId}=collaborationParams.parse(request.params),detail=await collaboration.detail(collaborationId),participantById=new Map((detail.participants as any[]).map(item=>[item.id,item])),providersToCheck=[...new Set<ProviderId>((detail.runs as any[]).filter(run=>run.status==="waiting-user"&&String(run.errorCategory).startsWith("paid-credit-consent-required:")).map(run=>participantById.get(run.participantId)?.provider).filter((item):item is ProviderId=>item==="codex"||item==="claude"))];const body=z.object({confirmExternalState:z.literal(true)}).parse(request.body);if(providersToCheck.length){await requirePaidCreditConsent(request,providersToCheck);collaboration.approveCreditOnce(collaborationId,[...confirmedPaidCreditProviders(request)]);}return idempotent(request,`collaboration-resume:${collaborationId}`,body,()=>collaboration.resume(collaborationId));});
app.post("/api/collaborations/:collaborationId/messages",{config:{rateLimit:{max:12,timeWindow:"1 minute"}}},async(request)=>{const {collaborationId}=collaborationParams.parse(request.params),body=z.object({prompt:z.string().trim().min(1).max(config.promptMaxLength),generation:z.number().int().positive().optional(),reminderTargets:z.array(providerParam).max(6).refine(items=>new Set(items).size===items.length,"Reminder targets must be unique.").optional()}).parse(request.body);return idempotent(request,`conversation-message:${collaborationId}`,body,()=>collaboration.submitConversationMessage(collaborationId,body.prompt,body.generation,body.reminderTargets));});
app.post("/api/collaborations/:collaborationId/conclusion-markdown",{config:{rateLimit:{max:3,timeWindow:"10 minutes"}}},async(request)=>{const {collaborationId}=collaborationParams.parse(request.params),body=z.object({workspaceId:z.string().min(1).max(100),relativePath:z.string().trim().min(3).max(1024).refine(value=>value.toLowerCase().endsWith(".md"),"Markdown filename required."),confirmWrite:z.literal(true),confirmNoOverwrite:z.literal(true)}).parse(request.body),detail=await collaboration.detail(collaborationId),providersToCheck=[...new Set<ProviderId>((detail.participants as any[]).filter(item=>!item.archivedAt&&((detail.session.metadata?.enabledProviders as unknown[])??[]).includes(item.provider)).map(item=>item.provider))];await requirePaidCreditConsent(request,providersToCheck);collaboration.approveCreditOnce(collaborationId,[...confirmedPaidCreditProviders(request)]);return idempotent(request,`conversation-conclusion:${collaborationId}`,body,async()=>{const result=await collaboration.createConversationConclusion(collaborationId,body);await db.appendAudit({createdAt:new Date().toISOString(),actor:(request as any).actor,action:"conversation-conclusion-create",provider:null,taskId:null,projectId:result.session.projectId,hostId:null,workspaceId:body.workspaceId,outcome:"success",detail:`collaboration=${collaborationId};path=${result.file.relativePath};bytes=${result.file.byteLength};overwrite=false`});return result;});});
app.delete("/api/collaborations/:collaborationId/conclusion-markdown",{config:{rateLimit:{max:6,timeWindow:"10 minutes"}}},async(request)=>{const {collaborationId}=collaborationParams.parse(request.params),body=z.object({workspaceId:z.string().min(1).max(100),relativePath:z.string().trim().min(3).max(1024).refine(value=>value.toLowerCase().endsWith(".md"),"Markdown filename required."),revision:z.string().regex(/^[a-f0-9]{64}$/),confirmDelete:z.literal(true)}).parse(request.body);return idempotent(request,`conversation-conclusion-delete:${collaborationId}`,body,async()=>{const result=await collaboration.deleteConversationConclusion(collaborationId,body,async input=>hostWorkspaces.deleteWorkspaceMarkdown(input.workspaceId,input.relativePath,input.revision));await db.appendAudit({createdAt:new Date().toISOString(),actor:(request as any).actor,action:"conversation-conclusion-delete",provider:null,taskId:null,projectId:result.session.projectId,hostId:LOCAL_HOST_ID,workspaceId:body.workspaceId,outcome:"success",detail:`collaboration=${collaborationId};path=${result.file.relativePath};revision=${result.file.revision}`});return result;});});
app.put("/api/collaborations/:collaborationId/participants/:provider",async(request)=>{const {collaborationId,provider}=z.object({collaborationId:z.string().uuid(),provider:providerParam}).parse(request.params),body=z.object({enabled:z.boolean(),confirm:z.literal(true)}).parse(request.body);return idempotent(request,`conversation-participant:${collaborationId}:${provider}`,body,()=>collaboration.setConversationParticipant(collaborationId,provider,body.enabled));});
app.post("/api/collaborations/:collaborationId/add-rounds",async(request)=>{const {collaborationId}=collaborationParams.parse(request.params),body=z.object({count:z.number().int().min(1).max(20).default(5)}).parse(request.body);return idempotent(request,`conversation-add-rounds:${collaborationId}`,body,()=>collaboration.addConversationRounds(collaborationId,body.count));});
app.post("/api/collaborations/:collaborationId/auto-continue",async(request)=>{const {collaborationId}=collaborationParams.parse(request.params),body=z.object({count:z.number().int().min(1).max(20).default(5)}).parse(request.body);return idempotent(request,`conversation-auto-continue:${collaborationId}`,body,()=>collaboration.autoContinueGuidedConversation(collaborationId,body.count));});
app.post("/api/collaborations/:collaborationId/runs/:runId/retry",async(request)=>{const {collaborationId,runId}=z.object({collaborationId:z.string().uuid(),runId:z.string().uuid()}).parse(request.params),body=z.object({confirm:z.literal(true)}).parse(request.body);return idempotent(request,`conversation-retry:${collaborationId}:${runId}`,body,()=>collaboration.retryFailedTurn(collaborationId,runId));});
app.post("/api/collaborations/:collaborationId/relay-to-primary",async(request)=>{const {collaborationId}=collaborationParams.parse(request.params),detail=await collaboration.detail(collaborationId),primary=(detail.participants as any[]).find(item=>item.id===detail.session.primaryParticipantId),providerId=primary?.provider as ProviderId;const body=z.object({confirm:z.literal(true)}).parse(request.body);await requirePaidCreditConsent(request,[providerId]);collaboration.approveCreditOnce(collaborationId,[...confirmedPaidCreditProviders(request)]);return idempotent(request,`collaboration-relay-primary:${collaborationId}`,body,()=>collaboration.relayToPrimary(collaborationId));});
app.get("/api/collaborations/:collaborationId/avatar",async(request)=>{const {collaborationId}=collaborationParams.parse(request.params);await collaboration.detail(collaborationId);return{states:await db.listCollaborationAvatarStates(collaborationId)};});
app.get("/api/collaborations/:collaborationId/participants/:participantId/session",async(request)=>{const params=z.object({collaborationId:z.string().uuid(),participantId:z.string().uuid()}).parse(request.params),detail=await collaboration.detail(params.collaborationId),participant=(detail.participants as any[]).find(item=>item.id===params.participantId);if(!participant)throw Object.assign(new Error("Participant not found."),{statusCode:404});const task=(detail.runs as any[]).filter(item=>item.participantId===participant.id&&item.providerTaskId).at(-1);return{participantId:participant.id,provider:participant.provider,providerSessionId:participant.providerSessionId,providerTaskId:task?.providerTaskId??participant.sourceTaskId,executionHostId:participant.executionHostId,workspaceId:participant.workspaceId};});
app.get("/api/collaborations/:collaborationId/relays/:artifactId",async(request)=>{const params=z.object({collaborationId:z.string().uuid(),artifactId:z.string().uuid()}).parse(request.params);return relayArtifacts.read(params.artifactId,params.collaborationId);});
app.post("/api/tasks/:provider/:taskId/assist",{config:{rateLimit:{max:6,timeWindow:"1 minute"}}},async(request)=>{const item=await taskFromParams(request.params);const body=z.object({targetProvider:providerParam,executionHostId:z.string().min(1).max(100),workspaceId:z.string().min(1).max(100),title:z.string().trim().min(1).max(100),prompt:z.string().trim().min(1).max(config.promptMaxLength),sourceContent:z.string().trim().min(1).max(config.promptMaxLength).optional(),timeoutMs:z.number().int().min(30_000).max(2*60*60_000).optional(),model:z.string().trim().min(1).max(120).nullable().optional(),reasoningEffort:z.string().trim().min(1).max(30).nullable().optional(),serviceTier:z.enum(["priority"]).nullable().optional()}).parse(request.body);await requirePaidCreditConsent(request,[body.targetProvider]);await requireGlobalModel(body.targetProvider,body.model);return idempotent(request,`collaboration-assist:${item.task.id}`,body,()=>collaboration.createAssist({sourceTask:item.task,...body,creditApprovedProviders:[...confirmedPaidCreditProviders(request)]}));});
let collaborationStreams=0;
app.get("/api/collaborations/:collaborationId/events",{config:{rateLimit:{max:20,timeWindow:"1 minute"}}},async(request,reply)=>{
  const {collaborationId}=collaborationParams.parse(request.params);await collaboration.detail(collaborationId);
  const allowedOrigins=new Set([config.externalOrigin,...(config.authMode==="test"?["http://127.0.0.1:3410"]:[])]);if(typeof request.headers.origin==="string"&&!allowedOrigins.has(request.headers.origin))throw Object.assign(new Error("Origin is not allowed for event streams."),{statusCode:403});if(collaborationStreams>=MAX_COLLABORATION_STREAMS)throw Object.assign(new Error("Too many collaboration streams."),{statusCode:429});
  const after=sseResumeSequence(request.headers["last-event-id"],(request.query as any)?.after);
  collaborationStreams++;reply.hijack();const response=reply.raw;response.writeHead(200,{"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-store, no-cache, must-revalidate","Connection":"keep-alive","X-Accel-Buffering":"no","Content-Encoding":"identity"});response.write("retry: 3000\n\n");let closed=false;
  let deliveredSequence=after;const send=(event:any)=>{const sequence=Number(event?.sequence)||0;if(sequence&&sequence<=deliveredSequence)return;if(sequence)deliveredSequence=sequence;if(!closed&&!response.destroyed)response.write(`id: ${event.eventId}\nevent: collaboration-event\ndata: ${JSON.stringify(sanitizeSensitiveValue(event,{preserveSourceIdentifiers:true}))}\n\n`);};
  const replay=collaborationEvents.replay(collaborationId,after);if(replay.replayMissed)response.write(`event: resync\ndata: ${JSON.stringify({reason:"replay-window-exceeded",latestSequence:replay.latestSequence})}\n\n`);else for(const event of replay.events)send(event);
  const unsubscribe=collaborationEvents.subscribe(collaborationId,send),heartbeat=setInterval(()=>{if(!closed&&!response.destroyed)response.write(`: heartbeat ${Date.now()}\n\n`);},15000);heartbeat.unref?.();const close=()=>{if(closed)return;closed=true;unsubscribe();clearInterval(heartbeat);collaborationStreams=Math.max(0,collaborationStreams-1);};request.raw.once("close",close);response.once("close",close);response.once("error",close);
});

app.get("/api/projects", async () => ({ projects: (await db.listProjects()).map((item) => ({ ...item, enabled:!item.archivedAt, error:null })) }));
app.get("/api/projects/:projectId/workspace-pipeline",async(request)=>{const {projectId}=z.object({projectId:z.string().regex(/^[a-z0-9-]+$/)}).parse(request.params),project=(await db.listProjects()).find(item=>item.id===projectId);if(!project)throw Object.assign(new Error("Project not found."),{statusCode:404});const workspaces=await db.listWorkspaces({projectId}),setting=await db.getSystemSetting(`project.workspace-pipeline.${projectId}`),stored=setting?.value?.workspaceIds,available=new Set(workspaces.map(item=>item.id)),workspaceIds=Array.isArray(stored)?stored.filter((item:unknown):item is string=>typeof item==="string"&&available.has(item)):workspaces.map(item=>item.id);return{projectId,workspaceIds,workspaces};});
app.get("/api/location-options",async(request)=>{
  const {hostId}=z.object({hostId:z.string().min(1).max(100).optional()}).parse(request.query);
  const [logicalProjects,workspaces]=await Promise.all([db.listProjects(),db.listWorkspaces(hostId?{hostId}:{})]);
  const projects=logicalProjects.filter(item=>!item.archivedAt).map(item=>({...item,enabled:true,error:null,workspaceCount:workspaces.filter(workspace=>workspace.projectId===item.id).length}));
  return{hostId:hostId??null,projects,workspaces};
});
app.post("/api/projects",{config:{rateLimit:{max:10,timeWindow:"10 minutes"}}},async(request)=>{const body=z.object({name:z.string().trim().min(1).max(100),slug:z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),description:z.string().trim().max(1000).nullable().optional(),defaultProvider:providerParam.nullable().optional()}).parse(request.body);assertWorkspaceManagementAllowed(body.slug);return idempotent(request,"project-create",body,async()=>{const timestamp=new Date().toISOString();return{project:await db.upsertProject({id:body.slug,name:body.name,slug:body.slug,description:body.description??null,defaultProvider:body.defaultProvider??null,createdAt:timestamp,updatedAt:timestamp,archivedAt:null})};});});
app.patch("/api/projects/:projectId",async(request)=>{const {projectId}=z.object({projectId:z.string().regex(/^[a-z0-9-]+$/)}).parse(request.params),body=z.object({name:z.string().trim().min(1).max(100),description:z.string().trim().max(1000).nullable().optional(),workspaceIds:z.array(z.string().min(1).max(100)).max(100).refine(items=>new Set(items).size===items.length,"Workspace pipeline contains duplicates.").optional()}).parse(request.body);assertWorkspaceManagementAllowed(projectId);return idempotent(request,`project-update:${projectId}`,body,async()=>{const current=(await db.listProjects()).find(item=>item.id===projectId);if(!current)throw Object.assign(new Error("Project not found."),{statusCode:404});if(current.archivedAt)throw Object.assign(new Error("Archived project cannot be edited."),{statusCode:409});if(body.workspaceIds){const available=new Set((await db.listWorkspaces({projectId})).map(item=>item.id));if(body.workspaceIds.some(id=>!available.has(id)))throw Object.assign(new Error("Workspace pipeline contains an unavailable or unrelated workspace."),{statusCode:409});}const timestamp=new Date().toISOString(),project=await db.upsertProject({...current,name:body.name,description:body.description??null,updatedAt:timestamp});if(body.workspaceIds)await db.putSystemSetting(`project.workspace-pipeline.${projectId}`,{workspaceIds:body.workspaceIds,version:1},timestamp);await db.appendAudit({createdAt:timestamp,actor:(request as any).actor,action:"project-update",provider:null,taskId:null,projectId,hostId:null,workspaceId:null,outcome:"success",detail:`name and description updated;workspacePipeline=${body.workspaceIds?.length??"unchanged"}`});return{project,workspaceIds:body.workspaceIds};});});
app.post("/api/projects/:projectId/archive",async(request)=>{const {projectId}=z.object({projectId:z.string().regex(/^[a-z0-9-]+$/)}).parse(request.params),body=z.object({confirm:z.literal(true),filesRemain:z.literal(true)}).parse(request.body);assertWorkspaceManagementAllowed(projectId);return idempotent(request,`project-archive:${projectId}`,body,async()=>{const current=(await db.listProjects()).find(item=>item.id===projectId);if(!current)throw Object.assign(new Error("Project not found."),{statusCode:404});const workspaces=await db.listWorkspaces({projectId}),workspaceIds=new Set(workspaces.map(item=>item.id)),active=(await db.listTasks()).some(task=>(task.projectId===projectId||Boolean(task.workspaceId&&workspaceIds.has(task.workspaceId)))&&["pending","queued","running","waiting","unknown"].includes(task.status));if(active)throw Object.assign(new Error("Project has an active or unconfirmed task."),{statusCode:409});const timestamp=new Date().toISOString();for(const workspace of workspaces)await db.archiveWorkspace(workspace.id,timestamp);const project=await db.upsertProject({...current,updatedAt:timestamp,archivedAt:timestamp});await db.putSystemSetting(`project.workspace-pipeline.${projectId}`,{workspaceIds:[],version:1},timestamp);await db.appendAudit({createdAt:timestamp,actor:(request as any).actor,action:"project-archive",provider:null,taskId:null,projectId,hostId:null,workspaceId:null,outcome:"success",detail:`workspacesArchived=${workspaces.length};filesDeleted=false`});return{project,workspacesArchived:workspaces.length,filesDeleted:false};});});
app.get("/api/tasks", async (request) => {
  const query = taskListQuery.parse(request.query);
  if(query.snapshot){
    if(query.revision===taskListSnapshotRevision)return{tasks:[],partial:false,warnings:[],snapshot:true,unchanged:true,revision:taskListSnapshotRevision};
    if(query.revision!==undefined&&query.revision>taskListSnapshotJournalFloor&&query.revision<taskListSnapshotRevision){
      const sinceRevision=query.revision;
      const mutations=taskListSnapshotJournal
        .filter(entry=>entry.revision>sinceRevision&&(!query.provider||(entry.mutation.kind==="upsert"?entry.mutation.task.provider:entry.mutation.provider)===query.provider))
        .map(entry=>entry.mutation.kind==="upsert"?{kind:"upsert",task:projectTasksWithLiveGitAttribution([entry.mutation.task])[0]}:entry.mutation);
      return{tasks:[],mutations,delta:true,partial:false,warnings:[],snapshot:true,unchanged:mutations.length===0,revision:taskListSnapshotRevision};
    }
    const tasks=taskListSnapshot
      .filter(task=>!query.provider||task.provider===query.provider)
      .sort((left,right)=>right.updatedAt.localeCompare(left.updatedAt));
    return{tasks:projectTasksWithLiveGitAttribution(tasks),partial:false,warnings:[],snapshot:true,unchanged:false,revision:taskListSnapshotRevision};
  }
  if(taskListSynchronization){
    const tasks=taskListSnapshot.filter(task=>!query.provider||task.provider===query.provider).sort((left,right)=>right.updatedAt.localeCompare(left.updatedAt));
    return{tasks:projectTasksWithLiveGitAttribution(tasks),partial:true,warnings:[{source:"synchronization",error:"refresh_in_progress"}],snapshot:true,refreshing:true,unchanged:false,revision:taskListSnapshotRevision};
  }
  const synchronizationRevision=taskListSnapshotRevision;
  const synchronization=(async()=>{
  const scope = query.scope === "all" ? "all" as const : undefined;
  // Claude's list must not wait for Codex's cx/database reconciliation. The
  // UI uses this provider filter on the Claude tab while the All tab keeps the
  // original combined response.
  const selectedProviders = query.provider ? [provider(query.provider)] : [...providers.values()];
  const providerResults=await Promise.allSettled(selectedProviders.map(item=>limited(item.listTasks(scope),8000,`${item.id} task synchronization`)));
  const external=providerResults.flatMap(result=>result.status==="fulfilled"?result.value:[]);
  // The provider snapshots above already cover every stored row for their
  // provider, so the full (and expensive) stored-task scan is only worth
  // paying when a provider failed to answer and needs a database fallback.
  const storedResult=providerResults.some(result=>result.status==="rejected")
    ? await db.listTasks().then(value=>({ok:true as const,value}),error=>({ok:false as const,error}))
    : {ok:true as const,value:[] as DeckTask[]};
  const warnings:Array<{source:string;error:string}>=providerResults.flatMap((result,index)=>result.status==="rejected"?[{source:selectedProviders[index].id,error:"synchronization_unavailable"}]:[]);
  // The managed local Worker is a Worker for every purpose except its host
  // type, which is `local`. Filtering on `type === "worker"` alone excluded it
  // from session synchronization entirely, so on Windows — where that Worker is
  // the only execution path — no provider session was ever discovered.
  const onlineWorkers=storedResult.ok?(await db.listHosts().catch(()=>[])).filter(item=>(item.type==="worker"||(managedLocalWorkerRequired&&item.id===LOCAL_HOST_ID))&&item.status==="online"&&workerHub.isOnline(item.id)):[];
  // Remote-session dedupe needs the previous rows; the provider snapshots are
  // now the primary source of those, with the stored fallback layered on top.
  const storedById=new Map([...external,...(storedResult.ok?storedResult.value:[])].map(task=>[task.id,task]));
  await Promise.all(onlineWorkers.map(async(host)=>{try{const remote=await workerHub.request(host.id,"provider.sessions.list",{},undefined,5000) as any;for(const session of remote?.sessions??[]){
    // The Worker reports which providers genuinely own a discoverable session
    // store. Trusting that instead of a hardcoded pair keeps the server from
    // ingesting sessions a provider cannot actually have.
    if(remote?.discovery?.[session.provider]?.externalSessionDiscovery!==true||session.ownership==="claudex-workhouse"||(query.provider&&session.provider!==query.provider)||typeof session.workspaceId!=="string")continue;
    const workspace=await db.getWorkspace(session.workspaceId);if(!workspace||workspace.hostId!==host.id)continue;
    const timestamp=typeof session.updatedAt==="string"?session.updatedAt:new Date().toISOString(),providerId=session.provider as ProviderId,nativeId=String(session.threadId??session.id??crypto.randomUUID()),id=`${providerId}:external:${host.id}:${crypto.createHash("sha256").update(nativeId).digest("hex").slice(0,32)}`,threadId=typeof session.threadId==="string"?session.threadId:null,status=["pending","queued","running","waiting","completed","failed","stopped"].includes(session.status)?session.status:"unknown",title=String(session.title??`${providerId} session`).slice(0,100),source=session.source??"unknown",previous=storedById.get(id);
    if(previous&&previous.threadId===threadId&&previous.status===status&&previous.updatedAt===timestamp&&previous.title===title&&previous.source===source&&previous.workspaceId===workspace.id)continue;
    const next=await db.upsertTask({id,provider:providerId,nativeId,threadId,projectId:workspace.projectId,title,prompt:"",status,createdAt:previous?.createdAt??timestamp,updatedAt:timestamp,result:null,error:null,log:"",owned:false,pid:null,pgid:null,processStart:null,commandMarker:null,parentThreadId:null,ownership:"external",source,cwd:null,lastSeenAt:timestamp,executionHostId:host.id,workspaceId:workspace.id,remoteWorkerId:host.id,hostTaskId:null,providerSessionId:threadId,metadata:{canStop:false,discoveredOnHost:host.id}});storedById.set(id,next);
  }}catch{/* a slow/offline Worker must not block local session listing */}}));
  const stored=(storedResult.ok?storedResult.value:taskListSnapshot).filter((task) => !query.provider || task.provider === query.provider);
  if(!storedResult.ok&&!stored.length&&!external.length)throw storedResult.error;
  const merged = new Map(stored.map((task) => [task.id, task]));
  const previousTasks=new Map(taskListSnapshot.map(task=>[task.id,task]));
  for (const task of external) {
    const previous=previousTasks.get(task.id);
    if(shouldSettleTaskLease(previous,task))await settleTaskLeases(task).catch(()=>warnings.push({source:"database",error:"lease_reconciliation_deferred"}));
    merged.set(task.id, task);
  }
  const tasks=hideOwnedProviderSessionMirrors([...merged.values()],[...taskListSnapshot,...merged.values()]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if(storedResult.ok)publishTaskSnapshots(tasks,query.provider,synchronizationRevision);
  return { tasks:projectTasksWithLiveGitAttribution(tasks), partial:!storedResult.ok||warnings.length>0, warnings,revision:taskListSnapshotRevision };
  })();
  taskListSynchronization=synchronization;
  try{return await synchronization;}finally{if(taskListSynchronization===synchronization)taskListSynchronization=null;}
});
async function createTaskFromBody(body:CreateTaskBody,requestedNativeId?:string,extension?:unknown,boardContext?:{workChainId:string;boardRole:"implementer"|"revision"}){
    body={...body,reasoningEffort:body.reasoningEffort==="default"?null:body.reasoningEffort};
    await requireGlobalModel(body.provider,body.model);
    const level=automationLevelForNewTask(body.provider,body.automationLevel,body.permissionProfile);assertAutomationSupported(body.provider,level);const ambiguousWindowsProfile=body.provider==="codex"&&body.automationLevel===undefined&&body.permissionProfile===":workspace"&&level==="confirm";const defaultedAutomation=body.automationLevel===undefined&&!body.permissionProfile&&level!==automationLevel(undefined,undefined);const permissionProfile=body.automationLevel||defaultedAutomation||ambiguousWindowsProfile?permissionForAutomation(body.provider,level):body.permissionProfile;
    const selection=await selectedWorkspace(body.projectId,body.executionHostId,body.workspaceId);
    const instructionProfile=await workspaceInstructionProfile(selection.workspace.id),workspaceInstructionSnapshot=await workspaceInstructionSnapshotFor(selection.workspace,instructionProfile);
    let character=await isolatedCharacterPrompt(body.provider,false),taskRuntimeProfile:"default"|"browser"="default";
    let characterDirective=character.directive,characterSnapshot:Record<string,unknown>=character.snapshot,taskMetadataExtension:Record<string,unknown>={};
    const providerPrompt=promptWithWorkspaceInstructions(body.prompt,workspaceInstructionSnapshot,{characterDirective}),taskTitle=workspaceInstructionTaskTitle(body.prompt,body.title);
    if((body.provider==="deepseek"||body.provider==="ollama"||body.provider==="antigravity")&&(selection.hostId!==LOCAL_HOST_ID||executionHostUsesWorker(selection.hostId)))throw Object.assign(new Error(`${body.provider} currently runs on the local Workhouse server only.`),{statusCode:409,code:"REMOTE_PROVIDER_UNAVAILABLE"});
    const targetProjectId=selection.workspace.projectId;
    const requestedTaskId=requestedNativeId?(selection.hostId===LOCAL_HOST_ID?(managedLocalWorkerRequired?`${body.provider}:worker:${requestedNativeId}`:(body.provider==="codex"?`codex:deck:${requestedNativeId}`:`${body.provider}:${requestedNativeId}`)):`${body.provider}:remote:${requestedNativeId}`):null;
    if(requestedTaskId){const existing=await db.getTask(requestedTaskId);if(existing)return existing;}
    let item:DeckTask;
    if(!executionHostUsesWorker(selection.hostId)){
      const stat=fs.statSync(selection.workspace.canonicalPath);if(!stat.isDirectory())throw Object.assign(new Error("Workspace is not a directory."),{code:"ENOTDIR"});fs.accessSync(selection.workspace.canonicalPath,fs.constants.R_OK|fs.constants.X_OK);
      const configured=config.projects.find(item=>item.id===targetProjectId),project={id:targetProjectId,name:configured?.name??selection.workspace.displayName,path:selection.workspace.canonicalPath,realPath:selection.workspace.canonicalPath,enabled:true,error:null};
      const created=await provider(body.provider).createTask({ project, prompt: providerPrompt, title:taskTitle,executionHostId:selection.hostId,workspaceId:selection.workspace.id,requestedNativeId,workMode:body.workMode,runtimeProfile:taskRuntimeProfile,automationLevel:level,googleSearchMode:body.provider==="antigravity"?body.googleSearchMode??"off":undefined,...boardContext, ...(body.provider === "codex" ? { model:body.model,reasoningEffort:body.reasoningEffort,serviceTier:body.serviceTier,permissionProfile } : { permissionProfile, model:body.model, reasoningEffort:body.reasoningEffort }) });
      item=await db.upsertTask({...created,prompt:body.prompt,executionHostId:LOCAL_HOST_ID,workspaceId:selection.workspace.id,providerSessionId:created.threadId,metadata:{...withoutLegacyWorkspaceApprovalMetadata(created.metadata),characterSnapshot,workspaceInstructionSnapshot,...taskMetadataExtension}});
    }else{
      const host=await db.getHost(selection.hostId);if(!host||host.disabledAt||host.revokedAt)throw Object.assign(new Error("Execution host is unavailable."),{statusCode:503});
      if(selection.hostId===LOCAL_HOST_ID)await refreshManagedLocalWorkerConfig();
      const id=requestedTaskId??`${body.provider}:${selection.hostId===LOCAL_HOST_ID?"worker":"remote"}:${crypto.randomUUID()}`,createdAt=new Date().toISOString();
      const remote=await workerHub.request(selection.hostId,"provider.task.start",{taskId:id,provider:body.provider,workspaceId:selection.workspace.id,prompt:providerPrompt,title:taskTitle,model:body.model,reasoningEffort:body.reasoningEffort,serviceTier:body.serviceTier,permissionProfile,workMode:body.workMode,runtimeProfile:taskRuntimeProfile,automationLevel:level,...boardContext,...await claudeRemoteExecutionSettings(body.provider)}) as any;
      item=await db.upsertTask({id,provider:body.provider,nativeId:String(remote?.hostTaskId??id),threadId:remote?.threadId??null,projectId:targetProjectId,title:taskTitle,prompt:body.prompt,status:remote?.status??"running",createdAt,updatedAt:createdAt,result:null,error:null,log:"Remote worker task started.",owned:true,pid:null,pgid:null,processStart:null,commandMarker:null,parentThreadId:null,ownership:"claudex-workhouse",source:"claudex-workhouse",cwd:null,executionHostId:selection.hostId,workspaceId:selection.workspace.id,remoteWorkerId:selection.hostId,hostTaskId:String(remote?.hostTaskId??id),providerSessionId:remote?.threadId??null,requestedModel:body.model,requestedReasoningEffort:body.reasoningEffort,requestedServiceTier:body.serviceTier,permissionProfile,workChainId:boardContext?.workChainId??null,metadata:{...(boardContext?.boardRole?{boardRole:boardContext.boardRole}:{}),workMode:body.workMode??"default",automationLevel:level,characterSnapshot,workspaceInstructionSnapshot,...taskMetadataExtension,...(remote?.executionPolicy?{requestedAutomation:remote.executionPolicy.requestedAutomation,effectiveSandbox:remote.executionPolicy.effectiveSandbox,effectiveApprovalPolicy:remote.executionPolicy.effectiveApprovalPolicy,executionBackend:remote.executionPolicy.executionBackend,executionUiLabel:remote.executionPolicy.uiLabel}:{})}});await workerHub.taskRegistered(item.id);const confirmed=await workerHub.request(selection.hostId,"provider.task.status",{taskId:item.id}).catch(()=>null) as any;if(confirmed)item=await db.upsertTask({...item,status:confirmed.status??item.status,threadId:confirmed.threadId??item.threadId,providerSessionId:confirmed.threadId??item.providerSessionId,result:typeof confirmed.result==="string"?confirmed.result:item.result,error:typeof confirmed.error==="string"?confirmed.error:item.error,updatedAt:confirmed.updatedAt??item.updatedAt});
    }
    if(item.workspaceId)await db.upsertWorkspaceLease({id:crypto.randomUUID(),projectId:item.projectId,workspaceId:item.workspaceId,chainId:null,sessionId:item.threadId??item.id,hostId:item.executionHostId??LOCAL_HOST_ID,mode:item.permissionProfile===":read-only"?"read":"write",acquiredAt:item.createdAt,expiresAt:new Date(Date.now()+8*60*60_000).toISOString(),releasedAt:null});
    if((item.provider==="deepseek"||item.provider==="ollama")&&(item.providerSessionId??item.threadId))await claudeProvider.excludeExternalSession((item.providerSessionId??item.threadId)!);
    return publishTaskSnapshot(item);
}
const collaborationBoard=new CollaborationBoardService(db);
type BoardAutomationActionContext={approvedProviders:Set<ProviderId>;fullAccessAcknowledged:boolean};
const boardActions={
  "start-work":async(request:FastifyRequest|null,chainId:string,raw:Record<string,unknown>,context?:BoardAutomationActionContext)=>{
    const card=await db.getWorkChain(chainId);if(!card)throw Object.assign(new Error("Collaboration board card not found."),{statusCode:404});
    const role=(card.roles?.implementer??{}) as any,body=createBody.parse({...raw,provider:raw.provider??role.provider,model:raw.model??role.model,reasoningEffort:raw.reasoningEffort??role.reasoningEffort,serviceTier:raw.serviceTier??role.serviceTier,permissionProfile:raw.permissionProfile??role.permissionProfile,workMode:raw.workMode??role.workMode,automationLevel:raw.automationLevel??role.automationLevel,googleSearchMode:raw.googleSearchMode??role.googleSearchMode,projectId:card.projectId,workspaceId:raw.workspaceId??card.workspaceId,title:raw.title??card.title,prompt:raw.prompt??(card.description||card.title),...(context?.fullAccessAcknowledged?{dangerConfirmation:true,fullAccessAcknowledged:true,acknowledgementVersion:1}:{})});
    const approvals=request?confirmedPaidCreditProviders(request):context?.approvedProviders??new Set<ProviderId>();await assertPaidCreditConsent([body.provider],approvals);await requireGlobalModel(body.provider,body.model);const task=await createTaskFromBody(body,undefined,undefined,{workChainId:chainId,boardRole:"implementer"});return{task};
  },
  "start-revision":async(request:FastifyRequest|null,chainId:string,raw:Record<string,unknown>,context?:BoardAutomationActionContext)=>{
    const card=await db.getWorkChain(chainId);if(!card)throw Object.assign(new Error("Collaboration board card not found."),{statusCode:404});
    const role=(card.roles?.implementer??{}) as any,body=createBody.parse({...raw,provider:raw.provider??role.provider,model:raw.model??role.model,reasoningEffort:raw.reasoningEffort??role.reasoningEffort,serviceTier:raw.serviceTier??role.serviceTier,permissionProfile:raw.permissionProfile??role.permissionProfile,workMode:raw.workMode??role.workMode,automationLevel:raw.automationLevel??role.automationLevel,googleSearchMode:raw.googleSearchMode??role.googleSearchMode,projectId:card.projectId,workspaceId:raw.workspaceId??card.workspaceId,title:raw.title??`${card.title} · Revision`,prompt:raw.prompt??`Continue revising ${card.title}. ${card.description}`.trim(),...(context?.fullAccessAcknowledged?{dangerConfirmation:true,fullAccessAcknowledged:true,acknowledgementVersion:1}:{})});
    const approvals=request?confirmedPaidCreditProviders(request):context?.approvedProviders??new Set<ProviderId>();await assertPaidCreditConsent([body.provider],approvals);await requireGlobalModel(body.provider,body.model);const task=await createTaskFromBody(body,undefined,undefined,{workChainId:chainId,boardRole:"revision"});return{task};
  },
  "resume":async(_request:FastifyRequest|null,chainId:string,raw:Record<string,unknown>)=>{
    const linked=await db.listTasksByWorkChainIds([chainId]),selected=selectBoardResumeTask(linked),taskId=z.string().min(1).max(200).parse(raw.taskId??selected?.id),prompt=z.string().trim().min(1).max(config.promptMaxLength).parse(raw.prompt??"Continue this work from the latest persisted state."),task=await db.getTask(taskId);if(!task||task.workChainId!==chainId||!isBoardWorkTask(task))throw Object.assign(new Error("No implementer or revision session is linked to this collaboration board card."),{statusCode:409,code:"BOARD_RESUME_NO_WORK_SESSION"});
    const source=await applyPendingTaskLocation(task);
    const next=await withThreadTurn(source.provider,source.threadId,async()=>{
      let resumed=boardResumeUsesWorkerHost(source,executionHostUsesWorker)?await remoteTaskCommand(source,"provider.session.resume",{prompt,model:source.requestedModel,reasoningEffort:source.requestedReasoningEffort,serviceTier:source.requestedServiceTier,permissionProfile:source.permissionProfile,workMode:source.metadata?.workMode??"default",automationLevel:automationLevel(source.metadata?.automationLevel,source.permissionProfile)}):await provider(source.provider).sendMessage(source,workspacePromptForTask(source,prompt));
      return publishTaskSnapshot(await db.upsertTask({...resumed,...(resumed.id!==source.id?{prompt}:{}),metadata:{...withoutLegacyWorkspaceApprovalMetadata(source.metadata),...withoutLegacyWorkspaceApprovalMetadata(resumed.metadata)}}));
    });
    return{task:next};
  },
  "request-review":async(request:FastifyRequest|null,chainId:string,raw:Record<string,unknown>,context?:BoardAutomationActionContext)=>{
    const card=await db.getWorkChain(chainId);if(!card)throw Object.assign(new Error("Collaboration board card not found."),{statusCode:404});const workspace=card.workspaceId?await db.getWorkspace(card.workspaceId):null;if(!workspace)throw Object.assign(new Error("Collaboration board card has no available workspace."),{statusCode:409,code:"BOARD_WORKSPACE_UNAVAILABLE"});
    const implementer=(card.roles?.implementer??{}) as any,reviewer=(card.roles?.reviewer??{}) as any,secondary=(card.roles?.secondaryReviewer??{}) as any;if(!implementer.provider||!reviewer.provider||implementer.provider===reviewer.provider)throw Object.assign(new Error("Distinct implementer and reviewer providers are required."),{statusCode:409,code:"BOARD_REVIEW_ROLES_REQUIRED"});const participant=(role:any,participantRole:"primary"|"reviewer")=>({provider:role.provider,role:participantRole,executionHostId:workspace.hostId,workspaceId:workspace.id,permissionMode:"read" as const,automationLevel:"read" as const,model:role.model??null,reasoningEffort:role.reasoningEffort??null,serviceTier:role.provider==="codex"?role.serviceTier??null:null});const participants=[participant(implementer,"primary"),participant(reviewer,"reviewer"),...(secondary.provider&&!new Set([implementer.provider,reviewer.provider]).has(secondary.provider)?[participant(secondary,"reviewer")]:[])],approvals=request?confirmedPaidCreditProviders(request):context?.approvedProviders??new Set<ProviderId>();await assertPaidCreditConsent(participants.map(item=>item.provider),approvals);await requireGlobalModels(participants);const collaborationResult=await collaboration.create({projectId:card.projectId,title:String(raw.title??`${card.title} · Review`),mode:"review",prompt:z.string().trim().min(1).max(config.promptMaxLength).parse(raw.prompt??`Review the implementation and persisted results for ${card.title}. ${card.description}`.trim()),primaryProvider:implementer.provider,workChainId:chainId,participants,reviewDepth:raw.reviewDepth==="deep"?"deep":"basic",reviewFinalization:"side-by-side",creditApprovedProviders:[...approvals]});return{collaboration:collaborationResult};
  }
};
const boardAutomation=new CollaborationBoardAutomationEngine(collaborationBoard,async(action,chainId,context)=>boardActions[action](null,chainId,{},context),session=>boardSessionIsLive(session,{usesWorker:executionHostUsesWorker,isHostOnline:hostId=>workerHub.isOnline(hostId)}));
registerCollaborationBoardRoutes(app,{service:collaborationBoard,idempotent,actions:boardActions,automation:{
  start:async(request,id,body)=>{const card=await collaborationBoard.verifyRevision(id,body.revision),providers=[card.roles.implementer?.provider,card.roles.reviewer?.provider,card.roles.secondaryReviewer?.provider].filter((item):item is ProviderId=>Boolean(item)),approved=confirmedPaidCreditProviders(request);await assertPaidCreditConsent(providers,approved);return boardAutomation.start(id,body.revision,{stopAfter:body.stopAfter,approvedProviders:approved,fullAccessAcknowledged:body.fullAccessAcknowledged&&body.acknowledgementVersion===1});},
  pause:(id,revision)=>boardAutomation.pause(id,revision),resume:(id,revision)=>boardAutomation.resume(id,revision),decide:(id,revision,decision)=>boardAutomation.decide(id,revision,decision)
}});
app.post("/api/tasks", { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (request) => {
  const body = createBody.parse(request.body);
  if(body.provider==="codex"||body.provider==="claude"||body.provider==="grok")await requirePaidCreditConsent(request,[body.provider]);
  return idempotent(request, "create", body, async () => {
    const item=await createTaskFromBody(body);
    await audit(request, "create", "success", item);
    return { task: item };
  });
});
app.post("/api/setup/test",{config:{rateLimit:{max:3,timeWindow:"10 minutes"}}},async(request)=>{
  const body=z.object({provider:authProviderParam,workspaceId:z.string().min(1).max(100)}).parse(request.body),workspace=await db.getWorkspace(body.workspaceId);
  if(!workspace||workspace.archivedAt)throw Object.assign(new Error("등록된 작업 폴더를 찾을 수 없습니다."),{statusCode:404,code:"SETUP_WORKSPACE_REQUIRED"});
  const accounts=await providerConnectionAccounts(),account=accounts.find(item=>item.provider===body.provider);
  if(account?.state!=="connected")throw Object.assign(new Error("Provider 로그인을 먼저 완료해 주세요."),{statusCode:409,code:"SETUP_PROVIDER_LOGIN_REQUIRED"});
  await requirePaidCreditConsent(request,[body.provider]);
  return idempotent(request,"setup-first-test",body,async()=>{
    const task=await createTaskFromBody({provider:body.provider,projectId:workspace.projectId,workspaceId:workspace.id,executionHostId:workspace.hostId,prompt:"이 폴더의 파일 목록과 README 파일이 있는지만 알려주세요. 파일을 수정하거나 명령을 실행하지 마세요.",title:"첫 연결 테스트",automationLevel:"read",workMode:"plan"});
    const updatedAt=new Date().toISOString();await db.putSystemSetting("setup.first-test",{taskId:task.id,provider:body.provider,workspaceId:workspace.id},updatedAt);await audit(request,"setup-first-test","success",task,"read-only onboarding test");return{task};
  });
});
app.get("/api/tasks/:provider/:taskId/snapshot",async(request)=>{
  const item=await taskFromParams(request.params);
  return{task:item.task,snapshot:true};
});
app.get("/api/tasks/:provider/:taskId/workspace-instructions",async(request)=>{
  const item=await taskFromParams(request.params),snapshot=workspaceInstructionSnapshotFromMetadata(item.task.metadata);
  if(!snapshot)return{enabled:false,snapshot:null,currentRevision:null,revisionChanged:false};
  const current=await workspaceInstructionProfile(snapshot.workspaceId);
  return{enabled:true,snapshot,currentRevision:current.revision,revisionChanged:current.revision!==snapshot.revision};
});
app.get("/api/tasks/:provider/:taskId", async (request) => {
  const item = await taskFromParams(request.params);
  if(item.task.executionHostId&&executionHostUsesWorker(item.task.executionHostId)){if(!workerHub.isOnline(item.task.executionHostId)){const task=publishTaskSnapshot({...item.task,status:["pending","queued","running","waiting"].includes(item.task.status)?"unknown":item.task.status,metadata:{...item.task.metadata,remoteState:"host-offline",lastKnownStatus:item.task.status}});return{task};}const task=await remoteTaskCommand(item.task,"provider.task.status");await settleTaskLeases(task);return{task:publishTaskSnapshot(task)};}
  const task=await item.provider.getTask(item.task);await settleTaskLeases(task);return { task:publishTaskSnapshot(task) };
});
app.patch("/api/sessions/:provider/:sessionId/title",async(request)=>{
  const params=z.object({provider:providerParam,sessionId:z.string().min(1).max(300)}).parse(request.params);
  const body=z.object({title:z.string().trim().min(1).max(100)}).parse(request.body);
  const result=await renameSessionTitle(db,params.provider,params.sessionId,body.title);
  const changed=new Map(result.tasks.map(task=>[task.id,task]));
  taskListSnapshot=taskListSnapshot.map(task=>changed.get(task.id)??task);
  for(const task of result.tasks)recordTaskListMutation({kind:"upsert",task});
  await audit(request,"session-title","success",result.anchor,`session=${params.sessionId};members=${result.tasks.length}`);
  return{title:result.title,tasks:result.tasks,thread:result.thread};
});
app.get("/api/tasks/:provider/:taskId/context",async(request)=>{
  const item=await taskFromParams(request.params);
  const task=item.task.executionHostId&&executionHostUsesWorker(item.task.executionHostId)
    ? (workerHub.isOnline(item.task.executionHostId)?await remoteTaskCommand(item.task,"provider.task.status"):item.task)
    : await item.provider.getTask(item.task);
  const active=["pending","queued","running","waiting"].includes(task.status);
  return{context:task.metadata?.contextUsage??null,capabilities:{providerNative:true,manualCompact:Boolean(task.owned&&task.threadId),busy:active},checkedAt:new Date().toISOString()};
});
app.post("/api/tasks/:provider/:taskId/compact",{config:{rateLimit:{max:4,timeWindow:"10 minutes"}}},async(request)=>{
  const item=await taskFromParams(request.params),body=z.object({confirm:z.literal(true)}).parse(request.body);
  await requirePaidCreditConsent(request,[item.task.provider]);
  if(!item.task.owned||item.task.ownership==="external")throw Object.assign(new Error("External sessions require an explicit control handoff before context compaction."),{statusCode:409,code:"CONTROL_HANDOFF_REQUIRED"});
  if(!item.task.threadId)throw Object.assign(new Error("Provider session ID is unavailable."),{statusCode:409});
  return idempotent(request,`context-compact:${item.task.id}`,body,async()=>{
    const current=item.task.executionHostId&&executionHostUsesWorker(item.task.executionHostId)?await remoteTaskCommand(item.task,"provider.task.status"):await item.provider.getTask(item.task);
    const active=["pending","queued","running","waiting"];
    if(active.includes(current.status))throw Object.assign(new Error("The context can be compacted once the response has finished."),{statusCode:409,code:"COMPACT_REQUIRES_IDLE"});
    const conflict=(await db.listActiveTasks()).find(task=>task.id!==current.id&&task.provider===current.provider&&task.threadId===current.threadId&&active.includes(task.status));
    if(conflict)throw Object.assign(new Error("Another task in the same session is still running."),{statusCode:409,code:"SESSION_TASK_STILL_RUNNING"});

    let next=current.executionHostId&&executionHostUsesWorker(current.executionHostId)
      ? await remoteTaskCommand(current,"provider.session.compact")
      : await item.provider.compactThread(current);
    next=await db.upsertTask({...next,executionHostId:current.executionHostId??LOCAL_HOST_ID,workspaceId:current.workspaceId??null,providerSessionId:next.threadId??current.threadId,metadata:{...workspaceInstructionCompactionMetadata(current.metadata,next.metadata),contextUsage:current.metadata?.contextUsage??null,operation:"context_compaction"}});
    publishTaskSnapshot(next);
    await audit(request,"context-compact","success",next,`thread=${current.threadId}`);
    return{task:next,context:next.metadata?.contextUsage??null};
  });
});
app.get("/api/approvals",async(request)=>{
  const query=z.object({taskId:z.string().min(3).max(200).optional()}).parse(request.query);
  const tasks=(query.taskId?[await db.getTask(query.taskId)].filter(Boolean):await db.listActiveTasks()) as DeckTask[];
  const approvals:any[]=[];
  for(const task of tasks.filter(item=>item.provider==="codex"&&item.owned&&["pending","queued","running","waiting","unknown"].includes(item.status))){
    try{
      if(task.executionHostId&&executionHostUsesWorker(task.executionHostId)){const result=await workerHub.request(task.executionHostId,"provider.approvals.list",{taskId:task.hostTaskId??task.id,provider:task.provider,workspaceId:task.workspaceId});for(const item of (result as any)?.approvals??[])approvals.push({...item,title:task.title});}
      else for(const item of codex.listApprovals(task))approvals.push({...item,title:task.title});
    }catch{/* An offline host leaves the task unknown, not falsely approved or denied. */}
  }
  return{approvals,capabilities:{codex:true,claude:false},checkedAt:new Date().toISOString()};
});
app.post("/api/tasks/:provider/:taskId/approvals/:approvalId",{config:{rateLimit:{max:20,timeWindow:"1 minute"}}},async(request)=>{
  const params=z.object({provider:providerParam,taskId:z.string().min(3).max(200),approvalId:z.string().uuid()}).parse(request.params);
  const body=z.object({decision:z.enum(["accept","acceptForSession","decline","cancel"]),confirmDetailView:z.literal(true)}).parse(request.body);
  if(params.provider!=="codex")throw Object.assign(new Error("This Claude runtime does not expose an interactive approval response channel."),{statusCode:409,code:"APPROVAL_UNSUPPORTED"});
  const task=await db.getTask(params.taskId);if(!task||task.provider!==params.provider)throw Object.assign(new Error("Task not found."),{statusCode:404});
  return idempotent(request,`approval:${task.id}:${params.approvalId}`,body,async()=>{
    const pending=await resolveTaskApproval({task,approvalId:params.approvalId,decision:body.decision as ApprovalDecision,localHostId:LOCAL_HOST_ID,workerBacked:Boolean(task.executionHostId&&executionHostUsesWorker(task.executionHostId)),listLocal:item=>codex.listApprovals(item),respondLocal:(item,approvalId,decision)=>codex.respondApproval(item,approvalId,decision),requestRemote:(hostId,command,payload)=>workerHub.request(hostId,command,payload)});
    await audit(request,"approval-resolve","success",task,`approval=${params.approvalId};decision=${body.decision};risk=${pending.risk}`);
    return{resolved:true,approvalId:params.approvalId,decision:body.decision};
  });
});
app.get("/api/user-input",async(request)=>{
  const query=z.object({taskId:z.string().min(3).max(200).optional()}).parse(request.query);
  const tasks=(query.taskId?[await db.getTask(query.taskId)].filter(Boolean):await db.listActiveTasks()) as DeckTask[];const requests:any[]=[];
  for(const task of tasks.filter(item=>item.provider==="codex"&&item.owned&&["pending","queued","running","waiting","unknown"].includes(item.status))){
    try{if(task.executionHostId&&executionHostUsesWorker(task.executionHostId)){const result=await workerHub.request(task.executionHostId,"provider.userInput.list",{taskId:task.hostTaskId??task.id,provider:task.provider,workspaceId:task.workspaceId});for(const item of (result as any)?.requests??[])requests.push({...item,title:task.title});}else for(const item of codex.listUserInputs(task))requests.push({...item,title:task.title});}catch{}
  }
  return{requests,capabilities:{codex:true,claude:false},checkedAt:new Date().toISOString()};
});
app.post("/api/tasks/:provider/:taskId/user-input/:requestId",{config:{rateLimit:{max:20,timeWindow:"1 minute"}}},async(request)=>{
  const params=z.object({provider:providerParam,taskId:z.string().min(3).max(200),requestId:z.string().uuid()}).parse(request.params);
  const body=z.object({answers:z.record(z.string().min(1).max(80),z.object({answers:z.array(z.string().min(1).max(1000)).min(1).max(12)}))}).parse(request.body);
  if(params.provider!=="codex")throw Object.assign(new Error("This provider does not expose a structured user-input response channel."),{statusCode:409,code:"USER_INPUT_UNSUPPORTED"});
  const task=await db.getTask(params.taskId);if(!task||task.provider!==params.provider)throw Object.assign(new Error("Task not found."),{statusCode:404});
  return idempotent(request,`user-input:${task.id}:${params.requestId}`,{requestId:params.requestId,answers:body.answers},async()=>{
    const remote=Boolean(task.executionHostId&&executionHostUsesWorker(task.executionHostId));const listed=remote?await workerHub.request(task.executionHostId!,"provider.userInput.list",{taskId:task.hostTaskId??task.id,provider:task.provider,workspaceId:task.workspaceId}):{requests:codex.listUserInputs(task)};
    const pending=(listed as any)?.requests?.find((item:any)=>item?.id===params.requestId);if(!pending)throw Object.assign(new Error("User input request is no longer pending."),{statusCode:409});if(pending.taskId!==task.id&&pending.taskId!==(task.hostTaskId??task.id))throw Object.assign(new Error("User input request does not belong to this task."),{statusCode:409});
    if(remote)await workerHub.request(task.executionHostId!,"provider.userInput.respond",{taskId:task.hostTaskId??task.id,provider:task.provider,workspaceId:task.workspaceId,requestId:params.requestId,answers:body.answers});else codex.respondUserInput(task,params.requestId,body.answers);
    await audit(request,"user-input-resolve","success",task,`request=${params.requestId};questions=${Object.keys(body.answers).length}`).catch(()=>{});return{resolved:true,requestId:params.requestId};
  });
});
app.post("/api/tasks/:provider/:taskId/resync",async(request)=>{const item=await taskFromParams(request.params);const body=z.object({confirm:z.literal(true)}).parse(request.body);return idempotent(request,`task-resync:${item.task.id}`,body,async()=>{const task=item.task.executionHostId&&executionHostUsesWorker(item.task.executionHostId)?await remoteTaskCommand(item.task,"provider.task.status"):await item.provider.getTask(item.task);await settleTaskLeases(task);await audit(request,"resync","success",task);return{task};});});
app.get("/api/tasks/:provider/:taskId/events", async (request) => {
  const eventQuery=z.object({transcriptTurns:z.coerce.number().int().min(12).max(24).optional()}).parse(request.query);
  const item = await taskFromParams(request.params);
  const task = item.task.executionHostId&&executionHostUsesWorker(item.task.executionHostId)?item.task:await item.provider.getTask(item.task);
  const stream=task.owned?readStreamEvents(config.dataRoot,task.id,0,STREAM_REPLAY_LIMIT):null;
  let durableImageOutputs=mergePersistedImageOutputs(task.metadata?.imageOutputs);
  if(task.provider==="codex"&&task.threadId){
    const[storedThread,linkedTasks]=await Promise.all([db.getCodexThread(task.threadId).catch(()=>null),db.listProviderTaskLinksByThreads("codex",[task.threadId]).catch(()=>[])]);
    durableImageOutputs=mergePersistedImageOutputs(durableImageOutputs,storedThread?.metadata?.imageOutputs,...linkedTasks.map((linked:any)=>linked.metadata?.imageOutputs));
  }
  const durableImageEvents=persistedImageOutputEvents(durableImageOutputs);
  const currentTaskImageEvents=persistedImageOutputEvents(durableImageOutputs,task.id);
  const replayEvents=mergeHistoricalFileChanges(durableImageEvents,stream?.events??[]);
  const providerStreamEvents=task.provider==="antigravity"?normalizeAntigravityOutputEvents(stream?.events??[]):stream?.events??[];
  const streamResult=()=>({taskId:task.id,status:task.status,events:mergeHistoricalFileChanges(providerStreamEvents,currentTaskImageEvents),source:"stream",latestSequence:stream?.latestSequence??0});
  if(task.provider==="codex"&&task.threadId&&!Boolean(task.executionHostId&&executionHostUsesWorker(task.executionHostId))){
    const isActive=["pending","queued","running","waiting"].includes(task.status);
    // The worker spool is the freshest source while a turn is active. Reading
    // app-server history first could return a snapshot from just before the
    // final agent message, then the UI would close its stream on completion and
    // keep that stale snapshot until a full page reload.
    if(isActive&&stream?.events.length)return streamResult();
    try{const transcript=withTaskRequestIdentity(codexTurnEvents((await codex.listTurns(task.threadId,null,20)).turns,task.cwd,{root:config.dataRoot,taskId:task.id,threadId:task.threadId}),replayEvents,task);if(transcript.length){const events=mergeHistoricalFileChanges(transcript,replayEvents);return{taskId:task.id,status:task.status,events,source:events===transcript?"app-server":"app-server+stream",latestSequence:stream?.latestSequence??0};}}catch{}
    if(stream?.events.length)return streamResult();
  }
  if(task.provider==="claude"){
    const isActive=["pending","queued","running","waiting"].includes(task.status);
    const base=config.projects.find((item)=>item.id===task.projectId)?.realPath ?? task.cwd ?? null;
    if(task.threadId&&task.owned&&isActive){
      const transcriptResult=base?claudeTranscriptEvents(resolveTranscriptFile(base,task.threadId),base,{turns:eventQuery.transcriptTurns}):null;
      const transcript=transcriptResult?.events.map((event)=>normalizeAgentEvent(event,"claude"))??[];
      const events=mergeActiveClaudeThreadEvents(transcript,stream?.events??[],task);
      return{taskId:task.id,status:task.status,events,source:transcript.length?"transcript+stream":"task+stream",latestSequence:stream?.latestSequence??0,...(transcriptResult?.truncated?{truncated:transcriptResult.truncated}:{})};
    }
    // Terminal/external sessions use the whole local transcript (same data
    // VSCode/CLI show) and need no per-turn fan-out from the browser.
    if(task.threadId&&base){
        const transcriptResult=claudeTranscriptEvents(resolveTranscriptFile(base,task.threadId),base,{turns:eventQuery.transcriptTurns});
        const transcript=withTaskRequestIdentity(transcriptResult.events.map((event)=>normalizeAgentEvent(event,"claude")),stream?.events??[],task);
        if(transcript.length){const events=mergeHistoricalFileChanges(transcript,stream?.events??[]);return{taskId:task.id,status:task.status,events,source:events===transcript?"transcript":"transcript+stream",latestSequence:stream?.latestSequence??0,...(transcriptResult.truncated?{truncated:transcriptResult.truncated}:{})};}
    }
    // A Claude thread keeps one task row per user turn. Without a readable
    // transcript, replaying only the selected task would show a single turn and
    // hide the rest of the conversation, so stitch the sibling turns together.
    if(task.threadId&&!Boolean(task.executionHostId&&executionHostUsesWorker(task.executionHostId))){
      const links=await db.listProviderTasks("claude").catch(()=>[]);
      const members=links.filter((member:any)=>member.threadId===task.threadId&&member.owned);
      if(members.length>1){
        const turns=members.map((member:any)=>({task:member,events:mergeHistoricalFileChanges(readStreamEvents(config.dataRoot,member.id,0,STREAM_REPLAY_LIMIT).events,[...readStreamFileChanges(config.dataRoot,member.id),...persistedImageOutputEvents(mergePersistedImageOutputs(member.metadata?.imageOutputs),member.id)])}));
        const events=providerThreadEvents(turns);
        if(events.length)return{taskId:task.id,status:task.status,events,source:"thread-streams",latestSequence:stream?.latestSequence??0};
      }
    }
    if(stream?.events.length)return streamResult();
  }
  if(task.threadId&&["antigravity","deepseek","ollama","grok"].includes(task.provider)&&!Boolean(task.executionHostId&&executionHostUsesWorker(task.executionHostId))){
    const links=await db.listProviderTaskLinksByThreads(task.provider,[task.threadId]);
    const members=(await Promise.all(links.filter(link=>link.owned).map(link=>db.getTask(link.id)))).filter((member):member is DeckTask=>Boolean(member&&member.threadId===task.threadId));
    const turns=members.map(member=>{
      const replay=readStreamEvents(config.dataRoot,member.id,0,STREAM_REPLAY_LIMIT);
      const normalized=member.provider==="antigravity"?normalizeAntigravityOutputEvents(replay.events):replay.events;
      const images=persistedImageOutputEvents(mergePersistedImageOutputs(member.metadata?.imageOutputs),member.id);
      return{task:member,events:mergeHistoricalFileChanges(normalized,[...readStreamFileChanges(config.dataRoot,member.id),...images])};
    });
    const events=providerThreadEvents(turns);
    if(events.length)return{taskId:task.id,status:task.status,events,source:"thread-streams",latestSequence:stream?.latestSequence??0};
  }
  if(stream?.events.length)return streamResult();
  return { taskId: task.id, status: task.status, events:mergeHistoricalFileChanges(taskEvents(task),durableImageEvents), source:"task", latestSequence:stream?.latestSequence??0 };
});
app.get("/api/tasks/:provider/:taskId/events/stream", { config:{ rateLimit:{ max:20, timeWindow:"1 minute" } } }, async (request, reply) => {
  const item = await taskFromParams(request.params);
  if (!item.task.owned || (item.task.ownership && item.task.ownership !== "claudex-workhouse")) throw Object.assign(new Error("Live events are available only for Claudex Workhouse owned tasks."), { statusCode:403 });
  const allowedOrigins = new Set([config.externalOrigin, ...(config.authMode === "test" ? ["http://127.0.0.1:3410"] : [])]);
  // Same-origin GETs (EventSource included) may omit the Origin header entirely;
  // only reject when a foreign origin is explicitly present. Auth is the JWT gate.
  if (typeof request.headers.origin === "string" && !allowedOrigins.has(request.headers.origin)) throw Object.assign(new Error("Origin is not allowed for event streams."), { statusCode:403 });
  const perTask=taskStreamConnections.get(item.task.id) ?? 0;
  if (streamConnections >= MAX_TASK_STREAMS || perTask >= 3) throw Object.assign(new Error("Too many live event connections."), { statusCode:429 });
  const tail=String((request.query as any)?.tail??"")==="1";
  let sequence=tail
    ?readStreamEvents(config.dataRoot,item.task.id,0,1).latestSequence
    :sseResumeSequence(request.headers["last-event-id"],(request.query as any)?.after);
  streamConnections++;taskStreamConnections.set(item.task.id,perTask+1);
  reply.hijack();
  const response=reply.raw;
  response.writeHead(200,{"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-store, no-cache, must-revalidate","Connection":"keep-alive","X-Accel-Buffering":"no","Content-Encoding":"identity"});
  response.write("retry: 3000\n\n");
  let closed=false;
  const send=(event:string,data:unknown,id?:string)=>{if(closed||response.destroyed||response.writableLength>1024*1024)return false;if(id)response.write(`id: ${id}\n`);response.write(`event: ${event}\n`);response.write(`data: ${JSON.stringify(sanitizeSensitiveValue(data,{preserveSourceIdentifiers:true}))}\n\n`);return true;};
  const pump=()=>{
    const replay=readStreamEvents(config.dataRoot,item.task.id,sequence,STREAM_REPLAY_LIMIT);
    if(replay.replayMissed){send("resync",{reason:"replay-window-exceeded",latestSequence:replay.latestSequence});sequence=replay.latestSequence;return;}
    for(const event of replay.events){if(!send("agent-event",applyPathDisplayPolicy(event,hideLocalPaths),event.eventId)){response.end();return;}sequence=event.sequence;}
  };
  pump();
  const poll=setInterval(pump,250);poll.unref?.();
  const heartbeat=setInterval(()=>{if(!closed&&!response.destroyed)response.write(`: heartbeat ${Date.now()}\n\n`);},15000);heartbeat.unref?.();
  const close=()=>{if(closed)return;closed=true;clearInterval(poll);clearInterval(heartbeat);streamConnections=Math.max(0,streamConnections-1);const next=Math.max(0,(taskStreamConnections.get(item.task.id)??1)-1);if(next)taskStreamConnections.set(item.task.id,next);else taskStreamConnections.delete(item.task.id);};
  request.raw.once("close",close);response.once("close",close);response.once("error",close);
});
async function taskRecoveryPreview(task:DeckTask){
  const eligibility=taskRecoveryEligibility(task),attempt=await db.getTaskRecoveryAttempt(task.id),permission=taskRecoveryPermission(task,null);
  const base={...eligibility,attempt:attempt?{status:attempt.status,resumedTaskId:attempt.resumedTaskId,error:attempt.error}:null,prompt:defaultRecoveryPrompt(task,await currentUiLocale()),provider:task.provider,threadId:task.threadId,executionHostId:task.executionHostId??null,workspaceId:task.workspaceId??null,workspaceName:null as string|null,model:task.requestedModel??null,reasoningEffort:task.requestedReasoningEffort??null,serviceTier:task.requestedServiceTier??null,originalPermission:permission.originalPermission,effectivePermission:permission.effectivePermission??":read-only",effectiveAutomationLevel:permission.effectiveLevel??"read",permissionDowngraded:permission.downgraded};
  if(!eligibility.eligible)return base;
  if(attempt?.status==="started")return{...base,eligible:false,reason:"already-resumed" as const};
  if(attempt?.status==="claiming")return{...base,eligible:false,reason:"recovery-in-progress" as const};
  if(attempt?.status==="failed")return{...base,eligible:false,reason:"recovery-failed" as const};
  const latest=task.threadId?await db.latestThreadTask(task.provider,task.threadId):null;
  if(latest&&latest.id!==task.id)return{...base,eligible:false,reason:"thread-advanced" as const};
  const hostId=task.executionHostId!,host=await db.getHost(hostId);
  let workspace:any;
  try{workspace=await hostWorkspaces.requireWorkspace(task.workspaceId!,hostId);}catch{}
  const boundary=taskRecoveryBoundary(task,host,workspace,!executionHostUsesWorker(hostId)||workerHub.isOnline(hostId));
  if(!boundary.valid)return{...base,eligible:false,reason:boundary.reason};
  const capabilityLevels=(host!.capabilities?.automationLevelsByProvider as any)?.[task.provider]??host!.capabilities?.automationLevels;
  const currentPermission=taskRecoveryPermission(task,capabilityLevels);
  if(!currentPermission.available)return{...base,workspaceName:workspace.displayName,eligible:false,reason:"permission-unavailable" as const};
  return{...base,workspaceName:workspace.displayName,originalPermission:currentPermission.originalPermission,effectivePermission:currentPermission.effectivePermission!,permissionDowngraded:currentPermission.downgraded,effectiveAutomationLevel:currentPermission.effectiveLevel!};
}
app.get("/api/tasks/:provider/:taskId/recovery",async(request)=>{
  const item=await taskFromParams(request.params);
  return{recovery:await taskRecoveryPreview(item.task)};
});
app.post("/api/tasks/:provider/:taskId/recovery",{config:{rateLimit:{max:6,timeWindow:"10 minutes"}}},async(request)=>{
  const item=await taskFromParams(request.params),body=z.object({confirm:z.literal(true),prompt:z.string().trim().min(1).max(config.promptMaxLength)}).parse(request.body);
  await requirePaidCreditConsent(request,[item.task.provider]);
  return idempotent(request,`task-recovery:${item.task.id}`,body,async()=>{
    let sourceTask=item.task;
    try{
      sourceTask=sourceTask.executionHostId&&executionHostUsesWorker(sourceTask.executionHostId)
        ?await remoteTaskCommand(sourceTask,"provider.task.status")
        :await db.upsertTask(await item.provider.getTask(sourceTask));
    }catch(error){
      await audit(request,"task-recovery-resume","failed",sourceTask,`source=${sourceTask.id};stage=refresh;error=${sanitizeSensitiveText(error instanceof Error?error.message:String(error)).slice(0,300)}`);
      throw error;
    }
    const preview=await taskRecoveryPreview(sourceTask);
    if(!preview.eligible)throw Object.assign(new Error("This task is not a candidate that can be safely resumed."),{statusCode:409,code:"TASK_RECOVERY_NOT_ELIGIBLE",reason:preview.reason});
    const now=new Date().toISOString(),attemptId=crypto.randomUUID(),claim=await db.claimTaskRecovery({sourceTaskId:sourceTask.id,attemptId,promptHash:recoveryPromptHash(body.prompt),now});
    if(!claim.claimed){
      if(claim.attempt?.status==="started"&&claim.attempt.resumedTaskId){const task=await db.getTask(claim.attempt.resumedTaskId);if(task)return{task,replayed:true};}
      throw Object.assign(new Error(claim.attempt?.status==="claiming"?"Recovery of this task has already started.":"The recovery attempt for this task has already finished."),{statusCode:409,code:claim.attempt?.status==="claiming"?"TASK_RECOVERY_IN_PROGRESS":"TASK_RECOVERY_ALREADY_DECIDED"});
    }
    let providerDispatchStarted=false;
    try{
      const current=await db.getTask(sourceTask.id),latest=sourceTask.threadId?await db.latestThreadTask(sourceTask.provider,sourceTask.threadId):null;
      if(!current||!taskRecoveryEligibility(current).eligible)throw Object.assign(new Error("The source task is no longer recoverable."),{statusCode:409,code:"TASK_RECOVERY_SOURCE_ACTIVE"});
      if(latest&&latest.id!==sourceTask.id)throw Object.assign(new Error("The source thread advanced before recovery launch."),{statusCode:409,code:"TASK_RECOVERY_SOURCE_ADVANCED"});
      const source:DeckTask={...current,permissionProfile:preview.effectivePermission,settingsUpdatedAt:now,metadata:{...current.metadata,automationLevel:preview.effectiveAutomationLevel??automationLevel(current.metadata?.automationLevel,preview.effectivePermission)}};
      let next=await withThreadTurn(source.provider,source.threadId,async()=>{
        providerDispatchStarted=true;
        return source.executionHostId&&executionHostUsesWorker(source.executionHostId)
          ?await remoteTaskCommand(source,"provider.session.resume",{prompt:body.prompt,expectedThreadId:source.threadId,model:source.requestedModel,reasoningEffort:source.requestedReasoningEffort,serviceTier:source.requestedServiceTier,permissionProfile:source.permissionProfile,workMode:source.metadata?.workMode??"default",automationLevel:source.metadata?.automationLevel})
          :await item.provider.sendMessage(source,workspacePromptForTask(source,body.prompt));
      });
      assertRecoveryThread(source.threadId!,next.threadId);
      next=await db.upsertTask({...next,...(next.id!==source.id?{prompt:body.prompt}:{}),metadata:{...workspaceInstructionRecoveryMetadata(source.metadata,next.metadata),recoveredFromTaskId:sourceTask.id,recoveryCause:preview.cause,recoveryAttemptId:attemptId,permissionDowngraded:preview.permissionDowngraded}});
      if(next.id!==sourceTask.id)await db.upsertTask({...sourceTask,metadata:{...sourceTask.metadata,recoveryState:"resumed",recoveryTaskId:next.id,recoveryAttemptId:attemptId}});
      await db.finishTaskRecovery({sourceTaskId:sourceTask.id,attemptId,status:"started",now:new Date().toISOString(),resumedTaskId:next.id,error:null});
      await audit(request,"task-recovery-resume","success",next,`source=${sourceTask.id};cause=${preview.cause};workspace=${sourceTask.workspaceId};permissionDowngraded=${preview.permissionDowngraded}`);
      return{task:next,replayed:false};
    }catch(error){
      const safe=sanitizeSensitiveText(error instanceof Error?error.message:String(error)).slice(0,500);
      const retryable=retryableRecoveryPrelaunchFailure(error)&&(!providerDispatchStarted||(error as any)?.code==="AUTOMATIC_EXECUTION_BLOCKED");
      if(retryable)await db.releaseTaskRecoveryClaim({sourceTaskId:sourceTask.id,attemptId}).catch(()=>false);
      else{
        await db.finishTaskRecovery({sourceTaskId:sourceTask.id,attemptId,status:"failed",now:new Date().toISOString(),resumedTaskId:null,error:safe}).catch(()=>{});
        await db.upsertTask({...sourceTask,metadata:{...sourceTask.metadata,recoveryState:"failed",recoveryError:safe,recoveryAttemptId:attemptId}}).catch(()=>{});
      }
      await audit(request,"task-recovery-resume","failed",sourceTask,`source=${sourceTask.id};stage=${providerDispatchStarted?"provider-dispatch":"pre-launch"};retryable=${retryable};error=${safe}`).catch(()=>{});
      throw error;
    }
  });
});
app.post("/api/tasks/:provider/:taskId/messages", async (request) => {
  const body = promptBody.parse(request.body);
  const item = await taskFromParams(request.params);
  await requirePaidCreditConsent(request,[item.task.provider]);
  if(!item.task.owned||item.task.ownership==="external")throw Object.assign(new Error("External sessions require an explicit control handoff before follow-up."),{statusCode:409,code:"CONTROL_HANDOFF_REQUIRED"});
  return idempotent(request, `message:${item.task.id}`, body, async () => {
    const source=await applyPendingTaskLocation(item.task);
    return withThreadTurn(source.provider,source.threadId,async()=>{
      let next = source.executionHostId&&executionHostUsesWorker(source.executionHostId)?await remoteTaskCommand(source,"provider.session.resume",{prompt:body.prompt,model:source.requestedModel,reasoningEffort:source.requestedReasoningEffort,serviceTier:source.requestedServiceTier,permissionProfile:source.permissionProfile,workMode:source.metadata?.workMode??"default",automationLevel:automationLevel(source.metadata?.automationLevel,source.permissionProfile)}):await item.provider.sendMessage(source,workspacePromptForTask(source,body.prompt));
      next=publishTaskSnapshot(await db.upsertTask({...next,...(next.id!==source.id?{prompt:body.prompt}:{}),metadata:{...withoutLegacyWorkspaceApprovalMetadata(source.metadata),...withoutLegacyWorkspaceApprovalMetadata(next.metadata)}}));
      await audit(request, "message", "success", next);
      return { task: next };
    },async active=>{
      // The browser decides between a direct follow-up and the queue from a
      // polled snapshot, so a turn that starts in between lands here. Queueing
      // preserves the message; a second process on this session would not.
      const timestamp=new Date().toISOString(),approved=confirmedPaidCreditProviders(request).has(source.provider);
      const queued=await db.enqueueSessionMessage({id:crypto.randomUUID(),provider:source.provider,threadId:source.threadId!,sourceTaskId:active.id,prompt:body.prompt,createdAt:timestamp,updatedAt:timestamp,...(approved?{error:`paid-credit-approved:${source.provider}`}:{})});
      await audit(request,"message","queued",active,`thread=${source.threadId};queue=${queued.id};reason=session-turn-in-progress`);
      return { task:active, queued };
    });
  });
});
const queueParams=taskParams.extend({queueId:z.string().uuid()});
async function queueItemFromRequest(raw:unknown){
  const params=queueParams.parse(raw),task=await db.getTask(params.taskId);if(!task||task.provider!==params.provider)throw Object.assign(new Error("Task not found."),{statusCode:404});
  const item=await db.getSessionMessage(params.queueId);if(!task.threadId||!item||item.provider!==task.provider||item.threadId!==task.threadId)throw Object.assign(new Error("The queued message could not be found."),{statusCode:404,code:"QUEUED_MESSAGE_NOT_FOUND"});return{params,task,item};
}
app.get("/api/tasks/:provider/:taskId/message-queue",async(request)=>{
  const item=await taskFromParams(request.params);if(!item.task.threadId)return{items:[],activeTask:null};
  const [items,activeTask]=await Promise.all([db.listSessionMessages(item.task.provider,item.task.threadId),latestQueuedThreadTask(item.task.provider,item.task.threadId)]);return{items,activeTask};
});
app.post("/api/tasks/:provider/:taskId/message-queue",async(request)=>{
  const body=promptBody.parse(request.body),item=await taskFromParams(request.params);if(!item.task.owned||item.task.ownership==="external"||!item.task.threadId)throw Object.assign(new Error("Only a confirmed session owned by Claudex Workhouse can queue messages."),{statusCode:409,code:"QUEUE_REQUIRES_OWNED_SESSION"});
  await requirePaidCreditConsent(request,[item.task.provider]);
  return idempotent(request,`message-queue:${item.task.threadId}`,body,async()=>{const timestamp=new Date().toISOString(),approved=confirmedPaidCreditProviders(request).has(item.task.provider),queued=await db.enqueueSessionMessage({id:crypto.randomUUID(),provider:item.task.provider,threadId:item.task.threadId,sourceTaskId:item.task.id,prompt:body.prompt,createdAt:timestamp,updatedAt:timestamp,...(approved?{error:`paid-credit-approved:${item.task.provider}`}:{})});void pumpSessionMessageQueue();return{item:queued};});
});
app.patch("/api/tasks/:provider/:taskId/message-queue/:queueId",async(request)=>{
  const body=promptBody.parse(request.body),{task,item}=await queueItemFromRequest(request.params);
  return idempotent(request,`message-queue-update:${item.id}`,body,async()=>{if(item.status!=="queued")throw Object.assign(new Error("Only a queued message can be edited."),{statusCode:409,code:"QUEUED_MESSAGE_NOT_EDITABLE"});const updated=await db.updateSessionMessage(item.id,body.prompt,new Date().toISOString());if(!updated)throw Object.assign(new Error("The queued message state has already changed."),{statusCode:409,code:"QUEUED_MESSAGE_STATE_CHANGED"});await audit(request,"queued-message-update","success",task,`queue=${item.id}`);return{item:updated};});
});
app.delete("/api/tasks/:provider/:taskId/message-queue/:queueId",async(request)=>{
  const {item}=await queueItemFromRequest(request.params);if(!["queued","failed","delivery-uncertain"].includes(item.status))throw Object.assign(new Error("A queued message that is already running cannot be removed."),{statusCode:409,code:"QUEUED_MESSAGE_IN_FLIGHT"});
  if(!await db.deleteSessionMessage(item.id))throw Object.assign(new Error("The queued message state has already changed."),{statusCode:409,code:"QUEUED_MESSAGE_STATE_CHANGED"});return{deleted:true,id:item.id};
});
app.post("/api/tasks/:provider/:taskId/message-queue/:queueId/send-now",async(request)=>{
  const {item}=await queueItemFromRequest(request.params);if(item.status!=="queued")throw Object.assign(new Error("Only a queued message can be sent immediately."),{statusCode:409,code:"QUEUED_MESSAGE_NOT_SENDABLE"});await requirePaidCreditConsent(request,[item.provider]);return dispatchQueuedMessage(item.id,true,confirmedPaidCreditProviders(request));
});
app.post("/api/tasks/:provider/:taskId/message-queue/:queueId/retry",async(request)=>{
  const body=z.object({confirmDuplicateRisk:z.literal(true)}).parse(request.body),{task,item}=await queueItemFromRequest(request.params);if(!["failed","delivery-uncertain"].includes(item.status))throw Object.assign(new Error("Only a failed or unconfirmed message can be sent again."),{statusCode:409,code:"QUEUED_MESSAGE_NOT_RETRYABLE"});
  await requirePaidCreditConsent(request,[task.provider]);
  return idempotent(request,`message-queue-retry:${item.id}`,body,async()=>{let retried=await db.retrySessionMessage(item.id,new Date().toISOString());if(retried?.status!=="queued")throw Object.assign(new Error("The queued message state has already changed."),{statusCode:409,code:"QUEUED_MESSAGE_STATE_CHANGED"});if(confirmedPaidCreditProviders(request).has(task.provider))retried=await db.deferSessionMessageCredit(item.id,`paid-credit-approved:${task.provider}`,new Date().toISOString());await audit(request,"queued-message-manual-retry","success",task,`queue=${item.id};previous=${item.status};duplicate-risk-confirmed=true`);void pumpSessionMessageQueue();return{item:retried};});
});
app.post("/api/tasks/:provider/:taskId/message-queue/:queueId/resolve-sent",async(request)=>{
  const body=z.object({confirm:z.literal(true)}).parse(request.body),{task,item}=await queueItemFromRequest(request.params);if(item.status!=="delivery-uncertain")throw Object.assign(new Error("Only a message with unconfirmed delivery can be resolved manually."),{statusCode:409,code:"QUEUED_MESSAGE_NOT_RESOLVABLE"});
  return idempotent(request,`message-queue-resolve:${item.id}`,body,async()=>{const resolved=await db.resolveSessionMessageSent(item.id,new Date().toISOString());if(resolved?.status!=="sent")throw Object.assign(new Error("The queued message state has already changed."),{statusCode:409,code:"QUEUED_MESSAGE_STATE_CHANGED"});await audit(request,"queued-message-manual-resolve","success",task,`queue=${item.id};marked-delivered=true`);return{item:resolved};});
});
app.post("/api/tasks/:provider/:taskId/follow",async(request)=>{const item=await taskFromParams(request.params);const body=z.object({enabled:z.boolean()}).parse(request.body);return idempotent(request,`external-follow:${item.task.id}`,body,async()=>{if(item.task.owned)throw Object.assign(new Error("Claudex Workhouse already controls this task."),{statusCode:409});const task=await db.upsertTask({...item.task,metadata:{...item.task.metadata,controlState:body.enabled?"follow":"history",followEnabledAt:body.enabled?new Date().toISOString():null}});await audit(request,body.enabled?"external-follow":"external-unfollow","success",task);return{task,controlState:body.enabled?"follow":"history"};});});
app.post("/api/tasks/:provider/:taskId/take-control",{config:{rateLimit:{max:6,timeWindow:"10 minutes"}}},async(request)=>{const item=await taskFromParams(request.params);const body=z.object({confirm:z.literal(true),prompt:z.string().trim().min(1).max(config.promptMaxLength).default("Continue this session under explicit Claudex Workhouse control.")}).parse(request.body);return idempotent(request,`external-control:${item.task.id}`,body,async()=>{
  await requirePaidCreditConsent(request,[item.task.provider]);
  if(item.task.owned)throw Object.assign(new Error("Claudex Workhouse already controls this task."),{statusCode:409});if(!item.task.threadId)throw Object.assign(new Error("Provider session ID is unavailable."),{statusCode:409});if(!["completed","failed","stopped"].includes(item.task.status))throw Object.assign(new Error("The external process may still be active. End it before transferring control."),{statusCode:409});
  const hostId=item.task.executionHostId??LOCAL_HOST_ID,workerBacked=executionHostUsesWorker(hostId),workspace=workerBacked&&item.task.workspaceId?await hostWorkspaces.requireWorkspace(item.task.workspaceId,hostId):null;if(workerBacked&&!workspace)throw Object.assign(new Error("The Worker-backed session has no workspace value."),{statusCode:409});const controlPermission=item.task.permissionProfile===":danger-full-access"?":read-only":item.task.permissionProfile??":read-only";let next:DeckTask;
  if(!workerBacked)next=await item.provider.sendMessage({...item.task,permissionProfile:controlPermission},workspacePromptForTask(item.task,body.prompt));else{if(hostId===LOCAL_HOST_ID)await refreshManagedLocalWorkerConfig();const id=`${item.task.provider}:${hostId===LOCAL_HOST_ID?"worker":"remote"}:${crypto.randomUUID()}`,remote=await workerHub.request(hostId,"provider.session.control",{taskId:id,provider:item.task.provider,workspaceId:workspace!.id,threadId:item.task.threadId,prompt:workspacePromptForTask(item.task,body.prompt),permissionProfile:controlPermission,...await claudeRemoteExecutionSettings(item.task.provider)}) as any,createdAt=new Date().toISOString(),title=`${item.task.title} · ${localizedTaskSuffix(await currentUiLocale(),"controlHandoff")}`;next=await db.upsertTask({id,provider:item.task.provider,nativeId:String(remote?.hostTaskId??id),threadId:remote?.threadId??item.task.threadId,projectId:item.task.projectId,title,prompt:body.prompt,status:remote?.status??"pending",createdAt,updatedAt:createdAt,result:null,error:null,log:"Worker control handoff started.",owned:true,pid:null,pgid:null,processStart:null,commandMarker:null,parentThreadId:item.task.threadId,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:hostId,workspaceId:workspace!.id,remoteWorkerId:hostId,hostTaskId:String(remote?.hostTaskId??id),providerSessionId:remote?.threadId??item.task.threadId,sourceSessionId:item.task.threadId,permissionProfile:controlPermission,metadata:{controlState:"controlled",controlProvenance:"official-resume",externalProcessOwned:false,workspaceInstructionSnapshot:workspaceInstructionSnapshotFromMetadata(item.task.metadata)}});}
  const timestamp=new Date().toISOString(),chainId=item.task.workChainId??crypto.randomUUID();if(!item.task.workChainId)await db.createWorkChain({id:chainId,projectId:item.task.projectId,title:item.task.title,rootSessionId:item.task.threadId??item.task.id,activeSessionId:next.threadId??next.id,createdAt:timestamp,updatedAt:timestamp,archivedAt:null});
  next=await db.upsertTask({...next,owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:hostId,workspaceId:workspace?.id??item.task.workspaceId??null,sourceSessionId:item.task.threadId??item.task.id,workChainId:chainId,metadata:{...next.metadata,controlState:"controlled",controlProvenance:"official-resume",externalProcessOwned:false}});await db.upsertTask({...item.task,workChainId:chainId,metadata:{...item.task.metadata,controlState:"history",controlledByTaskId:next.id}});await db.upsertSessionLink({id:crypto.randomUUID(),chainId,sourceSessionId:item.task.threadId??item.task.id,targetSessionId:next.threadId??next.id,relationType:"resume",handoffArtifactId:null,sourceHostId:item.task.executionHostId??LOCAL_HOST_ID,targetHostId:hostId,sourceProvider:item.task.provider,targetProvider:next.provider,sourceCommit:null,targetCommit:null,status:"delivered",createdAt:timestamp});await audit(request,"external-control-handoff","success",next,`source=${item.task.id};official-resume=true`);return{task:next,sourceTaskId:item.task.id,processOwnership:"new-claudex-workhouse-process-only"};
});});
app.post("/api/tasks/:provider/:taskId/fork", async (request) => {
  const item = await taskFromParams(request.params);
  return idempotent(request, `fork:${item.task.id}`, {}, async () => {

    const forked = item.task.executionHostId&&executionHostUsesWorker(item.task.executionHostId)?await remoteTaskCommand(item.task,"provider.session.fork",{}):await item.provider.forkThread(item.task);
    const next=publishTaskSnapshot(await db.upsertTask({...forked,metadata:{...withoutLegacyWorkspaceApprovalMetadata(item.task.metadata),...withoutLegacyWorkspaceApprovalMetadata(forked.metadata)}}));
    await audit(request, "fork", "success", next);
    return { task: next };
  });
});
app.patch("/api/tasks/claude/:taskId/settings", async (request) => {
  const body = z.object({ model:z.string().min(1).max(100).nullable().optional(), reasoningEffort:z.string().min(1).max(30).nullable().optional(), permissionProfile:z.string().min(1).max(80).nullable().optional(), workMode:z.enum(["default","plan"]).optional(),automationLevel:z.enum(["full","auto","confirm","read"]).optional(), dangerConfirmation:z.boolean().optional(),...sessionLocationFields }).superRefine((v,c)=>{
    if (v.reasoningEffort && v.reasoningEffort !== "default" && !ClaudeProvider.validEfforts.has(v.reasoningEffort)) c.addIssue({ code:z.ZodIssueCode.custom, message:"Unknown Claude reasoning effort." });
    if (v.permissionProfile && !ClaudeProvider.validProfiles.has(v.permissionProfile)) c.addIssue({ code:z.ZodIssueCode.custom, message:"Unknown Claude permission profile." });
    if ((v.permissionProfile === ":danger-full-access"||v.automationLevel==="full") && v.dangerConfirmation !== true) c.addIssue({ code:z.ZodIssueCode.custom, message:"Danger-full-access requires explicit confirmation." });
    if(v.automationLevel==="confirm")c.addIssue({code:z.ZodIssueCode.custom,message:"Claude confirm-then-run is still waiting on the approval response wiring."});
  }).parse(request.body);
  await requireGlobalModel("claude",body.model);
  const item = await taskFromParams({ provider:"claude", taskId:(request.params as any).taskId });
  const located=await setTaskLocationForNextRequest(item.task,body.projectId,body.workspaceId);
  const requestedPermission=body.permissionProfile === undefined ? located.permissionProfile ?? null : body.permissionProfile;
  const level=automationLevel(body.automationLevel,requestedPermission),permissionProfile=body.automationLevel?permissionForAutomation("claude",level):requestedPermission;
  const updated = await db.upsertTask({ ...located,
    requestedModel: body.model === undefined ? located.requestedModel ?? null : body.model === "default" ? null : body.model,
    requestedReasoningEffort: body.reasoningEffort === undefined ? located.requestedReasoningEffort ?? null : body.reasoningEffort === "default" ? null : body.reasoningEffort,
    permissionProfile,
    metadata:{...located.metadata,...(body.workMode?{workMode:body.workMode}:{}),automationLevel:level},
    settingsUpdatedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  await audit(request, "claude-settings", "success", updated);
  return { task: updated };
});
for(const compatibleProviderId of ["antigravity","deepseek","ollama","grok"] as const)app.patch(`/api/tasks/${compatibleProviderId}/:taskId/settings`,async(request)=>{
  const body=z.object({model:z.string().min(1).max(100).nullable().optional(),reasoningEffort:z.string().min(1).max(30).nullable().optional(),permissionProfile:z.string().min(1).max(80).nullable().optional(),workMode:z.enum(["default","plan"]).optional(),automationLevel:z.enum(["full","auto","confirm","read"]).optional(),googleSearchMode:z.enum(["off","auto","always"]).optional(),dangerConfirmation:z.boolean().optional(),...sessionLocationFields}).superRefine((value,context)=>{
    if(value.reasoningEffort&&value.reasoningEffort!=="default"&&(!ClaudeProvider.validEfforts.has(value.reasoningEffort)||compatibleProviderId==="antigravity"&&!["low","medium","high"].includes(value.reasoningEffort)))context.addIssue({code:z.ZodIssueCode.custom,message:"Unknown reasoning effort."});
    if(value.permissionProfile&&!ClaudeProvider.validProfiles.has(value.permissionProfile))context.addIssue({code:z.ZodIssueCode.custom,message:"Unknown permission profile."});
    if((value.permissionProfile===":danger-full-access"||value.automationLevel==="full")&&value.dangerConfirmation!==true)context.addIssue({code:z.ZodIssueCode.custom,message:"Danger-full-access requires explicit confirmation."});
    if(value.automationLevel==="confirm")context.addIssue({code:z.ZodIssueCode.custom,message:"Confirm-then-run is unavailable for this provider."});
    if(compatibleProviderId!=="antigravity"&&value.googleSearchMode)context.addIssue({code:z.ZodIssueCode.custom,message:"Google Search mode is an Antigravity-only setting."});
  }).parse(request.body);
  await requireGlobalModel(compatibleProviderId,body.model);
  const item=await taskFromParams({provider:compatibleProviderId,taskId:(request.params as any).taskId}),located=await setTaskLocationForNextRequest(item.task,body.projectId,body.workspaceId),requestedPermission=body.permissionProfile===undefined?located.permissionProfile??null:body.permissionProfile,level=automationLevel(body.automationLevel,requestedPermission),permissionProfile=body.automationLevel?permissionForAutomation(compatibleProviderId,level):requestedPermission,updated=await db.upsertTask({...located,requestedModel:body.model===undefined?located.requestedModel??null:body.model==="default"?null:body.model,requestedReasoningEffort:body.reasoningEffort===undefined?located.requestedReasoningEffort??null:body.reasoningEffort==="default"?null:body.reasoningEffort,permissionProfile,metadata:{...located.metadata,...(body.workMode?{workMode:body.workMode}:{}),automationLevel:level,...(compatibleProviderId==="antigravity"&&body.googleSearchMode?{googleSearchMode:body.googleSearchMode}:{})},settingsUpdatedAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  await audit(request,`${compatibleProviderId}-settings`,"success",updated);return{task:updated};
});
app.patch("/api/tasks/codex/:taskId/settings",async(request)=>{
  const body=codexSettings.parse(request.body),item=await taskFromParams({provider:"codex",taskId:(request.params as any).taskId});
  await requireGlobalModel("codex",body.model);
  const located=await setTaskLocationForNextRequest(item.task,body.projectId,body.workspaceId);
  const requestedPermission=body.permissionProfile??located.permissionProfile;
  const level=automationLevel(body.automationLevel,requestedPermission),valid=await codex.validateSettings({...body,permissionProfile:requestedPermission});
  const updated=await db.upsertTask({...located,requestedModel:valid.model,requestedReasoningEffort:valid.reasoningEffort,requestedServiceTier:valid.serviceTier,permissionProfile:valid.permissionProfile,metadata:{...located.metadata,...(body.workMode?{workMode:body.workMode}:{}),automationLevel:level},settingsUpdatedAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  if(!Boolean(updated.executionHostId&&executionHostUsesWorker(updated.executionHostId))&&updated.threadId&&await db.getCodexThread(updated.threadId))await codex.updateThreadSettings(updated.threadId,body);
  await audit(request,"codex-task-settings","success",updated);return{task:updated};
});
app.post("/api/tasks/:provider/:taskId/stop", async (request) => {
  const item = await taskFromParams(request.params);
  if(!item.task.owned||item.task.ownership==="external")throw Object.assign(new Error("External CLI or VS Code sessions cannot be stopped by Claudex Workhouse."),{statusCode:403});
  return idempotent(request, `stop:${item.task.id}`, {}, async () => {
    const stopped = item.task.executionHostId&&executionHostUsesWorker(item.task.executionHostId)?await remoteTaskCommand(item.task,"provider.task.stop",{}):await item.provider.stopTask(item.task);
    const{interruptionCause:_cause,interruptionDetectedAt:_detected,recoveryState:_recovery,...metadata}=stopped.metadata??{};
    const next=await db.upsertTask({...stopped,metadata:{...metadata,terminationCause:"user-stopped",terminatedAt:new Date().toISOString()}});
    await settleTaskLeases(next);
    publishTaskSnapshot(next);
    await audit(request, "stop", "success", next);
    return { task: next };
  });
});

app.delete("/api/tasks/:provider/:taskId/session",async(request)=>{
  const item=await taskFromParams(request.params),body=z.object({confirmDelete:z.literal(true),acknowledgeFilesRemain:z.literal(true)}).parse(request.body);
  if(!item.task.threadId)throw Object.assign(new Error("Session ID is unavailable."),{statusCode:409});
  const threadId=item.task.threadId;
  return idempotent(request,`session-delete:${item.task.provider}:${item.task.threadId}`,body,async()=>{
    try{
      let result:any;
      if(item.task.executionHostId&&executionHostUsesWorker(item.task.executionHostId)){
        if(item.task.executionHostId!==LOCAL_HOST_ID)throw Object.assign(new Error("Remote sessions must be deleted from their Worker host."),{statusCode:409});
        result=await workerHub.request(item.task.executionHostId,"provider.session.delete",{taskId:item.task.hostTaskId??item.task.id,provider:item.task.provider,workspaceId:item.task.workspaceId,threadId});
        await db.deleteTaskSession(item.task.provider,threadId);
      }else result=item.task.provider==="codex"?await codex.deleteThread(threadId):await item.provider.deleteSession(item.task);
      taskListSnapshot=removeProviderSessionRows(taskListSnapshot,item.task.provider,threadId);
      recordTaskListMutation({kind:"delete-session",provider:item.task.provider,threadId});
      await db.appendAudit({createdAt:new Date().toISOString(),actor:(request as any).actor,action:"session-delete",provider:item.task.provider,taskId:item.task.id,projectId:item.task.projectId,outcome:"success",detail:`thread=${item.task.threadId};ownership=${item.task.ownership??"unknown"}`});
      return result;
    }catch(error){
      await db.appendAudit({createdAt:new Date().toISOString(),actor:(request as any).actor,action:"session-delete",provider:item.task.provider,taskId:item.task.id,projectId:item.task.projectId,outcome:"failed",detail:error instanceof Error?error.message:String(error)});throw error;
    }
  });
});

app.get("/api/codex/threads", async (request) => {return{...(await codex.listThreads(threadQuery.parse(request.query)))};});
app.get("/api/codex/search", async (request) => {const q=z.object({q:z.string().trim().min(1).max(500),cursor:z.string().uuid().optional(),limit:z.coerce.number().int().min(1).max(100).default(50)}).parse(request.query);return codex.searchThreads(q.q,q.cursor,q.limit); });
const historySearchQuery=z.object({
  q:z.string().trim().min(1).max(500),cursor:z.string().min(1).max(2048).optional(),
  limit:z.coerce.number().int().min(1).max(50).default(30),
  provider:providerParam.optional(),workspaceId:z.string().min(1).max(100).optional(),
  status:z.enum(["pending","queued","running","waiting","completed","failed","stopped","unknown"]).optional(),
  from:z.string().datetime().optional(),to:z.string().datetime().optional()
});
type HistoryCursorPayload={v:1;signature:string;updatedAt:string;key:string;emitted:number};
const encodeHistoryCursor=(value:HistoryCursorPayload)=>Buffer.from(JSON.stringify(value)).toString("base64url");
const decodeHistoryCursor=(value:string|undefined,signature:string):HistoryCursorPayload|null=>{
  if(!value)return null;
  try{const parsed=JSON.parse(Buffer.from(value,"base64url").toString("utf8"));if(parsed?.v!==1||parsed.signature!==signature||typeof parsed.updatedAt!=="string"||typeof parsed.key!=="string"||!Number.isInteger(parsed.emitted)||parsed.emitted<0)throw new Error();return parsed;}
  catch{throw Object.assign(new Error("Search cursor is invalid or expired."),{statusCode:400});}
};
app.get("/api/history/search",{config:{rateLimit:{max:120,timeWindow:"1 minute"}}},async(request)=>{
  const startedAt=performance.now();
  const query=historySearchQuery.parse(request.query),signature=JSON.stringify({...query,cursor:undefined});
  const cursor=decodeHistoryCursor(query.cursor,signature),maxResults=500,pageLimit=Math.min(query.limit,maxResults-(cursor?.emitted??0));
  const stored=await historyDb.searchHistoryLocal({query:query.q,provider:query.provider,workspaceId:query.workspaceId,status:query.status,from:query.from,to:query.to,cursorUpdatedAt:cursor?.updatedAt,cursorKey:cursor?.key,limit:pageLimit});
  const results=stored.results as unknown as HistorySearchResult[],emitted=(cursor?.emitted??0)+results.length,next=stored.nextCursor&&emitted<maxResults?encodeHistoryCursor({v:1,signature,updatedAt:stored.nextCursor.updatedAt,key:stored.nextCursor.id,emitted}):null;
  return{results,nextCursor:next,strategy:"local-unified-index",maxResults,nativeFallback:false,nativeStatus:query.provider==="claude"?"disabled":"cached",serverElapsedMs:Math.max(0,Math.round(performance.now()-startedAt))};
});
app.get("/api/codex/threads/:threadId", async (request) => {return{thread:await codex.getThread(threadParams.parse(request.params).threadId)};});
app.get("/api/codex/threads/:threadId/turns", async (request) => {
  const {threadId}=threadParams.parse(request.params); const query=turnQuery.parse(request.query);
  return codex.listTurns(threadId,query.cursor,query.limit);
});
app.post("/api/codex/threads/:threadId/messages", async (request) => {
  const {threadId}=threadParams.parse(request.params); const body=codexMessageBody.parse(request.body);
  await requirePaidCreditConsent(request,["codex"]);
  const stored=await db.getCodexThread(threadId);if(stored&&stored.ownership!=="claudex-workhouse")throw Object.assign(new Error("Use the explicit control handoff for an external Codex session."),{statusCode:409,code:"CONTROL_HANDOFF_REQUIRED"});
  return idempotent(request,`codex-message:${threadId}`,body,async()=>{
    const linked=(await db.listProviderTasks("codex")).filter(task=>task.threadId===threadId&&task.ownership==="claudex-workhouse").sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
    let task:DeckTask;
    if(linked[0]){const source=await applyPendingTaskLocation(linked[0]),next=source.executionHostId&&executionHostUsesWorker(source.executionHostId)?await remoteTaskCommand(source,"provider.session.resume",{prompt:body.prompt,model:source.requestedModel,reasoningEffort:source.requestedReasoningEffort,serviceTier:source.requestedServiceTier,permissionProfile:source.permissionProfile,workMode:source.metadata?.workMode??"default",automationLevel:automationLevel(source.metadata?.automationLevel,source.permissionProfile)}):await codex.sendMessage(source,workspacePromptForTask(source,body.prompt));task=next.id!==source.id?await db.upsertTask({...next,prompt:body.prompt}):next;}
    else{task=await codex.sendThreadMessage(threadId,body.prompt,body);}
    await audit(request,"codex-message","success",task);return{task};
  });
});
app.post("/api/codex/threads/:threadId/fork", async (request) => {
  const {threadId}=threadParams.parse(request.params);
  return idempotent(request,`codex-fork:${threadId}`,request.body??{},async()=>{const stored=await db.getCodexThread(threadId);const task=await codex.forkByThread(threadId,stored?.projectId,stored?.title);await audit(request,"codex-fork","success",task);return{task};});
});
for (const [suffix,archived] of [["archive",true],["unarchive",false]] as const) app.post(`/api/codex/threads/:threadId/${suffix}`,async(request)=>{
  const {threadId}=threadParams.parse(request.params);
  return idempotent(request,`codex-${suffix}:${threadId}`,{},async()=>{const result=await codex.archiveThread(threadId,archived);await db.appendAudit({createdAt:new Date().toISOString(),actor:(request as any).actor,action:`codex-${suffix}`,provider:"codex",taskId:`thread:${threadId.slice(0,8)}`,projectId:null,outcome:"success",detail:null});return result;});
});
app.patch("/api/codex/threads/:threadId/settings",async(request)=>{
  const {threadId}=threadParams.parse(request.params);const body=codexSettings.parse(request.body);
  await requireGlobalModel("codex",body.model);
  return idempotent(request,`codex-settings:${threadId}`,body,async()=>{
    const stored=await db.getCodexThread(threadId);if(!stored)throw Object.assign(new Error("Codex thread not found."),{statusCode:404});
    const linked=(await db.listProviderTasks("codex")).filter(task=>task.threadId===threadId&&task.ownership==="claudex-workhouse");
    const current=linked[0]??null;let location:any=null,locatedLinked:DeckTask[]=[];
    if(body.projectId||body.workspaceId){
      const hostId=current?.executionHostId??stored.metadata?.executionHostId??LOCAL_HOST_ID;
      if(hostId!==LOCAL_HOST_ID)throw Object.assign(new Error("Change the project of a remote session from that task view."),{statusCode:409,code:"REMOTE_SESSION_PROJECT_CHANGE"});
      const projectId=body.projectId??stored.projectId;location=await selectedWorkspace(projectId,hostId,body.workspaceId);
      for(const task of linked)locatedLinked.push(await setTaskLocationForNextRequest(task,projectId,location.workspace.id,false));
    }
    const timestamp=new Date().toISOString();
    const deferred=locatedLinked.some(task=>activeTaskStatus(task.status));
    const preparedThread=await codex.updateThreadSettings(threadId,{...body,...(location?{projectId:location.workspace.projectId,cwd:location.workspace.canonicalPath,workspaceId:location.workspace.id,executionHostId:LOCAL_HOST_ID,workspaceChangedAt:timestamp,deferWorkspaceChange:deferred}:{})},false);
    if(location){const applied=await db.applyTaskThreadSettings(locatedLinked,preparedThread);await Promise.all(linked.map(task=>releasePreviousTaskWorkspaceLease(task,location.workspace.id).catch(()=>{})));return{thread:applied.thread};}
    const thread=await db.upsertCodexThread(preparedThread);return{thread};
  });
});
app.delete("/api/codex/threads/:threadId",async(request)=>{
  const {threadId}=threadParams.parse(request.params);const body=z.object({confirmDelete:z.literal(true),acknowledgeFilesRemain:z.literal(true)}).parse(request.body);const stored=await db.getCodexThread(threadId);
  if(!stored)throw Object.assign(new Error("Codex thread not found."),{statusCode:404});
  return idempotent(request,`codex-delete:${threadId}`,body,async()=>{try{const result=await codex.deleteThread(threadId);await db.appendAudit({createdAt:new Date().toISOString(),actor:(request as any).actor,action:"codex-delete",provider:"codex",taskId:`thread:${threadId.slice(0,8)}`,projectId:stored.projectId,outcome:"success",detail:`source=${stored.source};ownership=${stored.ownership}`});return result;}catch(error){await db.appendAudit({createdAt:new Date().toISOString(),actor:(request as any).actor,action:"codex-delete",provider:"codex",taskId:`thread:${threadId.slice(0,8)}`,projectId:stored.projectId,outcome:"failed",detail:error instanceof Error?error.message:String(error)});throw error;}});
});

app.setErrorHandler(async (error, request, reply) => {
  const validationError = error instanceof z.ZodError;
  const message = validationError ? "Invalid request." : sanitizeSensitiveText(error instanceof Error ? error.message : String(error));
  const status = validationError ? 400 : (error as any).statusCode && Number((error as any).statusCode) < 500 ? Number((error as any).statusCode) : (error as any).statusCode ?? 500;
  request.log.warn({ err: sanitizeSensitiveObject(error), status }, "request failed");
  await audit(request, "request", "failed", undefined, message).catch(() => {});
  const externalPathCandidates=Array.isArray((error as any).externalPathCandidates)?(error as any).externalPathCandidates.map((item:unknown)=>sanitizeSensitiveText(item)):undefined;
  const blockedProviders=Array.isArray((error as any).providers)?(error as any).providers.filter((item:unknown)=>item==="codex"||item==="claude"):undefined;
  const creditReasons=(error as any).reasons&&typeof (error as any).reasons==="object"?sanitizeSensitiveObject((error as any).reasons):undefined;
  const errorParams=(error as any).errorParams&&typeof (error as any).errorParams==="object"?sanitizeSensitiveObject((error as any).errorParams):undefined;
  reply.code(status).send({ ...(errorParams?{errorParams}:{}), ok: false, error: message, code: (error as any).code ?? "REQUEST_FAILED",...(externalPathCandidates?{externalPathCandidates}:{}),...(blockedProviders?.length?{providers:blockedProviders}:{}) ,...(creditReasons?{creditReasons}:{}) });
});

const staticRoot = path.join(config.appRoot, "app", "dist");
if (fs.existsSync(staticRoot)) {
  await app.register(fastifyStatic, { root: staticRoot, wildcard: false, cacheControl: false, setHeaders(res, filePath) {
    // Hashed assets are content-addressed -> cache forever. Everything else
    // (service-worker machinery, app shell) must revalidate so deploys land.
    if (filePath.includes(`${path.sep}assets${path.sep}`)) res.header("Cache-Control", "public, max-age=31536000, immutable");
    else res.header("Cache-Control", "no-cache");
  } });
  // wildcard:false registers the files that exist at server startup. Vite emits a
  // new content hash on every build, so a build performed while Claudex Workhouse is
  // running would otherwise send the SPA HTML fallback for the new JS/CSS URL
  // and leave the browser on a blank screen until the service is restarted.
  // Browsers request /favicon.ico implicitly. Without this the SPA fallback answers
  // with 200 text/html, which some clients cache as the icon result.
  app.get("/favicon.ico", async (_request, reply) => {
    reply.header("Cache-Control", "no-cache");
    return reply.type("image/png").sendFile("icons/icon-32.png");
  });
  app.get("/assets/*", async (request, reply) => {
    const fileName=String((request.params as Record<string,string>)["*"]??"");
    if(!/^[A-Za-z0-9._-]+$/.test(fileName))return reply.code(404).send();
    return reply.sendFile(`assets/${fileName}`);
  });
  app.get("/*", async (_request, reply) => { reply.header("Cache-Control", "no-cache"); return reply.sendFile("index.html"); });
}

await db.recoverSessionMessages(new Date().toISOString());
const quotaRecoveryAt=new Date().toISOString();
for(const reservation of await db.recoverQuotaTaskReservations(quotaRecoveryAt))if(reservation.status==="failed")void pushManager.notifyQuotaReservation("failed",reservation.id);
const queuePump=setInterval(()=>{void pumpSessionMessageQueue();},1000);queuePump.unref?.();
const creditResumePump=setInterval(()=>{void pumpCreditConsentWaits();void pumpQuotaTaskReservations();},15_000);creditResumePump.unref?.();
const boardAutomationPump=setInterval(()=>{void boardAutomation.tick().catch(error=>app.log.warn({err:sanitizeSensitiveObject(error)},"collaboration board automation tick failed"));},5_000);boardAutomationPump.unref?.();
void pumpQuotaTaskReservations();
const tempStorageSweep=setInterval(()=>{void sweepTempStorage();},TEMP_SWEEP_INTERVAL_MS);tempStorageSweep.unref?.();
const initialTempStorageSweep=setTimeout(()=>{void sweepTempStorage();},30_000);initialTempStorageSweep.unref?.();
let closePromise:Promise<void>|null=null;
const close=()=>closePromise??=(async()=>{clearInterval(queuePump);clearInterval(creditResumePump);clearInterval(boardAutomationPump);clearInterval(tempStorageSweep);clearTimeout(initialTempStorageSweep);runtimeUpdates.close();providerAuth.shutdown();protonDriveLogin.close();managedLocalWorker?.stop();workerHub.shutdown();await Promise.allSettled([pushManager.close(),app.close()]);await Promise.allSettled([db.close(),historyDb.close()]);process.exit(0);})();
process.on("SIGTERM",()=>{void close();});
process.on("SIGINT",()=>{void close();});

await relayArtifacts.purge();
try{await collaboration.recover();}catch(error){featureHealth.collaboration.status="degraded";featureHealth.collaboration.recoveryError=error instanceof Error?error.message:String(error);featureHealth.conversation.status="degraded";await db.appendAudit({createdAt:new Date().toISOString(),actor:"system",action:"collaboration-recovery",provider:null,taskId:null,projectId:null,outcome:"degraded",detail:featureHealth.collaboration.recoveryError}).catch(()=>{});}
void boardAutomation.tick();
await app.listen({ host: config.host, port: config.port });
if(managedLocalWorkerRequired){
  try{
    const prepared=await prepareManagedLocalWorker({
      dataRoot:config.dataRoot,
      installationId,
      serverUrl:`http://127.0.0.1:${config.port}`,
      claudeBinary:config.claudeBinary,
      codexBinary:process.env.CLAUDEX_WORKHOUSE_CODEX_BIN?.trim()||process.env.CODEX_BIN?.trim()||"codex",
      roots:await db.listWorkspaceRoots(LOCAL_HOST_ID),
      workspaces:await db.listWorkspaces({hostId:LOCAL_HOST_ID,includeArchived:true}),
      db
    });
    managedLocalWorkerConfig=prepared.config;
    managedLocalWorker=new DesktopWorkerClient(prepared.config,(state,message)=>{
      if(state==="offline"&&message)app.log.warn({error:sanitizeSensitiveText(message)},"managed local Worker is reconnecting");
    });
    void managedLocalWorker.run().catch(error=>app.log.error({err:sanitizeSensitiveObject(error)},"managed local Worker stopped"));
  }catch(error){
    const current=await db.getHost(MANAGED_LOCAL_WORKER_HOST_ID);
    if(current)await db.upsertHost({...current,status:"offline",updatedAt:new Date().toISOString(),capabilities:{...current.capabilities,managedLocal:true,bootstrapError:sanitizeSensitiveText(error instanceof Error?error.message:String(error))}});
    app.log.error({err:sanitizeSensitiveObject(error)},"managed local Worker bootstrap failed");
  }
}
void pumpSessionMessageQueue();
void pumpCreditConsentWaits();
