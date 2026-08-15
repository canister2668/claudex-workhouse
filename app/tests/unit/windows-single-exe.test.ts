import fs from"node:fs";
import os from"node:os";
import path from"node:path";
import{afterEach,describe,expect,it}from"vitest";
import{buildWindowsSingleExe,extractWindowsSingleExe,inspectWindowsSingleExe}from"../../src/server/windows/single-exe.js";
import{buildWindowsPayloadManifest}from"../../src/server/windows/payload.js";

const roots:string[]=[];
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"workhouse-single-exe-"));roots.push(root);
  const launcher=path.join(root,"launcher.exe"),payload=path.join(root,"payload"),output=path.join(root,"Claudex Workhouse.exe");
  const pe=Buffer.alloc(512,0);pe.write("MZ",0,"ascii");pe.writeUInt32LE(0x80,0x3c);pe.writeUInt32LE(0x00004550,0x80);pe.writeUInt16LE(0x8664,0x84);pe.writeUInt16LE(240,0x94);pe.writeUInt16LE(0x20b,0x98);pe.writeUInt32LE(16,0x80+24+108);fs.writeFileSync(launcher,pe);
  fs.mkdirSync(path.join(payload,"app","assets"),{recursive:true});
  fs.writeFileSync(path.join(payload,"node.exe"),"windows-node");
  fs.writeFileSync(path.join(payload,"app","start.mjs"),"start");
  fs.writeFileSync(path.join(payload,"app","assets","한글.txt"),"payload");
  const manifest=buildWindowsPayloadManifest(payload,"0.1.0","2026-07-30T00:00:00.000Z");
  return{root,launcher,payloadRoot:payload,output,manifest};
}
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

describe("Windows single EXE payload contract",()=>{
  it("builds, inspects, and extracts a deterministic verified payload",()=>{
    const value=fixture(),info=buildWindowsSingleExe(value);
    expect(info.launcherSize).toBeGreaterThanOrEqual(512);
    expect(info.totalSize%8).toBe(0);
    expect(info.manifest.files.map(item=>item.path)).toEqual(["app/assets/한글.txt","app/start.mjs","node.exe"]);
    expect(inspectWindowsSingleExe(value.output).manifest.version).toBe("0.1.0");
    const extracted=path.join(value.root,"extracted");
    expect(extractWindowsSingleExe({file:value.output,stagingRoot:extracted}).version).toBe("0.1.0");
    expect(fs.readFileSync(path.join(extracted,"app","assets","한글.txt"),"utf8")).toBe("payload");
  });
  it("rejects launcher, manifest, payload, and footer tampering",()=>{
    const value=fixture();
    expect(()=>buildWindowsSingleExe({...value,launcher:path.join(value.root,"missing.exe")})).toThrow();
    buildWindowsSingleExe(value);
    const original=fs.readFileSync(value.output),info=inspectWindowsSingleExe(value.output);
    for(const[position,label]of[[10,"launcher"],[info.payloadOffset,"payload"],[info.manifestOffset,"manifest"],[original.length-112,"footer"]]as const){
      const tampered=Buffer.from(original);tampered[position]^=1;const file=path.join(value.root,`${label}.exe`);fs.writeFileSync(file,tampered);
      if(label==="payload"){const staging=path.join(value.root,"bad-extract");expect(()=>extractWindowsSingleExe({file,stagingRoot:staging})).toThrow(/hash/);expect(fs.existsSync(staging)).toBe(false);}
      else expect(()=>inspectWindowsSingleExe(file)).toThrow();
    }
  });
  it("enforces the complete artifact size gate and exclusive staging",()=>{
    const value=fixture();
    expect(()=>buildWindowsSingleExe({...value,maximumBytes:200})).toThrow(/exceeds/);
    buildWindowsSingleExe(value);
    const staging=path.join(value.root,"occupied");fs.mkdirSync(staging);
    expect(()=>extractWindowsSingleExe({file:value.output,stagingRoot:staging})).toThrow(/already exists/);
  });
  it("finds the payload footer before an Authenticode certificate table",()=>{
    const value=fixture();buildWindowsSingleExe(value);
    const unsignedSize=fs.statSync(value.output).size,certificate=Buffer.alloc(2048,9);
    expect(unsignedSize%8).toBe(0);
    fs.appendFileSync(value.output,certificate);
    const fd=fs.openSync(value.output,"r+");try{const checksum=Buffer.alloc(4,5);fs.writeSync(fd,checksum,0,checksum.length,0x80+24+64);const entry=Buffer.alloc(8);entry.writeUInt32LE(unsignedSize,0);entry.writeUInt32LE(certificate.length,4);fs.writeSync(fd,entry,0,entry.length,0x80+24+144);}finally{fs.closeSync(fd);}
    expect(inspectWindowsSingleExe(value.output).manifest.version).toBe("0.1.0");
  });
  it("rejects empty or incomplete payload contracts",()=>{
    const value=fixture();
    const incomplete={...value.manifest,files:value.manifest.files.filter(item=>item.path!=="node.exe")};
    expect(()=>buildWindowsSingleExe({...value,manifest:incomplete})).toThrow();
  });
});
