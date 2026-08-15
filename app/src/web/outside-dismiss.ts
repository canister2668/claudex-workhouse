// Small anchored popups (usage, the topbar overflow sheet) close by tapping
// away from them. A close button costs a deliberate aim at a small target for
// something the surrounding screen can do, so it is not the primary way out.
export type OutsideDismissOptions={
  onDismiss:()=>void;
  // The element that opened the popup. Without this the pointerdown closes the
  // popup and the click that follows re-opens it, so the toggle looks dead.
  triggerSelector?:string;
};

export function shouldDismissOutside(
  target:{closest:(selector:string)=>unknown}|null|undefined,
  contains:(target:unknown)=>boolean,
  triggerSelector?:string
){
  if(!target)return true;
  if(contains(target))return false;
  return !(triggerSelector&&target.closest(triggerSelector));
}

export function dismissOnOutside(node:HTMLElement,options:OutsideDismissOptions){
  let current=options;
  const pointer=(event:PointerEvent)=>{
    const target=event.target as Element|null;
    if(shouldDismissOutside(target,value=>node.contains(value as Node),current.triggerSelector))current.onDismiss();
  };
  const key=(event:KeyboardEvent)=>{if(event.key==="Escape")current.onDismiss();};
  // Registered on the next frame so the very pointerdown that opened the popup
  // cannot immediately close it again.
  const timer=setTimeout(()=>{
    document.addEventListener("pointerdown",pointer);
    document.addEventListener("keydown",key);
  },0);
  return{
    update(next:OutsideDismissOptions){current=next;},
    destroy(){
      clearTimeout(timer);
      document.removeEventListener("pointerdown",pointer);
      document.removeEventListener("keydown",key);
    }
  };
}
