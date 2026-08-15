import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuthenticator, isLoopbackAddress, LocalEntryAuth, verifyAccessToken } from "../../src/server/security/auth.js";

const accessConfig = {
  teamDomain:"https://test-team.cloudflareaccess.com",
  audience:"test-access-audience",
  allowedEmail:"owner@example.com"
};
const issuer = accessConfig.teamDomain;
const audience = accessConfig.audience;
const email = accessConfig.allowedEmail;
let privateKey: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  const publicJwk = await exportJWK(pair.publicKey);
  publicJwk.kid = "local-access-test";
  publicJwk.alg = "RS256";
  jwks = createLocalJWKSet({ keys: [publicJwk] });
});

async function token(values: { issuer?: string; audience?: string; email?: string } = {}) {
  return new SignJWT({ email: values.email ?? email })
    .setProtectedHeader({ alg: "RS256", kid: "local-access-test" })
    .setIssuer(values.issuer ?? issuer)
    .setAudience(values.audience ?? audience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

describe("Cloudflare Access claim verification", () => {
  it("accepts only the exact issuer, audience, and email", async () => {
    await expect(verifyAccessToken(await token(), jwks, issuer, audience, email)).resolves.toBe(email);
  });

  it("rejects a wrong issuer", async () => {
    await expect(verifyAccessToken(await token({ issuer: "https://wrong.cloudflareaccess.com" }), jwks, issuer, audience, email)).rejects.toThrow();
  });

  it("rejects a wrong audience", async () => {
    await expect(verifyAccessToken(await token({ audience: "wrong-audience" }), jwks, issuer, audience, email)).rejects.toThrow();
  });

  it("rejects a wrong email", async () => {
    await expect(verifyAccessToken(await token({ email: "wrong@example.com" }), jwks, issuer, audience, email)).rejects.toThrow("Cloudflare identity is not allowed");
  });
});

describe("local bootstrap authentication",()=>{
  it("recognizes only socket loopback address forms",()=>{expect(isLoopbackAddress("127.0.0.1")).toBe(true);expect(isLoopbackAddress("::1")).toBe(true);expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);expect(isLoopbackAddress("192.168.0.20")).toBe(false);});
  it("is restricted to a loopback external origin",async()=>{const base={...accessConfig,root:"/tmp",dataDir:"/tmp",logDir:"/tmp",runDir:"/tmp",dbPath:"/tmp/db",projects:[],claudeBinary:"/tmp/claude",host:"127.0.0.1",port:3410,promptMaxLength:20000,commandTimeoutMs:15000,commandOutputLimit:2097152,teamDomain:"",audience:"",authMode:"local" as const};await expect(createAuthenticator({...base,externalOrigin:"http://127.0.0.1:3410"} as any)({} as any)).resolves.toBe("local-admin");await expect(createAuthenticator({...base,externalOrigin:"https://public.example.com"} as any)({} as any)).rejects.toThrow("loopback");});
  it("exchanges a 256-bit Windows entry token once and requires its HttpOnly session cookie",async()=>{
    const entryToken="a".repeat(64),entry=new LocalEntryAuth({platform:"win32",authMode:"local",entryToken});
    expect(entry.snapshot()).toEqual({required:true,configured:true,consumed:false,sessionActive:false});
    expect(()=>entry.exchange(entryToken,"192.168.0.2")).toThrow("loopback");
    const session=entry.exchange(entryToken,"127.0.0.1"),cookie=entry.cookie(session);
    expect(cookie).toContain("HttpOnly");expect(cookie).toContain("SameSite=Strict");expect(cookie).not.toContain(entryToken);
    expect(()=>entry.exchange(entryToken,"127.0.0.1")).toThrow("already consumed");
    const config={...accessConfig,externalOrigin:"http://127.0.0.1:3410",authMode:"local" as const},authenticate=createAuthenticator(config as any,{localEntry:entry});
    await expect(authenticate({ip:"127.0.0.1",headers:{}} as any)).rejects.toMatchObject({code:"LOCAL_ENTRY_SESSION_REQUIRED"});
    await expect(authenticate({ip:"127.0.0.1",headers:{cookie:cookie.split(";")[0]}} as any)).resolves.toBe("local-admin");
    await expect(authenticate({ip:"192.168.0.2",headers:{cookie:cookie.split(";")[0]}} as any)).rejects.toMatchObject({code:"LOCAL_ENTRY_LOOPBACK_REQUIRED"});
    const restarted=new LocalEntryAuth({platform:"win32",authMode:"local",entryToken:"b".repeat(64)});
    expect(()=>restarted.authenticate({ip:"127.0.0.1",headers:{cookie:cookie.split(";")[0]}} as any)).toThrow("session is required");
  });
  it("fails closed when a Windows launcher token is absent or not 256-bit",()=>{
    expect(()=>new LocalEntryAuth({platform:"win32",authMode:"local",entryToken:"short"})).toThrow("256 bits");
    const missing=new LocalEntryAuth({platform:"win32",authMode:"local"});
    expect(()=>missing.exchange("a".repeat(64),"127.0.0.1")).toThrow("not configured");
    expect(new LocalEntryAuth({platform:"linux",authMode:"local"}).snapshot().required).toBe(false);
  });
});

describe("test authentication coexistence",()=>{
  const config={...accessConfig,root:"/tmp",dataDir:"/tmp",logDir:"/tmp",runDir:"/tmp",dbPath:"/tmp/db",projects:[],claudeBinary:"/tmp/claude",host:"127.0.0.1",port:3410,promptMaxLength:20000,commandTimeoutMs:15000,commandOutputLimit:2097152,authMode:"test" as const};
  const previousTestMode=process.env.CLAUDEX_WORKHOUSE_TEST_MODE;beforeAll(()=>{process.env.CLAUDEX_WORKHOUSE_TEST_MODE="1";});afterAll(()=>{if(previousTestMode===undefined)delete process.env.CLAUDEX_WORKHOUSE_TEST_MODE;else process.env.CLAUDEX_WORKHOUSE_TEST_MODE=previousTestMode;});
  it("keeps Cloudflare fallback disabled unless the live verification explicitly enables it",async()=>{const request={ip:"127.0.0.1",headers:{"cf-access-jwt-assertion":await token()}} as any;await expect(createAuthenticator(config as any,{jwks})(request)).rejects.toThrow("Invalid test identity");});
  it("accepts a verified Cloudflare user alongside loopback test identity when explicitly enabled",async()=>{const authenticate=createAuthenticator(config as any,{jwks,allowCloudflareInTest:true});await expect(authenticate({ip:"127.0.0.1",headers:{"x-claudex-workhouse-test-user":email}} as any)).resolves.toBe(email);await expect(authenticate({ip:"127.0.0.1",headers:{"cf-access-jwt-assertion":await token()}} as any)).resolves.toBe(email);});
});

describe("Tailscale Serve authentication",()=>{
  const config={...accessConfig,externalOrigin:"https://workhouse.example-tailnet.ts.net",authMode:"tailscale" as const,tailscaleAllowedEmail:"owner@example.com"};
  const request=(headers:Record<string,string>,ip="127.0.0.1")=>({ip,headers,raw:{socket:{remoteAddress:ip}}}) as any;
  it("accepts an exact Serve login only through the loopback backend and configured host",async()=>{
    const authenticate=createAuthenticator(config as any);
    await expect(authenticate(request({host:"workhouse.example-tailnet.ts.net","tailscale-user-login":"owner@example.com",origin:config.externalOrigin}))).resolves.toBe("owner@example.com");
  });
  it("rejects spoofable direct requests, missing identity, wrong identity, host, and origin",async()=>{
    const authenticate=createAuthenticator(config as any),base={host:"workhouse.example-tailnet.ts.net","tailscale-user-login":"owner@example.com"};
    await expect(authenticate(request(base,"192.168.1.20"))).rejects.toMatchObject({code:"TAILSCALE_BACKEND_NOT_LOOPBACK"});
    await expect(authenticate(request({host:base.host}))).rejects.toMatchObject({code:"TAILSCALE_IDENTITY_REQUIRED"});
    await expect(authenticate(request({...base,"tailscale-user-login":"other@example.com"}))).rejects.toMatchObject({code:"TAILSCALE_IDENTITY_NOT_ALLOWED"});
    await expect(authenticate(request({...base,host:"wrong.ts.net"}))).rejects.toMatchObject({code:"TAILSCALE_HOST_MISMATCH"});
    await expect(authenticate(request({...base,origin:"https://wrong.ts.net"}))).rejects.toMatchObject({code:"TAILSCALE_ORIGIN_MISMATCH"});
  });
});
