import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const scriptDir=path.dirname(fileURLToPath(import.meta.url));
const appDir=path.resolve(scriptDir,"..");
const appRoot=path.resolve(appDir,"..");
const dataRoot=path.join(appDir,"test-results","e2e-server");
const baseUrl=new URL(process.env.CLAUDEX_WORKHOUSE_E2E_BASE_URL??"http://127.0.0.1:3410");
const port=Number(baseUrl.port||"3410");

if(baseUrl.protocol!=="http:"||!["127.0.0.1","localhost"].includes(baseUrl.hostname)||!Number.isInteger(port)){
  throw new Error("Managed E2E server requires a loopback HTTP URL with a valid port.");
}

fs.rmSync(dataRoot,{recursive:true,force:true});
fs.mkdirSync(path.join(dataRoot,"config"),{recursive:true,mode:0o700});
fs.writeFileSync(path.join(dataRoot,"config","claudex-workhouse.json"),JSON.stringify({
  host:"127.0.0.1",
  port,
  externalOrigin:baseUrl.origin,
  allowedEmail:"admin@example.com",
  teamDomain:"",
  audience:"",
  authMode:"test",
  promptMaxLength:20000,
  commandTimeoutMs:15000,
  commandOutputLimit:2097152,
  claudeBinary:"runtime/claude-bin/claude"
},null,2),{mode:0o600});
fs.writeFileSync(path.join(dataRoot,"config","projects.json"),JSON.stringify({
  projects:[{id:"claudex-workhouse",name:"Claudex Workhouse",path:appRoot}]
},null,2),{mode:0o600});

Object.assign(process.env,{
  CLAUDEX_WORKHOUSE_APP_ROOT:appRoot,
  CLAUDEX_WORKHOUSE_DATA_ROOT:dataRoot,
  CLAUDEX_WORKHOUSE_AUTH_MODE:"test",
  CLAUDEX_WORKHOUSE_TEST_MODE:"1",
  CLAUDEX_WORKHOUSE_ALLOWED_EMAIL:"admin@example.com",
  CLAUDEX_WORKHOUSE_HOST:"127.0.0.1",
  CLAUDEX_WORKHOUSE_PORT:String(port),
  CLAUDEX_WORKHOUSE_EXTERNAL_ORIGIN:baseUrl.origin
});

await import("../dist-server/index.js");
