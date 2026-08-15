import{describe,expect,it}from"vitest";
import{runSqliteMaintenance}from"../../src/server/db/sqlite-maintenance.mjs";

describe("bundled Node SQLite maintenance helper",()=>{
  it("opens restore sources read-only, backs up, and quick-checks the destination",async()=>{
    const calls:Array<{file:string;options:Record<string,unknown>}>=[],closed:string[]=[],backups:string[]=[];
    class FakeDatabase{
      constructor(readonly file:string,readonly options:Record<string,unknown>={}){calls.push({file,options});}
      async backup(destination:string){backups.push(destination);}
      pragma(){return[{quick_check:"ok"}];}
      prepare(){return{get:()=>({value:1})};}
      close(){closed.push(this.file);}
    }
    await expect(runSqliteMaintenance("restore","C:\\Snapshots\\verified.sqlite","C:\\Data\\restore.tmp",FakeDatabase)).resolves.toEqual({ok:true,quickCheck:"ok",destination:"C:\\Data\\restore.tmp"});
    expect(calls).toEqual([
      {file:"C:\\Snapshots\\verified.sqlite",options:{readonly:true,fileMustExist:true,timeout:5000}},
      {file:"C:\\Data\\restore.tmp",options:{readonly:true,fileMustExist:true,timeout:5000}},
    ]);
    expect(backups).toEqual(["C:\\Data\\restore.tmp"]);
    expect(closed).toEqual(["C:\\Snapshots\\verified.sqlite","C:\\Data\\restore.tmp"]);
  });
  it("rejects a restored destination that fails quick_check",async()=>{
    class FakeDatabase{
      constructor(readonly file:string){}
      async backup(){}
      pragma(){return[{quick_check:"corrupt"}];}
      prepare(){return{get:()=>({value:1})};}
      close(){}
    }
    await expect(runSqliteMaintenance("restore","source.sqlite","destination.sqlite",FakeDatabase)).rejects.toThrow(/quick_check/);
  });
});
