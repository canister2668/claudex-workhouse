const ACTIVE_STATUSES=new Set(["pending","queued","running","waiting"]);

export function activeTaskStatus(status:unknown){return ACTIVE_STATUSES.has(String(status??""));}

export function shouldPollMessageQueue(active:boolean,items:Array<{status?:string}>,threadActive=false){
  // A dispatched item leaves the queue before the task it started is reported,
  // so polling that stops on an empty queue can miss the hand-off entirely and
  // leave the open session pinned to the finished turn. Keep watching while the
  // thread's newest task is still running.
  return active||threadActive||items.some(item=>item.status==="queued"||item.status==="dispatching");
}

export function shouldPollAttention(status:unknown,pendingCount:number){
  return activeTaskStatus(status)||pendingCount>0;
}
