import fs from"node:fs";
import path from"node:path";
import{spawnSync}from"node:child_process";

const worker=path.resolve("dist-server/db/sqlite-worker.mjs");
const schema=path.resolve("dist-server/db/sqlite-schema.sql");
if(!fs.existsSync(worker)||!fs.existsSync(schema))throw new Error("Run pnpm run build before the Node SQLite contract test.");
const vitest=path.resolve("node_modules/vitest/vitest.mjs");
const result=spawnSync(process.execPath,[vitest,"run",
  "tests/integration/db.test.ts",
  "tests/integration/history-search.test.ts",
  "tests/integration/prompt-presets.test.ts",
  "tests/integration/quota-task-reservations.test.ts",
  "tests/integration/release-state.test.ts",
  "tests/integration/task-recovery.test.ts",
  "--maxWorkers=1","--testTimeout=60000","--hookTimeout=60000"
],{
  cwd:process.cwd(),
  env:{...process.env,CLAUDEX_WORKHOUSE_DB_WORKER:"node",CLAUDEX_WORKHOUSE_NODE_DB_WORKER:worker},
  stdio:"inherit",
  shell:false
});
if(result.error)throw result.error;
process.exitCode=result.status??1;
