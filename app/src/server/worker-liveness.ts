import fs from"node:fs";
import{spawnSync}from"node:child_process";

/** Worker process liveness and stop requests on native Windows.
 *
 * On Linux the server proves a task worker is still the process it launched
 * from `/proc/<pid>/stat` and `/proc/<pid>/cmdline`, and stops it by signalling
 * its process group. Windows has neither: there is no `/proc`, a negative PID
 * is not a process group, and an external SIGTERM terminates node outright
 * without running the worker's own shutdown handler.
 *
 * The worker therefore holds `<state>.alive` open with an exclusive share mode
 * for its whole life. The handle is not inherited by the provider CLI, so it
 * closes exactly when the worker process ends, however it ends. The server
 * answers "is it still running?" by trying to open that file: a sharing
 * violation means the worker is alive. That is synchronous, needs no
 * PowerShell, and a reused PID cannot fake it.
 *
 * A stop is a `<state>.stop` request file. The worker polls for it and runs the
 * same shutdown path SIGTERM runs on Linux, so Codex interrupts its turn and the
 * state file records `stopped`. Only if that does not finish in time does the
 * server end the process tree. */

// libuv's UV_FS_O_EXLOCK: CreateFileW with share mode 0. Node does not export
// the constant, but libuv honours the bit on every Windows release.
const UV_FS_O_EXLOCK=0x10000000;
const heldLocks=new Map<string,number>();

export const livenessFile=(stateFile:string)=>`${stateFile}.alive`;
export const stopRequestFile=(stateFile:string)=>`${stateFile}.stop`;
export const usesWindowsWorkerLiveness=(platform:NodeJS.Platform=process.platform)=>platform==="win32";

/** Called once by a worker script. A no-op outside Windows. */
export function holdWorkerLiveness(stateFile:string,platform:NodeJS.Platform=process.platform){
  if(!usesWindowsWorkerLiveness(platform)||heldLocks.has(stateFile))return;
  try{fs.rmSync(stopRequestFile(stateFile),{force:true});}catch{}
  const fd=fs.openSync(livenessFile(stateFile),fs.constants.O_RDWR|fs.constants.O_CREAT|UV_FS_O_EXLOCK,0o600);
  heldLocks.set(stateFile,fd);
}

/** True while the worker that owns `stateFile` is running. */
export function workerLivenessHeld(stateFile:string){
  try{fs.closeSync(fs.openSync(livenessFile(stateFile),"r"));return false;}
  catch(error){const code=(error as NodeJS.ErrnoException)?.code;return code==="EBUSY"||code==="EPERM"||code==="EACCES";}
}

/** Polls for a stop request and runs `stop` once. A no-op outside Windows,
 * where the server delivers SIGTERM instead. */
export function watchStopRequest(stateFile:string,stop:()=>void,platform:NodeJS.Platform=process.platform,intervalMs=250){
  if(!usesWindowsWorkerLiveness(platform))return()=>{};
  let fired=false;
  const timer=setInterval(()=>{if(fired||!fs.existsSync(stopRequestFile(stateFile)))return;fired=true;clearInterval(timer);try{fs.rmSync(stopRequestFile(stateFile),{force:true});}catch{}stop();},intervalMs);
  timer.unref?.();
  return()=>clearInterval(timer);
}

export function requestWorkerStop(stateFile:string){fs.writeFileSync(stopRequestFile(stateFile),`${new Date().toISOString()}\n`,{mode:0o600});}

/** Ends a worker and everything it started (the provider CLI and its tools). */
export function terminateWindowsProcessTree(pid:number){
  if(!Number.isSafeInteger(pid)||pid<=0)return;
  spawnSync("taskkill.exe",["/PID",String(pid),"/T","/F"],{shell:false,windowsHide:true,stdio:"ignore",timeout:10_000});
}

/** Server-side stop for Windows: request a graceful stop, wait for the worker
 * to exit, then end the process tree. Returns once the worker is gone. */
export async function stopWindowsWorker(stateFile:string,pid:number|null|undefined,graceMs=5000){
  try{requestWorkerStop(stateFile);}catch{}
  for(const deadline=Date.now()+graceMs;Date.now()<deadline;){
    if(!workerLivenessHeld(stateFile))break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(workerLivenessHeld(stateFile)&&pid)terminateWindowsProcessTree(pid);
  for(let attempt=0;attempt<30&&workerLivenessHeld(stateFile);attempt++)await new Promise(resolve=>setTimeout(resolve,100));
  try{fs.rmSync(stopRequestFile(stateFile),{force:true});}catch{}
}

/** A worker ended by the process-tree fallback never wrote its own terminal
 * state; record the stop the user asked for rather than a lost worker. */
export function markWorkerStateStopped(stateFile:string){
  try{
    const state=JSON.parse(fs.readFileSync(stateFile,"utf8"));
    if(!["pending","queued","running","waiting","unknown"].includes(state.status))return;
    const updatedAt=new Date().toISOString(),temporary=`${stateFile}.${process.pid}.stop.tmp`;
    fs.writeFileSync(temporary,`${JSON.stringify({...state,status:"stopped",updatedAt,error:null})}\n`,"utf8");fs.renameSync(temporary,stateFile);
  }catch{/* the DB row still records the stop */}
}

