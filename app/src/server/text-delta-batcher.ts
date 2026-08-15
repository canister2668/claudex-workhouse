export function createTextDeltaBatcher<T>(emit:(content:string,metadata:T|undefined)=>void,options:{intervalMs?:number;maxChars?:number}={}){
  const intervalMs=options.intervalMs??80,maxChars=options.maxChars??192;
  let buffer="",metadata:T|undefined,timer:ReturnType<typeof setTimeout>|null=null;
  const flush=()=>{if(timer)clearTimeout(timer);timer=null;if(!buffer)return;const content=buffer,currentMetadata=metadata;buffer="";metadata=undefined;emit(content,currentMetadata);};
  const push=(content:string,nextMetadata?:T)=>{if(!content)return;buffer+=content;metadata=nextMetadata??metadata;if(buffer.length>=maxChars){flush();return;}if(!timer){timer=setTimeout(flush,intervalMs);timer.unref?.();}};
  return{push,flush};
}
