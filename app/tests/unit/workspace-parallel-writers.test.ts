import { describe, expect, it } from "vitest";
import { concurrencyAuditDetail, parallelWriteContract, workspaceConcurrencyAdvisory } from "../../src/server/collaboration/workspace-concurrency";
import { assertAutomationWithinSource, automationRank } from "../../src/server/automation-level";

const lease=(id:string,mode:"read"|"write",session=`c-${id}`)=>({id,workspaceId:"w",collaborationSessionId:session,participantId:`p-${id}`,ownerRunId:`r-${id}`,mode,acquiredAt:"2026-08-14T00:00:00.000Z",expiresAt:"2026-08-14T00:01:00.000Z"});

describe("workspace concurrency advisory",()=>{
  it("counts concurrent readers and writers without ever refusing execution",()=>{
    const advisory=workspaceConcurrencyAdvisory({workspaceId:"w",selfMode:"write",concurrent:[lease("a","write"),lease("b","read"),lease("c","write")]});
    expect(advisory).toMatchObject({workspaceId:"w",selfMode:"write",concurrentTotal:3,concurrentWriters:2,concurrentReaders:1});
    expect(advisory.concurrent.map(item=>item.leaseId)).toEqual(["a","b","c"]);
  });

  it("carries identity and timing only, never prompts, results, paths or file contents",()=>{
    const advisory=workspaceConcurrencyAdvisory({workspaceId:"w",selfMode:"write",concurrent:[{...lease("a","write"),prompt:"secret prompt",result:"secret result",path:"/secret/file.ts"} as any]});
    expect(Object.keys(advisory.concurrent[0]).sort()).toEqual(["acquiredAt","collaborationSessionId","leaseId","mode","ownerRunId","workspaceId"]);
    expect(JSON.stringify(advisory)).not.toMatch(/secret/);
  });

  it("tolerates a missing or malformed concurrent set",()=>{
    for(const concurrent of [undefined,null,[] as any[]])expect(workspaceConcurrencyAdvisory({workspaceId:"w",selfMode:"read",concurrent})).toMatchObject({concurrentTotal:0,concurrentWriters:0,concurrentReaders:0,concurrent:[]});
    expect(workspaceConcurrencyAdvisory({workspaceId:"w",selfMode:"write",concurrent:[{} as any]}).concurrent[0]).toMatchObject({leaseId:"",mode:"read",workspaceId:"w"});
  });

  it("reports at most eight concurrent leases while keeping the true total",()=>{
    const advisory=workspaceConcurrencyAdvisory({workspaceId:"w",selfMode:"write",concurrent:Array.from({length:12},(_,index)=>lease(String(index),"write"))});
    expect(advisory.concurrentTotal).toBe(12);
    expect(advisory.concurrentWriters).toBe(12);
    expect(advisory.concurrent).toHaveLength(8);
  });
});

describe("parallel write contract",()=>{
  const solo=workspaceConcurrencyAdvisory({workspaceId:"w",selfMode:"write",concurrent:[]});
  const shared=workspaceConcurrencyAdvisory({workspaceId:"w",selfMode:"write",concurrent:[lease("a","write"),lease("b","read")]});

  it("gives a lone writer the dirty-worktree preservation contract",()=>{
    expect(parallelWriteContract(solo)).toContain("owned by another session");
    expect(parallelWriteContract(solo)).toContain("git status");
    expect(parallelWriteContract(solo)).toContain("Re-read a file immediately before you modify it");
    expect(parallelWriteContract(solo)).toMatch(/uniquely matched patches|compare-and-set/);
  });

  it("never instructs a destructive recovery or an unconditional overwrite",()=>{
    for(const advisory of [solo,shared]){
      const contract=parallelWriteContract(advisory);
      expect(contract).toContain("Never run `git reset`");
      expect(contract).toContain("git clean");
      expect(contract).toContain("git stash");
      expect(contract).not.toMatch(/force the (edit|patch)|overwrite (it )?anyway/i);
    }
  });

  it("keeps a real patch-context conflict as a stop-and-report, not a forced write",()=>{
    const contract=parallelWriteContract(shared);
    expect(contract).toContain("If the patch context no longer matches");
    expect(contract).toContain("stop that edit instead of forcing it");
    expect(contract).toContain("Do not stop merely because another writer exists");
  });

  it("adds the concurrent observation only when other sessions are active",()=>{
    expect(parallelWriteContract(solo)).not.toContain("Currently active alongside you");
    expect(parallelWriteContract(shared)).toContain("Currently active alongside you in workspace w: 1 writer(s), 1 reader(s)");
    expect(parallelWriteContract(shared)).toContain("run r-a");
  });

  it("gives a read participant no write contract at all",()=>{
    expect(parallelWriteContract(workspaceConcurrencyAdvisory({workspaceId:"w",selfMode:"read",concurrent:[lease("a","write")]}))).toBe("");
  });

  it("summarises the concurrent set for the audit log without secrets",()=>{
    expect(concurrencyAuditDetail(shared)).toBe("workspace=w;mode=write;concurrentWriters=1;concurrentReaders=1;leases=write:c-a:r-a,read:c-b:r-b");
    expect(concurrencyAuditDetail(solo)).toContain("leases=none");
  });
});

describe("managed automation ceiling",()=>{
  it("orders read below confirm below auto below full",()=>{
    expect([automationRank("read"),automationRank("confirm"),automationRank("auto"),automationRank("full")]).toEqual([0,1,2,3]);
  });

  it("allows any level at or below the source and refuses escalation",()=>{
    expect(assertAutomationWithinSource("read","full")).toBe("read");
    expect(assertAutomationWithinSource("full","full")).toBe("full");
    expect(assertAutomationWithinSource("auto","full")).toBe("auto");
    expect(assertAutomationWithinSource("read","read")).toBe("read");
    for(const requested of ["full","auto","confirm"] as const)expect(()=>assertAutomationWithinSource(requested,"read")).toThrow(/exceeds/);
    expect(()=>assertAutomationWithinSource("full","auto")).toThrow(expect.objectContaining({code:"AUTOMATION_LEVEL_ESCALATION_DENIED",statusCode:403}));
  });
});
