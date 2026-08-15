import fs from"node:fs";import os from"node:os";import path from"node:path";import{afterEach,describe,expect,it}from"vitest";import{inspectWindowsUpdateZip}from"../../src/server/windows/portable-updater.js";
import{inspectWorkerUpdateZip}from"../../src/server/desktop-worker/updater.js";
const roots:string[]=[];
function centralArchive(name:string,attributes=0){const encoded=Buffer.from(name),central=Buffer.alloc(46+encoded.length),end=Buffer.alloc(22);central.writeUInt32LE(0x02014b50,0);central.writeUInt32LE(1,24);central.writeUInt16LE(encoded.length,28);central.writeUInt32LE(attributes,38);encoded.copy(central,46);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(0,16);return Buffer.concat([central,end]);}
function archive(name:string,attributes=0){const root=fs.mkdtempSync(path.join(os.tmpdir(),"workhouse-windows-update-"));roots.push(root);const file=path.join(root,"update.zip");fs.writeFileSync(file,centralArchive(name,attributes));return file;}
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
describe("Windows portable updater archive boundary",()=>{
  it("accepts a normalized package entry",()=>expect(()=>inspectWindowsUpdateZip(archive("package/payload/file.js"))).not.toThrow());
  it("rejects traversal and symlink entries",()=>{
    expect(()=>inspectWindowsUpdateZip(archive("../escape"))).toThrow(/unsafe entry/);
    expect(()=>inspectWindowsUpdateZip(archive("package/link",0xa0000000))).toThrow(/unsafe entry/);
  });
  it("applies the same archive boundary to Worker updates",()=>{
    expect(()=>inspectWorkerUpdateZip(archive("worker/app/start.mjs"))).not.toThrow();
    expect(()=>inspectWorkerUpdateZip(archive("worker/link",0xa0000000))).toThrow(/unsafe entry/);
  });
});
