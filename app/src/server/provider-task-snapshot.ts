import type { DeckTask } from "./types.js";

type TaskStore = {
  listProviderTasks(provider: string, limit?: number): Promise<DeckTask[]>;
  listProviderTasksSince(provider: string, since: string, limit?: number): Promise<DeckTask[]>;
  listProviderTaskIds(provider:string):Promise<string[]>;
};

export function highestUpdatedAt(tasks: DeckTask[]) {
  let highest: string | null = null;
  for (const task of tasks) if (task.updatedAt && (!highest || task.updatedAt > highest)) highest = task.updatedAt;
  return highest;
}

export function replaceProviderTaskRows(current:DeckTask[],provider:string,rows:DeckTask[]){
  return [...current.filter(task=>task.provider!==provider),...rows]
    .sort((left,right)=>String(right.updatedAt??"").localeCompare(String(left.updatedAt??"")));
}

export function upsertTaskRows(current:DeckTask[],rows:DeckTask[]){
  const merged=new Map(current.map(task=>[task.id,task]));
  for(const task of rows)if(task?.id)merged.set(task.id,task);
  return [...merged.values()].sort((left,right)=>String(right.updatedAt??"").localeCompare(String(left.updatedAt??"")));
}

export function removeProviderSessionRows(current:DeckTask[],provider:string,threadId:string){
  return current.filter(task=>task.provider!==provider||task.threadId!==threadId);
}

export function shouldSettleTaskLease(previous:DeckTask|undefined,current:DeckTask){
  return Boolean(previous&&["pending","queued","running","waiting","unknown"].includes(previous.status)&&["completed","failed","stopped"].includes(current.status));
}

export type TaskSnapshotMutation=
  |{kind:"upsert";task:DeckTask}
  |{kind:"delete-task";provider:string;taskId:string}
  |{kind:"delete-session";provider:string;threadId:string};

export function reconcileTaskSnapshot(current:DeckTask[],rows:DeckTask[],provider:string|undefined,mutations:TaskSnapshotMutation[]){
  let next=provider?replaceProviderTaskRows(current,provider,rows):[...rows].sort((left,right)=>String(right.updatedAt??"").localeCompare(String(left.updatedAt??"")));
  for(const mutation of mutations)next=mutation.kind==="upsert"?upsertTaskRows(next,[mutation.task]):mutation.kind==="delete-task"?next.filter(task=>task.id!==mutation.taskId):removeProviderSessionRows(next,mutation.provider,mutation.threadId);
  return next;
}

// A full provider task listing carries prompt/result/log for every row and
// measures seconds and megabytes on a mature table, while the single
// serialized database worker makes that cost head-of-line blocking for every
// other caller. This cache keeps the rows in memory and advances them with an
// updated_at delta. A periodic id-only reconciliation removes deleted rows
// without pulling every historical prompt/result/log back through the worker.
//
// The watermark assumes rows change with a fresh updated_at. Writers that
// upsert rows carrying an older timestamp (worker state reconciliation,
// imported external sessions) must push those rows back via applyAll(), and
// anything that deletes rows must call invalidate().
export class ProviderTaskSnapshotCache {
  private tasks = new Map<string, DeckTask>();
  private watermark: string | null = null;
  private fullAt = 0;
  private initialized=false;

  constructor(private db: TaskStore, private provider: string, private resyncMs = 300000) {}

  invalidate() { this.initialized=false;this.watermark = null; this.fullAt = 0; }

  applyAll(rows: DeckTask[]) { for (const task of rows) if (task?.id) this.tasks.set(task.id, task); }

  prime(rows: DeckTask[]) {
    this.tasks = new Map(rows.map((task) => [task.id, task]));
    this.watermark = highestUpdatedAt(rows);
    this.fullAt = Date.now();
    this.initialized=true;
  }

  remove(id: string) { this.tasks.delete(id); }

  current() { return this.sorted(); }

  async load(): Promise<DeckTask[]> {
    if (!this.initialized) {
      const rows = await this.db.listProviderTasks(this.provider,500);
      this.tasks = new Map(rows.map((task) => [task.id, task]));
      this.fullAt = Date.now();
      this.watermark = highestUpdatedAt(rows);
      this.initialized=true;
      return this.sorted();
    }
    const changed = await this.db.listProviderTasksSince(this.provider, this.watermark??"");
    for (const task of changed) this.tasks.set(task.id, task);
    const advanced = highestUpdatedAt(changed);
    if (advanced && (!this.watermark||advanced > this.watermark)) this.watermark = advanced;
    if(Date.now()-this.fullAt>=this.resyncMs){
      const ids=new Set(await this.db.listProviderTaskIds(this.provider));
      for(const id of this.tasks.keys())if(!ids.has(id))this.tasks.delete(id);
      this.fullAt=Date.now();
    }
    return this.sorted();
  }

  private sorted() {
    return [...this.tasks.values()].sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
  }
}
