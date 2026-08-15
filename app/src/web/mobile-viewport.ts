export const PHONE_MAX_WIDTH=599;

// The band of the layout viewport that the user can actually see. On mobile
// Chrome the layout viewport keeps the size it has with the address bar
// hidden, so window.innerHeight counts the strip behind the toolbar as usable
// space. position:fixed and getBoundingClientRect share the layout coordinate
// space, and visualViewport.offsetTop/height express the visible band inside
// it, so every overlay clamp has to be written against this band instead.
export type ViewportBand={top:number;left:number;width:number;height:number};

export function viewportBand(view:{visualViewport?:{offsetTop:number;offsetLeft:number;width:number;height:number}|null;innerWidth:number;innerHeight:number}):ViewportBand{
  const visual=view.visualViewport;
  return{
    top:visual?.offsetTop??0,
    left:visual?.offsetLeft??0,
    width:visual?.width??view.innerWidth,
    height:visual?.height??view.innerHeight
  };
}

export const currentViewportBand=()=>viewportBand(typeof window==="undefined"?{visualViewport:null,innerWidth:0,innerHeight:0}:window);

export type PopoverPlacement={left:number;top:number;maxHeight:number;side:"above"|"below"};

// Places an anchored overlay inside the visible band. The menu opens upward to
// keep the trigger reachable, but flips below and always caps its height so it
// can never grow past the toolbar edge the way a bottom-anchored menu does.
export function popoverPlacement(
  anchor:{top:number;bottom:number;left:number},
  content:{width:number;height:number},
  band:ViewportBand,
  options:{gap?:number;margin?:number;minHeight?:number}={}
):PopoverPlacement{
  const gap=options.gap??6,margin=options.margin??8,minHeight=options.minHeight??120;
  const bandBottom=band.top+band.height;
  const spaceAbove=Math.max(0,anchor.top-gap-(band.top+margin));
  const spaceBelow=Math.max(0,bandBottom-margin-anchor.bottom-gap);
  const fitsAbove=content.height<=spaceAbove,fitsBelow=content.height<=spaceBelow;
  const side:"above"|"below"=fitsAbove?"above":fitsBelow?"below":spaceAbove>=spaceBelow?"above":"below";
  const available=Math.max(minHeight,side==="above"?spaceAbove:spaceBelow);
  const maxHeight=Math.max(1,Math.min(available,Math.max(1,band.height-margin*2)));
  const height=Math.min(content.height,maxHeight);
  const rawTop=side==="above"?anchor.top-gap-height:anchor.bottom+gap;
  const top=Math.min(Math.max(rawTop,band.top+margin),Math.max(band.top+margin,bandBottom-margin-height));
  const maxLeft=Math.max(band.left+margin,band.left+band.width-margin-content.width);
  const left=Math.min(Math.max(anchor.left,band.left+margin),maxLeft);
  return{left,top,maxHeight,side};
}

export function defaultSessionHeadingCollapsed(viewportWidth:number){
  return Number.isFinite(viewportWidth)&&viewportWidth<=PHONE_MAX_WIDTH;
}

export function keyboardInset(
  layoutHeight:number,
  viewportHeight:number,
  viewportOffsetTop:number,
  editableFocused:boolean,
){
  if(!editableFocused)return 0;
  return Math.max(0,Math.round(layoutHeight-viewportHeight-viewportOffsetTop));
}

export function installKeyboardInset(root:HTMLElement=document.documentElement){
  const viewport=window.visualViewport;
  if(!viewport)return()=>{};
  const isEditable=()=>{
    const element=document.activeElement;
    return element instanceof HTMLTextAreaElement||(element instanceof HTMLInputElement&&element.type!=="checkbox"&&element.type!=="radio");
  };
  const update=()=>{
    const layoutHeight=Math.max(window.innerHeight,document.documentElement.clientHeight);
    const inset=keyboardInset(layoutHeight,viewport.height,viewport.offsetTop,isEditable());
    root.style.setProperty("--keyboard-inset",`${inset}px`);
    root.toggleAttribute("data-keyboard-open",inset>0);
    // Overlays pinned with position:fixed sit in the layout viewport, which on
    // mobile Chrome extends behind the address bar. Publish the visible band so
    // they can offset themselves instead of hiding under the toolbar.
    const band=viewportBand(window);
    root.style.setProperty("--viewport-top",`${Math.max(0,Math.round(band.top))}px`);
    root.style.setProperty("--viewport-height",`${Math.max(0,Math.round(band.height))}px`);
  };
  const settle=()=>window.setTimeout(update,0);
  viewport.addEventListener("resize",update);
  viewport.addEventListener("scroll",update);
  window.addEventListener("focusin",settle);
  window.addEventListener("focusout",settle);
  update();
  return()=>{
    viewport.removeEventListener("resize",update);
    viewport.removeEventListener("scroll",update);
    window.removeEventListener("focusin",settle);
    window.removeEventListener("focusout",settle);
    root.style.removeProperty("--keyboard-inset");
    root.style.removeProperty("--viewport-top");
    root.style.removeProperty("--viewport-height");
    root.removeAttribute("data-keyboard-open");
  };
}
