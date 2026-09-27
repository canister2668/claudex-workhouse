#!/usr/bin/env node
import fs from"node:fs";
import path from"node:path";
import{fileURLToPath}from"node:url";
import{parseClaudeUsage,probeClaudeUsage}from"./claude-usage.js";
import{parsePicker,probeClaudeModels,readRegistry}from"./claude-models.js";
import{cleanTerminal,cloudFailureDetail,createClaudeCloudSession,parseCloudCreated}from"./claude-cloud.js";
import{runClaudeAuth,stdinMessages}from"./claude-auth.js";

/** Entry point with the same arguments and JSON output as the bin/*.py helpers:
 *
 *   cli.js claude-usage  CLAUDE_BINARY PROBE_DIRECTORY | parse
 *   cli.js claude-models CLAUDE_BINARY PROBE_DIRECTORY | parse [CLAUDE_BINARY]
 *   cli.js claude-cloud  CLAUDE_BINARY REPOSITORY TASK bundle|auto | parse
 *   cli.js claude-auth-pty BINARY CWD MODE ATTEMPT_ID MARKER
 */

const print=(value:unknown)=>process.stdout.write(`${JSON.stringify(value)}\n`);
const readStdin=()=>fs.readFileSync(0,"utf8");
function usage(message:string):never{process.stderr.write(`${message}\n`);process.exit(2);}

export async function main(argv:string[]){
  const[tool,...args]=argv;
  if(tool==="claude-usage"){
    if(args[0]==="parse"){print(parseClaudeUsage(readStdin()));return;}
    if(args.length!==2)usage("usage: claude-usage CLAUDE_BINARY PROBE_DIRECTORY | parse");
    print(await probeClaudeUsage(path.resolve(args[0]),path.resolve(args[1])));return;
  }
  if(tool==="claude-models"){
    if(args[0]==="parse"){const parsed=parsePicker(readStdin(),args[1]?readRegistry(args[1]):[]);print({ok:parsed.complete,...parsed});return;}
    if(args.length!==2)usage("usage: claude-models CLAUDE_BINARY PROBE_DIRECTORY | parse [CLAUDE_BINARY]");
    print(await probeClaudeModels(path.resolve(args[0]),path.resolve(args[1])));return;
  }
  if(tool==="claude-cloud"){
    if(args[0]==="parse"){const text=cleanTerminal(readStdin());print({created:parseCloudCreated(text),error:cloudFailureDetail(text)});return;}
    if(args.length!==4||!["bundle","auto"].includes(args[3]))usage("usage: claude-cloud CLAUDE_BINARY REPOSITORY TASK bundle|auto | parse");
    print(await createClaudeCloudSession(args[0],args[1],args[2],args[3] as "bundle"|"auto"));return;
  }
  if(tool==="claude-auth-pty"){
    if(args.length!==5)usage("usage: claude-auth-pty BINARY CWD MODE ATTEMPT_ID MARKER");
    const[binary,cwd,mode,attemptId,marker]=args;
    await runClaudeAuth({binary,cwd,mode,attemptId,marker,messages:stdinMessages(),emit:(event,values={})=>print({event,...values})});
    process.exit(0);
  }
  usage("usage: cli.js claude-usage|claude-models|claude-cloud|claude-auth-pty ...");
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(error=>{process.stderr.write(`${error instanceof Error?error.message:String(error)}\n`);process.exit(1);});
