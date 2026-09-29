import fs from"node:fs";
import path from"node:path";
import{managedCodexBinary}from"../codex-runtime.js";
import{discoverWindowsProvider,type WindowsProviderBinaryRecord,type WindowsProviderDiscovery,type WindowsProviderId}from"./provider-discovery.js";

/** Provider CLI discovery for the Windows server's direct execution path.
 *
 * The Windows server runs Claude Code and Codex itself, exactly like the Linux
 * server, instead of through a loopback Worker. Linux finds its CLIs at fixed
 * container paths; a Windows user has them wherever the official installer put
 * them (`~/.local/bin`, `%LOCALAPPDATA%\Programs\...`, PATH, the desktop app).
 * This reuses the Worker's verified discovery (reparse points rejected, only a
 * `<provider>.exe` that answers `--version`) and applies the result to the two
 * places the direct path reads: `config.claudeBinary` and
 * `CLAUDEX_WORKHOUSE_CODEX_BIN`.
 *
 * A runtime installed from the in-app setup (`runtime/claude-bin`,
 * `runtime/codex-bin`) always wins, because that is what auto-update keeps
 * current. An explicit CLAUDEX_WORKHOUSE_CLAUDE_BIN / _CODEX_BIN set by the user
 * is never replaced. */

type Records=Partial<Record<WindowsProviderId,WindowsProviderBinaryRecord>>;
export type WindowsDirectProviderState=Partial<Record<WindowsProviderId,WindowsProviderDiscovery>>;

const recordFile=(dataRoot:string)=>path.join(dataRoot,"config","windows-provider-binaries.json");
function readRecords(dataRoot:string):Records{try{const value=JSON.parse(fs.readFileSync(recordFile(dataRoot),"utf8"));return value&&typeof value==="object"?value:{};}catch{return{};}}
function writeRecords(dataRoot:string,records:Records){
  const file=recordFile(dataRoot),temporary=`${file}.${process.pid}.tmp`;
  try{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(temporary,`${JSON.stringify(records,null,2)}\n`,{mode:0o600});fs.renameSync(temporary,file);}catch{fs.rmSync(temporary,{force:true});}
}
const managedClaudeBinary=(dataRoot:string)=>path.join(dataRoot,"runtime","claude-bin","claude.exe");
const isFile=(file:string)=>{try{return fs.statSync(file).isFile();}catch{return false;}};

// Values this module wrote, so a later refresh can withdraw them without
// touching anything the user configured.
let appliedCodexBinary:string|null=null;
let lastState:WindowsDirectProviderState={};
let pending:Promise<WindowsDirectProviderState>|null=null;

export function windowsDirectProviderState(){return lastState;}

export async function refreshWindowsDirectProviders(input:{dataRoot:string;config:{claudeBinary:string};environment?:NodeJS.ProcessEnv;discover?:typeof discoverWindowsProvider}):Promise<WindowsDirectProviderState>{
  if(pending)return pending;
  pending=(async()=>{
    const environment=input.environment??process.env,discover=input.discover??discoverWindowsProvider,records=readRecords(input.dataRoot),state:WindowsDirectProviderState={};
    // Claude Code
    const claudeOverride=environment.CLAUDEX_WORKHOUSE_CLAUDE_BIN?.trim(),managedClaude=managedClaudeBinary(input.dataRoot);
    if(!claudeOverride&&isFile(managedClaude))input.config.claudeBinary=managedClaude;
    else if(!claudeOverride){
      const result=await discover({provider:"claude",record:records.claude}).catch(()=>null);
      if(result){records.claude=result.record;state.claude=result.discovery;if(result.discovery.binaryPath)input.config.claudeBinary=result.discovery.binaryPath;}
    }
    // Codex
    if(appliedCodexBinary&&environment.CLAUDEX_WORKHOUSE_CODEX_BIN===appliedCodexBinary)delete environment.CLAUDEX_WORKHOUSE_CODEX_BIN;
    appliedCodexBinary=null;
    if(!environment.CLAUDEX_WORKHOUSE_CODEX_BIN?.trim()&&!isFile(managedCodexBinary(input.dataRoot))){
      const result=await discover({provider:"codex",record:records.codex}).catch(()=>null);
      if(result){records.codex=result.record;state.codex=result.discovery;if(result.discovery.binaryPath){environment.CLAUDEX_WORKHOUSE_CODEX_BIN=result.discovery.binaryPath;appliedCodexBinary=result.discovery.binaryPath;}}
    }
    writeRecords(input.dataRoot,records);
    lastState=state;
    return state;
  })().finally(()=>{pending=null;});
  return pending;
}
