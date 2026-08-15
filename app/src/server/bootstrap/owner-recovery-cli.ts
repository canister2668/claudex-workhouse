#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ownerRecoveryMessage } from "./owner-claim.js";

function argument(name:string){
  const index=process.argv.indexOf(name);
  return index>=0?process.argv[index+1]:undefined;
}

const root=process.env.CLAUDEX_WORKHOUSE_ROOT??"/opt/claudex-workhouse";
const port=Number(process.env.CLAUDEX_WORKHOUSE_PORT??3410);
const rawUrl=argument("--url")??`http://127.0.0.1:${port}`;
let serverUrl:URL;
try{serverUrl=new URL(rawUrl);}catch{throw new Error("--url must be a loopback HTTP URL.");}
if(serverUrl.protocol!=="http:"||!["127.0.0.1","localhost","::1"].includes(serverUrl.hostname)||serverUrl.username||serverUrl.password)throw new Error("--url must be a direct loopback HTTP URL.");

const identityFile=path.join(root,"data","infrastructure","server-identity.json");
const identity=JSON.parse(fs.readFileSync(identityFile,"utf8")) as{installationId?:unknown;privateKeyPem?:unknown};
if(typeof identity.installationId!=="string"||typeof identity.privateKeyPem!=="string")throw new Error("The server identity file is invalid.");

const issuedAt=Date.now(),nonce=crypto.randomUUID(),message=ownerRecoveryMessage(identity.installationId,issuedAt,nonce);
const signature=crypto.sign(null,Buffer.from(message),crypto.createPrivateKey(identity.privateKeyPem)).toString("base64url");
const endpoint=new URL("/api/bootstrap/owner-claim/recover",serverUrl);
const response=await fetch(endpoint,{
  method:"POST",
  headers:{"Content-Type":"application/json","X-Claudex-Workhouse-Request":"1"},
  body:JSON.stringify({issuedAt,nonce,signature}),
  redirect:"error"
});
const body=await response.json().catch(()=>null) as{claimUrl?:unknown;qr?:unknown;error?:unknown}|null;
if(!response.ok)throw new Error(typeof body?.error==="string"?body.error:`Owner recovery failed with HTTP ${response.status}.`);
if(typeof body?.claimUrl!=="string")throw new Error("Owner recovery did not return a claim URL.");
process.stdout.write(`A new one-time owner claim was created.\n${body.claimUrl}\n${JSON.stringify(body.qr)}\n`);
