import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CodexProvider } from "../../src/server/providers/codex.js";

describe("Codex worker diagnostic persistence", () => {
  it.each([
    {status:"failed",providerError:{codexErrorCode:"httpConnectionFailed",upstreamHttpStatus:503}},
    {status:"completed",providerError:null}
  ])("publishes the worker's diagnostic state for $status", async state => {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"codex-diagnostics-"));
    try {
      const db={upsertTask:async (row:unknown)=>row};
      const provider=new CodexProvider({dataDir:root,root,projects:[]} as any,db as any);
      const task:any={id:"codex:deck:diagnostics",provider:"codex",status:"running",threadId:null,updatedAt:"2026-10-08T00:00:00.000Z",metadata:{providerError:{codexErrorCode:"serverOverloaded"}}};
      fs.writeFileSync(path.join(root,"codex-jobs","codex_deck_diagnostics.json"),JSON.stringify({...state,updatedAt:"2026-10-08T00:01:00.000Z",error:state.status==="failed"?"upstream unavailable":null}));
      const refreshed=await (provider as any).refreshWorker(task);
      expect(refreshed.status).toBe(state.status);
      expect(refreshed.metadata.providerError).toEqual(state.providerError);
    } finally {
      fs.rmSync(root,{recursive:true,force:true});
    }
  });
});
