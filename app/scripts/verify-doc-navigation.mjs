import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const markdown=["README.md",...fs.readdirSync(path.join(root,"docs"),{recursive:true}).filter(name=>name.endsWith(".md")).map(name=>path.join("docs",name))];
const links=new Map();
const failures=[];

for(const relative of markdown){
  const absolute=path.join(root,relative),source=fs.readFileSync(absolute,"utf8"),targets=[];
  for(const match of source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)){
    const raw=match[1].trim(),withoutAnchor=raw.split("#",1)[0].split("?",1)[0];
    if(!withoutAnchor||/^[a-z][a-z0-9+.-]*:/i.test(withoutAnchor))continue;
    const resolved=path.resolve(path.dirname(absolute),decodeURI(withoutAnchor));
    targets.push(path.relative(root,resolved).split(path.sep).join("/"));
    if(!fs.existsSync(resolved))failures.push(`${relative}: missing ${raw}`);
  }
  links.set(relative,targets);
}

const routes={
  en:["README.md","docs/guide.en.md","docs/introduction.en.md","docs/install/index.en.md",["docs/install/tailscale.en.md","docs/install/cloudflare.en.md"],"docs/install/connectivity-troubleshooting.en.md","docs/provider-authentication.en.md","docs/security.en.md","docs/deployment.en.md","docs/testing.en.md","docs/known-limitations.en.md","docs/license.en.md","README.md"],
  ko:["README.md","docs/guide.ko.md","docs/introduction.ko.md","docs/install/index.md",["docs/install/tailscale.md","docs/install/cloudflare.md"],"docs/install/connectivity-troubleshooting.md","docs/provider-authentication.ko.md","docs/security.ko.md","docs/deployment.ko.md","docs/testing.ko.md","docs/known-limitations.ko.md","docs/license.ko.md","README.md"],
  ja:["README.md","docs/guide.ja.md","docs/introduction.ja.md","docs/install/index.ja.md",["docs/install/tailscale.ja.md","docs/install/cloudflare.ja.md"],"docs/install/connectivity-troubleshooting.ja.md","docs/provider-authentication.ja.md","docs/security.ja.md","docs/deployment.ja.md","docs/testing.ja.md","docs/known-limitations.ja.md","docs/license.ja.md","README.md"]
};

function requireEdge(from,to,label){
  if(!links.get(from)?.includes(to))failures.push(`${label}: ${from} does not link to ${to}`);
}
for(const[language,route]of Object.entries(routes)){
  for(let index=0;index<route.length-1;index++){
    const from=route[index],to=route[index+1];
    if(Array.isArray(to))for(const branch of to)requireEdge(from,branch,language);
    else if(Array.isArray(from))for(const branch of from)requireEdge(branch,to,language);
    else requireEdge(from,to,language);
  }
}

for(const base of["guide","install/index","install/tailscale","install/cloudflare","install/connectivity-troubleshooting"]){
  const variants=base==="guide"?[`docs/${base}.en.md`,`docs/${base}.ko.md`,`docs/${base}.ja.md`]:[`docs/${base}.en.md`,`docs/${base}.md`,`docs/${base}.ja.md`];
  for(const source of variants)for(const target of variants)if(source!==target)requireEdge(source,target,"language switch");
}

if(failures.length){console.error(failures.join("\n"));process.exit(1);}
console.log(`documentation navigation verified (${markdown.length} Markdown files, 3 complete language routes)`);
