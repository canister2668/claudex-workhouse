import fs from"node:fs";
import path from"node:path";

const python=fs.readFileSync(path.resolve("src/server/db/sqlite-worker.py"),"utf8");
const node=fs.readFileSync(path.resolve("src/server/db/sqlite-worker.mts"),"utf8");
const schema=python.match(/db\.executescript\("""([\s\S]*?)"""\)/)?.[1];
if(!schema?.trim())throw new Error("Canonical SQLite schema literal is missing.");

const pythonOperations=new Set([...python.matchAll(/if\s+op\s*==\s*["']([^"']+)/g)].map(match=>match[1]));
const nodeOperations=new Set([...node.matchAll(/if\(op===["']([^"']+)/g)].map(match=>match[1]));
const quotaBlock=node.match(/const quotaUpdates:[\s\S]*?};if\(quotaUpdates\[op\]\)/)?.[0]??"";
for(const match of quotaBlock.matchAll(/^\s{4}([a-z_]+):\[/gm))nodeOperations.add(match[1]);

const nodeOnly=new Set(["backup","quick_check"]);
const missing=[...pythonOperations].filter(operation=>!nodeOperations.has(operation));
const unexpected=[...nodeOperations].filter(operation=>!pythonOperations.has(operation)&&!nodeOnly.has(operation));
if(missing.length||unexpected.length)throw new Error(`SQLite worker operation drift: missing=[${missing.sort()}] unexpected=[${unexpected.sort()}]`);

const normalizeSql=value=>value.replace(/\s+/g," ").trim();
const pythonRebuilds=[...python.matchAll(/db\.executescript\("""([\s\S]*?)"""\)/g)].slice(1).map(match=>normalizeSql(match[1]));
const nodeRebuilds=[...node.matchAll(/rebuildLegacyTable\(`([\s\S]*?)`,["'][^"']+["']\)/g)].map(match=>normalizeSql(match[1]));
if(pythonRebuilds.length!==3||nodeRebuilds.length!==3||pythonRebuilds.some((sql,index)=>sql!==nodeRebuilds[index]))throw new Error("SQLite legacy rebuild migration drift detected.");

const ensureSpecs=(source,loopPattern,callPattern)=>{
  const specs=[];
  for(const match of source.matchAll(loopPattern)){
    for(const pair of match[1].matchAll(/\["([^"]+)","([^"]+)"\]|\("([^"]+)","([^"]+)"\)/g))specs.push(`${match[2]}.${pair[1]??pair[3]}:${(pair[2]??pair[4]).replaceAll("\\\\","\\")}`);
  }
  for(const match of source.matchAll(callPattern))specs.push(`${match[1]}.${match[2]}:${match[3].replaceAll("\\\\","\\")}`);
  return specs.sort();
};
const pythonEnsures=ensureSpecs(python,/for name,declaration in \[([\s\S]*?)\]: ensure_column\("([^"]+)"/g,/ensure_column\("([^"]+)","([^"]+)","([^"]+)"\)/g);
const nodeEnsures=ensureSpecs(node,/for\(const\[name,declaration\]of\[([\s\S]*?)\]as const\)ensureColumn\("([^"]+)"/g,/ensureColumn\("([^"]+)","([^"]+)","([^"]+)"\)/g);
if(JSON.stringify(pythonEnsures)!==JSON.stringify(nodeEnsures))throw new Error(`SQLite ensure-column drift: python=${JSON.stringify(pythonEnsures)} node=${JSON.stringify(nodeEnsures)}`);

const markerMatch=node.match(/for\(const\[version,description\]of\[([\s\S]*?)\]as const\)run\("INSERT OR IGNORE INTO schema_migrations/);
if(!markerMatch)throw new Error("Node SQLite migration marker list could not be parsed.");
const markerBlock=markerMatch[1];
const markerVersions=[...markerBlock.matchAll(/\[(\d+),/g)].map(match=>Number(match[1]));
if(markerVersions.includes(10)||!node.includes("VALUES(10,datetime('now'),'Claudex Workhouse canonical identity and root migration')"))throw new Error("SQLite identity migration marker invariant changed.");
if(python.split(/\r?\n/).some(line=>line.includes("INSERT OR IGNORE INTO schema_migrations")&&line.includes("VALUES(10")))throw new Error("Python identity migration marker invariant changed.");

console.log(`sqlite worker contract verified (${pythonOperations.size} shared operations, ${nodeOnly.size} Node maintenance operations)`);
