import path from"node:path";
import type{ExternalAccessDetection}from"../types.js";
import{boundedCommand,defaultExternalCommandRunner,findExecutable,type ExternalCommandRunner}from"../process.js";
function parseVersion(raw:string){return raw.match(/\b(\d+\.\d+(?:\.\d+)?)/)?.[1]??null;}
function versionAtLeast(value:string|null,major:number,minor:number){if(!value)return false;const[a,b]=value.split(".").map(Number);return a>major||a===major&&b>=minor;}
export async function detectTailscale(input:{runner?:ExternalCommandRunner;binary?:string|null;cwd?:string}={}):Promise<ExternalAccessDetection>{
 const checkedAt=new Date().toISOString(),runner=input.runner??defaultExternalCommandRunner,binary=input.binary===undefined?findExecutable("tailscale"):input.binary,cwd=input.cwd??process.cwd();
 if(!binary)return{provider:"tailscale",state:"not_detected",management:"guided",checkedAt,installed:false,serviceRunning:null,authenticated:null,connected:null,configured:false,permission:"unknown",version:null,externalUrl:null,details:{serveSupported:false,funnelConfigured:false},warnings:[]};
 const versionResult=await boundedCommand(runner,binary,["version"],cwd),version=parseVersion(versionResult.stdout||versionResult.stderr);
 const statusResult=await boundedCommand(runner,binary,["status","--json"],cwd);let status:any={};try{status=JSON.parse(statusResult.stdout||"{}");}catch{}
 const backend=String(status.BackendState??"Unknown"),serviceRunning=backend!=="Stopped"&&backend!=="NoState",authenticated=backend!=="NeedsLogin",connected=backend==="Running"&&Boolean(status.Self?.Online);
 let serve:any={},serveSupported=versionAtLeast(version,1,52),configured=false,funnelConfigured=false;
 if(serveSupported){const result=await boundedCommand(runner,binary,["serve","status","--json"],cwd);try{serve=JSON.parse(result.stdout||"{}");configured=Object.keys(serve).length>0;}catch{serveSupported=result.exitCode===0;}}
 if(serveSupported){const result=await boundedCommand(runner,binary,["funnel","status","--json"],cwd);try{const funnel=JSON.parse(result.stdout||"{}");funnelConfigured=Object.keys(funnel).length>0;}catch{funnelConfigured=false;}}
 const dnsName=typeof status.Self?.DNSName==="string"?status.Self.DNSName.replace(/\.$/,""):null;
 const state=!versionAtLeast(version,1,52)?"unsupported_version":!serviceRunning?"service_stopped":!authenticated?"authentication_required":!connected?"degraded":configured?"configured":"connected";
 return{provider:"tailscale",state:funnelConfigured?"misconfigured":state,management:process.platform==="linux"||process.platform==="darwin"?"managed":"guided",checkedAt,installed:true,serviceRunning,authenticated,connected,configured,permission:"unknown",version,externalUrl:configured&&dnsName?`https://${dnsName}`:null,details:{backendState:backend,magicDnsAvailable:Boolean(status.MagicDNSSuffix&&dnsName),dnsName,serveSupported,serveConfigured:configured,funnelConfigured,serveShape:Object.keys(serve).sort().slice(0,20)},warnings:[...(!versionAtLeast(version,1,52)?["Tailscale Serve requires a newer supported CLI version."]:[]),...(funnelConfigured?["Tailscale Funnel is public and cannot be used for Workhouse identity authentication."]:[])]};
}
export function tailscaleServeArgs(action:"apply"|"remove",target="http://127.0.0.1:3410"){
 if(!/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):[1-9]\d{0,4}$/.test(target))throw new Error("Tailscale Serve target must be a bounded loopback HTTP URL.");
 return action==="apply"?["serve","--bg",target]:["serve","reset"];
}
