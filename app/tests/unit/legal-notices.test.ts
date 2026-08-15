import fs from"node:fs";
import os from"node:os";
import path from"node:path";
import{afterEach,describe,expect,it}from"vitest";
import{COPYRIGHT_HOLDER,legalNoticeMetadata,ORIGINAL_REPOSITORY}from"../../src/server/legal-notices.js";

const created:string[]=[];
afterEach(()=>{for(const item of created.splice(0))fs.rmSync(item,{recursive:true,force:true});});
function rootWithCommit(commit="a".repeat(40)){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"claudex-legal-"));created.push(root);
  fs.mkdirSync(path.join(root,".git","refs","heads"),{recursive:true});
  fs.writeFileSync(path.join(root,".git","HEAD"),"ref: refs/heads/main\n");
  fs.writeFileSync(path.join(root,".git","refs","heads","main"),`${commit}\n`);
  return root;
}

describe("legal notice build metadata",()=>{
  it("uses the canonical repository and current commit for an official source build",()=>{
    const commit="b".repeat(40),value=legalNoticeMetadata({root:rootWithCommit(commit),version:"0.1.0",environment:{}});
    expect(COPYRIGHT_HOLDER).toBe("Canister");
    expect(value).toMatchObject({project:"Claudex Workhouse",copyrightHolder:"Canister",license:"AGPL-3.0-only",distributionStatus:"Official",originalRepository:ORIGINAL_REPOSITORY,commitSha:commit,correspondingSource:`${ORIGINAL_REPOSITORY}/tree/${commit}`});
  });
  it("keeps original and corresponding source separate for a modified distribution",()=>{
    const value=legalNoticeMetadata({root:rootWithCommit(),version:"0.1.0",environment:{
      CLAUDEX_WORKHOUSE_DISTRIBUTION_STATUS:"Modified",
      CLAUDEX_WORKHOUSE_DISTRIBUTOR:"Example modifier",
      CLAUDEX_WORKHOUSE_COMMIT_SHA:"1234567",
      CLAUDEX_WORKHOUSE_SOURCE_URL:"https://code.example.test/workhouse/tree/1234567"
    }});
    expect(value).toMatchObject({distributionStatus:"Modified",distributor:"Example modifier",originalRepository:ORIGINAL_REPOSITORY,commitSha:"1234567",correspondingSource:"https://code.example.test/workhouse/tree/1234567"});
    expect(value.correspondingSource).not.toBe(value.originalRepository);
  });
  it("rejects invalid or incomplete modified-build metadata without requesting the URL",()=>{
    expect(()=>legalNoticeMetadata({root:rootWithCommit(),version:"0.1.0",environment:{CLAUDEX_WORKHOUSE_DISTRIBUTION_STATUS:"Modified"}})).toThrow("DISTRIBUTOR");
    expect(()=>legalNoticeMetadata({root:rootWithCommit(),version:"0.1.0",environment:{CLAUDEX_WORKHOUSE_DISTRIBUTION_STATUS:"Unofficial",CLAUDEX_WORKHOUSE_DISTRIBUTOR:"Modifier"}})).toThrow("SOURCE_URL");
    expect(()=>legalNoticeMetadata({root:rootWithCommit(),version:"0.1.0",environment:{CLAUDEX_WORKHOUSE_SOURCE_URL:"javascript:alert(1)"}})).toThrow("HTTP or HTTPS");
    expect(()=>legalNoticeMetadata({root:rootWithCommit(),version:"0.1.0",environment:{CLAUDEX_WORKHOUSE_SOURCE_URL:"https://user:secret@example.test/source"}})).toThrow("embedded credentials");
  });
});
