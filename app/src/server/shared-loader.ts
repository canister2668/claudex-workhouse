export function createSharedLoader<T>(load:(force:boolean)=>Promise<T>){
  let pending:Promise<T>|null=null;
  return(force=false)=>{
    if(force)return load(true);
    if(pending)return pending;
    pending=load(false);
    void pending.finally(()=>{pending=null;}).catch(()=>{});
    return pending;
  };
}
