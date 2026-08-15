export type StreamStatus="live"|"delayed"|"offline";
// `eventName` accepts a list for endpoints that publish several named events
// over one connection; the handler is told which one arrived.
type Options={url:()=>string;eventName:string|readonly string[];onEvent:(value:any,eventName:string)=>void;onResync:(value:any)=>void;onStatus:(status:StreamStatus)=>void;onWatchdog?:()=>void;visible?:()=>boolean};

export class PersistentEventStream{
  private source:EventSource|null=null;private retry=0;private reconnectTimer:ReturnType<typeof setTimeout>|null=null;private watchdog:ReturnType<typeof setInterval>|null=null;private stopped=true;
  constructor(private options:Options){}
  start(){this.stopped=false;this.connect();}
  stop(){this.stopped=true;this.source?.close();this.source=null;if(this.reconnectTimer)clearTimeout(this.reconnectTimer);this.reconnectTimer=null;this.stopWatchdog();}
  reconnectNow(){if(this.stopped)return;this.source?.close();this.source=null;if(this.reconnectTimer)clearTimeout(this.reconnectTimer);this.reconnectTimer=null;this.retry=0;this.connect();}
  private stopWatchdog(){if(this.watchdog)clearInterval(this.watchdog);this.watchdog=null;}
  private startWatchdog(){if(this.watchdog||!this.options.onWatchdog)return;this.watchdog=setInterval(()=>{if(!this.stopped&&(!this.options.visible||this.options.visible()))this.options.onWatchdog?.();},20_000);}
  private schedule(){if(this.stopped||this.reconnectTimer)return;this.options.onStatus(navigator.onLine?"delayed":"offline");this.startWatchdog();const base=Math.min(30_000,1000*2**Math.min(this.retry++,5)),delay=base+Math.floor(Math.random()*Math.min(1000,base/4));this.reconnectTimer=setTimeout(()=>{this.reconnectTimer=null;this.connect();},delay);}
  private connect(){if(this.stopped||this.source||this.options.visible&&!this.options.visible())return;if(!navigator.onLine){this.schedule();return;}this.options.onStatus("delayed");const source=new EventSource(this.options.url());this.source=source;source.addEventListener("open",()=>{if(this.source!==source)return;this.retry=0;this.stopWatchdog();this.options.onStatus("live");});for(const name of Array.isArray(this.options.eventName)?this.options.eventName:[this.options.eventName as string])source.addEventListener(name,message=>{if(this.source!==source)return;try{this.options.onEvent(JSON.parse((message as MessageEvent).data),name);}catch{}});source.addEventListener("resync",message=>{if(this.source!==source)return;try{this.options.onResync(JSON.parse((message as MessageEvent).data));}catch{this.options.onResync({});}});source.onerror=()=>{if(this.source!==source)return;source.close();this.source=null;this.schedule();};}
}
