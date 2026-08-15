<script lang="ts">
  import { onMount } from "svelte";
  import {
    CheckCircle2,
    CircleAlert,
    CircleHelp,
    Clipboard,
    Computer,
    Download,
    ExternalLink,
    KeyRound,
    Pencil,
    Plus,
    Power,
    RefreshCw,
    Server,
    ShieldCheck,
    Unplug,
    XCircle
  } from "@lucide/svelte";
  import { mergePairingStatus } from "./pairing-state";
  import { formatDateTime, locale, t } from "./i18n";
  import ExternalAccessWizard from "./ExternalAccessWizard.svelte";

  export let api:(path:string,init?:RequestInit)=>Promise<any>;
  export let onopenworkspace:()=>void=()=>{};
  export let onopensettings:(section:string)=>void=()=>{};

  type HostRole="main-server"|"worker";
  type ConnectionStatus="online"|"offline"|"connecting"|"unknown"|"disabled";
  type HealthStatus="healthy"|"warning"|"failed"|"unknown";
  type Host={
    id:string;
    type:"local"|"worker";
    displayName:string;
    platform:string;
    architecture:string;
    workerVersion:string|null;
    status:string;
    connectionStatus?:ConnectionStatus;
    healthStatus?:HealthStatus;
    roles?:HostRole[];
    lastSeenAt:string|null;
    capabilities:Record<string,any>;
    revokedAt:string|null;
    lastDiagnosticAt?:string|null;
    lastHealthCheck?:HealthCheckRun|null;
  };
  type MainServer={
    id?:string;
    displayName?:string;
    deviceName?:string;
    roles?:HostRole[];
    platform?:string;
    operatingSystem?:string;
    operatingSystemVersion?:string;
    architecture?:string;
    version?:string;
    appVersion?:string;
    internalUrl?:string|null;
    externalUrl?:string|null;
    installMethod?:string|null;
    installationMethod?:string|null;
    connectionStatus?:ConnectionStatus;
    healthStatus?:HealthStatus;
    lastDiagnosticAt?:string|null;
    lastHealthCheck?:HealthCheckRun|null;
  };
  type HealthCheckResult={
    key:string;
    label:string;
    status:"passed"|"warning"|"failed"|"skipped";
    summary:string;
    summaryKey?:string;
    summaryParams?:Record<string,string|number>;
    detail?:string;
    remediation?:{
      kind:"retry"|"restart-service"|"rediscover-binary"|"open-settings"|"documentation";
      label:string;
      labelKey?:string;
      safe:boolean;
      payload?:Record<string,unknown>;
    };
  };
  type HealthCheckRun={
    id:string;
    targetType:"server"|"execution-host";
    targetId:string;
    startedAt:string;
    completedAt:string|null;
    overall:HealthStatus;
    checks:HealthCheckResult[];
  };
  type PlanPlatform="synology"|"qnap"|"docker-nas"|"linux";
  type PublicAccess="local-only"|"cloudflare-existing"|"tailscale-existing"|"custom-reverse-proxy";

  let server:MainServer|null=null;
  let hosts:Host[]=[];
  let selectedHost="";
  let loading=false;
  let notice="";
  let healthBusy="";
  let supportBundleBusy=false;
  let healthRun:HealthCheckRun|null=null;
  let executionBackend:any=null;

  let addMode:""|"worker"|"server"="";
  let workerPlatform:"windows"|"linux"="windows";
  let workerArchitecture:"x64"|"arm64"="x64";
  let workerInstaller:any=null;
  let pairing:any=null;
  let pairTimer:ReturnType<typeof setInterval>|null=null;

  let planPlatform:PlanPlatform="synology";
  let planDataPath="/volume1/docker/claudex-workhouse";
  let planServerOrigin="";
  let planPublicAccess:PublicAccess="local-only";
  let planPort=3410;
  let planArchitecture:""|"x64"|"arm64"="";
  let planWorkerRole=true;
  let planAdvanced=false;
  let planBusy=false;
  let planResult:any=null;

  $: selectedHostRecord=hosts.find(item=>item.id===selectedHost);
  $: visibleHealth=healthRun??(selectedHost?selectedHostRecord?.lastHealthCheck??null:server?.lastHealthCheck??null);

  function normalizedConnection(value:unknown):ConnectionStatus{
    return value==="online"||value==="offline"||value==="connecting"||value==="disabled"?value:"unknown";
  }
  function normalizedHealth(value:unknown):HealthStatus{
    return value==="healthy"||value==="warning"||value==="failed"?value:"unknown";
  }
  function normalizeHost(item:any):Host{
    const declaredRoles=Array.isArray(item?.roles)?item.roles.filter((role:unknown):role is HostRole=>role==="main-server"||role==="worker"):[];
    const type=item?.type==="worker"||declaredRoles.length>0&&!declaredRoles.includes("main-server")?"worker":"local";
    const roles:HostRole[]=declaredRoles.length?declaredRoles:(type==="local"?["main-server","worker"]:["worker"]);
    const status=item?.disabledAt?"disabled":String(item?.status??item?.connectionStatus??"unknown");
    return{
      id:String(item?.id??(type==="local"?"local":"")),
      type,
      displayName:String(item?.displayName??item?.deviceName??item?.hostname??item?.id??$t("common.unknown")),
      platform:String(item?.platform??item?.operatingSystem??$t("common.unknown")),
      architecture:String(item?.architecture??$t("common.unknown")),
      workerVersion:item?.workerVersion==null&&item?.appVersion==null?null:String(item.workerVersion??item.appVersion),
      status,
      connectionStatus:normalizedConnection(item?.connectionStatus??item?.status),
      healthStatus:normalizedHealth(item?.healthStatus??item?.health?.overall),
      roles,
      lastSeenAt:typeof item?.lastSeenAt==="string"?item.lastSeenAt:null,
      capabilities:item?.capabilities&&typeof item.capabilities==="object"?item.capabilities:{},
      revokedAt:typeof item?.revokedAt==="string"?item.revokedAt:null,
      lastDiagnosticAt:typeof item?.lastDiagnosticAt==="string"?item.lastDiagnosticAt:null,
      lastHealthCheck:normalizeHealthRun(item?.lastHealthCheck??item?.healthCheck)
    };
  }
  function normalizeHealthRun(value:any):HealthCheckRun|null{
    if(!value||typeof value!=="object")return null;
    const checks=Array.isArray(value.checks)?value.checks.filter((item:any)=>item&&typeof item==="object").map((item:any)=>({
      key:String(item.key??"unknown"),
      label:String(item.label??item.key??$t("common.unknown")),
      status:item.status==="passed"||item.status==="warning"||item.status==="failed"||item.status==="skipped"?item.status:"skipped",
      summary:String(item.summary??item.detail??$t("common.unknown")),
      summaryKey:typeof item.summaryKey==="string"?item.summaryKey:undefined,
      summaryParams:item.summaryParams&&typeof item.summaryParams==="object"?item.summaryParams:undefined,
      detail:typeof item.detail==="string"?item.detail:undefined,
      remediation:item.remediation&&typeof item.remediation==="object"?item.remediation:undefined
    })): [];
    return{
      id:String(value.id??crypto.randomUUID()),
      targetType:value.targetType==="execution-host"?"execution-host":"server",
      targetId:String(value.targetId??"local"),
      startedAt:String(value.startedAt??new Date().toISOString()),
      completedAt:typeof value.completedAt==="string"?value.completedAt:null,
      overall:normalizedHealth(value.overall),
      checks
    };
  }
  function responseHealth(value:any){
    return normalizeHealthRun(value?.run??value?.healthCheck??value);
  }
  function overviewPayload(value:any){
    return value?.overview&&typeof value.overview==="object"?value.overview:value;
  }
  async function load(){
    loading=true;
    notice="";
    try{
      const value=overviewPayload(await api("/api/infrastructure/overview"));
      server=value?.server??value?.mainServer??null;
      let source=value?.executionHosts??value?.hosts;
      if(!Array.isArray(source))source=(await api("/api/hosts")).hosts??[];
      hosts=source.map(normalizeHost).filter((item:Host)=>item.id);
      if(server&&server.roles?.includes("worker")&&!hosts.some(item=>item.id===(server?.id??"local"))){
        hosts=[normalizeHost({
          id:server.id??"local",
          type:"local",
          displayName:server.displayName??server.deviceName,
          roles:server.roles,
          platform:server.platform??server.operatingSystem,
          architecture:server.architecture,
          appVersion:server.appVersion??server.version,
          status:"online",
          connectionStatus:server.connectionStatus??"online",
          healthStatus:server.healthStatus,
          lastDiagnosticAt:server.lastDiagnosticAt
        }),...hosts];
      }
      if(!hosts.some(item=>item.id===selectedHost))selectedHost=hosts.find(item=>item.type==="local")?.id??hosts[0]?.id??"";
      if(!server){
        const local=hosts.find(item=>item.type==="local");
        server=local?{
          id:local.id,
          displayName:local.displayName,
          roles:local.roles,
          platform:local.platform,
          architecture:local.architecture,
          version:local.workerVersion??undefined,
          connectionStatus:local.connectionStatus,
          healthStatus:local.healthStatus
        }:null;
      }
      await loadExecutionBackend();
    }catch(error){
      notice=error instanceof Error?error.message:String(error);
    }finally{
      loading=false;
    }
  }
  async function loadExecutionBackend(){
    executionBackend=null;
    if(!selectedHost)return;
    try{executionBackend=await api(`/api/hosts/${encodeURIComponent(selectedHost)}/execution-backend`);}catch{}
  }
  async function chooseHost(id:string){
    selectedHost=id;
    healthRun=null;
    await loadExecutionBackend();
  }
  async function runServerHealth(){
    healthBusy="server";
    notice="";
    try{
      healthRun=responseHealth(await api("/api/infrastructure/health/server",{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:"{}"}));
      if(server&&healthRun)server={...server,healthStatus:healthRun.overall,lastHealthCheck:healthRun};
    }catch(error){notice=error instanceof Error?error.message:String(error)}
    finally{healthBusy="";}
  }
  async function runHostHealth(hostId=selectedHost){
    if(!hostId)return;
    healthBusy=hostId;
    notice="";
    try{
      const run=responseHealth(await api(`/api/infrastructure/health/hosts/${encodeURIComponent(hostId)}`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:"{}"}));
      healthRun=run;
      if(run)hosts=hosts.map(item=>item.id===hostId?{...item,healthStatus:run.overall,lastHealthCheck:run}:item);
    }catch(error){notice=error instanceof Error?error.message:String(error)}
    finally{healthBusy="";}
  }
  function remediationAvailable(item:HealthCheckResult){
    if(item.remediation?.safe!==true)return false;
    if(item.remediation.kind==="retry"||item.remediation.kind==="open-settings")return true;
    if(item.remediation.kind==="documentation"){
      const url=item.remediation.payload?.url;
      return typeof url==="string"&&(url.startsWith("https://")||url.startsWith("/"));
    }
    return typeof item.remediation.payload?.endpoint==="string"
      && String(item.remediation.payload.endpoint).startsWith("/api/infrastructure/");
  }
  async function applyRemediation(item:HealthCheckResult){
    const action=item.remediation;
    if(!action||!remediationAvailable(item))return;
    if(action.kind==="retry"){
      const target=visibleHealth;
      if(target?.targetType==="execution-host")await runHostHealth(target.targetId);
      else await runServerHealth();
      return;
    }
    if(action.kind==="open-settings"){
      const section=String(action.payload?.section??"infrastructure");
      if(section==="workspace")onopenworkspace();
      else onopensettings(section);
      return;
    }
    if(action.kind==="documentation"){
      window.open(String(action.payload?.url),"_blank","noopener,noreferrer");
      return;
    }
    const endpoint=String(action.payload?.endpoint??"");
    healthBusy=`action:${item.key}`;
    try{
      await api(endpoint,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify(action.payload?.body??{})});
      const target=visibleHealth;
      if(target?.targetType==="execution-host")await runHostHealth(target.targetId);
      else await runServerHealth();
    }catch(error){notice=error instanceof Error?error.message:String(error)}
    finally{healthBusy="";}
  }

  async function renameHost(item:Host){
    const displayName=prompt($t("host.displayName"),item.displayName)?.trim();
    if(!displayName||displayName===item.displayName)return;
    try{
      await api(`/api/hosts/${encodeURIComponent(item.id)}`,{method:"PATCH",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({displayName})});
      await load();
    }catch(error){notice=error instanceof Error?error.message:String(error)}
  }
  async function rotateCredential(item:Host){
    if(item.type!=="worker"||!confirm($t("host.rotateCredentialConfirm",{name:item.displayName})))return;
    try{
      await api(`/api/hosts/${encodeURIComponent(item.id)}/credential/rotate`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({confirm:true})});
      notice=$t("host.credentialRotated");
      await load();
    }catch(error){notice=error instanceof Error?error.message:String(error)}
  }
  async function toggleHost(item:Host){
    if(item.type!=="worker")return;
    const disabled=item.status!=="disabled";
    if(!confirm($t(disabled?"host.disableConfirm":"host.enableConfirm",{name:item.displayName})))return;
    try{
      await api(`/api/hosts/${encodeURIComponent(item.id)}/disable`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({disabled,confirm:true})});
      await load();
    }catch(error){notice=error instanceof Error?error.message:String(error)}
  }
  async function revoke(item:Host){
    if(item.type!=="worker"||!confirm($t("host.revokeConfirm",{name:item.displayName})))return;
    try{
      await api(`/api/hosts/${encodeURIComponent(item.id)}/revoke`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({confirm:true})});
      await load();
    }catch(error){notice=error instanceof Error?error.message:String(error)}
  }
  async function toggleTrustedAuto(){
    if(selectedHost!=="local")return;
    const enabled=!executionBackend?.trustedHost?.enabled;
    if(enabled&&!confirm($t("host.trustedAutoConfirm")))return;
    try{
      await api(`/api/hosts/${encodeURIComponent(selectedHost)}/trusted-auto`,{method:"PUT",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({enabled,provider:"codex",confirmNoSandbox:true,version:1})});
      await loadExecutionBackend();
      notice=$t(enabled?"host.trustedAutoEnabled":"host.trustedAutoDisabled");
    }catch(error){notice=error instanceof Error?error.message:String(error)}
  }
  async function reprobeSandbox(){
    if(selectedHost!=="local")return;
    try{
      const data=await api(`/api/hosts/${encodeURIComponent(selectedHost)}/execution-backend/reprobe`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({confirm:true})});
      executionBackend={...executionBackend,nativeSandbox:data.nativeSandbox};
      notice=$t("host.sandboxReprobed");
    }catch(error){notice=error instanceof Error?error.message:String(error)}
  }

  async function startPairing(){
    try{
      const result=await api("/api/hosts/pairings",{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:"{}"});
      pairing=result.pairing;
      workerInstaller=null;
      await loadWorkerInstaller();
      if(pairTimer)clearInterval(pairTimer);
      pairTimer=setInterval(()=>void pollPairing(),2000);
    }catch(error){notice=error instanceof Error?error.message:String(error)}
  }
  async function loadWorkerInstaller(){
    if(!pairing?.code)return;
    try{
      workerInstaller=await api("/api/deployment/worker-instructions",{
        method:"POST",
        headers:{"Idempotency-Key":crypto.randomUUID()},
        body:JSON.stringify({
          platform:workerPlatform,
          architecture:workerPlatform==="windows"?"x64":workerArchitecture,
          installMethod:workerPlatform==="windows"?"powershell-worker":"shell-worker",
          pairingCode:pairing.code
        })
      });
    }catch(error){
      workerInstaller=null;
      if((error as any)?.code!=="WORKER_PACKAGE_METADATA_REQUIRED"){
        notice=error instanceof Error?error.message:String(error);
      }
    }
  }
  async function pollPairing(){
    const current=pairing;
    if(!current)return;
    try{
      const next=(await api(`/api/hosts/pairings/${encodeURIComponent(current.id)}`)).pairing;
      if(pairing?.id!==current.id)return;
      pairing=mergePairingStatus(current,next);
      if(pairing.status!=="waiting"){
        if(pairTimer)clearInterval(pairTimer);
        pairTimer=null;
        if(pairing.status==="paired")await load();
      }
    }catch{}
  }
  function pairCommand(){
    if(!pairing?.code)return"";
    return `claudex-workhouse-worker pair --url ${location.origin} --code ${pairing.code}`;
  }
  function workerInstallCommand(){
    return typeof workerInstaller?.installScript==="string"&&workerInstaller.installScript.trim()
      ?workerInstaller.installScript
      :pairCommand();
  }
  function verifiedWorkerDownload(){
    const value=workerInstaller?.verifiedDownload;
    if(
      workerPlatform!=="windows"||
      value?.url!=="/api/worker-package/windows"||
      typeof value.fileName!=="string"||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.zip$/.test(value.fileName)||
      !Number.isSafeInteger(value.size)||
      value.size<1||
      typeof value.sha256!=="string"||
      !/^[a-f0-9]{64}$/.test(value.sha256)
    )return null;
    return value as{url:string;fileName:string;size:number;sha256:string};
  }
  async function copy(value:string){
    await navigator.clipboard.writeText(value);
    notice=$t("common.copied");
  }
  async function downloadSupportBundle(){
    supportBundleBusy=true;
    notice="";
    try{
      const response=await api("/api/infrastructure/support-bundle");
      const bundle=response?.bundle;
      if(
        !bundle||
        typeof bundle!=="object"||
        bundle.type!=="claudex-workhouse-support-bundle"||
        bundle.schemaVersion!==1
      )throw new Error($t("infrastructure.supportBundleInvalid"));
      const blob=new Blob([`${JSON.stringify(bundle,null,2)}\n`],{type:"application/json"});
      const url=URL.createObjectURL(blob);
      const anchor=document.createElement("a");
      const date=typeof bundle.generatedAt==="string"&&/^\d{4}-\d{2}-\d{2}/.test(bundle.generatedAt)
        ?bundle.generatedAt.slice(0,10)
        :new Date().toISOString().slice(0,10);
      anchor.href=url;
      anchor.download=`claudex-workhouse-support-${date}.json`;
      anchor.click();
      setTimeout(()=>URL.revokeObjectURL(url),0);
      notice=$t("infrastructure.supportBundleReady");
    }catch(error){
      notice=error instanceof Error?error.message:String(error);
    }finally{
      supportBundleBusy=false;
    }
  }

  function dataPathFor(platform:PlanPlatform){
    if(platform==="synology")return"/volume1/docker/claudex-workhouse";
    if(platform==="qnap")return"/share/Container/claudex-workhouse";
    if(platform==="docker-nas")return"/srv/claudex-workhouse";
    return"/opt/claudex-workhouse";
  }
  function choosePlanPlatform(platform:PlanPlatform){
    planPlatform=platform;
    planDataPath=dataPathFor(platform);
    planResult=null;
  }
  function privateNetworkOriginHost(hostname:string){
    const value=hostname.toLowerCase();
    if(!value.includes(".")||value.endsWith(".local"))return true;
    const octets=value.split(".").map(Number);
    return octets.length===4&&octets.every(part=>Number.isInteger(part)&&part>=0&&part<=255)
      &&(octets[0]===10||(octets[0]===172&&octets[1]>=16&&octets[1]<=31)||(octets[0]===192&&octets[1]===168));
  }
  function planServerOriginIssue(){
    const value=planServerOrigin.trim();
    if(!value)return"infrastructure.serverOriginRequired";
    try{
      const url=new URL(value);
      if(!["http:","https:"].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=="/")return"infrastructure.serverOriginInvalid";
      const hostname=url.hostname.toLowerCase();
      if(["localhost","127.0.0.1","0.0.0.0","[::1]","::1"].includes(hostname))return"infrastructure.serverOriginReachable";
      if(url.protocol==="http:"&&planPublicAccess==="local-only"&&!privateNetworkOriginHost(hostname))return"infrastructure.serverOriginPrivateHttp";
      if(planPublicAccess!=="local-only"&&url.protocol!=="https:")return"infrastructure.serverOriginHttps";
      return"";
    }catch{return"infrastructure.serverOriginInvalid";}
  }
  function normalizedServerOrigin(){try{return new URL(planServerOrigin.trim()).origin}catch{return planServerOrigin.trim()}}
  async function createPlan(){
    if(!planDataPath.trim()||planServerOriginIssue()||!Number.isInteger(planPort)||planPort<1024||planPort>65535)return;
    planBusy=true;
    notice="";
    planResult=null;
    try{
      planResult=await api("/api/deployment/plans",{
        method:"POST",
        headers:{"Idempotency-Key":crypto.randomUUID()},
        body:JSON.stringify({
          target:"main-server",
          platform:planPlatform,
          architecture:planArchitecture||undefined,
          installMethod:"docker-compose",
          roles:planWorkerRole?["main-server","worker"]:["main-server"],
          dataPath:planDataPath.trim(),
          port:planPort,
          publicAccess:planPublicAccess,
          serverOrigin:normalizedServerOrigin()
        })
      });
    }catch(error){
      notice=error&&typeof error==="object"&&(error as any).code==="RELEASE_METADATA_REQUIRED"
        ?$t("infrastructure.releaseMetadataRequired")
        :error instanceof Error?error.message:String(error);
    }
    finally{planBusy=false;}
  }
  function generatedPlan(){return planResult?.plan??planResult?.deploymentPlan??null}
  function generatedBundle(){return planResult?.artifacts??planResult?.bundle??planResult?.installer??planResult??null}
  function generatedCommand(){
    const bundle=generatedBundle();
    return String(bundle?.installCommand??bundle?.command??planResult?.installCommand??"");
  }
  function generatedDownload(){
    const bundle=generatedBundle();
    const value=bundle?.downloadUrl??bundle?.bundleUrl??planResult?.downloadUrl;
    return typeof value==="string"&&value.startsWith("/")?value:"";
  }
  function generatedArchive(){
    const value=generatedBundle()?.archive??planResult?.archive;
    if(!value||typeof value!=="object")return null;
    if(value.encoding!=="base64"||value.mediaType!=="application/gzip")return null;
    if(typeof value.content!=="string"||value.content.length>4_000_000||!/^[A-Za-z0-9+/]*={0,2}$/.test(value.content))return null;
    if(typeof value.fileName!=="string"||!/^[A-Za-z0-9._-]+\.tar\.gz$/.test(value.fileName))return null;
    return value as{fileName:string;mediaType:string;content:string;sha256?:string};
  }
  function generatedFileSource(){
    const bundle=generatedBundle();
    if(Array.isArray(bundle))return bundle;
    return bundle?.files??bundle?.artifacts??planResult?.files??[];
  }
  function generatedFiles(){
    const source=generatedFileSource();
    if(Array.isArray(source))return source.map(item=>typeof item==="string"?item:String(item?.name??item?.path??"")).filter(Boolean);
    if(source&&typeof source==="object")return Object.keys(source);
    return[];
  }
  function generatedFileContent(name:string){
    const source=generatedFileSource();
    if(Array.isArray(source)){
      const item=source.find(value=>value&&typeof value==="object"&&String(value.name??value.path??"")===name);
      return typeof item?.content==="string"?item.content:null;
    }
    if(source&&typeof source==="object"){
      const value=source[name];
      return typeof value==="string"?value:typeof value?.content==="string"?value.content:null;
    }
    return null;
  }
  function generatedFileDigest(name:string){
    const source=generatedFileSource();
    if(Array.isArray(source)){
      const item=source.find(value=>value&&typeof value==="object"&&String(value.name??value.path??"")===name);
      return typeof item?.sha256==="string"?item.sha256:"";
    }
    const value=source&&typeof source==="object"?source[name]:null;
    return value&&typeof value==="object"&&typeof value.sha256==="string"?value.sha256:"";
  }
  function downloadGeneratedFile(name:string){
    const content=generatedFileContent(name);
    if(content===null)return;
    const url=URL.createObjectURL(new Blob([content],{type:"text/plain;charset=utf-8"}));
    const anchor=document.createElement("a");
    anchor.href=url;
    anchor.download=name.split(/[\\/]/).pop()||"claudex-install.txt";
    anchor.click();
    setTimeout(()=>URL.revokeObjectURL(url),0);
  }
  function downloadGeneratedBundle(){
    const direct=generatedDownload();
    if(direct){
      const anchor=document.createElement("a");
      anchor.href=direct;
      anchor.click();
      return;
    }
    const archive=generatedArchive();
    if(!archive)return;
    const binary=atob(archive.content),bytes=new Uint8Array(binary.length);
    for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);
    const url=URL.createObjectURL(new Blob([bytes],{type:archive.mediaType}));
    const anchor=document.createElement("a");
    anchor.href=url;
    anchor.download=archive.fileName;
    anchor.click();
    setTimeout(()=>URL.revokeObjectURL(url),0);
  }
  function verificationRows(){
    const source=generatedBundle()?.verification??planResult?.verification??planResult?.release??{};
    const archive=generatedArchive();
    return[
      [$t("infrastructure.imageDigest"),source.imageDigest??source.imageReference??generatedPlan()?.imageDigest],
      [$t("infrastructure.artifactDigest"),archive?.sha256??source.artifactDigest],
      [$t("infrastructure.manifestSignature"),source.manifestSignature??source.signature??source.manifestSha256],
      [$t("infrastructure.signingFingerprint"),source.signingPublicKeySha256]
    ].filter((row):row is [string,string]=>typeof row[1]==="string"&&Boolean(row[1]));
  }
  function roleLabel(role:HostRole){return $t(role==="main-server"?"infrastructure.role.mainServer":"infrastructure.role.worker")}
  function rolesLabel(roles:HostRole[]|undefined){const values:HostRole[]=roles?.length?roles:["worker"];return values.map(roleLabel).join(" + ")}
  function connectionLabel(status:unknown){return $t(`infrastructure.connection.${normalizedConnection(status)}`)}
  function healthLabel(status:unknown){return $t(`infrastructure.health.${normalizedHealth(status)}`)}
  function checkStatusLabel(status:HealthCheckResult["status"]){return $t(`infrastructure.check.${status}`)}
  const localizedHealthCheckKeys=new Set([
    "server.process","server.http-health","database.ping","database.quick-check","database.worker",
    "storage.data-writable","storage.spool-writable","storage.free","server.version",
    "server.install-method","server.internal-url","server.external-url","server.external-connectivity",
    "server.external-sse","server.external-websocket","transport.sse","transport.websocket",
    "server.owner-claim","worker.local","workspace.access","worker.connection","worker.protocol",
    "worker.version","worker.platform","runtime.claude","runtime.codex","provider.claude.auth",
    "provider.codex.auth","tool.git","tool.github-cli","worker.spool","worker.storage.free",
    "worker.recent-tasks","worker.execution-ready"
  ]);
  function checkLabel(item:HealthCheckResult){
    return localizedHealthCheckKeys.has(item.key)
      ?$t(`infrastructure.healthCheck.${item.key}` as any)
      :item.label;
  }
  // Diagnostics ship a dictionary key per summary and remediation label. Runs stored
  // before those keys existed keep their literal text, which is Korean for old rows.
  function checkSummary(item:HealthCheckResult){
    if(item.summaryKey)return $t(item.summaryKey as any,item.summaryParams);
    return item.summary||$t(`infrastructure.checkSummary.${item.status}` as any);
  }
  function remediationLabel(item:NonNullable<HealthCheckResult["remediation"]>){
    if(item.labelKey)return $t(item.labelKey as any);
    return item.label||$t(`infrastructure.remediation.${item.kind}` as any);
  }
  function checkIcon(status:HealthCheckResult["status"]){
    return status==="passed"?CheckCircle2:status==="failed"?XCircle:status==="warning"?CircleAlert:CircleHelp;
  }

  onMount(()=>{
    void load();
    return()=>{
      if(pairTimer)clearInterval(pairTimer);
    };
  });
</script>

<section class="infrastructure-settings" aria-labelledby="infrastructure-title">
  <div class="section-heading">
    <span>
      <h3 id="infrastructure-title">{$t("infrastructure.title")}</h3>
      <small>{$t("infrastructure.body")}</small>
    </span>
    <button type="button" disabled={loading} onclick={load}><RefreshCw size={15} class={loading?"spin":""}/>{$t("common.refresh")}</button>
  </div>

  {#if server}
    <article class="main-server-card">
      <header>
        <Server size={22}/>
        <span><strong>{server.displayName??server.deviceName??$t("infrastructure.mainServer")}</strong><small>{rolesLabel(server.roles?.length?server.roles:["main-server"])}</small></span>
        <div class="status-pair">
          <em class="connection {normalizedConnection(server.connectionStatus??"online")}">{connectionLabel(server.connectionStatus??"online")}</em>
          <em class="health {normalizedHealth(server.healthStatus)}">{healthLabel(server.healthStatus)}</em>
        </div>
      </header>
      <dl>
        <div><dt>{$t("infrastructure.operatingSystem")}</dt><dd>{server.operatingSystem??server.platform??$t("common.unknown")}{server.operatingSystemVersion?` · ${server.operatingSystemVersion}`:""}</dd></div>
        <div><dt>{$t("infrastructure.architecture")}</dt><dd>{server.architecture??$t("common.unknown")}</dd></div>
        <div><dt>{$t("infrastructure.appVersion")}</dt><dd>{server.appVersion??server.version??$t("common.unknown")}</dd></div>
        <div><dt>{$t("infrastructure.installMethod")}</dt><dd>{server.installationMethod??server.installMethod??$t("common.unknown")}</dd></div>
        <div><dt>{$t("infrastructure.lastDiagnostic")}</dt><dd>{server.lastDiagnosticAt?formatDateTime(server.lastDiagnosticAt,$locale):$t("common.none")}</dd></div>
        <div><dt>{$t("infrastructure.internalAddress")}</dt><dd title={server.internalUrl??""}>{server.internalUrl??$t("common.none")}</dd></div>
        <div><dt>{$t("infrastructure.externalAddress")}</dt><dd title={server.externalUrl??""}>{server.externalUrl??$t("infrastructure.notConfigured")}</dd></div>
      </dl>
      <div class="card-actions">
        <button type="button" disabled={Boolean(healthBusy)} onclick={runServerHealth}><ShieldCheck size={15}/>{$t(healthBusy==="server"?"infrastructure.diagnosing":"infrastructure.runDiagnostics")}</button>
        <button type="button" disabled={supportBundleBusy||Boolean(healthBusy)} onclick={downloadSupportBundle}><Download size={15}/>{$t(supportBundleBusy?"infrastructure.supportBundlePreparing":"infrastructure.downloadSupportBundle")}</button>
      </div>
    </article>
  {:else if !loading}
    <p class="empty-small">{$t("infrastructure.serverUnavailable")}</p>
  {/if}

  <ExternalAccessWizard {api}/>


  <div class="section-heading devices-heading">
    <span><h3>{$t("infrastructure.executionDevices")}</h3><small>{$t("infrastructure.executionDevicesBody")}</small></span>
    <button type="button" onclick={()=>{addMode=addMode?"":"worker";pairing=null;planResult=null;}}>{#if addMode}<XCircle size={15}/>{:else}<Plus size={15}/>{/if}{$t(addMode?"common.close":"infrastructure.addDevice")}</button>
  </div>

  <div class="host-grid">
    {#each hosts as item}
      <button type="button" class="host-card" class:selected={selectedHost===item.id} onclick={()=>void chooseHost(item.id)}>
        <Computer size={20}/>
        <span><strong>{item.displayName}</strong><small>{rolesLabel(item.roles)} · {item.platform} · {item.architecture}{item.workerVersion?` · ${item.workerVersion}`:""}</small>{#if item.lastDiagnosticAt}<small>{$t("infrastructure.lastDiagnostic")} · {formatDateTime(item.lastDiagnosticAt,$locale)}</small>{/if}</span>
        <span class="status-pair">
          <em class="connection {normalizedConnection(item.connectionStatus??item.status)}">{connectionLabel(item.connectionStatus??item.status)}</em>
          <em class="health {normalizedHealth(item.healthStatus)}">{healthLabel(item.healthStatus)}</em>
        </span>
      </button>
    {/each}
    {#if !hosts.length&&!loading}<p class="empty-small">{$t("infrastructure.noExecutionDevices")}</p>{/if}
  </div>

  {#if addMode}
    <section class="add-device-panel">
      <div class="choice-grid">
        <button type="button" class:active={addMode==="worker"} onclick={()=>{addMode="worker";planResult=null;}}><Computer size={20}/><span><strong>{$t("infrastructure.connectWorker")}</strong><small>{$t("infrastructure.connectWorkerBody")}</small></span></button>
        <button type="button" class:active={addMode==="server"} onclick={()=>{addMode="server";pairing=null;}}><Server size={20}/><span><strong>{$t("infrastructure.installServer")}</strong><small>{$t("infrastructure.installServerBody")}</small></span></button>
      </div>

      {#if addMode==="worker"}
        <div class="worker-flow">
          <h4>{$t("infrastructure.workerPlatform")}</h4>
          <div class="segments">
            <button type="button" class:active={workerPlatform==="windows"} onclick={()=>{workerPlatform="windows";workerArchitecture="x64";void loadWorkerInstaller();}}>{$t("infrastructure.platform.windows")}</button>
            <button type="button" class:active={workerPlatform==="linux"} onclick={()=>{workerPlatform="linux";void loadWorkerInstaller();}}>{$t("infrastructure.platform.linux")}</button>
          </div>
          {#if workerPlatform==="linux"}<label>{$t("infrastructure.architecture")}<select bind:value={workerArchitecture} onchange={()=>void loadWorkerInstaller()}><option value="x64">{$t("infrastructure.architecture.x64")}</option><option value="arm64">{$t("infrastructure.architecture.arm64")}</option></select></label>{/if}
          <p>{$t(workerPlatform==="windows"?"infrastructure.windowsWorkerBody":"infrastructure.linuxWorkerBody")}</p>
          {#if !pairing}<button type="button" class="primary" onclick={startPairing}><KeyRound size={15}/>{$t("infrastructure.createPairing")}</button>{/if}
          {#if pairing}
            <div class="pairing" aria-live="polite">
              <strong>{$t(pairing.status==="waiting"?"host.pairing.enterCode":pairing.status==="paired"?"host.pairing.connected":"host.pairing.expired")}</strong>
              {#if pairing.status==="waiting"}
                {@const workerDownload=verifiedWorkerDownload()}
                <code class="pair-code">{pairing.code||$t("host.pairing.regenerate")}</code>
                <div class="pair-actions">
                  {#if workerDownload}<a class="worker-download" href={workerDownload.url} download={workerDownload.fileName}><Download size={14}/>{$t("host.pairing.downloadWindows")}</a>{/if}
                  <button type="button" disabled={!pairing.code} onclick={()=>copy(pairing.code)}><Clipboard size={14}/>{$t("host.pairing.copyCode")}</button>
                </div>
                <div class="install-command">
                  <strong>{$t(workerInstaller?"infrastructure.installCommand":workerPlatform==="linux"?"infrastructure.linuxCommand":"infrastructure.workerCommand")}</strong>
                  <code>{workerInstallCommand()}</code>
                  <button type="button" disabled={!workerInstallCommand()} onclick={()=>copy(workerInstallCommand())}><Clipboard size={14}/>{$t("host.pairing.copyCommand")}</button>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {:else}
        <form class="deployment-form" onsubmit={(event)=>{event.preventDefault();void createPlan();}}>
          <h4>{$t("infrastructure.installServer")}</h4>
          <fieldset>
            <legend>{$t("infrastructure.platform")}</legend>
            <div class="platform-grid">
              {#each ["synology","qnap","docker-nas","linux"] as value}
                <button type="button" class:active={planPlatform===value} onclick={()=>choosePlanPlatform(value as PlanPlatform)}>{$t(`infrastructure.platform.${value}`)}</button>
              {/each}
            </div>
          </fieldset>
          <label>{$t("infrastructure.dataPath")}<input bind:value={planDataPath} maxlength="1024" autocomplete="off" spellcheck="false"/></label>
          <label>{$t("infrastructure.publicAccess")}<select bind:value={planPublicAccess}><option value="local-only">{$t("infrastructure.publicAccess.local")}</option><option value="cloudflare-existing">{$t("infrastructure.publicAccess.cloudflare")}</option><option value="tailscale-existing">{$t("infrastructure.publicAccess.tailscale")}</option><option value="custom-reverse-proxy">{$t("infrastructure.publicAccess.custom")}</option></select></label>
          <label>{$t("infrastructure.targetServerOrigin")}<input type="url" bind:value={planServerOrigin} maxlength="2048" inputmode="url" autocomplete="off" spellcheck="false" placeholder={$t("infrastructure.targetServerOriginPlaceholder")} aria-invalid={Boolean(planServerOriginIssue())}/><small>{$t(`infrastructure.serverOriginHelp.${planPublicAccess}`)}</small>{#if planServerOriginIssue()}<small class="field-error">{$t(planServerOriginIssue())}</small>{/if}</label>
          <label class="role-choice"><input type="checkbox" bind:checked={planWorkerRole}/><span><strong>{$t("infrastructure.localWorkerRole")}</strong><small>{$t("infrastructure.localWorkerRoleBody")}</small></span></label>
          <details bind:open={planAdvanced}><summary>{$t("infrastructure.advanced")}</summary><div class="advanced-grid"><label>{$t("infrastructure.port")}<input type="number" min="1024" max="65535" bind:value={planPort}/></label><label>{$t("infrastructure.architecture")}<select bind:value={planArchitecture}><option value="">{$t("infrastructure.autoDetect")}</option><option value="x64">{$t("infrastructure.architecture.x64")}</option><option value="arm64">{$t("infrastructure.architecture.arm64")}</option></select></label></div></details>
          <button class="primary" disabled={planBusy||!planDataPath.trim()||Boolean(planServerOriginIssue())||!Number.isInteger(planPort)||planPort<1024||planPort>65535}>{$t(planBusy?"infrastructure.generatingPlan":"infrastructure.generatePlan")}</button>
        </form>
        {#if planResult}
          <article class="plan-result">
            <header><CheckCircle2 size={20}/><span><strong>{$t("infrastructure.planReady")}</strong><small>{generatedPlan()?.platform??planPlatform} · {generatedPlan()?.installMethod??"docker-compose"}</small></span></header>
            {#if generatedFiles().length}<div><strong>{$t("infrastructure.generatedFiles")}</strong><ul>{#each generatedFiles() as file}<li><code>{file}</code>{#if generatedFileDigest(file)}<small title={generatedFileDigest(file)}>{$t("infrastructure.sha256")} · {generatedFileDigest(file).slice(0,12)}</small>{/if}{#if generatedFileContent(file)!==null}<button type="button" onclick={()=>downloadGeneratedFile(file)} aria-label={$t("infrastructure.downloadFile",{name:file})}><Download size={13}/></button>{/if}</li>{/each}</ul></div>{/if}
            {#if generatedCommand()}<div class="install-command"><strong>{$t("infrastructure.installCommand")}</strong><code>{generatedCommand()}</code><button type="button" onclick={()=>copy(generatedCommand())}><Clipboard size={14}/>{$t("common.copy")}</button></div>{/if}
            {#if verificationRows().length}<dl class="verification">{#each verificationRows() as row}<div><dt>{row[0]}</dt><dd title={row[1]}>{row[1]}</dd></div>{/each}</dl>{/if}
            {#if generatedDownload()||generatedArchive()}<button type="button" class="worker-download primary-link" onclick={downloadGeneratedBundle}><Download size={15}/>{$t("infrastructure.downloadBundle")}</button>{/if}
            <p><ShieldCheck size={15}/>{$t("infrastructure.noRemoteAdmin")}</p>
          </article>
        {/if}
      {/if}
    </section>
  {/if}

  {#if selectedHostRecord}
    <div class="host-actions">
      <button type="button" disabled={Boolean(healthBusy)} onclick={()=>runHostHealth()}><ShieldCheck size={15}/>{$t(healthBusy===selectedHost?"infrastructure.diagnosing":"infrastructure.runDiagnostics")}</button>
      <button type="button" onclick={()=>renameHost(selectedHostRecord!)}><Pencil size={15}/>{$t("host.rename")}</button>
      {#if selectedHostRecord.type==="worker"}
        <button type="button" onclick={()=>rotateCredential(selectedHostRecord!)} disabled={selectedHostRecord.status!=="online"}><KeyRound size={15}/>{$t("host.rotateCredential")}</button>
        <button type="button" onclick={()=>toggleHost(selectedHostRecord!)}><Power size={15}/>{$t(selectedHostRecord.status==="disabled"?"host.enable":"host.disable")}</button>
        <button type="button" class="danger-lite" onclick={()=>revoke(selectedHostRecord!)}><Unplug size={15}/>{$t("host.disconnect")}</button>
      {/if}
    </div>
    {#if executionBackend}
      <article class="sandbox-state">
        <strong>{$t(executionBackend.nativeSandbox?.status==="native-supported"?"host.sandbox.native":executionBackend.trustedHost?.enabled?"host.sandbox.trusted":"host.sandbox.disabled")}</strong>
        <small>{$t("host.nativeSandbox")}: {executionBackend.nativeSandbox?.status??$t("host.sandbox.notChecked")}{executionBackend.nativeSandbox?.reason?` · ${executionBackend.nativeSandbox.reason}`:""}{executionBackend.nativeSandbox?.checkedAt?` · ${formatDateTime(executionBackend.nativeSandbox.checkedAt,$locale)}`:""}</small>
        {#if selectedHost==="local"}<div><button type="button" onclick={reprobeSandbox}><RefreshCw size={14}/>{$t("host.reprobe")}</button>{#if executionBackend.nativeSandbox?.status!=="native-supported"}<button type="button" class:danger-lite={executionBackend.trustedHost?.enabled} onclick={toggleTrustedAuto}>{$t(executionBackend.trustedHost?.enabled?"host.trustedAutoRevoke":"host.trustedAutoActivate")}</button>{/if}</div>{/if}
      </article>
    {/if}
  {/if}

  {#if visibleHealth}
    <section class="health-panel" aria-labelledby="health-title">
      <header><span><h4 id="health-title">{$t("infrastructure.diagnosticResults")}</h4><small>{visibleHealth.completedAt?formatDateTime(visibleHealth.completedAt,$locale):$t("infrastructure.diagnosing")}</small></span><em class="health {visibleHealth.overall}">{healthLabel(visibleHealth.overall)}</em></header>
      <div class="check-list">
        {#each visibleHealth.checks as item}
          {@const Icon=checkIcon(item.status)}
          <article class="check-card {item.status}">
            <Icon size={19}/>
            <span><strong>{checkLabel(item)}</strong><em>{checkStatusLabel(item.status)}</em><p>{checkSummary(item)}</p>{#if item.detail}<small>{item.detail}</small>{/if}</span>
            {#if remediationAvailable(item)&&item.remediation}<button type="button" disabled={Boolean(healthBusy)} onclick={()=>applyRemediation(item)}>{remediationLabel(item.remediation)}{#if item.remediation.kind==="documentation"}<ExternalLink size={13}/>{/if}</button>{/if}
          </article>
        {/each}
        {#if !visibleHealth.checks.length}<p class="empty-small">{$t("infrastructure.noDiagnosticChecks")}</p>{/if}
      </div>
    </section>
  {/if}

  {#if notice}<p class="infrastructure-notice" aria-live="polite">{notice}</p>{/if}
</section>

<style>
  .infrastructure-settings{container-type:inline-size;display:grid;gap:.85rem;padding-bottom:.5rem}.section-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:.7rem}.section-heading h3{margin:0}.section-heading small{display:block;color:var(--muted);margin-top:.2rem}.section-heading button, .card-actions button, .host-actions button, .pairing button, .check-card button, .worker-download{display:inline-flex;align-items:center;gap:.35rem}.main-server-card, .add-device-panel, .health-panel, .plan-result, .sandbox-state{display:grid;gap:.7rem;padding:.8rem;border:1px solid var(--line);border-radius:14px;background:var(--panel)}.main-server-card>header, .plan-result>header, .health-panel>header{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:.65rem}.main-server-card header span, .plan-result header span{display:grid;min-width:0}.main-server-card small, .plan-result small, .health-panel small{color:var(--muted)}.main-server-card dl, .verification{display:grid;grid-template-columns:1fr 1fr;gap:.4rem;margin:0}.main-server-card dl div, .verification div{display:grid;gap:.12rem;min-width:0;padding:.45rem;border-radius:9px;background:var(--bg)}dt{font-size:.7rem;color:var(--muted)}dd{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.status-pair{display:flex!important;align-items:flex-end;gap:.25rem}.status-pair em, .health-panel>header>em{padding:.22rem .45rem;border-radius:999px;font-size:.68rem;font-style:normal;white-space:nowrap;background:var(--bg);color:var(--muted)}em.connection.online, em.health.healthy{color:var(--good)}em.connection.connecting, em.health.warning{color:var(--warn)}em.connection.offline, em.connection.disabled, em.health.failed{color:var(--danger)}.card-actions, .host-actions, .pair-actions{display:flex;gap:.5rem;flex-wrap:wrap}.devices-heading{margin-top:.35rem}.host-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:.55rem}.host-grid.compact{grid-template-columns:1fr}.host-card{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:.65rem;text-align:left;padding:.75rem;border:1px solid var(--line);border-radius:13px;background:var(--panel)}.host-card.selected{border-color:var(--accent)}.host-card>span{min-width:0;display:grid;gap:.12rem}.host-card small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)}.choice-grid{display:grid;grid-template-columns:1fr 1fr;gap:.55rem}.choice-grid>button{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:.55rem;text-align:left;padding:.7rem}.choice-grid>button.active, .platform-grid>button.active, .segments button.active{border-color:var(--accent);background:var(--accent-soft)}.choice-grid span{display:grid}.choice-grid small{color:var(--muted)}.worker-flow, .deployment-form{display:grid;gap:.65rem}.worker-flow h4, .deployment-form h4{margin:.2rem 0}.worker-flow p{margin:.1rem 0;color:var(--muted)}.segments, .platform-grid{display:flex;gap:.4rem;flex-wrap:wrap}.segments button{flex:1}.pairing{display:grid;gap:.55rem;padding:.75rem;border:1px solid var(--accent);border-radius:12px}.pair-code{padding:.65rem;background:var(--bg);border-radius:8px;font-size:1.05rem;letter-spacing:.12em;text-align:center}.worker-download{width:max-content;min-height:40px;padding:.5rem .75rem;border:1px solid var(--line);border-radius:9px;color:inherit;text-decoration:none}.install-command{display:grid;gap:.4rem}.install-command code{display:block;padding:.65rem;border-radius:9px;background:var(--bg);overflow:auto;white-space:pre-wrap;word-break:break-all}.deployment-form fieldset{display:grid;gap:.4rem;margin:0;padding:0;border:0}.deployment-form label, .advanced-grid label{display:grid;gap:.28rem}.deployment-form label>small{color:var(--muted)}.deployment-form label>.field-error{color:var(--danger)}.role-choice{display:flex!important;align-items:flex-start;gap:.5rem}.role-choice span{display:grid}.role-choice small{color:var(--muted)}.deployment-form details{padding:.6rem;border:1px solid var(--line);border-radius:10px}.advanced-grid{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-top:.5rem}.plan-result ul{display:flex;gap:.35rem;flex-wrap:wrap;margin:.4rem 0;padding:0;list-style:none}.plan-result li{display:flex;align-items:center;gap:.2rem}.plan-result li code{padding:.25rem .4rem;border-radius:7px;background:var(--bg)}.plan-result li button{min-width:30px;min-height:30px;padding:.25rem}.plan-result p{display:flex;align-items:center;gap:.4rem;margin:.1rem 0;color:var(--muted)}.primary-link{border-color:var(--accent);background:var(--accent);color:var(--on-accent)}.danger-lite{color:var(--danger)}.sandbox-state small{color:var(--muted)}.sandbox-state>div{display:flex;gap:.4rem;flex-wrap:wrap}.health-panel>header{grid-template-columns:1fr auto}.health-panel h4{margin:0}.check-list{display:grid;gap:.45rem}.check-card{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:start;gap:.55rem;padding:.65rem;border:1px solid var(--line);border-radius:11px}.check-card.passed{color:var(--good)}.check-card.warning{color:var(--warn)}.check-card.failed{color:var(--danger)}.check-card.skipped{color:var(--muted)}.check-card span{display:grid;grid-template-columns:1fr auto;gap:.15rem .4rem;color:var(--text)}.check-card em{font-size:.7rem;font-style:normal;color:var(--muted)}.check-card p, .check-card small{grid-column:1/-1;margin:0;white-space:normal}.check-card p{font-size:.8rem}.check-card small{color:var(--muted)}.check-card button{align-self:center}.empty-small, .infrastructure-notice{margin:.2rem;color:var(--muted)}.infrastructure-notice{color:var(--warn)}
  @media(max-width:600px){.section-heading{align-items:stretch;flex-direction:column}.section-heading>button{min-height:44px;justify-content:center}.main-server-card dl,.choice-grid,.advanced-grid,.temp-summary{grid-template-columns:1fr 1fr}.host-grid{grid-template-columns:1fr}.host-card{min-height:62px}.host-actions{display:grid;grid-template-columns:1fr 1fr}.host-actions button,.temp-actions button{justify-content:center}.temp-actions{display:grid}.check-card{grid-template-columns:auto minmax(0,1fr)}.check-card>button{grid-column:1/-1;justify-content:center}.infrastructure-settings{padding-bottom:calc(env(safe-area-inset-bottom) + .5rem)}}
  @container(max-width:520px){.main-server-card>header{grid-template-columns:auto 1fr}.main-server-card>header>.status-pair{grid-column:1/-1}.status-pair{align-items:flex-start}.host-card{grid-template-columns:auto minmax(0,1fr)}.host-card>.status-pair{grid-column:1/-1;display:flex!important}}
</style>
