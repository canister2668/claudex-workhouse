import { writable, type Readable } from "svelte/store";

export type TaskState<T extends {id:string;provider:string;status:string}> = Readable<T[]> & {
  replace(rows:T[]):void;
  replaceProvider(provider:string,rows:T[]):void;
  upsert(snapshot:T):void;
  remove(id:string):void;
  removeSession(provider:string,threadId:string):void;
  update(id:string,update:(current:T)=>T):void;
  patchStatus(provider:string,id:string,status:string,updatedAt?:string):void;
};

export function createTaskState<T extends {id:string;provider:string;status:string}>():TaskState<T>{
  const state=writable<T[]>([]);
  return {
    subscribe:state.subscribe,
    replace(rows){state.set([...rows]);},
    replaceProvider(provider,rows){state.update(current=>[...current.filter(item=>item.provider!==provider),...rows]);},
    upsert(snapshot){state.update(current=>[snapshot,...current.filter(item=>item.id!==snapshot.id)]);},
    remove(id){state.update(current=>current.filter(item=>item.id!==id));},
    removeSession(provider,threadId){state.update(current=>current.filter(item=>item.provider!==provider||(item as T&{threadId?:string|null}).threadId!==threadId));},
    update(id,update){state.update(current=>current.map(item=>item.id===id?update(item):item));},
    patchStatus(provider,id,status,updatedAt=new Date().toISOString()){state.update(current=>current.map(item=>item.provider===provider&&item.id===id?{...item,status,updatedAt}:item));}
  };
}
