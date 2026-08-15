#!/usr/bin/env node
import fs from "node:fs";
import readline from "node:readline";

const state=process.env.FAKE_AUTH_STATE;
let cancelled=false;
const send=(value)=>process.stdout.write(`${JSON.stringify(value)}\n`);
readline.createInterface({input:process.stdin}).on("line",(line)=>{
  const message=JSON.parse(line);
  if(message.method==="initialize")return send({id:message.id,result:{}});
  if(message.method==="initialized")return;
  if(message.method==="account/login/start"){
    if(message.params.type==="chatgptDeviceCode"&&process.env.FAKE_DEVICE_UNSUPPORTED==="1")return send({id:message.id,error:{code:-32000,message:"device code not allowed by policy"}});
    const loginId="login-fake";
    send({id:message.id,result:message.params.type==="chatgptDeviceCode"?{type:"chatgptDeviceCode",loginId,userCode:"ABCD-EFGH",verificationUrl:"https://auth.openai.com/codex/device"}:{type:"chatgpt",loginId,authUrl:"https://auth.openai.com/oauth/authorize"}});
    setTimeout(()=>{if(cancelled)return;fs.writeFileSync(state,"1");send({method:"account/login/completed",params:{loginId,success:true}});},120);
    return;
  }
  if(message.method==="account/login/cancel"){cancelled=true;return send({id:message.id,result:{}});}
  if(message.method==="account/read")return send({id:message.id,result:fs.existsSync(state)?{requiresOpenaiAuth:true,account:{type:"chatgpt",email:"masked@example.com",planType:"pro"}}:{requiresOpenaiAuth:true,account:null}});
  if(message.method==="account/logout"){fs.rmSync(state,{force:true});return send({id:message.id,result:{}});}
  send({id:message.id,result:{}});
});
