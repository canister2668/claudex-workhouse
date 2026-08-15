// Horizontal strips such as the settings tab bar overflow on narrow windows.
// Touch already pans them, but with a mouse or a trackpad without horizontal
// wheel the only handle is a thin scrollbar, so pointer dragging the strip
// itself is added. Touch and pen keep the native momentum scrolling instead.
export const DRAG_SCROLL_CLICK_SLOP=4;

export function dragScrollX(node:HTMLElement){
  let pointerId:number|null=null,startX=0,startScroll=0,moved=false;
  const scrollable=()=>node.scrollWidth-node.clientWidth>1;
  const stop=()=>{
    if(pointerId!==null&&node.hasPointerCapture(pointerId))node.releasePointerCapture(pointerId);
    pointerId=null;
    node.classList.remove("dragging");
  };
  const down=(event:PointerEvent)=>{
    // Left button only; touch/pen scroll natively and middle/right stay free
    // for autoscroll and the context menu.
    if(event.pointerType!=="mouse"||event.button!==0||!scrollable())return;
    pointerId=event.pointerId;
    startX=event.clientX;
    startScroll=node.scrollLeft;
    moved=false;
  };
  const move=(event:PointerEvent)=>{
    if(pointerId!==event.pointerId)return;
    const delta=event.clientX-startX;
    // Below the slop the gesture is still a click on a tab, so the drag does
    // not start and the button keeps receiving the click.
    if(!moved){
      if(Math.abs(delta)<DRAG_SCROLL_CLICK_SLOP)return;
      moved=true;
      node.classList.add("dragging");
      node.setPointerCapture(event.pointerId);
    }
    node.scrollLeft=startScroll-delta;
    event.preventDefault();
  };
  // A drag that ends over a tab must not also activate it.
  const click=(event:MouseEvent)=>{if(moved){event.preventDefault();event.stopPropagation();moved=false;}};
  node.addEventListener("pointerdown",down);
  node.addEventListener("pointermove",move);
  node.addEventListener("pointerup",stop);
  node.addEventListener("pointercancel",stop);
  node.addEventListener("click",click,true);
  return{
    destroy(){
      stop();
      node.removeEventListener("pointerdown",down);
      node.removeEventListener("pointermove",move);
      node.removeEventListener("pointerup",stop);
      node.removeEventListener("pointercancel",stop);
      node.removeEventListener("click",click,true);
    }
  };
}
