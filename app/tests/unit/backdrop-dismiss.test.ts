import{describe,expect,it}from"vitest";
import{beginBackdropPointer,moveBackdropPointer,shouldDismissBackdrop}from"../../src/web/backdrop-dismiss";

describe("modal backdrop dismissal",()=>{
  it("dismisses only a stationary press that begins and ends on the backdrop",()=>{
    const press=beginBackdropPointer(true,100,100);
    expect(shouldDismissBackdrop(press,true)).toBe(true);
    expect(shouldDismissBackdrop(press,false)).toBe(false);
    expect(shouldDismissBackdrop(moveBackdropPointer(press,103,102),true)).toBe(true);
    expect(shouldDismissBackdrop(moveBackdropPointer(press,120,100),true)).toBe(false);
  });

  it("keeps the modal open when a drag begins inside it and ends outside",()=>{
    const drag=moveBackdropPointer(beginBackdropPointer(false,300,300),40,40);
    expect(shouldDismissBackdrop(drag,true)).toBe(false);
  });
});
