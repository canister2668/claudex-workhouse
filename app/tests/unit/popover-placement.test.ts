import {describe,expect,it}from"vitest";
import {popoverPlacement,viewportBand}from"../../src/web/mobile-viewport";

// Mobile Chrome keeps the layout viewport at its address-bar-hidden size, so
// the top strip of that viewport sits behind the toolbar while it is shown.
const TOOLBAR=180;
const phoneBand=viewportBand({visualViewport:{offsetTop:TOOLBAR,offsetLeft:0,width:412,height:730},innerWidth:412,innerHeight:910});
const desktopBand=viewportBand({visualViewport:null,innerWidth:1280,innerHeight:900});

describe("viewport band",()=>{
  it("uses the visual viewport when the address bar shrinks the visible area",()=>{
    expect(phoneBand).toEqual({top:TOOLBAR,left:0,width:412,height:730});
  });

  it("falls back to the layout viewport when no visual viewport exists",()=>{
    expect(desktopBand).toEqual({top:0,left:0,width:1280,height:900});
  });
});

describe("popover placement",()=>{
  it("keeps a tall upward menu below the address bar instead of behind it",()=>{
    const spot=popoverPlacement({top:820,bottom:856,left:120},{width:290,height:640},phoneBand);
    expect(spot.top).toBeGreaterThanOrEqual(phoneBand.top+8);
    expect(spot.top+spot.maxHeight).toBeLessThanOrEqual(phoneBand.top+phoneBand.height);
  });

  it("caps the menu height to the space above the trigger",()=>{
    const spot=popoverPlacement({top:820,bottom:856,left:120},{width:290,height:640},phoneBand);
    expect(spot.side).toBe("above");
    expect(spot.maxHeight).toBe(820-6-(TOOLBAR+8));
  });

  it("opens upward without clamping when the menu already fits",()=>{
    const spot=popoverPlacement({top:820,bottom:856,left:120},{width:290,height:200},phoneBand);
    expect(spot.side).toBe("above");
    expect(spot.top).toBe(820-6-200);
  });

  it("flips below when the trigger sits near the top of the visible band",()=>{
    const spot=popoverPlacement({top:TOOLBAR+20,bottom:TOOLBAR+56,left:120},{width:290,height:300},phoneBand);
    expect(spot.side).toBe("below");
    expect(spot.top).toBe(TOOLBAR+56+6);
  });

  it("keeps the menu inside the horizontal band",()=>{
    const near=popoverPlacement({top:820,bottom:856,left:400},{width:290,height:200},phoneBand);
    expect(near.left).toBe(412-8-290);
    const off=popoverPlacement({top:820,bottom:856,left:-40},{width:290,height:200},phoneBand);
    expect(off.left).toBe(8);
  });

  it("never returns a height larger than the visible band",()=>{
    const spot=popoverPlacement({top:400,bottom:436,left:10},{width:290,height:5_000},{top:0,left:0,width:412,height:200});
    expect(spot.maxHeight).toBeLessThanOrEqual(200-16);
    expect(spot.top).toBeGreaterThanOrEqual(8);
  });
});
