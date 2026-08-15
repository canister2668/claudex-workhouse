import fs from"node:fs";
import path from"node:path";

const source=path.resolve("src","server","db","sqlite-worker.py");
const destination=path.resolve("dist-server","db","sqlite-worker.py");
const pythonSource=fs.readFileSync(source,"utf8");
const schema=pythonSource.match(/db\.executescript\("""([\s\S]*?)"""\)/)?.[1];
if(!schema?.trim())throw new Error("Canonical SQLite schema could not be extracted from sqlite-worker.py.");
fs.mkdirSync(path.dirname(destination),{recursive:true});
fs.copyFileSync(source,destination);
fs.chmodSync(destination,0o600);
const schemaDestination=path.resolve("dist-server","db","sqlite-schema.sql");
fs.writeFileSync(schemaDestination,`${schema.trim()}\n`,{encoding:"utf8",mode:0o600});
console.log("server runtime assets copied");
