import path from"node:path";

export type SqliteMaintenanceInvocation={command:string;args:string[];kind:"python"|"node"};
export function sqliteMaintenanceInvocation(input:{operation:"backup"|"restore"|"quick-check";source:string;destination?:string;platform?:NodeJS.Platform;appRoot?:string;nodeBinary?:string;pythonBinary?:string}):SqliteMaintenanceInvocation{
  const platform=input.platform??process.platform;
  if(platform==="win32"){
    if(!input.appRoot)throw new Error("Windows SQLite maintenance requires appRoot.");
    const helper=path.win32.join(input.appRoot,"app","dist-server","db","sqlite-maintenance.mjs");
    return{command:input.nodeBinary??process.execPath,args:[helper,input.operation,input.source,...(input.destination?[input.destination]:[])],kind:"node"};
  }
  if(input.operation==="quick-check")throw new Error("Linux quick-check uses the bounded Python read-only probe.");
  const sourceConnection=input.operation==="restore"
    ?`src=sqlite3.connect(Path(source).resolve().as_uri()+"?mode=ro",uri=True,timeout=30)`
    :`src=sqlite3.connect(source,timeout=30)`;
  const script=`import sqlite3,sys
from pathlib import Path
source,destination=sys.argv[1],sys.argv[2]
${sourceConnection}
dst=sqlite3.connect(destination)
try:
 src.backup(dst)
 row=dst.execute("PRAGMA quick_check").fetchone()
 if not row or row[0] != "ok": raise RuntimeError("backup quick_check failed")
finally:
 dst.close(); src.close()
`;
  return{command:input.pythonBinary??process.env.PYTHON_BIN??"python3",args:["-c",script,input.source,input.destination!],kind:"python"};
}
