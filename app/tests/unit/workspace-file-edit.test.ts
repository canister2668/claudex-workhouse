import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,describe,expect,it} from "vitest";
import {decodeEditableText,resolveWorkspaceTextPath,writeEditableTextFile} from "../../src/server/workspace-file-edit.js";

const temporary:string[]=[];
function workspace(){const root=fs.mkdtempSync(path.join(os.tmpdir(),"claudex-workhouse-file-edit-"));temporary.push(root);return root;}
afterEach(()=>{for(const root of temporary.splice(0))fs.rmSync(root,{recursive:true,force:true});});

describe("workspace file editing",()=>{
  it("decodes and preserves CRLF, BOM and the final newline",()=>{
    const root=workspace(),file=path.join(root,"sample.txt"),original=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from("one\r\ntwo\r\n")]);fs.writeFileSync(file,original);
    const snapshot=decodeEditableText(original);expect(snapshot).toMatchObject({content:"one\ntwo\n",lineEnding:"crlf",hasUtf8Bom:true,endsWithNewline:true});
    const saved=writeEditableTextFile(file,"one\nchanged",snapshot.revision);expect(saved.revision).not.toBe(snapshot.revision);expect(fs.readFileSync(file)).toEqual(Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from("one\r\nchanged\r\n")]));
  });

  it("rejects a stale revision and succeeds only against the reviewed current revision",()=>{
    const root=workspace(),file=path.join(root,"sample.txt");fs.writeFileSync(file,"base\n");const base=decodeEditableText(fs.readFileSync(file));fs.writeFileSync(file,"agent\n");const latest=decodeEditableText(fs.readFileSync(file));
    expect(()=>writeEditableTextFile(file,"human\n",base.revision)).toThrowError(expect.objectContaining({code:"FILE_VERSION_CONFLICT"}));
    writeEditableTextFile(file,"human\n",base.revision,latest.revision);expect(fs.readFileSync(file,"utf8")).toBe("human\n");
  });

  it("blocks path escapes, git metadata and symlink traversal",()=>{
    const root=workspace();fs.mkdirSync(path.join(root,".git"));fs.writeFileSync(path.join(root,".git","config"),"x");
    expect(()=>resolveWorkspaceTextPath(root,root,"../outside.txt")).toThrowError(expect.objectContaining({code:"WORKSPACE_FILE_PATH_ESCAPE"}));
    expect(()=>resolveWorkspaceTextPath(root,root,".git/config")).toThrowError(expect.objectContaining({code:"GIT_METADATA_EDIT_BLOCKED"}));
    const real=path.join(root,"real");fs.mkdirSync(real);fs.writeFileSync(path.join(real,"file.txt"),"x");fs.symlinkSync(real,path.join(root,"linked"),"dir");
    expect(()=>resolveWorkspaceTextPath(root,root,"linked/file.txt")).toThrowError(expect.objectContaining({code:"SYMLINK_EDIT_BLOCKED"}));
  });

  it("rejects invalid UTF-8 and mixed line endings",()=>{
    expect(()=>decodeEditableText(Buffer.from([0xc3,0x28]))).toThrowError(expect.objectContaining({code:"WORKSPACE_FILE_INVALID_UTF8"}));
    expect(()=>decodeEditableText(Buffer.from("a\r\nb\n"))).toThrowError(expect.objectContaining({code:"WORKSPACE_FILE_MIXED_LINE_ENDINGS"}));
  });
});
