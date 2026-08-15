export type SharedTaskPayload={title?:unknown;text?:unknown;url?:unknown;files?:unknown};

const clean=(value:unknown,max=20_000)=>typeof value==="string"?value.replace(/\0/g,"").trim().slice(0,max):"";

export function sharedTaskPrompt(payload:SharedTaskPayload){
  const title=clean(payload.title,500),text=clean(payload.text),url=clean(payload.url,4096);
  return [title,text,url].filter((value,index,items)=>value&&items.indexOf(value)===index).join("\n\n").slice(0,20_000);
}
