export type LoaderFailure={region:string;message:string};

export function summarizeLoaderFailures(failures:LoaderFailure[]){
  const messages=[...new Set(failures.map(item=>item.message).filter(Boolean))];
  if(messages.length<=1)return messages[0]??"";
  return failures.map(item=>`${item.region}: ${item.message}`).join("\n");
}

export async function applyIndependentRegion<T>(region:string,promise:Promise<T>,apply:(value:T)=>void,failures:LoaderFailure[]){
  try{apply(await promise);}
  catch(reason){
    const message=reason instanceof Error?reason.message:String(reason);
    failures.push({region,message});
    throw reason;
  }
}
