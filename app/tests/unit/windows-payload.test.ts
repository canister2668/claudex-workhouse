import fs from"node:fs";
import path from"node:path";
import{afterEach,describe,expect,it}from"vitest";
import{activateWindowsPayload,buildWindowsPayloadManifest,validateWindowsPayloadPath,verifyWindowsPayload}from"../../src/server/windows/payload.js";

const created:string[]=[];
afterEach(()=>{for(const item of created.splice(0))fs.rmSync(item,{recursive:true,force:true});});
function temporary(name:string){const root=fs.mkdtempSync(path.resolve("../data",name));created.push(root);return root;}

describe("Windows server payload",()=>{
  it("rejects archive escape, device, reserved, ambiguous, and case-collision paths",()=>{
    for(const item of["../escape","/absolute","C:/drive","//server/share","folder\\file","folder//file","folder/CON.txt","folder/trailing.","folder/file:stream"])expect(()=>validateWindowsPayloadPath(item)).toThrow();
    const root=temporary("windows-payload-collision-");fs.writeFileSync(path.join(root,"Readme.txt"),"a");fs.writeFileSync(path.join(root,"README.TXT"),"b");
    expect(()=>buildWindowsPayloadManifest(root,"0.1.0")).toThrow("case-insensitive path collision");
  });

  it("hashes every regular file and rejects tampering, extras, and links",()=>{
    const root=temporary("windows-payload-verify-");fs.mkdirSync(path.join(root,"app"));fs.writeFileSync(path.join(root,"app","server.js"),"server\n");fs.writeFileSync(path.join(root,"node.exe"),"runtime\n");
    const manifest=buildWindowsPayloadManifest(root,"0.1.0","2026-07-30T00:00:00.000Z");
    expect(verifyWindowsPayload(root,manifest).files).toHaveLength(2);
    fs.writeFileSync(path.join(root,"app","server.js"),"tampered\n");expect(()=>verifyWindowsPayload(root,manifest)).toThrow("verification failed");
    fs.writeFileSync(path.join(root,"app","server.js"),"server\n");fs.writeFileSync(path.join(root,"extra"),"extra");expect(()=>verifyWindowsPayload(root,manifest)).toThrow("file count");
    fs.rmSync(path.join(root,"extra"));fs.symlinkSync(path.join(root,"node.exe"),path.join(root,"linked.exe"));expect(()=>buildWindowsPayloadManifest(root,"0.1.0")).toThrow("symbolic link");
  });

  it("activates a verified staging directory atomically and preserves the previous version pointer",()=>{
    const installRoot=temporary("windows-payload-install-");
    const stage=(version:string,body:string)=>{const root=path.join(installRoot,`stage-${version}`);fs.mkdirSync(root);fs.writeFileSync(path.join(root,"server.js"),body);return{root,manifest:buildWindowsPayloadManifest(root,version)};};
    const first=stage("0.1.0","one"),activated=activateWindowsPayload({installRoot,stagingRoot:first.root,manifest:first.manifest});
    expect(activated.current).toMatchObject({version:"0.1.0",previousVersion:null,payloadDirectory:"versions/0.1.0"});expect(fs.existsSync(first.root)).toBe(false);
    const duplicate=stage("0.1.0","one");activateWindowsPayload({installRoot,stagingRoot:duplicate.root,manifest:duplicate.manifest});expect(fs.existsSync(duplicate.root)).toBe(false);
    const second=stage("0.2.0","two"),next=activateWindowsPayload({installRoot,stagingRoot:second.root,manifest:second.manifest});
    expect(next.current).toMatchObject({version:"0.2.0",previousVersion:"0.1.0"});expect(fs.readFileSync(path.join(installRoot,"versions","0.1.0","server.js"),"utf8")).toBe("one");
  });
});
