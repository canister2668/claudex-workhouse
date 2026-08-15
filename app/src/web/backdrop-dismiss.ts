export type BackdropPointer={startedOnBackdrop:boolean;startX:number;startY:number;moved:boolean};

export function beginBackdropPointer(startedOnBackdrop:boolean,x:number,y:number):BackdropPointer{
  return{startedOnBackdrop,startX:x,startY:y,moved:false};
}

export function moveBackdropPointer(state:BackdropPointer,x:number,y:number,threshold=6):BackdropPointer{
  if(state.moved||Math.hypot(x-state.startX,y-state.startY)<threshold)return state;
  return{...state,moved:true};
}

export function shouldDismissBackdrop(state:BackdropPointer|null,endedOnBackdrop:boolean){
  return Boolean(state?.startedOnBackdrop&&!state.moved&&endedOnBackdrop);
}
