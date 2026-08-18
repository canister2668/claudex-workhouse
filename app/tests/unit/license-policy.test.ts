import crypto from"node:crypto";
import fs from"node:fs";
import path from"node:path";
import{describe,expect,it}from"vitest";

const repositoryRoot=path.resolve("..");
const read=(relative:string)=>fs.readFileSync(path.join(repositoryRoot,relative),"utf8");
const authoritativeFiles=["LICENSE","NOTICE.md","THIRD_PARTY_NOTICES.md"];
const translatedFiles=["LICENSE.ko.md","LICENSE.ja.md","NOTICE.ko.md","NOTICE.ja.md","THIRD_PARTY_NOTICES.ko.md","THIRD_PARTY_NOTICES.ja.md"];
const legalFiles=[...authoritativeFiles,...translatedFiles];

describe("repository license and notice contract",()=>{
  it("keeps the unmodified official GNU AGPLv3 text and standalone notices",()=>{
    for(const file of legalFiles)expect(fs.statSync(path.join(repositoryRoot,file)).isFile()).toBe(true);
    expect(crypto.createHash("sha256").update(fs.readFileSync(path.join(repositoryRoot,"LICENSE"))).digest("hex")).toBe("0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0");
    expect(fs.existsSync(path.join(repositoryRoot,"ADDITIONAL_TERMS.md"))).toBe(false);
    expect(read("NOTICE.md")).toContain("https://github.com/canister2668/claudex-workhouse");
    expect(read("NOTICE.md")).toContain("Copyright Holder: Canister");
    expect(read("NOTICE.md")).not.toContain("copyright holder not yet designated");
    expect(read("THIRD_PARTY_NOTICES.md")).toContain("original works");
    expect(read("THIRD_PARTY_NOTICES.md")).toContain("created by Canister");
    expect(read("THIRD_PARTY_NOTICES.md")).not.toContain("remain a TODO");
  });
  it("declares AGPL-3.0-only consistently without noncommercial or Agent Deck lineage claims",()=>{
    expect(read("README.md")).toContain("AGPL-3.0-only");
    for(const file of["app/package.json","installer-web/package.json","vscode-extension/package.json"]){
      const manifest=JSON.parse(read(file));
      expect(manifest.license).toBe("AGPL-3.0-only");
      expect(manifest.version).toBe("1.0.2");
    }
    const userFacing=["README.md","NOTICE.md",...translatedFiles,...fs.readdirSync(path.join(repositoryRoot,"docs")).filter(name=>name.endsWith(".md")).map(name=>`docs/${name}`),...fs.readdirSync(path.join(repositoryRoot,"app","src","web")).filter(name=>/\.(?:svelte|ts)$/.test(name)).map(name=>`app/src/web/${name}`),"installer-web/src/main.ts"];
    const forbidden=/(based on agent[ _-]?deck|forked from agent[ _-]?deck|derived from agent[ _-]?deck|agent[ _-]?deck upstream|agent deck 기반|agent deck 포크|agent deck에서 파생)/i;
    for(const file of userFacing)expect(read(file),file).not.toMatch(forbidden);
    for(const file of["README.md","NOTICE.md","installer-web/src/main.ts"])expect(read(file),file).not.toMatch(/non-commercial|commercial use prohibited|CC BY-NC-SA|registered trademark|®/i);
  });

  it("ships localized guides and clearly marks license translations as unofficial",()=>{
    expect(read("docs/license.md")).toContain("license.ko.md");
    for(const locale of["en","ko","ja"]){
      const guide=read(`docs/license.${locale}.md`);
      expect(guide).toContain("AGPL-3.0-only");
      expect(guide).toContain("../LICENSE");
      expect(guide).toContain("../NOTICE.md");
    }
    for(const locale of["ko","ja"]){
      const translation=read(`LICENSE.${locale}.md`);
      expect(translation).toContain("unofficial translation");
      expect(translation).toContain("LICENSE");
    }
  });
  it("ships authoritative and translated notice files through every package",()=>{
    const docker=read("Dockerfile"),windows=read("app/scripts/package-windows-server.mjs"),worker=read("app/scripts/package-worker-release.mjs"),installer=read("installer-web/scripts/build.mjs");
    for(const file of legalFiles){
      expect(docker).toContain(file);
      expect(windows).toContain(file);
      expect(worker).toContain(file);
      expect(installer).toContain(file);
    }
    expect(docker).toContain("/opt/claudex-workhouse/licenses/");
    expect(worker).toContain('path.join(legalDirectory, "third-party"');
    expect(worker).toContain('type:"module"');
    expect(windows).toContain('path.join(legalRoot,"third-party","nodejs")');
    expect(read("installer-web/src/main.ts")).toContain("GNU AGPL-3.0-only");
    expect(read("app/scripts/create-release-manifest.mjs")).toContain('license:"AGPL-3.0-only"');
  });
  it("places SPDX identifiers on the selected core entrypoints without custom terms",()=>{
    for(const file of["app/src/server/index.ts","app/src/web/main.ts","app/src/web/AboutLicenses.svelte","launcher/windows/src/main.cpp","app/scripts/create-release-manifest.mjs","app/scripts/package-windows-server.mjs","app/scripts/package-worker-release.mjs"]){
      expect(read(file),file).toContain("SPDX-License-Identifier: AGPL-3.0-only");
      expect(read(file),file).not.toContain("ADDITIONAL_TERMS.md");
    }
  });
});
