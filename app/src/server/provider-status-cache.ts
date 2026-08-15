/**
 * One shared, coalesced snapshot of the Worker's provider status.
 *
 * `/api/setup`, `/api/runtime-updates` and `/api/provider-connections` all
 * describe the same provider state, and `/api/setup` alone reads it twice. Each
 * read used to become its own `provider.status.read`, and that command runs the
 * Worker's version-then-authentication probe chain per provider. A single
 * screen load could therefore queue four chains behind one Worker while the
 * browser's own request budget expired underneath them, and a runtime update —
 * when executables are locked, cold and being scanned — made every one of those
 * chains slower at exactly the moment more of them were being started.
 *
 * This holds the whole snapshot rather than one slice of it, joins concurrent
 * callers onto a single in-flight request, and refuses to start a new probe
 * while the runtime it would probe is being replaced.
 *
 * Two rules keep a slow Worker from being paid for by the caller. A known
 * snapshot is served immediately once it expires and refreshed behind the
 * request, so only the very first read of a cold cache ever waits for a probe
 * chain; and a probe that fails is not retried until `errorTtlMs` has passed,
 * so a Worker that is timing out costs one chain per backoff window rather
 * than one chain per request.
 */
export type ProviderStatusSnapshot=Record<string,any>|null;

export type ProviderStatusCacheOptions={
  /** Issues the underlying `provider.status.read`. */
  read:()=>Promise<ProviderStatusSnapshot>;
  /** False when there is no Worker to ask; the last snapshot is reused. */
  available:()=>boolean;
  ttlMs?:number;
  /** How long a failed probe suppresses the next attempt. */
  errorTtlMs?:number;
  now?:()=>number;
};

export class ProviderStatusCache {
  private snapshot:ProviderStatusSnapshot=null;
  private checkedAt=0;
  private pending:Promise<ProviderStatusSnapshot>|null=null;
  private mutationDepth=0;
  private failedAt=0;
  private readonly ttlMs:number;
  private readonly errorTtlMs:number;
  private readonly now:()=>number;
  /** Counts completed reads so a test can assert the coalescing actually held. */
  reads=0;

  constructor(private readonly options:ProviderStatusCacheOptions){
    this.ttlMs=options.ttlMs??12_000;
    this.errorTtlMs=options.errorTtlMs??5_000;
    this.now=options.now??(()=>Date.now());
  }

  /** True while a runtime install or update is in flight. */
  get updating(){return this.mutationDepth>0;}

  invalidate(){this.snapshot=null;this.checkedAt=0;this.failedAt=0;}

  /**
   * Suppresses probing for the duration of a runtime mutation and starts one
   * forced refresh once the last overlapping mutation finishes. Depth rather
   * than a flag: an install and an update can overlap, and the suppression has
   * to outlive whichever finishes first.
   *
   * The snapshot is expired rather than discarded, and the caller that
   * triggered the update — and only that caller — waits for the replacement.
   * Discarding it made the moment right after an update, when the replaced
   * executable is cold, locked and being scanned, the one moment every
   * endpoint had to wait out a full probe chain; expiring it lets every other
   * reader answer immediately from the previous snapshot marked stale.
   */
  async duringMutation<T>(action:()=>Promise<T>):Promise<T>{
    this.mutationDepth+=1;
    try{return await action();}
    finally{
      this.mutationDepth-=1;
      if(this.mutationDepth===0){this.checkedAt=0;this.failedAt=0;await this.refresh().catch(()=>{});}
    }
  }

  /**
   * Starts, or joins, the single probe. A recent failure suppresses a new
   * attempt: the probe chain that just timed out is not made cheaper by
   * starting it again on the next request, and the caller is better served by
   * the last known snapshot — or by an honest empty answer — than by another
   * full timeout.
   */
  private refresh():Promise<ProviderStatusSnapshot>{
    if(this.pending)return this.pending;
    if(this.failedAt&&this.now()-this.failedAt<this.errorTtlMs)return Promise.resolve(this.snapshot);
    this.pending=this.options.read()
      .then(value=>{this.reads+=1;this.failedAt=0;this.snapshot=value??null;this.checkedAt=this.now();return this.snapshot;})
      // A failed probe must never erase what is already known: the caller
      // renders the previous snapshot rather than an empty provider list.
      .catch(()=>{this.reads+=1;this.failedAt=this.now();return this.snapshot;})
      .finally(()=>{this.pending=null;});
    return this.pending;
  }

  async get():Promise<ProviderStatusSnapshot>{
    if(!this.options.available())return this.snapshot;
    if(this.mutationDepth>0)return this.snapshot?{...this.snapshot,updateInProgress:true}:{updateInProgress:true};
    if(this.snapshot&&this.now()-this.checkedAt<this.ttlMs)return this.snapshot;
    // Expired but known: answer now, refresh behind the request.
    if(this.snapshot){void this.refresh().catch(()=>{});return{...this.snapshot,stale:true};}
    return this.refresh();
  }
}
