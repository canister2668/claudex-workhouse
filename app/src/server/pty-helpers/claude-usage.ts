import fs from"node:fs";
import path from"node:path";
import{startTerminal,type TerminalFactory}from"./terminal.js";

/** Node port of bin/claude-usage.py for hosts without a POSIX pty (Windows).
 * The parser is the same expressions; tests hold the two to identical output. */

function percentage(section:string){
  const match=/((?:\d{1,3}%\s+)+)used\b/i.exec(section);
  if(!match)return null;
  const values=[...match[1].matchAll(/(\d{1,3})%/g)].map(item=>Number(item[1]));
  return values.length?Math.max(0,Math.min(100,values[values.length-1])):null;
}
function resetLabel(section:string){
  const match=/Resets\s+((?:[A-Z][a-z]{2}\s+\d{1,2},\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm))\s+\(([^)]+)\)/i.exec(section);
  return match?`${match[1]} (${match[2]})`:null;
}
function section(text:string,start:RegExp,ends:RegExp[]){
  const match=start.exec(text);
  if(!match)return"";
  const from=match.index+match[0].length,rest=text.slice(from);let finish=text.length;
  for(const end of ends){const candidate=end.exec(rest);if(candidate)finish=Math.min(finish,from+candidate.index);}
  return text.slice(from,finish);
}
export function parseClaudeUsage(text:string){
  const current=section(text,/Current session\b/i,[/Current week\b/i]);
  const weekly=section(text,/Current week\s*\(all models\)/i,[/Current week\s*\((?!all models)[^)]+\)/i,/What's contributing/i,/Usage credits/i]);
  const currentPct=percentage(current),weeklyPct=percentage(weekly),plan=/\bClaude\s+(Free|Pro|Max|Team|Enterprise)\b/.exec(text);
  return{
    ok:currentPct!==null||weeklyPct!==null,
    source:"claude-cli-usage",
    plan:plan?plan[1]:null,
    five_hour:currentPct===null?null:{utilization:currentPct,resets_at:null,reset_label:resetLabel(current)},
    seven_day:weeklyPct===null?null:{utilization:weeklyPct,resets_at:null,reset_label:resetLabel(weekly)}
  };
}

const RATE_LIMIT=/Usage endpoint is rate limited/i;
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

/** The CLI environment every screen probe uses: no updater, no colour, and no
 * inherited CLAUDE_CONFIG_DIR (it sends the CLI into first-run onboarding). */
export function probeEnvironment(cols:number,rows:number,environment:NodeJS.ProcessEnv=process.env){
  const env:NodeJS.ProcessEnv={...environment,DISABLE_AUTOUPDATER:"1",NO_COLOR:"1",TERM:"xterm-256color",COLUMNS:String(cols),LINES:String(rows)};
  delete env.CLAUDE_CONFIG_DIR;
  return env;
}
export const PROBE_ARGS=["--ax-screen-reader","--safe-mode","--no-chrome","--permission-mode","plan"];

export async function probeClaudeUsage(binary:string,cwd:string,options:{terminal?:TerminalFactory;retrySpacingMs?:number;timeoutMs?:number}={}){
  fs.mkdirSync(cwd,{recursive:true,mode:0o700});
  const retrySpacing=options.retrySpacingMs??Number(process.env.CLAUDE_USAGE_RETRY_SECONDS??"6")*1000,limit=options.timeoutMs??60_000;
  const terminal=(options.terminal??startTerminal)({binary:path.resolve(binary),args:PROBE_ARGS,cwd:path.resolve(cwd),env:probeEnvironment(100,40),cols:100,rows:40});
  let started=Date.now(),trusted=false,importsAnswered=false,usageSent=false,exitSent=false,rateLimited=false,retries=0,retryAt=0;
  let result:ReturnType<typeof parseClaudeUsage>|null=null;
  try{
    while(Date.now()-started<limit){
      await terminal.settle(250);
      const text=terminal.text();
      if(!trusted&&text.includes("Quick safety check")&&(text.includes("Enter y/n")||text.includes("Enter to confirm"))){
        // Claudex Workhouse owns this empty probe directory; safe mode keeps
        // repository hooks and settings out of the probe.
        terminal.write("y\r");trusted=true;started=Date.now();continue;
      }
      if(!importsAnswered&&text.includes("Allow external CLAUDE.md file imports?")&&(text.includes("Enter y/n")||text.includes("Enter to confirm"))){
        terminal.write("n\r");importsAnswered=true;started=Date.now();continue;
      }
      if(!usageSent&&Date.now()-started>1500&&(text.includes("plan mode on")||text.includes("manual mode on"))){terminal.write("/usage\r");usageSent=true;}
      if(usageSent&&RATE_LIMIT.test(text)){
        rateLimited=true;
        if(retries<3&&Date.now()-retryAt>retrySpacing){terminal.write("r");retries++;retryAt=Date.now();terminal.clearHistory();continue;}
        if(Date.now()-retryAt>retrySpacing)break;
      }
      if(usageSent){
        const candidate=parseClaudeUsage(text);
        if(candidate.ok){
          result=candidate;
          if(!exitSent){terminal.write("\x1b");await sleep(150);terminal.write("/exit\r");exitSent=true;}
        }
        if(exitSent&&Date.now()-started>2000)break;
      }
      if(terminal.closed)break;
    }
  }finally{terminal.kill();await Promise.race([terminal.exit,sleep(3000)]);}
  return result??{ok:false,source:"claude-cli-usage",error:rateLimited?"rate_limited":"unavailable"};
}
