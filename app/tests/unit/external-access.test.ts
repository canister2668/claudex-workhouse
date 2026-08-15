import fs from"node:fs";
import os from"node:os";
import path from"node:path";
import{describe,expect,it}from"vitest";
import{detectTailscale,tailscaleServeArgs}from"../../src/server/external-access/detectors/tailscale.js";
import{detectCloudflare}from"../../src/server/external-access/detectors/cloudflare.js";
import{assertNoBrowserExecutionFields,externalAccessActionRegistry}from"../../src/server/external-access/executors/registry.js";
import{removeManagedCloudflareFiles,storeCloudflareToken,writeManagedCloudflareFiles}from"../../src/server/external-access/config-store.js";
import type{ExternalCommandRunner}from"../../src/server/external-access/process.js";
import{publicAddress}from"../../src/server/external-access/tests/connection-tests.js";
import{planInputSchema}from"../../src/server/external-access/schemas.js";
const result=(stdout="",exitCode=0,stderr="")=>({stdout,stderr,exitCode,signal:null,timedOut:false,overflow:false});
describe("external access fixed execution boundary",()=>{
 it("defines only fixed actions and rejects browser command fields recursively",()=>{expect(Object.keys(externalAccessActionRegistry)).toContain("tailscale_serve_apply");expect(()=>assertNoBrowserExecutionFields({provider:"tailscale",nested:{argv:["serve"]}})).toThrowError(/Forbidden execution field/);expect(()=>assertNoBrowserExecutionFields({hostname:"node.ts.net"})).not.toThrow();});
 it("builds only bounded Tailscale Serve argv",()=>{expect(tailscaleServeArgs("apply")).toEqual(["serve","--bg","http://127.0.0.1:3410"]);expect(tailscaleServeArgs("remove")).toEqual(["serve","reset"]);expect(()=>tailscaleServeArgs("apply","http://example.com:3410")).toThrow(/loopback/);});
 it("rejects unsafe hostnames and incomplete managed secrets",()=>{expect(()=>planInputSchema.parse({provider:"cloudflare",action:"cloudflare_validate",hostname:"127.0.0.1",localTarget:"http://127.0.0.1:3410",runMode:"existing"})).toThrow();expect(()=>planInputSchema.parse({provider:"cloudflare",action:"cloudflare_managed_config_apply",hostname:"workhouse.example.com",localTarget:"http://127.0.0.1:3410",runMode:"host"})).toThrow();expect(publicAddress("127.0.0.1")).toBe(false);expect(publicAddress("10.1.2.3")).toBe(false);expect(publicAddress("100.64.0.1")).toBe(false);expect(publicAddress("1.1.1.1")).toBe(true);});
});
describe("external access detectors",()=>{
 it("distinguishes missing, signed-out, connected, Serve, and Funnel states without returning identity records",async()=>{
   await expect(detectTailscale({binary:null})).resolves.toMatchObject({state:"not_detected",installed:false});
   const responses=new Map<string,ReturnType<typeof result>>([
     ["version",result("1.92.1\n")],["status --json",result(JSON.stringify({BackendState:"Running",MagicDNSSuffix:"tail.ts.net",Self:{Online:true,DNSName:"workhouse.tail.ts.net.",UserID:12}}))],["serve status --json",result(JSON.stringify({TCP:{443:{HTTPS:true}}}))],["funnel status --json",result("{}")]
   ]),runner:ExternalCommandRunner=async(_command,args)=>responses.get(args.join(" "))??result("",1,"unsupported");
   const detected=await detectTailscale({binary:"/fixture/tailscale",runner});expect(detected).toMatchObject({state:"configured",connected:true,configured:true,externalUrl:"https://workhouse.tail.ts.net"});expect(JSON.stringify(detected)).not.toContain("owner@example.com");
   responses.set("funnel status --json",result(JSON.stringify({Web:{"workhouse.tail.ts.net:443":{}}})));await expect(detectTailscale({binary:"/fixture/tailscale",runner})).resolves.toMatchObject({state:"misconfigured",details:{funnelConfigured:true}});
 });
 it("reports host cloudflared and safe config shape without credential content",async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"cloudflared-detect-")),file=path.join(root,"config.yml");try{fs.writeFileSync(file,"tunnel: 00000000-0000-4000-8000-000000000000\ncredentials-file: /secret/credential.json\ningress:\n  - hostname: workhouse.example.com\n    service: http://127.0.0.1:3410\n");const runner:ExternalCommandRunner=async()=>result("cloudflared version 2025.4.1");const detected=await detectCloudflare({binary:"/fixture/cloudflared",runner,configFiles:[file]});expect(detected).toMatchObject({installed:true,configured:true,details:{configDetected:true,tokenFileSupported:true}});expect(JSON.stringify(detected)).not.toContain("/secret/credential.json");}finally{fs.rmSync(root,{recursive:true,force:true});}});
});
describe("managed Cloudflare secret files",()=>{
 it("writes token and generated files privately and removes only the fixed managed names",()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"external-access-store-"));try{const token="A".repeat(80),tokenFile=storeCloudflareToken(root,token),files=writeManagedCloudflareFiles(root,{hostname:"workhouse.example.com",localTarget:"http://127.0.0.1:3410",runMode:"sidecar"});expect(fs.statSync(tokenFile).mode&0o777).toBe(0o600);expect(fs.readFileSync(tokenFile,"utf8").trim()).toBe(token);expect(files.sidecar).toBeTruthy();const unrelated=path.join(root,"config","external-access","keep.txt");fs.writeFileSync(unrelated,"keep");expect(removeManagedCloudflareFiles(root).sort()).toEqual(["cloudflared.token","cloudflared.yml","compose.cloudflared.yaml"]);expect(fs.existsSync(unrelated)).toBe(true);}finally{fs.rmSync(root,{recursive:true,force:true});}});
});
