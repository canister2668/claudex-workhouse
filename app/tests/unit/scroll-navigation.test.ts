import{describe,expect,it}from"vitest";
import{followLatestAfterScroll,intentionalTopReach,preserveProcessPanelOnCompletion,readingRestoreNeedsMoreHeight,readingScrollRestoreTarget,scrollButtonMode,scrollPosition,scrollTopAfterContentChange,shouldAutoFoldSessionChrome,shouldRestoreAutoFoldedPanel,topClampNeedsRestore}from"../../src/web/scroll-navigation";

describe("scroll navigation",()=>{
  it("uses a stable threshold near the top and bottom",()=>{
    expect(scrollPosition(40,1000,400)).toEqual({nearTop:true,nearBottom:false});
    expect(scrollPosition(550,1000,400)).toEqual({nearTop:false,nearBottom:true});
    expect(scrollPosition(300,1000,400)).toEqual({nearTop:false,nearBottom:false});
    expect(scrollPosition(65,1000,400,56,{nearTop:true,nearBottom:false})).toEqual({nearTop:true,nearBottom:false});
    expect(scrollPosition(73,1000,400,56,{nearTop:true,nearBottom:false})).toEqual({nearTop:false,nearBottom:false});
  });

  it("shows one contextual button when automatic switching is enabled",()=>{
    expect(scrollButtonMode(true,true,false,"up")).toBe("down");
    expect(scrollButtonMode(true,false,true,"down")).toBe("up");
    expect(scrollButtonMode(true,false,false,"down")).toBe("down");
    expect(scrollButtonMode(true,false,false,"up")).toBe("up");
    expect(scrollButtonMode(true,false,false,null)).toBe("down");
    expect(scrollButtonMode(true,false,false,"up",true)).toBe("down");
  });

  it("keeps both legacy buttons when automatic switching is disabled",()=>{
    expect(scrollButtonMode(false,false,false,"up")).toBe("both");
  });

  it("folds session chrome only while moving toward older cards",()=>{
    expect(shouldAutoFoldSessionChrome("up",200,false)).toBe(true);
    expect(shouldAutoFoldSessionChrome("down",200,false)).toBe(false);
    expect(shouldAutoFoldSessionChrome("up",20,false)).toBe(false);
    expect(shouldAutoFoldSessionChrome("up",200,true)).toBe(false);
  });

  it("restores an auto-folded panel only at the absolute bottom",()=>{
    expect(shouldRestoreAutoFoldedPanel("down",0)).toBe(true);
    expect(shouldRestoreAutoFoldedPanel("down",1)).toBe(true);
    expect(shouldRestoreAutoFoldedPanel("down",2)).toBe(false);
    expect(shouldRestoreAutoFoldedPanel("up",0)).toBe(false);
  });

  it("releases bottom following for a slow upward scroll after pointer intent expires",()=>{
    expect(followLatestAfterScroll(true,false,false,true,-2)).toBe(false);
    expect(followLatestAfterScroll(false,false,false,true,2)).toBe(true);
    expect(followLatestAfterScroll(false,false,false,false,2)).toBe(false);
    expect(followLatestAfterScroll(true,true,false,false,-2)).toBe(true);
  });

  it("keeps the process panel open across completion at every scroll position",()=>{
    expect(preserveProcessPanelOnCompletion(true,false,false)).toBe(true);
    expect(preserveProcessPanelOnCompletion(true,false,true)).toBe(true);
    expect(preserveProcessPanelOnCompletion(false,true,false,true)).toBe(false);
  });

  it("keeps the same reading position when history is inserted above it",()=>{
    expect(scrollTopAfterContentChange(320,900,1500,false,true)).toBe(920);
    expect(scrollTopAfterContentChange(320,900,1500,false,false)).toBe(320);
  });

  it("sticks to the latest output when the view was already at the bottom",()=>{
    expect(scrollTopAfterContentChange(500,900,1500,true,true)).toBe(1500);
  });

  it("keeps the reader's desired position through a temporary layout clamp",()=>{
    const desired=640;
    expect(readingScrollRestoreTarget(desired,430,400,false)).toBe(30);
    expect(readingScrollRestoreTarget(desired,1400,400,false)).toBe(640);
  });

  it("pins only a position that was genuinely captured at the top",()=>{
    expect(readingScrollRestoreTarget(640,1400,400,true)).toBe(0);
    expect(readingScrollRestoreTarget(12,1400,400,false)).toBe(12);
  });

  it("keeps restoration pending while a short intermediate layout clamps the coordinate",()=>{
    expect(readingRestoreNeedsMoreHeight(640,30)).toBe(true);
    expect(readingRestoreNeedsMoreHeight(640,640)).toBe(false);
  });

  it("commits the top only for a reader gesture or the explicit jump control",()=>{
    expect(intentionalTopReach(true,true,false)).toBe(true);
    expect(intentionalTopReach(true,false,true)).toBe(true);
    expect(intentionalTopReach(true,false,false)).toBe(false);
    expect(intentionalTopReach(false,true,true)).toBe(false);
  });

  it("restores a mid-log reading position after a layout clamp reaches zero",()=>{
    expect(topClampNeedsRestore(true,false,false,false,-320)).toBe(true);
    expect(topClampNeedsRestore(true,true,false,false,-320)).toBe(false);
    expect(topClampNeedsRestore(true,false,true,false,-320)).toBe(false);
    expect(topClampNeedsRestore(true,false,false,true,-320)).toBe(false);
    expect(topClampNeedsRestore(true,false,false,false,20)).toBe(false);
  });
});
