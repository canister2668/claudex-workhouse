import { writable } from "svelte/store";
import { PHONE_MAX_WIDTH } from "./mobile-viewport";

// Phone reading mode: while the log is being scrolled the heading and the
// bottom chrome slide away so only the output stays. Nothing comes back on its
// own mid-log — a reader who pauses must not have the passage covered again.
// The bottom chrome is the exception: it is treated as pushed just off the
// edge, and slides back in proportionally as the end of the output approaches.
export type ImmersiveChromePhase="scrolling"|"tap";
export type ImmersiveChromeInput={
  phase:ImmersiveChromePhase;
  atBottom:boolean;
  enabled:boolean;
  keyboardOpen:boolean;
  blocking:boolean;
};

export const IMMERSIVE_TOP_REVEAL=24;
// How far from the end of the log the bottom chrome starts sliding back in.
export const IMMERSIVE_REVEAL_DISTANCE=200;
// Short landscape viewports cannot fit the restored heading, expanded status
// badge, composer, and fixed mobile navigation at once.
export const IMMERSIVE_END_HEADING_MIN_HEIGHT=480;
export const COMPACT_LANDSCAPE_MAX_WIDTH=1024;
export const COMPACT_LANDSCAPE_MAX_HEIGHT=720;

export function immersiveChromeVisible(visible:boolean,input:ImmersiveChromeInput):boolean{
  // Typing, approvals and user-input prompts must never be hidden behind a
  // reading affordance.
  if(!input.enabled||input.keyboardOpen||input.blocking)return true;
  // Tap toggles. Reveal-only would force a deliberate scroll just to get the
  // reading area back.
  if(input.phase==="tap")return !visible;
  // The normalized distance below removes the heading-height feedback loop,
  // so reaching the true end can safely restore both the heading and drawer.
  return input.atBottom;
}

// The measured distance to the end of the log already reflects however much of
// the chrome is currently on screen: sliding it in shrinks the viewport and
// grows the raw distance by exactly those pixels. Subtracting them back out
// makes the value invariant, which is what stops "reveal → distance grows →
// hide → distance shrinks → reveal" from oscillating. It also has to read zero
// once the log cannot scroll any further, so that the end of the output opens
// the drawer the whole way rather than parking it partly open.
// The heading is the other half of the same correction. It does not slide, it
// collapses, so the pixels it gives back are all-or-nothing on its own
// visibility rather than proportional to the drawer progress. Left unsubtracted
// it closed a second feedback loop of its own: shown → distance grows by the
// heading height → not at the end → hide → distance shrinks back → at the end →
// show. Between the true end of the log and one heading height above it, both
// states argued with each other, so a slow scroll through that band made the
// heading strobe once per scroll event.
export function normalizedBottomDistance(rawDistance:number,progress:number,chromeHeight:number,headingOffset=0){
  return Math.max(0,rawDistance-clamp01(progress)*Math.max(0,chromeHeight)-Math.max(0,headingOffset));
}

export function chromeRevealProgress(normalizedDistance:number,revealDistance=IMMERSIVE_REVEAL_DISTANCE){
  if(revealDistance<=0)return normalizedDistance<=0?1:0;
  return clamp01((revealDistance-Math.max(0,normalizedDistance))/revealDistance);
}

// The drawer only reaches "hidden" once the normalised distance clears the reveal
// window, and normalisation already gives back the chrome height. A log with less
// travel than the two combined can never finish the transition: the heading still
// hides at 24px, while the bottom chrome tracks the scroll forever at some
// fraction, which reads as the affordance jamming half-way. Tall viewports hit
// this constantly — a mini tablet in portrait is classified as a phone by width
// but shows so much more of the log that the overflow left to scroll is tiny.
export function immersiveChromeHasRoom(scrollableDistance:number,chromeHeight:number,revealDistance=IMMERSIVE_REVEAL_DISTANCE){
  if(!Number.isFinite(scrollableDistance))return false;
  return scrollableDistance>=revealDistance+Math.max(0,chromeHeight);
}

function clamp01(value:number){
  return Number.isFinite(value)?Math.min(1,Math.max(0,value)):0;
}

const INTERACTIVE_SELECTOR="a,button,input,textarea,select,summary,label,[role=button],[role=option],[role=listbox],[contenteditable=true],pre,code";

// A reveal tap must not swallow the interaction the user actually aimed at:
// links, copy buttons, the scroll-jump control and selectable code blocks all
// keep their own behaviour.
export function shouldRevealOnTap(target:{closest:(selector:string)=>unknown}|null|undefined){
  if(!target)return true;
  return !target.closest(INTERACTIVE_SELECTOR);
}

export function immersiveChromeEnabled(viewportWidth:number,viewportHeight:number,coarsePointer:boolean,setting:boolean){
  const phone=Number.isFinite(viewportWidth)&&viewportWidth<=PHONE_MAX_WIDTH;
  const compactLandscape=Number.isFinite(viewportWidth)&&Number.isFinite(viewportHeight)
    &&viewportWidth<=COMPACT_LANDSCAPE_MAX_WIDTH&&viewportHeight<=COMPACT_LANDSCAPE_MAX_HEIGHT&&viewportWidth>viewportHeight;
  return setting&&coarsePointer&&(phone||compactLandscape);
}

// The Claude detail view and the Codex detail view are separate components that
// render the same heading, task menu and composer. One shared store keeps them
// from drifting into two different sets of visibility conditions.
export const chromeVisible=writable(true);
export const bottomChromeProgress=writable(1);

let chromeConfig={enabled:false,keyboardOpen:false,blocking:false,revealHeadingAtBottom:true};
let visibleNow=true;
let progressNow=1;
const chromeHeights=new Map<unknown,number>();
const headingHeights=new Map<unknown,number>();

const totalChromeHeight=()=>[...chromeHeights.values()].reduce((sum,value)=>sum+value,0);
const totalHeadingHeight=()=>[...headingHeights.values()].reduce((sum,value)=>sum+value,0);
// Only a heading that is currently on screen is inflating the measured distance.
const headingOffset=()=>visibleNow?totalHeadingHeight():0;
// The heading state that leaves the least room to scroll is the hidden one, so
// the room test asks about that state whichever state we are in. Measuring the
// shown state instead would let a marginal log pass the test, hide the heading,
// fail the test and reveal it again.
// The drawer needs the same correction for the opposite reason: its negative
// margin hands those pixels back to the log while it is slid away, so a measured
// total taken at progress 0 is one chrome height short of the total the room test
// is written against. Left uncorrected it closed the loop this test exists to
// prevent: room → hide the drawer → the log gives back the drawer height → no
// room → publish(true,1) → room again. At the top of the log every scroll event
// re-ran that decision with progress pinned at 0, so the heading and the drawer
// blinked once per event instead of settling.
const scrollableFloor=(scrollTop:number,rawDistance:number)=>
  scrollTop+rawDistance-headingOffset()+(1-clamp01(progressNow))*Math.max(0,totalChromeHeight());

function publish(visible:boolean,progress:number){
  if(visible!==visibleNow){visibleNow=visible;chromeVisible.set(visible);}
  const next=clamp01(progress);
  if(next!==progressNow){progressNow=next;bottomChromeProgress.set(next);}
}

export function configureImmersiveChrome(next:Partial<typeof chromeConfig>){
  chromeConfig={...chromeConfig,...next};
  if(!chromeConfig.enabled||chromeConfig.keyboardOpen||chromeConfig.blocking)publish(true,1);
}

// Each detail view owns a different task object, so "this task is waiting for an
// answer" has to be reported per view rather than derived from one of them.
// Otherwise the Codex side silently loses the rule the Claude side enforces.
const blockingSources=new Map<string,boolean>();

export function setChromeBlocking(source:string,blocking:boolean){
  if(blockingSources.get(source)===blocking)return;
  blockingSources.set(source,blocking);
  configureImmersiveChrome({blocking:[...blockingSources.values()].some(Boolean)});
}

// Momentum keeps scrolling long after the touch-intent flag expires, and the
// auto-follow of a live task scrolls with no touch at all. Both still move the
// log, so the drawer has to keep tracking the distance even when the event is
// not attributed to a deliberate gesture. Only hiding needs that attribution.
export function updateChromeDistance(rawDistance:number,scrollTop=0){
  if(!chromeConfig.enabled||chromeConfig.keyboardOpen||chromeConfig.blocking)return;
  if(!Number.isFinite(rawDistance))return;
  if(!immersiveChromeHasRoom(scrollableFloor(scrollTop,rawDistance),totalChromeHeight()))return publish(true,1);
  const progress=chromeRevealProgress(normalizedBottomDistance(rawDistance,progressNow,totalChromeHeight(),headingOffset()));
  // Momentum and auto-follow may carry the log to its end without a gesture.
  // That still counts as arriving, so restore the heading with the drawer.
  publish(progress>=1&&chromeConfig.revealHeadingAtBottom?true:visibleNow,progress);
}

export function applyChromePhase(phase:ImmersiveChromePhase,scrollTop=0,rawDistance=Number.POSITIVE_INFINITY){
  // The drawer can be partially open while the heading remains hidden, but the
  // true end restores both regions. A deliberate tap can still dismiss both.
  if(!chromeConfig.enabled||chromeConfig.keyboardOpen||chromeConfig.blocking)return publish(true,1);
  // A log that cannot complete the transition must not start it: hiding the
  // heading while the drawer is stuck part way is worse than leaving both alone.
  // A tap is still honoured — that is a deliberate request for reading space.
  if(phase==="scrolling"&&chromeConfig.enabled&&!chromeConfig.keyboardOpen&&!chromeConfig.blocking
    &&Number.isFinite(rawDistance)&&!immersiveChromeHasRoom(scrollableFloor(scrollTop,rawDistance),totalChromeHeight()))return publish(true,1);
  const progress=Number.isFinite(rawDistance)
    ?chromeRevealProgress(normalizedBottomDistance(rawDistance,progressNow,totalChromeHeight(),headingOffset()))
    :progressNow;
  const visible=immersiveChromeVisible(visibleNow,{phase,atBottom:progress>=1&&chromeConfig.revealHeadingAtBottom,...chromeConfig});
  // A tap that dismisses the chrome has to win over the drawer, otherwise it
  // cannot be closed at all near the end of the log. The next scroll hands
  // control back to the distance.
  if(phase==="tap")return publish(visible,visible?1:0);
  publish(visible,progress);
}

// Each sliding element reports its own natural height so the CSS can translate
// it by exactly that much, and so the distance normalisation above knows how
// many pixels are currently parked off screen.
// Leaving a detail view lands on a screen the reader never scrolled, so the
// chrome has to be restored outright. A tap only toggles, which hid it instead
// whenever the detail had already scrolled it away.
export function revealImmersiveChrome(){publish(true,1);}

export function chromeSlide(node:HTMLElement){
  const measure=()=>{
    // translateY and a negative margin move the box without resizing it, so the
    // measured height stays the natural one at any slide position.
    const height=Math.round(node.getBoundingClientRect().height);
    chromeHeights.set(node,height>0?height:0);
    node.style.setProperty("--self-height",`${height>0?height:0}px`);
  };
  measure();
  const observer=typeof ResizeObserver==="undefined"?null:new ResizeObserver(measure);
  observer?.observe(node);
  return{destroy(){observer?.disconnect();chromeHeights.delete(node);}};
}

// The heading collapses to nothing instead of sliding, so while it is hidden it
// measures zero and the last natural height is the only record of how many
// pixels it will take back. Keeping that value is what lets the distance stay
// invariant across the transition rather than only after it settles.
export function chromeCollapse(node:HTMLElement){
  const measure=()=>{
    const height=Math.round(node.getBoundingClientRect().height);
    if(height>0)headingHeights.set(node,height);
  };
  measure();
  const observer=typeof ResizeObserver==="undefined"?null:new ResizeObserver(measure);
  observer?.observe(node);
  return{destroy(){observer?.disconnect();headingHeights.delete(node);}};
}

export function resetImmersiveChromeForTests(){
  chromeConfig={enabled:false,keyboardOpen:false,blocking:false,revealHeadingAtBottom:true};
  chromeHeights.clear();headingHeights.clear();blockingSources.clear();
  visibleNow=true;progressNow=1;
  chromeVisible.set(true);bottomChromeProgress.set(1);
}
