import{describe,expect,it}from"vitest";
import{consumeShareTargetPayload,nativeShareTargetNavigation}from"../../src/server/share-target";

const allowed=new Set(["https://workhouse.example.test"]);
const request=(headers:Record<string,string>)=>({method:"POST",url:"/api/share-target",headers:{"content-type":"multipart/form-data; boundary=x",...headers}});

describe("native share target request boundary",()=>{
  it("allows authenticated app and OS document navigations without the AJAX guard header",()=>{
    expect(nativeShareTargetNavigation(request({origin:"https://workhouse.example.test","sec-fetch-site":"same-origin"}),allowed)).toBe(true);
    expect(nativeShareTargetNavigation(request({"sec-fetch-site":"none","sec-fetch-mode":"navigate","sec-fetch-dest":"document"}),allowed)).toBe(true);
  });
  it("rejects cross-site forms, null-origin subresources, and non-multipart requests",()=>{
    expect(nativeShareTargetNavigation(request({origin:"https://evil.test","sec-fetch-site":"cross-site","sec-fetch-mode":"navigate","sec-fetch-dest":"document"}),allowed)).toBe(false);
    expect(nativeShareTargetNavigation(request({origin:"null","sec-fetch-site":"cross-site"}),allowed)).toBe(false);
    expect(nativeShareTargetNavigation({method:"POST",url:"/api/share-target",headers:{"content-type":"application/json"}},allowed)).toBe(false);
  });
  it("fails closed when navigation metadata is absent or incomplete",()=>{
    expect(nativeShareTargetNavigation(request({}),allowed)).toBe(false);
    expect(nativeShareTargetNavigation(request({"sec-fetch-mode":"cors"}),allowed)).toBe(false);
  });
  it("consumes a share payload exactly once and rejects expired values",()=>{
    const payload={expiresAt:2_000,consumed:false,value:"shared"};
    expect(consumeShareTargetPayload(payload,1_000)).toBe(payload);
    expect(consumeShareTargetPayload(payload,1_000)).toBeNull();
    expect(consumeShareTargetPayload({expiresAt:999,consumed:false},1_000)).toBeNull();
  });
});
