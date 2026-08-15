export type SessionSearchSource="result"|"error"|"log"|"prompt"|"title"|"project";

export type SessionSearchMatch={
  source:SessionSearchSource;
  before:string;
  match:string;
  after:string;
  leading:boolean;
  trailing:boolean;
};

type SearchableSession={
  title?:string|null;
  prompt?:string|null;
  result?:string|null;
  error?:string|null;
  log?:string|null;
  preview?:string|null;
  previewSource?:Exclude<SessionSearchSource,"title"|"project">;
};

const CONTEXT_BEFORE=72;
const CONTEXT_AFTER=150;

function compact(value:string){
  return value.replace(/\s+/g," ").trim();
}

function matchIn(source:SessionSearchSource,value:string,query:string):SessionSearchMatch|null{
  const index=value.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if(index<0)return null;
  const start=Math.max(0,index-CONTEXT_BEFORE),end=Math.min(value.length,index+query.length+CONTEXT_AFTER);
  return{
    source,
    before:compact(value.slice(start,index)),
    match:value.slice(index,index+query.length),
    after:compact(value.slice(index+query.length,end)),
    leading:start>0,
    trailing:end<value.length,
  };
}

export function sessionSearchMatch(task:SearchableSession,rawQuery:string,projectName=""):SessionSearchMatch|null{
  const query=rawQuery.trim();
  if(!query)return null;
  const sources:Array<[SessionSearchSource,string]>=[
    ["result",task.result??""],
    ["error",task.error??""],
    ["log",task.log??""],
    ["prompt",task.prompt??""],
    [task.previewSource??"result",task.preview??""],
    ["title",task.title??""],
    ["project",projectName],
  ];
  for(const [source,value] of sources){
    const found=value?matchIn(source,value,query):null;
    if(found)return found;
  }
  return null;
}
