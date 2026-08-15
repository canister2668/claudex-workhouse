import {afterEach,describe,expect,it}from"vitest";
import {get}from"svelte/store";
import {immersiveChromeHasRoom,IMMERSIVE_REVEAL_DISTANCE,chromeCollapse,chromeSlide,chromeRevealProgress,normalizedBottomDistance,applyChromePhase,bottomChromeProgress,chromeVisible,configureImmersiveChrome,immersiveChromeEnabled,immersiveChromeVisible,resetImmersiveChromeForTests,setChromeBlocking,shouldRevealOnTap,updateChromeDistance}from"../../src/web/immersive-chrome";

const base={phase:"scrolling" as const,atBottom:false,enabled:true,keyboardOpen:false,blocking:false};
const target=(match:string|null)=>({closest:(selector:string)=>match&&selector.includes(match)?{}:null});

describe("immersive chrome",()=>{
  it("hides the chrome while the reader scrolls in either direction",()=>{
    expect(immersiveChromeVisible(true,base)).toBe(false);
    expect(immersiveChromeVisible(true,{...base,atBottom:false})).toBe(false);
  });

  it("stays hidden while the reader pauses mid-log",()=>{
    // Pausing to read must not put the chrome back over the passage.
    expect(immersiveChromeVisible(false,base)).toBe(false);
  });

  it("toggles on a tap in both directions",()=>{
    expect(immersiveChromeVisible(false,{...base,phase:"tap"})).toBe(true);
    expect(immersiveChromeVisible(true,{...base,phase:"tap"})).toBe(false);
  });

  it("reveals the heading only at the end",()=>{
    expect(immersiveChromeVisible(true,{...base,atBottom:true})).toBe(true);
    expect(immersiveChromeVisible(false,{...base,atBottom:true})).toBe(true);
    expect(immersiveChromeVisible(true,{...base,atBottom:false})).toBe(false);
  });

  it("never hides the chrome while typing or while an answer is required",()=>{
    expect(immersiveChromeVisible(false,{...base,keyboardOpen:true})).toBe(true);
    expect(immersiveChromeVisible(false,{...base,blocking:true})).toBe(true);
    expect(immersiveChromeVisible(false,{...base,enabled:false})).toBe(true);
  });

  it("reveals on a tap that is not aimed at an interactive element",()=>{
    expect(shouldRevealOnTap(target(null))).toBe(true);
    expect(shouldRevealOnTap(null)).toBe(true);
    expect(shouldRevealOnTap(target("button"))).toBe(false);
    expect(shouldRevealOnTap(target("code"))).toBe(false);
  });

  it("applies only to coarse-pointer phone viewports with the setting on",()=>{
    expect(immersiveChromeEnabled(412,915,true,true)).toBe(true);
    expect(immersiveChromeEnabled(412,915,true,false)).toBe(false);
    expect(immersiveChromeEnabled(412,915,false,true)).toBe(false);
    expect(immersiveChromeEnabled(1280,800,true,true)).toBe(false);
  });

  it("covers short mini-tablet landscape without changing tablet portrait",()=>{
    expect(immersiveChromeEnabled(760,500,true,true)).toBe(true);
    expect(immersiveChromeEnabled(1024,600,true,true)).toBe(true);
    expect(immersiveChromeEnabled(800,1280,true,true)).toBe(false);
    expect(immersiveChromeEnabled(1025,600,true,true)).toBe(false);
    expect(immersiveChromeEnabled(800,721,true,true)).toBe(false);
  });
});

// Both detail views drive one store, so a Codex session and a Claude session
// cannot end up with different visibility rules.
describe("shared chrome store",()=>{
  afterEach(()=>resetImmersiveChromeForTests());

  it("hides on scroll and toggles by tap through the shared store",()=>{
    configureImmersiveChrome({enabled:true});
    applyChromePhase("scrolling",400,5_000);
    expect(get(chromeVisible)).toBe(false);
    applyChromePhase("tap");
    expect(get(chromeVisible)).toBe(true);
    applyChromePhase("tap");
    expect(get(chromeVisible)).toBe(false);
  });

  it("reveals the heading and drawer on arrival at the end of the log",()=>{
    configureImmersiveChrome({enabled:true});
    applyChromePhase("scrolling",400,5_000);
    applyChromePhase("scrolling",400,0);
    expect(get(chromeVisible)).toBe(true);
    expect(get(bottomChromeProgress)).toBe(1);
    // A deliberate tap can dismiss both while parked at the end.
    applyChromePhase("tap");
    expect(get(chromeVisible)).toBe(false);
    expect(get(bottomChromeProgress)).toBe(0);
  });

  it("keeps only the heading hidden at the end of a too-short landscape viewport",()=>{
    configureImmersiveChrome({enabled:true,revealHeadingAtBottom:false});
    applyChromePhase("scrolling",400,5_000);
    applyChromePhase("scrolling",400,0);
    expect(get(chromeVisible)).toBe(false);
    expect(get(bottomChromeProgress)).toBe(1);
  });

  it("keeps tracking the drawer through momentum after the gesture flag expires",()=>{
    configureImmersiveChrome({enabled:true});
    applyChromePhase("scrolling",400,5_000);
    expect(get(bottomChromeProgress)).toBe(0);
    // No deliberate gesture attached to these, but the log is still moving.
    updateChromeDistance(100,4_900);
    expect(get(bottomChromeProgress)).toBeCloseTo(0.5,10);
    updateChromeDistance(0,5_000);
    expect(get(bottomChromeProgress)).toBe(1);
    // Arriving at the end restores the complete session chrome.
    expect(get(chromeVisible)).toBe(true);
    updateChromeDistance(5_000,0);
    expect(get(chromeVisible)).toBe(true);
  });

  it("stays hidden at the top of the log so the two reveal rules cannot collide",()=>{
    configureImmersiveChrome({enabled:true});
    applyChromePhase("scrolling",400,5_000);
    expect(get(chromeVisible)).toBe(false);
    expect(get(bottomChromeProgress)).toBe(0);
    applyChromePhase("scrolling",0,5_400);
    expect(get(chromeVisible)).toBe(false);
    expect(get(bottomChromeProgress)).toBe(0);
    updateChromeDistance(5_400,0);
    expect(get(chromeVisible)).toBe(false);
    expect(get(bottomChromeProgress)).toBe(0);
  });

  it("keeps a one-page log stable when top and bottom are the same position",()=>{
    configureImmersiveChrome({enabled:true});
    applyChromePhase("scrolling",400,5_000);
    expect(get(chromeVisible)).toBe(false);
    applyChromePhase("scrolling",0,0);
    expect(get(chromeVisible)).toBe(true);
    expect(get(bottomChromeProgress)).toBe(1);
    updateChromeDistance(0,0);
    expect(get(chromeVisible)).toBe(true);
    expect(get(bottomChromeProgress)).toBe(1);
  });

  it("blocks from whichever detail view is waiting on the person",()=>{
    configureImmersiveChrome({enabled:true});
    applyChromePhase("scrolling",400,5_000);
    expect(get(chromeVisible)).toBe(false);
    // The Codex view reports its own task, not the one the Claude view holds.
    setChromeBlocking("codex",true);
    expect(get(chromeVisible)).toBe(true);
    // Clearing one source must not unblock while another still needs an answer.
    setChromeBlocking("claude",false);
    applyChromePhase("scrolling",400,5_000);
    expect(get(chromeVisible)).toBe(true);
    setChromeBlocking("codex",false);
    applyChromePhase("scrolling",400,5_000);
    expect(get(chromeVisible)).toBe(false);
  });

  it("ignores scrolling while the mode is off",()=>{
    configureImmersiveChrome({enabled:false});
    applyChromePhase("scrolling",400,5_000);
    expect(get(chromeVisible)).toBe(true);
  });

  it("restores immediately when a blocking prompt appears mid-scroll",()=>{
    configureImmersiveChrome({enabled:true});
    applyChromePhase("scrolling",400,5_000);
    expect(get(chromeVisible)).toBe(false);
    configureImmersiveChrome({blocking:true});
    expect(get(chromeVisible)).toBe(true);
  });

  it("restores immediately when the keyboard opens mid-scroll",()=>{
    configureImmersiveChrome({enabled:true});
    applyChromePhase("scrolling",400,5_000);
    configureImmersiveChrome({keyboardOpen:true});
    expect(get(chromeVisible)).toBe(true);
  });
});

// The reveal used to feed back into its own trigger: showing the chrome shrank
// the log, which grew the measured distance, which hid the chrome again.
describe("bottom chrome drawer",()=>{
  const CHROME=120;

  it("reports the same distance no matter how much chrome is on screen",()=>{
    // Same scroll position, three drawer positions: sliding the drawer in
    // shrinks the log, so the raw distance grows by exactly those pixels.
    const hidden=normalizedBottomDistance(80,0,CHROME);
    const halfway=normalizedBottomDistance(140,0.5,CHROME);
    const shown=normalizedBottomDistance(200,1,CHROME);
    expect(hidden).toBe(80);
    expect(halfway).toBe(80);
    expect(shown).toBe(80);
  });

  it("opens the drawer the whole way at the end of the log",()=>{
    // The log cannot scroll further, so the raw distance is zero at every
    // drawer position. All of them must read as fully open.
    expect(chromeRevealProgress(normalizedBottomDistance(0,0,CHROME))).toBe(1);
    expect(chromeRevealProgress(normalizedBottomDistance(CHROME/2,0.5,CHROME))).toBe(1);
    expect(chromeRevealProgress(normalizedBottomDistance(CHROME,1,CHROME))).toBe(1);
  });

  it("does not oscillate at the point where the drawer starts opening",()=>{
    const raw=IMMERSIVE_REVEAL_DISTANCE-CHROME;
    let progress=0;
    for(let step=0;step<12;step++){
      const next=chromeRevealProgress(normalizedBottomDistance(raw+progress*CHROME,progress,CHROME));
      progress=next;
    }
    const settled=chromeRevealProgress(normalizedBottomDistance(raw+progress*CHROME,progress,CHROME));
    expect(settled).toBeCloseTo(progress,10);
  });

  it("slides in proportionally instead of snapping",()=>{
    expect(chromeRevealProgress(IMMERSIVE_REVEAL_DISTANCE)).toBe(0);
    expect(chromeRevealProgress(IMMERSIVE_REVEAL_DISTANCE/2)).toBeCloseTo(0.5,10);
    expect(chromeRevealProgress(0)).toBe(1);
  });

  it("clamps outside the reveal band",()=>{
    expect(chromeRevealProgress(5_000)).toBe(0);
    expect(chromeRevealProgress(-50)).toBe(1);
  });
it("keeps the chrome whole when the log has no room to complete the transition",()=>{
    const CHROME_HEIGHT=168;
    // A mini tablet in portrait is a phone by width but shows far more of the log,
    // so the overflow left to scroll is a fraction of what a phone leaves.
    expect(immersiveChromeHasRoom(1400,CHROME_HEIGHT)).toBe(true);
    expect(immersiveChromeHasRoom(IMMERSIVE_REVEAL_DISTANCE+CHROME_HEIGHT,CHROME_HEIGHT)).toBe(true);
    expect(immersiveChromeHasRoom(IMMERSIVE_REVEAL_DISTANCE+CHROME_HEIGHT-1,CHROME_HEIGHT)).toBe(false);
    expect(immersiveChromeHasRoom(Number.NaN,CHROME_HEIGHT)).toBe(false);
  });

  it("does not hide the heading on a log the drawer can never clear",()=>{
    resetImmersiveChromeForTests();
    configureImmersiveChrome({enabled:true});
    // 220px of travel: every scroll position sits inside the reveal window, so the
    // old behaviour hid the heading while the drawer tracked the scroll forever.
    applyChromePhase("scrolling",60,100);
    expect(get(chromeVisible)).toBe(true);
    expect(get(bottomChromeProgress)).toBe(1);
    updateChromeDistance(100,60);
    expect(get(chromeVisible)).toBe(true);
    expect(get(bottomChromeProgress)).toBe(1);
  });

  it("still engages once the log is long enough",()=>{
    resetImmersiveChromeForTests();
    configureImmersiveChrome({enabled:true});
    applyChromePhase("scrolling",600,1200);
    expect(get(chromeVisible)).toBe(false);
    expect(get(bottomChromeProgress)).toBe(0);
  });
});

// The heading collapses rather than sliding, so it gives the log its own height
// back the moment it hides. That is a second feedback loop into the same
// distance the drawer reads, and it used to strobe the heading once per scroll
// event anywhere within one heading height of the end of the log.
describe("heading collapse feedback",()=>{
  const HEADING=56;
  // The browser reports the distance the current layout produces: a shown
  // heading takes HEADING pixels off the viewport, so the distance to the end of
  // the log reads that much larger.
  const measured=(trueDistance:number)=>trueDistance+(get(chromeVisible)?HEADING:0);
  const registerHeading=()=>chromeCollapse({getBoundingClientRect:()=>({height:HEADING}),style:{setProperty(){}}} as unknown as HTMLElement);

  afterEach(()=>resetImmersiveChromeForTests());

  it("does not strobe while the reader creeps up from the end of the log",()=>{
    resetImmersiveChromeForTests();
    registerHeading();
    configureImmersiveChrome({enabled:true});
    const scrollHeightMinusViewport=4_000;
    const states:boolean[]=[];
    // A slow drag fires several scroll events per pixel of travel, which is what
    // exposes the loop: a flick crosses the bistable band faster than it can
    // argue with itself.
    for(let trueDistance=0;trueDistance<=HEADING*2;trueDistance++){
      for(let event=0;event<3;event++){
        const raw=measured(trueDistance);
        applyChromePhase("scrolling",scrollHeightMinusViewport-raw,raw);
        states.push(get(chromeVisible));
      }
    }
    const flips=states.filter((visible,index)=>index>0&&visible!==states[index-1]).length;
    expect(flips).toBeLessThanOrEqual(1);
    expect(states.at(-1)).toBe(false);
  });

  it("settles instead of arguing with itself at the end of the log",()=>{
    resetImmersiveChromeForTests();
    registerHeading();
    configureImmersiveChrome({enabled:true});
    // Standing still at the end of the log: every event reports the same
    // position, so every event must reach the same answer.
    const states:boolean[]=[];
    for(let step=0;step<8;step++){
      const raw=measured(0);
      applyChromePhase("scrolling",4_000-raw,raw);
      states.push(get(chromeVisible));
    }
    expect(states).toEqual(states.map(()=>true));
    expect(get(bottomChromeProgress)).toBe(1);
  });
});

// The drawer closes a feedback loop of its own. Its negative margin hands its
// height back to the log while it is slid away, so the same log measures one
// chrome height less scrollable at progress 0 than at progress 1 — while the
// room test compares against a threshold written in the drawer-out baseline. A
// log sitting in that one-chrome-height band flipped the answer on every event,
// and at the top of the log nothing throttles those events: the reading chrome
// blinked in and out in place.
describe("drawer occupancy feedback",()=>{
  const CHROME=140,HEADING=48;
  const node=(height:number)=>({getBoundingClientRect:()=>({height}),style:{setProperty(){}}} as unknown as HTMLElement);
  // Scrollable distance of a log that only just clears the room test with the
  // drawer fully out. The measured value shrinks by whatever the drawer has
  // given back and grows by a heading that is currently on screen.
  const SCROLLABLE=IMMERSIVE_REVEAL_DISTANCE+CHROME+60;
  const measured=()=>SCROLLABLE-(1-get(bottomChromeProgress))*CHROME+(get(chromeVisible)?HEADING:0);
  const register=()=>{chromeSlide(node(CHROME));chromeCollapse(node(HEADING));};

  afterEach(()=>resetImmersiveChromeForTests());

  it("settles at the top of the log instead of blinking once per scroll event",()=>{
    resetImmersiveChromeForTests();
    register();
    configureImmersiveChrome({enabled:true});
    const states:string[]=[];
    for(let step=0;step<8;step++){
      applyChromePhase("scrolling",0,measured());
      states.push(`${get(chromeVisible)}/${get(bottomChromeProgress)}`);
    }
    expect(new Set(states.slice(1)).size).toBe(1);
  });

  it("settles at the top when the scroll is not a gesture",()=>{
    resetImmersiveChromeForTests();
    register();
    configureImmersiveChrome({enabled:true});
    const states:string[]=[];
    for(let step=0;step<8;step++){
      updateChromeDistance(measured(),0);
      states.push(`${get(chromeVisible)}/${get(bottomChromeProgress)}`);
    }
    expect(new Set(states.slice(1)).size).toBe(1);
  });
});
