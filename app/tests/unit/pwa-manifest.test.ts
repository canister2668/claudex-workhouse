import fs from"node:fs";
import{describe,expect,it}from"vitest";

describe("PWA manifest task entry contracts",()=>{
  it("keeps shared content out of the entry URL and posts supported files to the authenticated API",()=>{
    const manifest=JSON.parse(fs.readFileSync("public/manifest.webmanifest","utf8"));
    expect(manifest.shortcuts).toContainEqual(expect.objectContaining({url:"/?new=1"}));
    expect(manifest.share_target).toMatchObject({action:"/api/share-target",method:"POST",enctype:"multipart/form-data",params:{title:"title",text:"text",url:"url"}});
    expect(manifest.share_target.params.files[0].name).toBe("files");
    expect(manifest.share_target.action).not.toContain("title");
  });
});
