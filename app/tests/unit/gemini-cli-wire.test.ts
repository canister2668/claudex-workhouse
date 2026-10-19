import {describe,it,expect} from "vitest";
import fs from "node:fs";
import vm from "node:vm";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {geminiWireContents,patchGeminiWireSource} from "../../src/server/gemini-cli-wire";
import {geminiCliResultFailure} from "../../src/server/gemini-cli-runtime";

describe("Vertex multimodal tool wire compatibility",()=>{
  const image={inlineData:{mimeType:"image/png",data:"unchanged-image-bytes"}};
  it("keeps parallel tool IDs, response text and images paired without modifying history",()=>{
    const history=[{role:"model",parts:[{functionCall:{name:"read_file",id:"a"},thoughtSignature:"signature"}]},{role:"user",parts:[
      {functionResponse:{id:"a",name:"read_file",response:{output:"first"}}},image,
      {functionResponse:{id:"b",name:"read_file",response:{output:"second"}}},{fileData:{mimeType:"image/png",fileUri:"gs://fixture/image"}}
    ]}];
    const before=JSON.stringify(history),result=geminiWireContents(history,"gemini-4-argon");
    expect(JSON.stringify(history)).toBe(before);
    expect(result[0]).toEqual(history[0]);
    expect(result[1].parts).toEqual([
      {functionResponse:{id:"a",name:"read_file",response:{output:"first"},parts:[image]}},
      {functionResponse:{id:"b",name:"read_file",response:{output:"second"},parts:[{fileData:{mimeType:"image/png",fileUri:"gs://fixture/image"}}]}}
    ]);
    expect(geminiWireContents(result,"gemini-4-argon")).toEqual(result);
  });
  it("preserves already nested media and leaves normal user images and other model families intact",()=>{
    const history=[{role:"user",parts:[image]},{role:"user",parts:[{functionResponse:{name:"read_file",response:{},parts:[image]}}]}];
    expect(geminiWireContents(history,"gemini-3.8-flash")).toEqual(history);
    expect(geminiWireContents(history,"gemini-2.5-pro")).toBe(history);
  });
  it("does not invent associations across text or before the first tool result",()=>{
    const history=[{role:"user",parts:[image,{functionResponse:{name:"tool",response:{}}},{text:"user text"},image]}];
    expect(geminiWireContents(history,"gemini-4-argon")).toEqual(history);
  });
  it("fails closed when an upstream function changes instead of silently sending broken requests",()=>{
    expect(patchGeminiWireSource("unrelated module")).toBe("unrelated module");
    expect(()=>patchGeminiWireSource("function stripToolCallIdPrefixes(contents) {} ")).toThrow("GEMINI_CLI_COMPATIBILITY_UNSUPPORTED");
  });
  it("keeps transport retries but blocks invalid-response replay independently",()=>{
    const source=fs.readFileSync(new URL("../fixtures/gemini-cli-0.55.1-wire.txt",import.meta.url),"utf8");
    const retry=vm.runInNewContext(patchGeminiWireSource(source)+"; shouldRetry");
    expect(retry(false,true,{aborted:false})).toBe(true);
    expect(retry(false,true,{aborted:false},true)).toBe(false);
    expect(retry(false,true,{aborted:true})).toBe(false);
    expect(retry(true,false,{aborted:false})).toBe(false);
    expect(retry(true,true,{aborted:false})).toBe(false);
  });
  it("patches the native CLI seam and preserves nested media while stripping call prefixes",()=>{
    const source=fs.readFileSync(new URL("../fixtures/gemini-cli-0.55.1-wire.txt",import.meta.url),"utf8");
    const context=vm.createContext({});
    context[Symbol.for("workhouse.geminiWireContents")]=geminiWireContents;
    const send=vm.runInContext(patchGeminiWireSource(source)+"; send",context);
    const history=[{role:"model",parts:[{functionCall:{name:"read_file",id:"read_file__a",args:{path:"image.png"}},thoughtSignature:"signature"}]},{role:"user",parts:[
      {functionResponse:{name:"read_file",id:"read_file__a",response:{output:"loaded"},parts:[image]}},image
    ]}];
    const result=send(history,"gemini-4-argon");
    expect(result[0].parts[0]).toEqual({functionCall:{name:"read_file",id:"a",args:{path:"image.png"}},thoughtSignature:"signature"});
    expect(result[1].parts).toEqual([{functionResponse:{name:"read_file",id:"a",response:{output:"loaded"},parts:[image,image]}}]);
    expect(history[1].parts).toHaveLength(2);
  });
  it("loads the adapter in a real Node process without changing installed bundle bytes",()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"gemini wire "));
    try{
      const directory=path.join(root,"node_modules/@google/gemini-cli/bundle");
      fs.mkdirSync(directory,{recursive:true});
      fs.writeFileSync(path.join(directory,"../package.json"),JSON.stringify({type:"module"}));
      const source=fs.readFileSync(new URL("../fixtures/gemini-cli-0.55.1-wire.txt",import.meta.url),"utf8");
      const history=[{role:"user",parts:[{functionResponse:{name:"read_file",id:"read_file__a",response:{}}},image]}];
      const file=path.join(directory,"fixture.js"),script=source+`\nconsole.log(JSON.stringify(send(${JSON.stringify(history)},"gemini-4-argon")));`;
      fs.writeFileSync(file,script);
      const output=execFileSync(process.execPath,["--import",new URL("../../src/server/gemini-cli-preload.ts",import.meta.url).href,file],{encoding:"utf8",timeout:10000});
      expect(JSON.parse(output)[0].parts).toEqual([{functionResponse:{name:"read_file",id:"a",response:{},parts:[image]}}]);
      expect(fs.readFileSync(file,"utf8")).toBe(script);
    }finally{fs.rmSync(root,{recursive:true,force:true});}
  });
  it("distinguishes the terminal 400 from recovered 429 warnings and retains genuine terminal 429",()=>{
    const error='[API Error: {"error":{"code":400,"message":"Requests ending with a model turn are not supported."}}]';
    const quota="RESOURCE_EXHAUSTED status 429";
    expect(geminiCliResultFailure(error,quota).code).toBe("GEMINI_INVALID_TURN");
    expect(geminiCliResultFailure("",`${quota}\n${error}`).code).toBe("GEMINI_INVALID_TURN");
    expect(geminiCliResultFailure(quota,error).code).toBe("VERTEX_QUOTA_EXHAUSTED");
  });
});

it("reports a terminal fetch failure separately from earlier quota retries",()=>{
 const message="[API Error: Failed to generate content: exception TypeError: fetch failed sending request]";
 const diagnostics="Attempt 4 failed with status 429. Retrying with backoff... RESOURCE_EXHAUSTED\n"+message;
 expect(geminiCliResultFailure(message,diagnostics).code).toBe("GEMINI_CLI_NETWORK_ERROR");
 expect(geminiCliResultFailure("",diagnostics).code).toBe("GEMINI_CLI_NETWORK_ERROR");
});

it("blocks model requests if a future CLI silently bypasses the adapter",()=>{
 const script='fetch("https://should-not-resolve.invalid/models/model:generateContent").then(()=>process.exit(9)).catch(error=>console.log(error.message));';
 const output=execFileSync(process.execPath,["--import",new URL("../../src/server/gemini-cli-preload.ts",import.meta.url).href,"--input-type=module","-e",script],{encoding:"utf8",timeout:10000});
 expect(output).toContain("GEMINI_CLI_COMPATIBILITY_UNSUPPORTED");
 expect(output).toContain("no model request was sent");
});
