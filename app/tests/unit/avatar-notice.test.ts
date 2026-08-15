import{describe,expect,it}from"vitest";
import{AVATAR_TRAY_SHAPE_STORAGE_KEY,avatarNoticeKey,DEFAULT_AVATAR_COLLAPSE_DELAY_MS,normalizeAvatarCollapseDelay,normalizeAvatarTrayShape,readAvatarTrayShape,terminalNoticeStatus,writeAvatarTrayShape}from"../../src/web/avatar-notice";

describe("avatar notice helpers",()=>{
  it("keeps supported delays and defaults invalid values to four seconds",()=>{
    expect(DEFAULT_AVATAR_COLLAPSE_DELAY_MS).toBe(4000);
    expect(normalizeAvatarCollapseDelay(undefined)).toBe(DEFAULT_AVATAR_COLLAPSE_DELAY_MS);
    expect(normalizeAvatarCollapseDelay(3000)).toBe(3000);
    expect(normalizeAvatarCollapseDelay("10000")).toBe(10000);
    expect(normalizeAvatarCollapseDelay(5000)).toBe(4000);
  });

  it("does not treat a repeated semantic state as a new notice",()=>{
    const state={engine:"claude",sessionId:"thread-1",status:"completed",outfit:"normal",emotion:"happy",line:"해냈어요!",statusLine:"완료!"};
    expect(avatarNoticeKey(state)).toBe(avatarNoticeKey({...state}));
    expect(avatarNoticeKey(state)).not.toBe(avatarNoticeKey({...state,line:"새 상태"}));
  });

  it("keeps the tray shape on the device and falls back to the breakpoint layout",()=>{
    for(const shape of ["auto","wide","card"])expect(normalizeAvatarTrayShape(shape)).toBe(shape);
    for(const value of ["square",null,undefined,1,""])expect(normalizeAvatarTrayShape(value)).toBe("auto");
    const store=new Map<string,string>();
    const original=Reflect.get(globalThis,"localStorage");
    Object.defineProperty(globalThis,"localStorage",{value:{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{store.set(key,value);}},configurable:true});
    try{
      expect(readAvatarTrayShape()).toBe("auto");
      expect(writeAvatarTrayShape("card")).toBe("card");
      expect(store.get(AVATAR_TRAY_SHAPE_STORAGE_KEY)).toBe("card");
      expect(readAvatarTrayShape()).toBe("card");
      // A value from an older or corrupted build must not leave the tray unstyled.
      store.set(AVATAR_TRAY_SHAPE_STORAGE_KEY,"tall");
      expect(readAvatarTrayShape()).toBe("auto");
    }finally{
      if(original===undefined)Reflect.deleteProperty(globalThis,"localStorage");
      else Object.defineProperty(globalThis,"localStorage",{value:original,configurable:true});
    }
  });

  it("treats only a finished run as the outcome that overrides a dismissal",()=>{
    for(const status of ["completed","failed","stopped"])expect(terminalNoticeStatus(status)).toBe(true);
    for(const status of ["running","pending","queued","waiting","reasoning","acting","",null,undefined])expect(terminalNoticeStatus(status)).toBe(false);
  });
});
