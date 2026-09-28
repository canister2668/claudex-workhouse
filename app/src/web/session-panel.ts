// The left sessions panel and the changed-files chip in the session heading.
// Kept free of Svelte so the preference and the file roll-up can be tested.

export type SessionPanelStorage=Pick<Storage,"getItem"|"setItem">;

export const SESSION_PANEL_STORAGE_KEY="deck-session-panel";
// Wide enough that a 300px list still leaves the conversation a full column.
export const SESSION_PANEL_DEFAULT_OPEN_WIDTH=1280;
// Rows rendered in the panel; the rest stay one click away in the full list.
export const SESSION_PANEL_ROW_LIMIT=60;

// An explicit choice wins at every width; without one the panel starts open
// only where it does not squeeze the conversation.
export function readSessionPanelOpen(storage:SessionPanelStorage|null,viewportWidth:number){
  let saved:string|null=null;
  try{saved=storage?.getItem(SESSION_PANEL_STORAGE_KEY)??null;}catch{}
  if(saved==="open")return true;
  if(saved==="closed")return false;
  return viewportWidth>=SESSION_PANEL_DEFAULT_OPEN_WIDTH;
}

export function writeSessionPanelOpen(storage:SessionPanelStorage|null,open:boolean){
  try{storage?.setItem(SESSION_PANEL_STORAGE_KEY,open?"open":"closed");}catch{}
}

export type SessionPanelView={
  compactShell:boolean;
  settingsOpen:boolean;
  viewerSplit:boolean;
  sessionsListView:boolean;
};

// Phones keep the 세션 tab as the list, settings own the screen, a split
// workspace viewer already takes the second column, and the sessions page is
// the list itself — the panel only appears where it adds a way to jump.
export function sessionPanelAvailable(view:SessionPanelView){
  return!view.compactShell&&!view.settingsOpen&&!view.viewerSplit&&!view.sessionsListView;
}

export type ChangedFilePathBase="workspace"|"task-cwd"|"unresolved";
export type ChangedFileEntry={path:string;add:number;del:number;pathBase:ChangedFilePathBase};
type FileEventLike={type:string;metadata?:Record<string,unknown>|null};

// Sums +/- per path over the session's file events. A path reported against
// two different bases cannot be opened safely, so it becomes unresolved.
export function collectChangedFiles(events:readonly FileEventLike[]):ChangedFileEntry[]{
  const files=new Map<string,{add:number;del:number;pathBase:ChangedFilePathBase}>();
  for(const event of events){
    if(event.type!=="file_change_started"&&event.type!=="file_change_completed")continue;
    const path=String(event.metadata?.path??"");if(!path)continue;
    const rawBase=event.metadata?.pathBase,pathBase:ChangedFilePathBase=rawBase==="workspace"||rawBase==="task-cwd"?rawBase:"unresolved";
    const current=files.get(path)??{add:0,del:0,pathBase};
    current.add+=Number(event.metadata?.additions??0);current.del+=Number(event.metadata?.deletions??0);
    if(current.pathBase!==pathBase)current.pathBase="unresolved";
    files.set(path,current);
  }
  return[...files].map(([path,stats])=>({path,...stats}));
}
