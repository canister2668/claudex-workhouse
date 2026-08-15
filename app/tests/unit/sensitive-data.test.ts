import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { DeckDatabase } from "../../src/server/db/client.js";
import { REDACTED, SANITIZATION_FAILED, sanitizeSensitiveText, sanitizeSensitiveValue } from "../../src/server/sensitive-data.js";
import type { DeckTask } from "../../src/server/types.js";
import { createWorkspacePatch } from "../../src/server/desktop-worker/workspaces.js";
import type { WorkerConfig } from "../../src/server/desktop-worker/config.js";

const created:string[]=[];
afterEach(()=>{for(const item of created.splice(0))fs.rmSync(item,{recursive:true,force:true});});

describe("sensitive data sanitization",()=>{
  it.each([
    ["Authorization: Bearer abcdef012345",`Authorization: Bearer ${REDACTED}`],
    ["OPENAI_API_KEY=abcdef012345",`OPENAI_API_KEY=${REDACTED}`],
    ["ANTHROPIC_API_KEY='abcdef012345'",`ANTHROPIC_API_KEY=${REDACTED}`],
    ['{"access_token":"abcdef","refresh_token":"uvwxyz"}',`{"access_token":"${REDACTED}","refresh_token":"${REDACTED}"}`],
    ["-----BEGIN PRIVATE KEY-----\nabcdef\n-----END PRIVATE KEY-----",REDACTED],
    ["https://example.test/callback?code=visible&access_token=hidden",`https://example.test/callback?code=${REDACTED}&access_token=${REDACTED}`],
    ["https://example.test/callback?state=oauth-state&user_code=one-time",`https://example.test/callback?state=${REDACTED}&user_code=${REDACTED}`],
    ["sk-proj-abcdefghijklmnopqrstuvwxyz",REDACTED],
    ["github_pat_abcdefghijklmnopqrstuvwxyz",REDACTED]
  ])("redacts structured secret input %#",(input,expected)=>{
    expect(sanitizeSensitiveText(input)).toBe(expected);
  });

  it.each([
    "0123456789abcdef0123456789abcdef01234567",
    "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "550e8400-e29b-41d4-a716-446655440000",
    "codex:deck:task-123",
    "thread_01JABCDEF0123456789",
    "v1.2.3-beta.4",
    "/volume2/projects/a-very-long-normal-directory/file.ts",
    "SGVsbG8gd29ybGQ="
  ])("does not redact normal identifiers %#",(input)=>{
    expect(sanitizeSensitiveText(input)).toBe(input);
  });

  it("does not rewrite source identifiers and type declarations that merely use sensitive names",()=>{
    const source=[
      "export const token = process.env.TOKEN;",
      "const password = form.password;",
      "type CredentialShape = { token: string; password?: string };"
    ].join("\n");
    expect(sanitizeSensitiveText(source,{preserveSourceIdentifiers:true})).toBe(source);
    expect(sanitizeSensitiveText(source)).not.toBe(source);
    expect(sanitizeSensitiveText("token=abcdef012345",{preserveSourceIdentifiers:true})).toBe(`token=${REDACTED}`);
    expect(sanitizeSensitiveText('password="literal-secret"',{preserveSourceIdentifiers:true})).toBe(`password="${REDACTED}"`);
  });

  it("handles nested Error and circular objects without exposing secrets or throwing",()=>{
    const value:any={id:"task-1",nested:{apiKey:"hidden"},error:new Error("OPENAI_API_KEY=hidden")};
    value.self=value;
    const safe=sanitizeSensitiveValue(value) as any;
    expect(safe.id).toBe("task-1");
    expect(safe.nested.apiKey).toBe(REDACTED);
    expect(safe.error.message).toBe(`OPENAI_API_KEY=${REDACTED}`);
    expect(safe.self).toBe("[Circular]");
  });

  it("fails closed for an unreadable object and tolerates malformed byte sequences and large output",()=>{
    const unreadable=Object.defineProperty({},"value",{enumerable:true,get(){throw new Error("OPENAI_API_KEY=must-not-escape");}});
    expect(sanitizeSensitiveValue(unreadable)).toBe(SANITIZATION_FAILED);
    expect(()=>sanitizeSensitiveValue(Buffer.from([0xff,0xfe,0x00]))).not.toThrow();
    const large=`prefix OPENAI_API_KEY=large-secret\n${"x".repeat(2*1024*1024)}`;
    const sanitized=sanitizeSensitiveText(large);
    expect(sanitized).toContain(`OPENAI_API_KEY=${REDACTED}`);
    expect(sanitized).not.toContain("large-secret");
  });

  it("sanitizes task outputs before SQLite persistence while preserving the user prompt",async()=>{
    const root=fs.mkdtempSync(path.join(process.cwd(),".claudex-sensitive-db-"));created.push(root);
    const db=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),path.join(root,"deck.sqlite"));
    try{
      await db.ping();
      const now=new Date().toISOString();
      const task:DeckTask={id:"codex:sensitive",provider:"codex",nativeId:"sensitive",threadId:"thread",projectId:"project",title:"test",prompt:"user explicitly opened OPENAI_API_KEY=visible",status:"failed",createdAt:now,updatedAt:now,result:"Authorization: Bearer result-secret",error:'{"refresh_token":"error-secret"}',log:"ANTHROPIC_API_KEY=log-secret",owned:true,pid:null,pgid:null,processStart:null,commandMarker:null,parentThreadId:null,metadata:{access_token:"metadata-secret"}};
      await db.upsertTask(task);
      const stored=await db.getTask(task.id);
      expect(stored?.prompt).toBe(task.prompt);
      expect(stored?.result).toBe(`Authorization: Bearer ${REDACTED}`);
      expect(stored?.error).toBe(`{"refresh_token":"${REDACTED}"}`);
      expect(stored?.log).toBe(`ANTHROPIC_API_KEY=${REDACTED}`);
      expect(stored?.metadata?.access_token).toBe(REDACTED);

      const source="export const token = process.env.TOKEN; const password = form.password;";
      await db.upsertTask({...task,id:"codex:source",result:source,error:null,log:source,metadata:{language:"typescript"}});
      const storedSource=await db.getTask("codex:source");
      expect(storedSource?.result).toBe(source);
      expect(storedSource?.log).toBe(source);
    }finally{await db.close();}
  });

  it("omits secret-like files from an automatic handoff patch without failing the patch",async()=>{
    const root=fs.mkdtempSync(path.join(process.cwd(),".claudex-sensitive-patch-"));created.push(root);
    const workspace=path.join(root,"workspace");fs.mkdirSync(workspace);
    const git=(args:string[])=>execFileSync("git",args,{cwd:workspace,stdio:"pipe"});
    git(["init","-q"]);git(["config","user.name","Test"]);git(["config","user.email","test@example.com"]);
    fs.writeFileSync(path.join(workspace,"app.txt"),"before\n");fs.writeFileSync(path.join(workspace,".env"),"TOKEN=before\n");
    git(["add","."]);git(["commit","-qm","initial"]);
    fs.writeFileSync(path.join(workspace,"app.txt"),"after\n");fs.writeFileSync(path.join(workspace,".env"),"TOKEN=after-secret\n");
    const timestamp=new Date().toISOString(),config:WorkerConfig={schemaVersion:1,serverUrl:null,hostId:"host",credential:null,credentialVersion:0,entryKey:"entry-key",roots:[{id:"root",displayName:"Root",canonicalPath:root,allowCreate:true,allowRegister:true,allowClone:true,allowDelete:false}],workspaces:[{id:"workspace",projectId:"project",hostId:"host",rootId:"root",relativePath:"workspace",canonicalPath:workspace,displayName:"Workspace",workspaceType:"existing",createdAt:timestamp,updatedAt:timestamp}],tasks:[],claudeBinary:"claude",codexBinary:"codex"};
    const patch=(await createWorkspacePatch(config,"workspace")).toString("utf8");
    expect(patch).toContain("app.txt");
    expect(patch).toContain("+after");
    expect(patch).not.toContain(".env");
    expect(patch).not.toContain("after-secret");
  });
});
