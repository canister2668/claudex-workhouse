import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { resolveTranscriptFile, transcriptFile } from "../../src/server/claude-transcript.js";

const created:string[]=[];const originalHome=process.env.HOME;
afterEach(()=>{process.env.HOME=originalHome;for(const directory of created.splice(0))fs.rmSync(directory,{recursive:true,force:true});});

function store(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"claudex-workhouse-transcript-"));created.push(root);
  process.env.HOME=path.join(root,"home");
  return root;
}
function write(cwd:string,sessionId:string,body="{}\n"){
  const file=transcriptFile(cwd,sessionId);
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,body);
  return file;
}

describe("Claude transcript resolution",()=>{
  it("uses the working directory slug when the transcript is where the task expects it",()=>{
    store();
    const sessionId=crypto.randomUUID(),file=write("/srv/project",sessionId);
    expect(resolveTranscriptFile("/srv/project",sessionId)).toBe(file);
  });

  // The CLI slug comes from the directory the process actually started in, so a
  // session started elsewhere and later moved writes under a different slug.
  it("finds a transcript written under a different project slug",()=>{
    store();
    const sessionId=crypto.randomUUID(),actual=write("/srv/projects/example/build/nai-studio",sessionId);
    expect(transcriptFile("/srv/claudex-workhouse",sessionId)).not.toBe(actual);
    expect(resolveTranscriptFile("/srv/claudex-workhouse",sessionId)).toBe(actual);
  });

  it("prefers the most recently written copy when several slugs hold the same session",()=>{
    store();
    const sessionId=crypto.randomUUID();
    const stale=write("/srv/old",sessionId),fresh=write("/srv/new",sessionId);
    fs.utimesSync(stale,new Date(1000),new Date(1000));
    fs.utimesSync(fresh,new Date(9000),new Date(9000));
    expect(resolveTranscriptFile("/srv/other",sessionId)).toBe(fresh);
  });

  it("returns the expected path when nothing matches so callers keep their fallback",()=>{
    store();
    const sessionId=crypto.randomUUID();
    expect(resolveTranscriptFile("/srv/project",sessionId)).toBe(transcriptFile("/srv/project",sessionId));
  });

  it("refuses to search on a session id that could escape the store",()=>{
    store();
    write("/srv/project","../escape");
    expect(resolveTranscriptFile("/srv/other","../escape")).toBe(transcriptFile("/srv/other","../escape"));
  });

  it("ignores a directory that shares the transcript name",()=>{
    const root=store();
    const sessionId=crypto.randomUUID();
    fs.mkdirSync(path.join(root,"home",".claude","projects","-srv-decoy",`${sessionId}.jsonl`),{recursive:true});
    expect(resolveTranscriptFile("/srv/project",sessionId)).toBe(transcriptFile("/srv/project",sessionId));
  });
});
