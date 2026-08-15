export type GrokModel={id:string;displayName:string;source:"runtime"};

export function parseGrokModels(output:string):GrokModel[]{
  const seen=new Set<string>(),models:GrokModel[]=[];
  for(const raw of output.split(/\r?\n/)){
    const line=raw.replace(/^\s*[-*>•]\s*/,"").trim();
    if(!line||/^available models/i.test(line))continue;
    let id=line;
    try{const value=JSON.parse(line);id=String(value?.id??value?.model??value?.name??"").trim();}catch{id=line.replace(/^default model:\s*/i,"").replace(/\s+\(default\)\s*$/i,"").split(/\s{2,}|\t/)[0]?.trim()??"";}
    if(!id||id.length>120||seen.has(id))continue;
    seen.add(id);models.push({id,displayName:id,source:"runtime"});
  }
  return models;
}
