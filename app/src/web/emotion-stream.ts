import { setEmotionAssetBaseUrl } from "./collaboration-assets";
import { PersistentEventStream } from "./collaboration-stream";
import { mergeEmotionState } from "./emotion-state";

export type EmotionStreamState={emotion:string;line:string;statusLine:string;lineKey?:string;statusKey?:string;outfit:string;source?:string;sessionId?:string;taskId?:string;timestamp?:number};
export type EmotionAsset={emotion:string;file:string};
export type EmotionProvider="codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok";
export type EmotionTaskStates=Record<EmotionProvider,Record<string,EmotionStreamState>>;
export type EmotionStreamSnapshot={state:EmotionStreamState;codexState:EmotionStreamState;grokState:EmotionStreamState;deepseekState:EmotionStreamState;ollamaState:EmotionStreamState;antigravityState:EmotionStreamState;taskStates:EmotionTaskStates;outfits:string[];outfitsByProvider:Record<EmotionProvider,string[]>;assets:Record<string,EmotionAsset[]>;assetBaseUrl:string;mode:"mcp"|"catch";bootstrapStatus:"pending"|"ready"|"error"};

const neutral=(outfit:string):EmotionStreamState=>({emotion:"neutral",line:"",statusLine:"",outfit});
const emptyTaskStates=():EmotionTaskStates=>({codex:{},claude:{},grok:{},deepseek:{},ollama:{},antigravity:{}});
let snapshot:EmotionStreamSnapshot={state:neutral("normal"),codexState:neutral("Gpt-Sol"),grokState:neutral("Grok"),deepseekState:neutral("DeepSeek"),ollamaState:neutral("Ollama"),antigravityState:neutral("Antigravity"),taskStates:emptyTaskStates(),outfits:["normal","capy"],outfitsByProvider:{codex:["Gpt-Codex","Gpt-Sol"],claude:["normal","capy"],grok:["Grok"],antigravity:["Antigravity","Gemma-e4b"],deepseek:["DeepSeek","Ollama"],ollama:["Ollama","DeepSeek","Antigravity","Gemma-e4b"]},assets:{},assetBaseUrl:location.origin,mode:"mcp",bootstrapStatus:"pending"};
const listeners=new Set<(value:EmotionStreamSnapshot)=>void>();
const EVENT_KEYS:Record<string,"state"|"codexState"|"grokState"|"deepseekState"|"ollamaState"|"antigravityState">={
  "emotion":"state",
  "codex-emotion":"codexState",
  "grok-emotion":"grokState",
  "deepseek-emotion":"deepseekState",
  "ollama-emotion":"ollamaState",
  "antigravity-emotion":"antigravityState"
};
let source:PersistentEventStream|null=null;
let connected=false;
let bootstrapping:Promise<void>|null=null;

function publish(){for(const listener of listeners)listener(snapshot);}
// Each event carries the whole state. The translation keys are absent whenever the
// line is model-authored, so they are reset explicitly instead of surviving the
// merge and mistranslating the next line.
function update(key:"state"|"codexState"|"grokState"|"deepseekState"|"ollamaState"|"antigravityState",value:unknown){
  if(!value||typeof value!=="object")return;
  const next=mergeEmotionState(snapshot[key],value),provider:EmotionProvider=key==="state"?"claude":key==="codexState"?"codex":key==="grokState"?"grok":key==="deepseekState"?"deepseek":key==="ollamaState"?"ollama":"antigravity",taskStates=next.taskId?{...snapshot.taskStates,[provider]:{...snapshot.taskStates[provider],[next.taskId]:next}}:snapshot.taskStates;
  snapshot={...snapshot,[key]:next,taskStates};
  publish();
}
function stop(){source?.stop();source=null;connected=false;}
// A bare EventSource only retries after a transport-level drop. Any HTTP error
// response -- a 502 while the server restarts behind the proxy, or this
// endpoint's own 429 connection cap -- puts it in CLOSED for good, which froze
// every avatar on whatever emotion arrived last (a finished task's "완료" hook
// while the next one was already running). The shared stream reconnects with
// backoff, and each reconnection refetches the snapshot because this endpoint
// publishes no replay of its own.
function start(){
  if(source||!listeners.size||document.visibilityState!=="visible")return;
  source=new PersistentEventStream({
    url:()=>"/api/emotion/stream",
    eventName:Object.keys(EVENT_KEYS),
    visible:()=>document.visibilityState==="visible",
    onEvent:(value,name)=>{const key=EVENT_KEYS[name];if(key)update(key,value);},
    onResync:()=>{void bootstrap();},
    onStatus:status=>{const live=status==="live";if(live&&!connected)void bootstrap();connected=live;}
  });
  source.start();
}
// A tab that was hidden across a state change reopens with a stale snapshot,
// so resynchronize rather than waiting for the next event to arrive.
function visibility(){if(document.visibilityState==="hidden")stop();else{void bootstrap();start();}}
function online(){if(listeners.size&&document.visibilityState==="visible")source?.reconnectNow();}
function bootstrap(){
  if(bootstrapping)return bootstrapping;
  snapshot={...snapshot,bootstrapStatus:"pending"};publish();
  bootstrapping=fetch("/api/emotion",{headers:{Accept:"application/json"}}).then(async response=>{
    if(!response.ok)throw new Error(`emotion ${response.status}`);
    const data=await response.json();
    const assetBaseUrl=typeof data.assetBaseUrl==="string"?data.assetBaseUrl:snapshot.assetBaseUrl;setEmotionAssetBaseUrl(assetBaseUrl);const outfitsByProvider=data.outfitsByProvider&&typeof data.outfitsByProvider==="object"?{...snapshot.outfitsByProvider,...data.outfitsByProvider}:snapshot.outfitsByProvider,taskStates=emptyTaskStates();for(const provider of Object.keys(taskStates) as EmotionProvider[]){const values=data.taskStates?.[provider];if(values&&typeof values==="object")for(const [taskId,state] of Object.entries(values))if(state&&typeof state==="object")taskStates[provider][taskId]=mergeEmotionState(neutral(outfitsByProvider[provider][0]??"normal"),state);}
    snapshot={state:mergeEmotionState(neutral(outfitsByProvider.claude[0]??"normal"),data.state),codexState:mergeEmotionState(neutral(data.codexState?.outfit??"Gpt-Sol"),data.codexState),grokState:mergeEmotionState(neutral(outfitsByProvider.grok[0]??"Grok"),data.grokState),deepseekState:mergeEmotionState(neutral(outfitsByProvider.deepseek[0]??"DeepSeek"),data.deepseekState),ollamaState:mergeEmotionState(neutral(outfitsByProvider.ollama[0]??"Ollama"),data.ollamaState),antigravityState:mergeEmotionState(neutral(outfitsByProvider.antigravity[0]??"Antigravity"),data.antigravityState),taskStates,outfits:Array.isArray(data.outfits)&&data.outfits.length?data.outfits:snapshot.outfits,outfitsByProvider,assets:data.assets&&typeof data.assets==="object"?data.assets:snapshot.assets,assetBaseUrl,mode:data.mode==="catch"?"catch":"mcp",bootstrapStatus:"ready"};publish();
  }).catch(()=>{snapshot={...snapshot,bootstrapStatus:"error"};publish();}).finally(()=>{bootstrapping=null;});
  return bootstrapping;
}

export function subscribeEmotionStream(listener:(value:EmotionStreamSnapshot)=>void){
  const first=listeners.size===0;listeners.add(listener);listener(snapshot);
  if(first){document.addEventListener("visibilitychange",visibility);window.addEventListener("online",online);void bootstrap();start();}
  return()=>{listeners.delete(listener);if(!listeners.size){document.removeEventListener("visibilitychange",visibility);window.removeEventListener("online",online);stop();}};
}
