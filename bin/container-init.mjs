#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const env=name=>process.env[`CLAUDEX_WORKHOUSE_${name}`];
const root=env("ROOT")||"/opt/claudex-workhouse",configDir=path.join(root,"config");
fs.mkdirSync(configDir,{recursive:true,mode:0o700});
for(const dir of ["data","logs","run","runtime/bin","runtime/claude-bin","runtime/codex-bin","runtime/home","snapshots","workspaces"])fs.mkdirSync(path.join(root,dir),{recursive:true,mode:0o700});
const configFile=path.join(configDir,"claudex-workhouse.json"),projectsFile=path.join(configDir,"projects.json");
if(!fs.existsSync(configFile)){
  const origin=env("EXTERNAL_ORIGIN")||"http://127.0.0.1:3410";
  const config={host:"0.0.0.0",port:Number(env("PORT")||3410),externalOrigin:origin,allowedEmail:env("ALLOWED_EMAIL")||"admin@example.invalid",teamDomain:env("TEAM_DOMAIN")||"",audience:env("AUDIENCE")||"",authMode:env("AUTH_MODE")||"local",promptMaxLength:20000,commandTimeoutMs:30000,commandOutputLimit:2097152,claudeBinary:"runtime/claude-bin/claude",workspaceRoots:[{path:path.join(root,"workspaces"),displayName:"Claudex Workhouse Workspaces",allowCreate:true,allowRegister:true,allowClone:true,allowDelete:false}],installationId:crypto.randomUUID()};
  fs.writeFileSync(configFile,`${JSON.stringify(config,null,2)}\n`,{mode:0o600,flag:"wx"});
}
if(!fs.existsSync(projectsFile))fs.writeFileSync(projectsFile,'{"projects":[]}\n',{mode:0o600,flag:"wx"});
for(const file of [configFile,projectsFile])try{fs.chmodSync(file,0o600);}catch{}
