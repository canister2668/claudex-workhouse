import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pairWorker } from "../../src/server/desktop-worker/client.js";

let server:http.Server|null=null;
afterEach(async()=>{vi.unstubAllEnvs();await new Promise<void>(resolve=>server?server.close(()=>resolve()):resolve());server=null;});

describe("Desktop Worker pairing response",()=>{
  it("reports a Cloudflare Access redirect instead of parsing its HTML as JSON",async()=>{
    vi.stubEnv("CLAUDEX_WORKHOUSE_WORKER_HOME","/tmp/claudex-workhouse-worker-pairing-response-test");
    server=http.createServer((_request,response)=>{response.writeHead(302,{location:"https://team.cloudflareaccess.com/cdn-cgi/access/login/example"});response.end("<!DOCTYPE html>");});
    await new Promise<void>(resolve=>server!.listen(0,"127.0.0.1",resolve));const address=server.address();if(!address||typeof address==="string")throw new Error("missing test address");
    await expect(pairWorker(`http://127.0.0.1:${address.port}`,"ABCD-EFGH-IJKL","Desktop")).rejects.toThrow(/Cloudflare Access/);
  });
});
