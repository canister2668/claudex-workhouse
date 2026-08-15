import{describe,expect,it,vi}from"vitest";
import{exchangeLocalEntryFragment,localEntryTokenFromHash}from"../../src/web/local-entry-bootstrap.js";

describe("Windows local entry browser bootstrap",()=>{
  it("accepts only 256-bit token encodings and exchanges from the URL fragment",async()=>{
    const token="a".repeat(64),replaceState=vi.fn(),request=vi.fn(async()=>new Response("{}",{status:200}));
    expect(localEntryTokenFromHash(`#entry=${token}`)).toBe(token);expect(localEntryTokenFromHash("#entry=short")).toBeNull();
    await expect(exchangeLocalEntryFragment({hash:`#entry=${token}`,pathname:"/",search:"?new=1"}, {replaceState},request as any)).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith("/api/local-entry/exchange",expect.objectContaining({method:"POST",credentials:"same-origin",body:JSON.stringify({token})}));
    expect(replaceState).toHaveBeenCalledWith(null,"","/?new=1");
  });

  it("removes the fragment after a terminal exchange failure",async()=>{
    const replaceState=vi.fn(),request=vi.fn(async()=>new Response("{}",{status:403}));
    await expect(exchangeLocalEntryFragment({hash:`#entry=${"b".repeat(64)}`,pathname:"/",search:""}, {replaceState},request as any)).rejects.toMatchObject({status:403});
    expect(replaceState).toHaveBeenCalledWith(null,"","/");
  });
});
