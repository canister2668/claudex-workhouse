import fs from"node:fs";
import path from"node:path";
import{spawn,type ChildProcess}from"node:child_process";
import{fileURLToPath}from"node:url";
import{VirtualScreen}from"./virtual-screen.js";

/** A program running in a terminal, read as screen text.
 *
 * Windows: `claudex-conpty-bridge.exe` (built with the launcher) hosts the
 * program in a ConPTY and relays it over pipes. POSIX: util-linux `script`
 * provides the pty. Either way the output is replayed into a VirtualScreen and
 * callers see the text a person would see. */
export interface Terminal{
  write(data:string):void;
  text():string;
  clearHistory():void;
  readonly closed:boolean;
  /** Resolves on the next output chunk or after `ms`, whichever is first. */
  settle(ms:number):Promise<void>;
  kill():void;
  exit:Promise<number|null>;
}
export type TerminalOptions={binary:string;args:string[];cwd:string;env:NodeJS.ProcessEnv;cols:number;rows:number};
export type TerminalFactory=(options:TerminalOptions)=>Terminal;

export function conptyBridgePath(environment:NodeJS.ProcessEnv=process.env){
  const configured=environment.CLAUDEX_WORKHOUSE_CONPTY_BRIDGE?.trim();
  if(configured)return configured;
  // payload/<version>/app/dist-server/pty-helpers/terminal.js -> payload/<version>/bin
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..","..","..","bin","claudex-conpty-bridge.exe");
}

const shellQuote=(value:string)=>`'${value.replaceAll("'","'\\''")}'`;

function wrap(child:ChildProcess,cols:number,rows:number):Terminal{
  const screen=new VirtualScreen(cols,rows);let closed=false;const waiters=new Set<()=>void>();
  const wake=()=>{for(const waiter of [...waiters])waiter();};
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data",(chunk:string)=>{screen.write(chunk);wake();});
  child.stderr?.on("data",()=>{/* diagnostics may contain account material; never kept */});
  child.stdin?.on("error",()=>{/* the program may exit before a final write */});
  const exit=new Promise<number|null>(resolve=>{
    child.once("error",()=>{closed=true;wake();resolve(null);});
    child.once("close",code=>{closed=true;wake();resolve(code);});
  });
  return{
    write:data=>{if(!closed&&child.stdin&&!child.stdin.destroyed)child.stdin.write(data);},
    text:()=>screen.text(),
    clearHistory:()=>screen.clearHistory(),
    get closed(){return closed;},
    settle:ms=>new Promise<void>(resolve=>{if(closed){resolve();return;}const done=()=>{clearTimeout(timer);waiters.delete(done);resolve();};const timer=setTimeout(done,ms);waiters.add(done);}),
    kill:()=>{if(!closed)try{child.kill();}catch{}},
    exit
  };
}

export const startTerminal:TerminalFactory=options=>{
  fs.mkdirSync(options.cwd,{recursive:true});
  if(process.platform==="win32"){
    const bridge=conptyBridgePath(options.env);
    const child=spawn(bridge,["--cols",String(options.cols),"--rows",String(options.rows),"--cwd",options.cwd,"--parent-pid",String(process.pid),"--",options.binary,...options.args],{cwd:options.cwd,env:options.env,shell:false,windowsHide:true,stdio:["pipe","pipe","pipe"]});
    return wrap(child,options.cols,options.rows);
  }
  const command=`stty cols ${options.cols} rows ${options.rows} 2>/dev/null; exec ${[options.binary,...options.args].map(shellQuote).join(" ")}`;
  const child=spawn("script",["-q","-f","-e","-c",command,"/dev/null"],{cwd:options.cwd,env:{...options.env,SHELL:"/bin/sh"},shell:false,stdio:["pipe","pipe","pipe"]});
  return wrap(child,options.cols,options.rows);
};
