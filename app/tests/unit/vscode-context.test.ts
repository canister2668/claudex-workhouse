import{describe,expect,it,vi}from"vitest";
import{matchingVscodeWorkspace,vscodeContextFromLocation,vscodeContextPrompt}from"../../src/web/vscode-context";

function fragment(value:unknown){const bytes=new TextEncoder().encode(JSON.stringify(value)),binary=String.fromCharCode(...bytes);return`#vscode-context=${btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")}`;}

describe("VS Code context deep links",()=>{
  it("validates a bounded fragment and formats an explicit preview prompt",()=>{
    vi.stubGlobal("atob",(value:string)=>Buffer.from(value,"base64").toString("binary"));
    const context=vscodeContextFromLocation({hash:fragment({version:1,workspacePath:"/work/app",filePath:"src/main.ts",languageId:"typescript",startLine:4,startColumn:2,endLine:6,endColumn:8,selectedText:"const ok = true;",request:"이 부분을 고쳐줘",diagnostics:[{severity:"error",message:"Broken type",line:5,column:3}]})} as Location);
    expect(context).not.toBeNull();
    expect(vscodeContextPrompt(context!)).toContain("ERROR 6:4 Broken type");
    expect(vscodeContextPrompt(context!)).toContain("```typescript\nconst ok = true;");
  });

  it("rejects invalid payloads and matches normalized workspace paths",()=>{
    vi.stubGlobal("atob",(value:string)=>Buffer.from(value,"base64").toString("binary"));
    expect(vscodeContextFromLocation({hash:"#vscode-context=bad"} as Location)).toBeNull();
    const context=vscodeContextFromLocation({hash:fragment({version:1,workspacePath:"C:\\work\\app\\",filePath:"src/a.ts"})} as Location)!;
    expect(matchingVscodeWorkspace(context,[{canonicalPath:"C:/work/app",id:"matched"}])).toMatchObject({id:"matched"});
  });
});
