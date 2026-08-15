import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { workerConfigFile, workerHome } from "./config.js";

function cliFile(){return path.join(path.dirname(fileURLToPath(import.meta.url)),"cli.js");}
function linuxServiceFile(){return path.join(os.homedir(),".config","systemd","user","claudex-workhouse-worker.service");}
function macServiceFile(){return path.join(os.homedir(),"Library","LaunchAgents","workhouse.claudex.worker.plist");}
const windowsTask="ClaudexWorkhouseWorker";

export function systemdExecArgument(value:string){
  if(!value||/[\u0000\r\n]/.test(value))throw new Error("Invalid systemd executable path.");
  return `"${value.replaceAll("\\","\\\\").replaceAll('"','\\"').replaceAll("%","%%")}"`;
}

export function serviceStatus(){
  if(process.platform==="linux")return{supported:true,installed:fs.existsSync(linuxServiceFile()),type:"systemd-user"};
  if(process.platform==="darwin")return{supported:true,installed:fs.existsSync(macServiceFile()),type:"launchd-user"};
  if(process.platform==="win32"){const installed=spawnSync("schtasks.exe",["/Query","/TN",windowsTask],{shell:false,windowsHide:true,stdio:"ignore"}).status===0;return{supported:true,installed,type:"current-user-logon-task"};}
  return{supported:false,installed:false,type:"unsupported"};
}

export function installService(){
  if(typeof process.getuid==="function"&&process.getuid()===0)throw new Error("Worker service must not be installed as root.");
  // A product rename must replace the existing launch entry instead of
  // leaving two workers racing over the same retained configuration.
  uninstallService();
  const executable=cliFile();
  if(process.platform==="linux"){
    const file=linuxServiceFile();fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
    const content=`[Unit]\nDescription=Claudex Workhouse Desktop Worker\nAfter=network-online.target\n\n[Service]\nExecStart=${systemdExecArgument(process.execPath)} ${systemdExecArgument(executable)} run\nRestart=on-failure\nRestartSec=5\nNoNewPrivileges=true\n\n[Install]\nWantedBy=default.target\n`;
    fs.writeFileSync(file,content,{mode:0o600});spawnSync("systemctl",["--user","daemon-reload"],{stdio:"ignore"});const result=spawnSync("systemctl",["--user","enable","--now","claudex-workhouse-worker.service"],{stdio:"ignore"});if(result.status!==0)throw new Error("systemd user service installation failed.");return{installed:true,type:"systemd-user",file};
  }
  if(process.platform==="darwin"){
    const file=macServiceFile();fs.mkdirSync(path.dirname(file),{recursive:true});const plist=`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>workhouse.claudex.worker</string><key>ProgramArguments</key><array><string>${process.execPath}</string><string>${executable}</string><string>run</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/></dict></plist>`;fs.writeFileSync(file,plist,{mode:0o600});const result=spawnSync("launchctl",["load",file],{stdio:"ignore"});if(result.status!==0)throw new Error("launchd user agent installation failed.");return{installed:true,type:"launchd-user",file};
  }
  if(process.platform==="win32"){
    const command=`\"${process.execPath}\" \"${executable}\" run`;const result=spawnSync("schtasks.exe",["/Create","/F","/SC","ONLOGON","/RL","LIMITED","/TN",windowsTask,"/TR",command],{shell:false,windowsHide:true,stdio:"ignore"});if(result.status!==0)throw new Error("Windows logon task installation failed.");spawnSync("schtasks.exe",["/Run","/TN",windowsTask],{shell:false,windowsHide:true,stdio:"ignore"});return{installed:true,type:"current-user-logon-task"};
  }
  throw new Error("Unsupported platform.");
}

export function uninstallService(){
  if(process.platform==="linux"){spawnSync("systemctl",["--user","disable","--now","claudex-workhouse-worker.service"],{stdio:"ignore"});fs.rmSync(linuxServiceFile(),{force:true});spawnSync("systemctl",["--user","daemon-reload"],{stdio:"ignore"});}
  else if(process.platform==="darwin"){const file=macServiceFile();spawnSync("launchctl",["unload",file],{stdio:"ignore"});fs.rmSync(file,{force:true});}
  else if(process.platform==="win32"){spawnSync("schtasks.exe",["/End","/TN",windowsTask],{shell:false,windowsHide:true,stdio:"ignore"});spawnSync("schtasks.exe",["/Delete","/F","/TN",windowsTask],{shell:false,windowsHide:true,stdio:"ignore"});}
  return{uninstalled:true,configurationRetained:fs.existsSync(workerConfigFile()),home:workerHome()};
}
