import Fastify from"fastify";
import{afterEach,describe,expect,it}from"vitest";
import{authorizeLocalOwnerRequest,createAuthenticator,LocalEntryAuth,localEntryPublicRequest,registerLocalEntryRoutes}from"../../src/server/security/auth.js";

const apps:Array<ReturnType<typeof Fastify>>=[];
afterEach(async()=>{for(const app of apps.splice(0))await app.close();});

describe("Windows local entry authentication",()=>{
  it("exchanges once, sets an HttpOnly cookie, protects APIs, and exposes only a safe status snapshot",async()=>{
    const token="c".repeat(64),auth=new LocalEntryAuth({platform:"win32",authMode:"local",entryToken:token}),app=Fastify({logger:false});apps.push(app);
    app.addHook("onRequest",async request=>{if(request.url.startsWith("/api/")&&!localEntryPublicRequest(request))auth.authenticate(request);});
    registerLocalEntryRoutes(app,{auth,externalOrigin:"http://127.0.0.1:3410",snapshot:()=>({platform:"win32",server:{status:"running"}})});
    app.get("/api/protected",async()=>({ok:true}));

    const before=await app.inject({method:"GET",url:"/api/bootstrap/status"});
    expect(before.statusCode).toBe(200);expect(before.headers["cache-control"]).toBe("no-store");
    expect(before.json()).toEqual({schemaVersion:1,platform:"win32",server:{status:"running"},localEntry:{required:true,configured:true,consumed:false,sessionActive:false}});
    expect(JSON.stringify(before.json())).not.toContain(token);
    expect((await app.inject({method:"GET",url:"/api/protected"})).statusCode).toBe(403);

    const exchanged=await app.inject({method:"POST",url:"/api/local-entry/exchange",payload:{token}});
    expect(exchanged.statusCode).toBe(200);expect(exchanged.json()).toEqual({authenticated:true});
    const cookie=String(exchanged.headers["set-cookie"]).split(";")[0]!;
    expect(exchanged.headers["set-cookie"]).toContain("HttpOnly");expect(exchanged.headers["set-cookie"]).toContain("SameSite=Strict");
    expect(String(exchanged.headers["set-cookie"])).not.toContain(token);
    expect((await app.inject({method:"GET",url:"/api/protected",headers:{cookie}})).json()).toEqual({ok:true});
    expect((await app.inject({method:"POST",url:"/api/local-entry/exchange",payload:{token}})).statusCode).toBe(409);
  });

  it("does not expose bootstrap or exchange routes beyond loopback",async()=>{
    const auth=new LocalEntryAuth({platform:"win32",authMode:"local",entryToken:"d".repeat(64)}),app=Fastify({logger:false});apps.push(app);
    registerLocalEntryRoutes(app,{auth,externalOrigin:"http://127.0.0.1:3410",snapshot:()=>({})});
    expect((await app.inject({method:"GET",url:"/api/bootstrap/status",remoteAddress:"192.168.1.9"})).statusCode).toBe(403);
    expect((await app.inject({method:"POST",url:"/api/local-entry/exchange",remoteAddress:"192.168.1.9",payload:{token:"d".repeat(64)}})).statusCode).toBe(403);
  });

  it("requires entry before public owner claim routes and both entry and owner credentials after claim",async()=>{
    const token="e".repeat(64),auth=new LocalEntryAuth({platform:"win32",authMode:"local",entryToken:token}),app=Fastify({logger:false});apps.push(app);
    const config={authMode:"local",externalOrigin:"http://127.0.0.1:3410",teamDomain:"",audience:""} as any,authenticate=createAuthenticator(config,{localEntry:auth});
    let claimed=false,ownerCredential=false;
    app.addHook("onRequest",async request=>{
      if(!request.url.startsWith("/api/")||localEntryPublicRequest(request))return;
      const access=request.url==="/api/bootstrap/owner-claim/status"?"public":claimed?"normal":"blocked";
      const actor=await authorizeLocalOwnerRequest(request,{entryRequired:true,authenticate,access,ownerAuthenticate:item=>item.headers.cookie?.includes("owner=valid")?"owner:test":null,ownerHasCredential:()=>ownerCredential});
      if(actor)(request as any).actor=actor;
    });
    registerLocalEntryRoutes(app,{auth,externalOrigin:config.externalOrigin,snapshot:()=>({})});
    app.get("/api/bootstrap/owner-claim/status",async()=>({claimed}));
    app.get("/api/protected-owner",async request=>({actor:(request as any).actor}));

    expect((await app.inject({method:"GET",url:"/api/bootstrap/owner-claim/status"})).statusCode).toBe(403);
    const exchange=await app.inject({method:"POST",url:"/api/local-entry/exchange",payload:{token}}),entryCookie=String(exchange.headers["set-cookie"]).split(";")[0]!;
    expect((await app.inject({method:"GET",url:"/api/bootstrap/owner-claim/status",headers:{cookie:entryCookie}})).statusCode).toBe(200);
    expect((await app.inject({method:"GET",url:"/api/protected-owner",headers:{cookie:entryCookie}})).statusCode).toBe(428);

    claimed=true;ownerCredential=true;
    const missingOwner=await app.inject({method:"GET",url:"/api/protected-owner",headers:{cookie:entryCookie}});
    expect(missingOwner.statusCode).toBe(403);expect(missingOwner.json().code).toBe("OWNER_CREDENTIAL_REQUIRED");
    const both=await app.inject({method:"GET",url:"/api/protected-owner",headers:{cookie:`${entryCookie}; owner=valid`}});
    expect(both.statusCode).toBe(200);expect(both.json()).toEqual({actor:"owner:test"});
  });
});
