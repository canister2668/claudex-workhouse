import Database from"better-sqlite3";
import{fileURLToPath}from"node:url";
import path from"node:path";

type DatabaseLike={
  close():void;
  backup(destination:string):Promise<unknown>;
  prepare(sql:string):{get():unknown};
  pragma(sql:string):Array<Record<string,unknown>>;
};
type DatabaseFactory=new(file:string,options?:Record<string,unknown>)=>DatabaseLike;

export async function runSqliteMaintenance(operation:string,source:string,destination:string|undefined,DatabaseConstructor:DatabaseFactory=Database as unknown as DatabaseFactory){
  if(!operation||!source)throw new Error("SQLite maintenance operation and source are required.");
  if(operation==="quick-check"){
    const db=new DatabaseConstructor(source,{readonly:true,fileMustExist:true,timeout:5000});
    try{
      const ping=Number((db.prepare("SELECT 1 AS value").get()as any).value)===1;
      const rows=db.pragma("quick_check").slice(0,20).map(row=>String(Object.values(row)[0]));
      const quickCheck=rows.length===1&&rows[0]!.toLowerCase()==="ok";
      return{ping,quickCheck,detail:quickCheck?null:rows.join("; ").slice(0,800)};
    }finally{db.close();}
  }
  if(operation==="backup"||operation==="restore"){
    if(!destination)throw new Error(`SQLite ${operation} destination is required.`);
    const db=new DatabaseConstructor(source,{readonly:operation==="restore",fileMustExist:true,timeout:5000});
    try{await db.backup(destination);}
    finally{db.close();}
    const copy=new DatabaseConstructor(destination,{readonly:true,fileMustExist:true,timeout:5000});
    try{
      const rows=copy.pragma("quick_check");
      if(rows.length!==1||String(Object.values(rows[0]!)[0]).toLowerCase()!=="ok")throw new Error(`${operation} quick_check failed`);
      return{ok:true,quickCheck:"ok",destination};
    }finally{copy.close();}
  }
  throw new Error(`Unsupported SQLite maintenance operation: ${operation}`);
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  const[operation,source,destination]=process.argv.slice(2);
  const result=await runSqliteMaintenance(operation??"",source??"",destination);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
