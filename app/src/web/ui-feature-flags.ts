export const LIVE_WORK_REDESIGN_KEY="ui.liveWorkRedesign";

export function liveWorkRedesignEnabled(storage:Pick<Storage,"getItem">|null=typeof localStorage==="undefined"?null:localStorage){
  return storage?.getItem(LIVE_WORK_REDESIGN_KEY)!=="false";
}
