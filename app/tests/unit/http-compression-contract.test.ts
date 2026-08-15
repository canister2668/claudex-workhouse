import fs from "node:fs";
import path from "node:path";
import {gunzipSync} from "node:zlib";
import Fastify from "fastify";
import fastifyCompress from "@fastify/compress";
import {describe,expect,it} from "vitest";

describe("HTTP compression contract",()=>{
  it("registers global gzip for non-streaming API responses",()=>{
    const server=fs.readFileSync(path.resolve("src/server/index.ts"),"utf8"),manifest=JSON.parse(fs.readFileSync(path.resolve("package.json"),"utf8"));
    expect(manifest.dependencies["@fastify/compress"]).toBeTruthy();
    expect(server).toContain('import fastifyCompress from "@fastify/compress"');
    expect(server).toContain('app.register(fastifyCompress,{global:true,threshold:1024,encodings:["gzip"]})');
    expect(server).toContain('"Content-Encoding":"identity"');
  });

  it("serves a large JSON response as valid gzip",async()=>{
    const app=Fastify();await app.register(fastifyCompress,{global:true,threshold:1024,encodings:["gzip"]});app.get("/large",async()=>({payload:"x".repeat(16_384)}));
    try{const response=await app.inject({method:"GET",url:"/large",headers:{"accept-encoding":"gzip"}});expect(response.headers["content-encoding"]).toBe("gzip");expect(JSON.parse(gunzipSync(response.rawPayload).toString("utf8"))).toEqual({payload:"x".repeat(16_384)});}finally{await app.close();}
  });
});
