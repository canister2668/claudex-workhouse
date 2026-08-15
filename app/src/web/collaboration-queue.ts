export type AvatarNotice={eventId:string;participantId:string;sourceRunId:string;generation:number;version:number;activity:string;line:string;emotion:string;priority:number;terminal:boolean};
export type AvatarQueueState={visible:AvatarNotice|null;pending:AvatarNotice[];seen:Set<string>;terminalRuns:Set<string>;pinned:boolean};
export const initialAvatarQueue=():AvatarQueueState=>({visible:null,pending:[],seen:new Set(),terminalRuns:new Set(),pinned:false});

export function enqueueAvatar(state:AvatarQueueState,notice:AvatarNotice):AvatarQueueState{
  const identity=`${notice.eventId}:${notice.sourceRunId}:${notice.generation}:${notice.version}`;
  if(state.seen.has(identity)||state.terminalRuns.has(notice.sourceRunId)&&!notice.terminal)return state;
  const seen=new Set(state.seen);seen.add(identity);const terminalRuns=new Set(state.terminalRuns);if(notice.terminal)terminalRuns.add(notice.sourceRunId);
  let pending=state.pending.filter(item=>!(item.participantId===notice.participantId&&item.priority<=1));
  if(state.visible?.line===notice.line&&state.visible.participantId===notice.participantId)return{...state,seen,terminalRuns};
  pending=pending.filter(item=>!(item.line===notice.line&&item.participantId===notice.participantId));pending.push(notice);pending.sort((a,b)=>b.priority-a.priority);
  const visible=state.visible??pending.shift()??null;return{...state,visible,pending:pending.slice(0,4),seen,terminalRuns};
}
export function advanceAvatar(state:AvatarQueueState):AvatarQueueState{if(state.pinned)return state;const pending=[...state.pending],visible=pending.shift()??null;return{...state,visible,pending};}
export function pinAvatar(state:AvatarQueueState,pinned:boolean):AvatarQueueState{return{...state,pinned};}
