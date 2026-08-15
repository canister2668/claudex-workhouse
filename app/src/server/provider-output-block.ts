export function providerOutputBlockId(callId:unknown,index:unknown){
  const call=typeof callId==="string"?callId.trim():"";
  if(!call)return null;
  const block=Number(index);
  return Number.isSafeInteger(block)&&block>=0?`${call}:${block}`:call;
}

export class ProviderOutputBlockTracker{
  private streamedOrdinals=new Map<string,Map<string,number>>();
  private nextStreamOrdinal=new Map<string,number>();
  private nextCompletedOrdinal=new Map<string,number>();

  streamed(callId:unknown,nativeIndex:unknown){
    const call=typeof callId==="string"?callId.trim():"";
    if(!call)return null;
    const native=String(nativeIndex??"");
    let ordinals=this.streamedOrdinals.get(call);
    if(!ordinals){ordinals=new Map();this.streamedOrdinals.set(call,ordinals);}
    let ordinal=ordinals.get(native);
    if(ordinal===undefined){ordinal=this.nextStreamOrdinal.get(call)??0;ordinals.set(native,ordinal);this.nextStreamOrdinal.set(call,ordinal+1);}
    return providerOutputBlockId(call,ordinal);
  }

  completed(callId:unknown){
    const call=typeof callId==="string"?callId.trim():"";
    if(!call)return null;
    const ordinal=this.nextCompletedOrdinal.get(call)??0;
    this.nextCompletedOrdinal.set(call,ordinal+1);
    return providerOutputBlockId(call,ordinal);
  }
}
