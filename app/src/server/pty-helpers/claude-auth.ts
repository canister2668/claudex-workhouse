import path from"node:path";
import fs from"node:fs";
import readline from"node:readline";
import{startTerminal,type TerminalFactory}from"./terminal.js";

/** Node port of bin/claude-auth-pty.py for hosts without a POSIX pty (Windows).
 *
 * Runs `claude auth login` in a terminal and reports only safe state events as
 * JSON lines; the parent answers with `{"type":"code","value":...}` or
 * `{"type":"cancel"}`. Raw terminal output and the submitted code never leave
 * this process, exactly as with the Python helper, so the web UI's paste-the-
 * code login works on Windows too (including from another device). */

const URL_PATTERN=/https:\/\/[^\s\x00-\x20<>"']{1,2048}/g;
const CODE_PROMPT=/(?:paste|enter|input)[^\r\n]{0,80}(?:code|token)|(?:code|token)[^\r\n]{0,80}(?:paste|enter|input)/i;
const CODE_FORMAT=/^[A-Za-z0-9._~+/=:#-]+$/;
const TIMEOUT_MS=300_000;
const FLAGS:Record<string,string[]>={subscription:[],console:["--console"],sso:["--sso"]};

type Emit=(event:string,values?:Record<string,unknown>)=>void;
export type AuthInput={onMessage(listener:(message:any)=>void):void;onClose(listener:()=>void):void};

export async function runClaudeAuth(input:{binary:string;cwd:string;mode:string;attemptId:string;marker:string;emit:Emit;messages:AuthInput;terminal?:TerminalFactory;timeoutMs?:number}){
  if(!(input.mode in FLAGS))throw new Error("unsupported login mode");
  if(!path.isAbsolute(input.binary)||!fs.statSync(input.cwd,{throwIfNoEntry:false})?.isDirectory())throw new Error("invalid runtime or working directory");
  const env={...process.env,DISABLE_AUTOUPDATER:"1",NO_COLOR:"1",TERM:"xterm-256color"};
  // Wide enough that an authorization URL is never wrapped by the terminal.
  const terminal=(input.terminal??startTerminal)({binary:input.binary,args:["auth","login",...FLAGS[input.mode]],cwd:input.cwd,env,cols:1000,rows:50});
  let cancelled=false,codeRequired=false,codeSubmitted=false;const seen=new Set<string>();
  input.messages.onClose(()=>{cancelled=true;});
  input.messages.onMessage(message=>{
    if(message?.type==="cancel"){cancelled=true;return;}
    if(message?.type==="code"&&!codeSubmitted){
      const value=message.value;
      if(typeof value==="string"&&value.length>=1&&value.length<=512&&CODE_FORMAT.test(value)){
        terminal.write(`${value}\r`);codeSubmitted=true;message.value="";input.emit("helper/verifying");
      }
    }
  });
  input.emit("helper/start",{attemptId:input.attemptId,marker:input.marker,uid:process.getuid?.()??null,gid:process.getgid?.()??null,home:process.env.HOME??""});
  const started=Date.now(),limit=input.timeoutMs??TIMEOUT_MS;let previous="";
  try{
    for(;;){
      if(cancelled){input.emit("helper/cancelled");return;}
      if(Date.now()-started>=limit){input.emit("helper/timeout");return;}
      await terminal.settle(200);
      const text=terminal.text().replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,"");
      // A pseudo console paints a long line in several frames, so a URL can be
      // on screen only in part. Read URLs only once the screen has held still
      // for a whole settle period; a partial URL is never reported.
      const stable=text===previous;previous=text;
      // The code prompt is read on the same settled screen, after its URL, so
      // the web UI always has the link before it asks for the code.
      if(stable||terminal.closed){
        for(const match of text.matchAll(URL_PATTERN)){
          const candidate=match[0].replace(/[.,);\]]+$/,"");
          if(!seen.has(candidate)){seen.add(candidate);input.emit("helper/url",{url:candidate});}
        }
        if(!codeRequired&&CODE_PROMPT.test(text)){codeRequired=true;input.emit("helper/code-required");}
      }
      if(terminal.closed){const code=await terminal.exit;input.emit("helper/exit",{exitCode:typeof code==="number"?code:1});return;}
    }
  }finally{terminal.kill();}
}

/** stdin JSON lines as an AuthInput. */
export function stdinMessages(stream:NodeJS.ReadableStream=process.stdin):AuthInput{
  const lines=readline.createInterface({input:stream});
  return{
    onMessage:listener=>lines.on("line",line=>{if(line.length>4096)return;try{listener(JSON.parse(line));}catch{}}),
    onClose:listener=>lines.on("close",listener)
  };
}
