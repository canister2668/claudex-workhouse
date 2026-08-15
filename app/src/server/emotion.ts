import crypto from"node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

// Mirrors the VS Code emotion panel's data source: the provider-worker state.json.
// Writers replace atomically under a lock, so we watch the *directory* (rename-safe),
// debounce 60ms like the extension, and keep the last good snapshot when a read
// races a partial write. Values that end up in asset URLs are sanitized here.

// lineKey/statusKey are i18n keys for canned worker/hook copy. When present the UI
// renders them in the user's language and ignores the literal line/statusLine.
export type EmotionState = { emotion: string; line: string; statusLine: string; lineKey?: string; statusKey?: string; outfit: string; source?: string; sessionId?: string; taskId?: string; timestamp?: number };
export type EmotionAsset = { emotion: string; file: string };
export type EmotionProvider = "codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok";
export const PROVIDER_EMOTION_OUTFITS:Record<EmotionProvider,readonly string[]>={
  codex:["Gpt-Codex","Gpt-Sol"],
  claude:["normal","capy"],
  antigravity:["Antigravity","Gemma-e4b"],
  grok:["Grok"],
  deepseek:["DeepSeek","Ollama"],
  ollama:["Ollama","DeepSeek","Antigravity","Gemma-e4b"]
};
const DEFAULT_STATE: EmotionState = { emotion: "neutral", line: "", statusLine: "", outfit: "normal" };
const slug = (value: unknown, fallback: string) => {
  const clean = String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  return clean || fallback;
};
// Keys reach the DOM through a dictionary lookup, so restrict them to the shape
// real keys have rather than trusting whatever the state file holds.
const translationKey = (value: unknown) => {
  const clean = String(value ?? "").slice(0, 60);
  return /^avatar\.[a-z]+\.[a-zA-Z0-9_]+$/.test(clean) ? clean : undefined;
};

export class EmotionWatcher {
  private state: EmotionState = DEFAULT_STATE;
  private listeners = new Set<(state: EmotionState) => void>();
  private debounce: NodeJS.Timeout | null = null;
  private watcher: fs.FSWatcher | null = null;
  private poll: NodeJS.Timeout | null = null;
  private writeQueue:Promise<void>=Promise.resolve();

  constructor(private file: string,private assetsDir=path.join(path.dirname(file),"assets"),private platform:NodeJS.Platform=process.platform,initialOutfit="normal",private allowedOutfits:readonly string[]|null=null,private provider:EmotionProvider="claude") {
    this.state={...DEFAULT_STATE,outfit:slug(initialOutfit,"normal")};
    fs.mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700});
    if(!fs.existsSync(this.file))fs.writeFileSync(this.file,`${JSON.stringify(this.state)}\n`,{encoding:"utf8",mode:0o600});
    this.read(false);
    this.watch();
  }

  private watch() {
    try {
      this.watcher = fs.watch(path.dirname(this.file), (_event, name) => {
        if (name && name !== path.basename(this.file)) return;
        if (this.debounce) clearTimeout(this.debounce);
        this.debounce = setTimeout(() => this.read(true), 60);
      });
      this.watcher.once("error", () => this.startPolling());
      this.watcher.unref?.();
    } catch {
      this.startPolling();
    }
  }

  private startPolling() {
    this.watcher?.close();
    this.watcher = null;
    if (this.poll) return;
    this.poll = setInterval(() => this.read(true), 4000);
    this.poll.unref?.();
  }

  private read(broadcast: boolean) {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      const next=this.normalized(raw);
      const changed = JSON.stringify(next) !== JSON.stringify(this.state);
      this.state = next;
      if (broadcast && changed) for (const listener of this.listeners) listener(next);
    } catch { /* partial write or missing file: keep last good snapshot */ }
  }

  private normalized(raw:any):EmotionState{return{
        emotion: slug(raw.emotion, "neutral"),
        line: String(raw.line ?? "").slice(0, 200),
        statusLine: String(raw.statusLine ?? "").slice(0, 200),
        lineKey: translationKey(raw.lineKey),
        statusKey: translationKey(raw.statusKey),
        outfit: this.acceptedOutfit(raw.outfit),
        source: typeof raw.source === "string" ? raw.source.slice(0, 40) : undefined,
        sessionId: typeof raw.sessionId === "string" ? raw.sessionId.slice(0, 100) : undefined,
        taskId: typeof raw.taskId === "string" ? raw.taskId.slice(0, 160) : undefined,
        timestamp: Number.isFinite(Number(raw.timestamp)) ? Number(raw.timestamp) : undefined
      };}

  private taskStateDirectory(){return path.join(path.dirname(this.file),"tasks",this.provider);}
  private persistTaskState(state:EmotionState){
    if(!state.taskId)return;
    const directory=this.taskStateDirectory(),file=path.join(directory,`${crypto.createHash("sha256").update(state.taskId).digest("hex")}.json`),temporary=`${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.mkdirSync(directory,{recursive:true,mode:0o700});fs.writeFileSync(temporary,`${JSON.stringify(state)}\n`,{encoding:"utf8",mode:0o600});fs.renameSync(temporary,file);
  }
  taskStates(limit=100):Record<string,EmotionState>{
    const result:Record<string,EmotionState>={};
    try{
      const entries=fs.readdirSync(this.taskStateDirectory()).map(name=>({name,mtime:fs.statSync(path.join(this.taskStateDirectory(),name)).mtimeMs})).sort((a,b)=>b.mtime-a.mtime).slice(0,limit);
      for(const entry of entries)try{const state=this.normalized(JSON.parse(fs.readFileSync(path.join(this.taskStateDirectory(),entry.name),"utf8")));if(state.taskId)result[state.taskId]=state;}catch{}
    }catch{}
    return result;
  }

  get() { return this.state; }
  private acceptedOutfit(value:unknown){const fallback=this.allowedOutfits?.[0]??this.state.outfit??"normal",candidate=slug(value,fallback);return !this.allowedOutfits||this.allowedOutfits.includes(candidate)?candidate:fallback;}
  subscribe(listener: (state: EmotionState) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  // Emotion artwork ships with Claudex Workhouse. Runtime state remains in data/
  // so a clean build or update never overwrites the selected outfit.
  outfits(): string[] {
    try {
      return fs.readdirSync(this.assetsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory()&&(!this.allowedOutfits||this.allowedOutfits.includes(entry.name))).map((entry) => entry.name).sort();
    } catch { return this.allowedOutfits?[...this.allowedOutfits]:["normal"]; }
  }

  assetCatalog(): Record<string,EmotionAsset[]> {
    const root=this.assetsDir,catalog:Record<string,EmotionAsset[]>={};
    try {
      for(const entry of fs.readdirSync(root,{withFileTypes:true})){
        if(!entry.isDirectory()||!/^[a-zA-Z0-9_-]{1,40}$/.test(entry.name))continue;
        const assets:EmotionAsset[]=[];
        for(const file of fs.readdirSync(path.join(root,entry.name),{withFileTypes:true})){
          if(!file.isFile()||!/^[a-zA-Z0-9_~-]+\.(?:webp|png|gif)$/i.test(file.name))continue;
          let emotion=file.name.replace(/\.(?:webp|png|gif)$/i,"");
          if(entry.name.startsWith("Gpt-")&&emotion.startsWith(`${entry.name}_`))emotion=emotion.slice(entry.name.length+1);
          if(emotion==="chu~")emotion="chu";
          assets.push({emotion,file:file.name});
        }
        if(assets.length)catalog[entry.name]=assets.sort((a,b)=>a.file.localeCompare(b.file)).slice(0,200);
      }
    } catch { /* an unavailable asset mount leaves the catalog empty */ }
    return catalog;
  }

  private writeState(payload:string){
    if(this.platform==="win32"){
      const temporary=path.join(path.dirname(this.file),`.${path.basename(this.file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
      let handle:fs.promises.FileHandle|null=null;
      return fs.promises.open(temporary,"wx",0o600).then(async opened=>{
        handle=opened;await opened.writeFile(`${payload}\n`,"utf8");await opened.sync();await opened.close();handle=null;
        await fs.promises.rename(temporary,this.file);
      }).finally(async()=>{if(handle)await handle.close().catch(()=>{});await fs.promises.rm(temporary,{force:true}).catch(()=>{});});
    }
    return new Promise<void>((resolve, reject) => {
      const child = spawn("/bin/flock", [`${this.file}.flock`, "sh", "-c", 'cat > "$EMOTION_STATE_FILE"'],
        { env: { ...process.env, EMOTION_STATE_FILE: this.file }, stdio: ["pipe", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(stderr || `flock exited ${code}`)));
      child.stdin.end(payload + "\n");
    });
  }

  // Linux preserves the shared flock/truncate contract. Windows has one
  // in-process writer queue and atomically replaces the file in its directory;
  // the directory watcher remains rename-safe.
  async setState(patch: Record<string, unknown>,options:{persistTask?:boolean}={}): Promise<EmotionState> {
    const operation=this.writeQueue.then(async()=>{
      let current:Record<string,unknown>={};
      try{current=JSON.parse(fs.readFileSync(this.file,"utf8"));}catch{/* start fresh */}
      // Model-authored literal copy must not inherit a canned worker translation
      // key from the previous state. Outfit-only patches intentionally preserve it.
      const cleared={
        ...(Object.hasOwn(patch,"line")&&!Object.hasOwn(patch,"lineKey")?{lineKey:undefined}:{}),
        ...(Object.hasOwn(patch,"statusLine")&&!Object.hasOwn(patch,"statusKey")?{statusKey:undefined}:{})
      };
      const next={emotion:"neutral",line:"",statusLine:"",outfit:this.allowedOutfits?.[0]??"normal",...current,...cleared,...patch,timestamp:patch.timestamp??Date.now()};
      next.outfit=this.acceptedOutfit(next.outfit);
      const payload=JSON.stringify(next);
      await this.writeState(payload);
      if(options.persistTask!==false)this.persistTaskState(this.normalized(next));
    });
    this.writeQueue=operation.catch(()=>{});
    await operation;
    this.read(true);
    return this.state;
  }

  // The selected character is provider-global configuration, not task history.
  // Keeping this out of task snapshots prevents a settings change from rewriting
  // the historical emotion state of whichever task happened to run last.
  setOutfit(outfit: string) { return this.setState({ outfit, source: "claudex-workhouse" },{persistTask:false}); }

  // Explicit-emotion input mode: "mcp" = the model calls set_emotion itself;
  // "catch" = the provider worker's prompt bridge keyword-matches the user's input
  // directly (zero tokens, works even in read-only sessions).
  private get modeFile() { return path.join(path.dirname(this.file), "emotion-mode"); }
  getMode(): "mcp" | "catch" {
    try { return fs.readFileSync(this.modeFile, "utf8").trim() === "catch" ? "catch" : "mcp"; } catch { return "mcp"; }
  }
  setMode(mode: "mcp" | "catch") { fs.writeFileSync(this.modeFile, `${mode}\n`, "utf8"); return mode; }
}
