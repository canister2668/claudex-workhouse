export const AVATAR_COLLAPSE_DELAYS=[3000,4000,6000,10000] as const;
export type AvatarCollapseDelay=typeof AVATAR_COLLAPSE_DELAYS[number];
export const DEFAULT_AVATAR_COLLAPSE_DELAY_MS:AvatarCollapseDelay=4000;

export function normalizeAvatarCollapseDelay(value:unknown):AvatarCollapseDelay{
  const parsed=Number(value);
  return AVATAR_COLLAPSE_DELAYS.includes(parsed as AvatarCollapseDelay)?parsed as AvatarCollapseDelay:DEFAULT_AVATAR_COLLAPSE_DELAY_MS;
}

// Floating card shape. "auto" keeps the breakpoint-chosen layout; the explicit
// values pin it, because width and height alone cannot tell a tablet the user
// holds in landscape from a cramped desktop window.
// Stored per device rather than in the synced display settings: the right shape
// follows the screen in front of the user, not the account.
export const AVATAR_TRAY_SHAPES=["auto","wide","card"] as const;
export type AvatarTrayShape=typeof AVATAR_TRAY_SHAPES[number];
export const AVATAR_TRAY_SHAPE_STORAGE_KEY="deck-floating-avatar-shape";

export function normalizeAvatarTrayShape(value:unknown):AvatarTrayShape{
  return AVATAR_TRAY_SHAPES.includes(value as AvatarTrayShape)?value as AvatarTrayShape:"auto";
}

export function readAvatarTrayShape():AvatarTrayShape{
  try{return normalizeAvatarTrayShape(localStorage.getItem(AVATAR_TRAY_SHAPE_STORAGE_KEY));}catch{return "auto";}
}

export function writeAvatarTrayShape(value:unknown):AvatarTrayShape{
  const shape=normalizeAvatarTrayShape(value);
  try{localStorage.setItem(AVATAR_TRAY_SHAPE_STORAGE_KEY,shape);}catch{/* private mode keeps the session value only */}
  return shape;
}

// Dismissing a notice must not swallow the one notice the user is waiting for.
export const TERMINAL_NOTICE_STATUSES=new Set(["completed","failed","stopped"]);
export const terminalNoticeStatus=(status:string|null|undefined)=>Boolean(status&&TERMINAL_NOTICE_STATUSES.has(status));

export function avatarNoticeKey(value:{engine:string|null;sessionId?:string|null;status?:string;outfit:string;emotion:string;line:string;statusLine:string}){
  return JSON.stringify([value.engine,value.sessionId??null,value.status??"",value.outfit,value.emotion,value.line,value.statusLine]);
}
