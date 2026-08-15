import path from "node:path";
import { describe,expect,it,vi } from "vitest";
import { DeckDatabase,databaseWorkerLaunch,runWithDatabaseRequestTrace,type DatabaseRequestTrace } from "../../src/server/db/client.js";

describe("DeckDatabase request isolation",()=>{
  const worker=path.resolve("tests/fixtures/fake-sqlite-worker.py");
  async function waitForRecovery(db:DeckDatabase){for(let attempt=0;attempt<100;attempt++){if(db.diagnostics().available&&!db.diagnostics().recovering)return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error("database worker did not recover");}

  it("selects Python on Linux and the bundled Node worker on Windows",()=>{
    expect(databaseWorkerLaunch("/srv/app/sqlite-worker.py","/srv/data/deck.sqlite",{platform:"linux"})).toEqual({command:"python3",args:["/srv/app/sqlite-worker.py","/srv/data/deck.sqlite"],kind:"python"});
    expect(databaseWorkerLaunch("C:\\Workhouse\\app\\sqlite-worker.py","C:\\Data\\deck.sqlite",{platform:"win32",nodeBinary:"C:\\Workhouse\\node.exe",nodeWorkerPath:"C:\\Workhouse\\app\\sqlite-worker.mjs"})).toEqual({command:"C:\\Workhouse\\node.exe",args:["C:\\Workhouse\\app\\sqlite-worker.mjs","C:\\Data\\deck.sqlite"],kind:"node"});
  });

  it("takes the Python interpreter from the caller, then PYTHON_BIN, then PATH",()=>{
    const launch=()=>databaseWorkerLaunch("/srv/app/sqlite-worker.py","/srv/data/deck.sqlite",{platform:"linux"});
    const previous=process.env.PYTHON_BIN;
    try{
      delete process.env.PYTHON_BIN;
      expect(launch().command).toBe("python3");
      process.env.PYTHON_BIN="/opt/python/bin/python3.12";
      expect(launch().command).toBe("/opt/python/bin/python3.12");
      expect(databaseWorkerLaunch("/srv/app/sqlite-worker.py","/srv/data/deck.sqlite",{platform:"linux",pythonBinary:"/usr/local/bin/python3"}).command).toBe("/usr/local/bin/python3");
    }finally{
      if(previous===undefined)delete process.env.PYTHON_BIN;else process.env.PYTHON_BIN=previous;
    }
  });

  it("lets only the caller widen the startup ping watchdog",async()=>{
    const db=Object.create(DeckDatabase.prototype) as DeckDatabase;
    const request=vi.fn().mockResolvedValue({journalMode:"wal",synchronous:2,walAutocheckpoint:1000});
    Object.defineProperty(db,"request",{value:request});
    await db.ping(60_000);
    expect(request).toHaveBeenCalledWith("ping",{},60_000);
  });

  it("times out an unresponsive request, clears the queue, and replaces the worker",async()=>{
    const db=new DeckDatabase(worker,"/tmp/fake.sqlite",{defaultTimeoutMs:3000,maxPending:4});
    await db.request("ready");
    await expect(db.request("hang",{},30)).rejects.toMatchObject({name:"DatabaseRequestError",kind:"timeout",code:"database_busy",statusCode:503});
    await waitForRecovery(db);
    expect(db.diagnostics()).toMatchObject({available:true,recovering:false,restartCount:1,queueDepth:0,waitingDepth:0,currentOperation:null});
    await expect(db.request<{operation:string}>("after",{},1000)).resolves.toEqual({operation:"after"});
    await db.close();
  });

  it("rejects requests queued behind a timed-out operation instead of letting them pile up",async()=>{
    const db=new DeckDatabase(worker,"/tmp/fake.sqlite",{defaultTimeoutMs:3000,maxPending:4});
    await db.request("ready");
    const delayed=db.request("delayed",{seconds:0.2},20);
    const queued=db.request("after",{},1000);
    await expect(delayed).rejects.toMatchObject({kind:"timeout"});
    await expect(queued).rejects.toMatchObject({kind:"worker_unavailable"});
    await waitForRecovery(db);
    await expect(db.request<{operation:string}>("after",{},1000)).resolves.toEqual({operation:"after"});
    await db.close();
  });

  it("starts the watchdog when queued work begins executing",async()=>{
    const db=new DeckDatabase(worker,"/tmp/fake.sqlite",{defaultTimeoutMs:3000,maxPending:4});
    await db.request("ready");
    const first=db.request("delayed",{seconds:0.08},500);
    const queued=db.request<{operation:string}>("after",{},30);
    expect(db.diagnostics()).toMatchObject({queueDepth:2,waitingDepth:1,currentOperation:"delayed"});
    await first;
    await expect(queued).resolves.toEqual({operation:"after"});
    expect(db.diagnostics()).toMatchObject({queueDepth:0,waitingDepth:0,restartCount:0});
    await db.close();
  });

  it("rejects queue overflow separately from timeout",async()=>{
    const db=new DeckDatabase(worker,"/tmp/fake.sqlite",{defaultTimeoutMs:3000,maxPending:1});
    await db.request("ready");
    const first=db.request("delayed",{seconds:0.08});
    await expect(db.request("overflow")).rejects.toMatchObject({name:"DatabaseRequestError",kind:"overload",code:"database_busy"});
    expect(db.diagnostics()).toMatchObject({queueDepth:1,currentOperation:"delayed",maxPending:1});
    await first;
    await db.close();
  });

  it("records database operation names and elapsed time in the request trace",async()=>{
    const db=new DeckDatabase(worker,"/tmp/fake.sqlite",{defaultTimeoutMs:3000,maxPending:4}),trace:DatabaseRequestTrace={operations:[],totalMs:0};
    await runWithDatabaseRequestTrace(trace,()=>db.request("delayed",{seconds:0.02}));
    expect(trace.operations).toEqual([expect.objectContaining({operation:"delayed",outcome:"ok",elapsedMs:expect.any(Number)})]);
    expect(trace.totalMs).toBeGreaterThanOrEqual(10);
    await db.close();
  });

  it("reports a worker that exits as unavailable",async()=>{
    const db=new DeckDatabase(path.resolve("tests/fixtures/exiting-sqlite-worker.py"),"/tmp/fake.sqlite",{defaultTimeoutMs:3000});
    await expect(db.request("ping")).rejects.toMatchObject({name:"DatabaseRequestError",kind:"worker_unavailable",code:"database_busy",statusCode:503});
    for(let attempt=0;attempt<100&&(db.diagnostics().available||db.diagnostics().recovering||db.diagnostics().restartCount<3);attempt++)await new Promise(resolve=>setTimeout(resolve,10));
    expect(db.diagnostics()).toMatchObject({available:false,recovering:false,restartCount:3,consecutiveRestarts:3});
    await db.close();
  });

  it("bounds restart attempts for a failing Node worker without falling back to Python",async()=>{
    const nodeWorker=path.resolve("tests/fixtures/exiting-sqlite-worker.mjs");
    const db=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),"/tmp/fake-node.sqlite",{platform:"win32",nodeBinary:process.execPath,nodeWorkerPath:nodeWorker,defaultTimeoutMs:3000});
    await expect(db.request("ping")).rejects.toMatchObject({name:"DatabaseRequestError",kind:"worker_unavailable",code:"database_busy",statusCode:503});
    for(let attempt=0;attempt<200&&(db.diagnostics().available||db.diagnostics().recovering||db.diagnostics().restartCount<3);attempt++)await new Promise(resolve=>setTimeout(resolve,10));
    expect(db.diagnostics()).toMatchObject({available:false,recovering:false,restartCount:3,consecutiveRestarts:3});
    await db.close();
  });
});
