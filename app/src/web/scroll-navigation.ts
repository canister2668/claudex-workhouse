export type ScrollDirection="down"|"up"|null;
export type ScrollButtonMode="both"|"down"|"up";

export function scrollPosition(scrollTop:number,scrollHeight:number,clientHeight:number,threshold=56,previous?:{nearTop:boolean;nearBottom:boolean},hysteresis=16){
  const top=Math.max(0,scrollTop);
  const maxTop=Math.max(0,scrollHeight-clientHeight);
  const topLimit=threshold+(previous?.nearTop?hysteresis:0);
  const bottomLimit=threshold+(previous?.nearBottom?hysteresis:0);
  return{nearTop:top<=topLimit,nearBottom:maxTop-top<=bottomLimit};
}

export function scrollButtonMode(autoSwitch:boolean,nearTop:boolean,nearBottom:boolean,direction:ScrollDirection,hasNewEvents=false):ScrollButtonMode{
  if(!autoSwitch)return"both";
  if(nearTop)return"down";
  if(nearBottom)return"up";
  if(hasNewEvents)return"down";
  return direction==="up"?"up":"down";
}

// "Up" means the scroll position is decreasing: the reader is moving toward
// older cards above the current one. Give that reading direction more room by
// folding the session chrome. Reaching the latest card is handled separately
// and restores anything that was folded automatically.
export function shouldAutoFoldSessionChrome(direction:ScrollDirection,scrollTop:number,nearBottom:boolean,threshold=24){
  return direction==="up"&&!nearBottom&&scrollTop>threshold;
}

export function shouldRestoreAutoFoldedPanel(direction:ScrollDirection,distanceToBottom:number,tolerance=1){
  return direction==="down"&&Number.isFinite(distanceToBottom)&&distanceToBottom<=tolerance;
}

export function preserveProcessPanelOnCompletion(previousBusy:boolean,busy:boolean,_nearBottom:boolean,current=false){
  if(!previousBusy&&busy)return false;
  // Collapsing the running process panel in the same render that marks a task
  // terminal can remove most of the scrollable height. Browsers then clamp
  // scrollTop to zero before the bottom-stick pass runs. Keep the just-finished
  // panel open until the user explicitly collapses it.
  if(previousBusy&&!busy)return true;
  return current;
}

export function followLatestAfterScroll(
  current:boolean,
  scrollingToLatest:boolean,
  userScrollIntent:boolean,
  nearBottom:boolean,
  delta:number,
){
  if(scrollingToLatest)return current;
  // A slow touch drag can outlive the short pointer-intent timer. Treat every
  // upward movement as an explicit request to read older content so a resize
  // caused by mobile controls cannot snap the log back to the bottom.
  if(delta<0)return false;
  if(userScrollIntent)return nearBottom;
  if(nearBottom)return true;
  return current;
}

export function scrollTopAfterContentChange(
  previousScrollTop:number,
  previousScrollHeight:number,
  nextScrollHeight:number,
  wasAtBottom:boolean,
  contentStartChanged:boolean,
){
  if(wasAtBottom)return Math.max(0,nextScrollHeight);
  if(!contentStartChanged)return Math.max(0,previousScrollTop);
  return Math.max(0,previousScrollTop+Math.max(0,nextScrollHeight-previousScrollHeight));
}

export function readingScrollRestoreTarget(
  desiredScrollTop:number,
  scrollHeight:number,
  clientHeight:number,
  wasActuallyAtTop:boolean,
){
  if(wasActuallyAtTop)return 0;
  return Math.min(Math.max(0,desiredScrollTop),Math.max(0,scrollHeight-clientHeight));
}

export function readingRestoreNeedsMoreHeight(desiredScrollTop:number,restoredScrollTop:number,tolerance=0.5){
  return desiredScrollTop-restoredScrollTop>tolerance;
}

export function intentionalTopReach(reachedTop:boolean,userScrollIntent:boolean,scrollingToTop:boolean){
  return reachedTop&&(userScrollIntent||scrollingToTop);
}

export function topClampNeedsRestore(
  reachedTop:boolean,
  readingAtTop:boolean,
  followLatest:boolean,
  restoredScroll:boolean,
  delta:number,
){
  return reachedTop&&!readingAtTop&&!followLatest&&!restoredScroll&&delta<0;
}
