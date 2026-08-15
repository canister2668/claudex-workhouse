export function antigravityTextValue(value:unknown):string{
  if(typeof value==="string")return value;
  if(Array.isArray(value))return value.map(antigravityTextValue).filter(Boolean).join("\n");
  if(value&&typeof value==="object"){
    const item=value as Record<string,unknown>;
    return antigravityTextValue(item.response??item.text_delta??item.text??item.content??item.output_text??item.output??item.result??item.step_update??item.step??item.message);
  }
  return"";
}

export function antigravityConversationId(value:unknown){
  if(!value||typeof value!=="object")return"";
  const item=value as Record<string,any>;
  return String(item.conversation_id??item.conversationId??item.session_id??item.sessionId??item.conversation?.id??item.init?.conversation_id??item.result?.conversation_id??item.step_update?.conversation_id??"").trim();
}

export function antigravityFinalResponse(output:unknown):string{
  if(typeof output!=="string")return antigravityTextValue(output).trim();
  let final="",agent="";
  for(const line of output.split(/\r?\n/)){
    let value:any;try{value=JSON.parse(line);}catch{continue;}
    const event=String(value?.event??value?.type??"");
    if(event==="result"){const text=antigravityTextValue(value?.result??value);if(text)final=text;}
    else if(event==="step_update"&&String(value?.step_update?.step_type??value?.step_type??"")==="agent_response"){
      const text=antigravityTextValue(value?.step_update??value);if(text)agent=text;
    }
  }
  return(final||agent).trim();
}

export function normalizeAntigravityOutputEvents<T extends {type?:string;content?:string}>(events:T[]):T[]{
  return events.map(event=>{
    if((event.type!=="message_completed"&&event.type!=="message_delta")||typeof event.content!=="string"||!event.content.includes("\"event\""))return event;
    const content=antigravityFinalResponse(event.content);return content?{...event,content}:event;
  });
}

export function parseAntigravityModels(output:string){
  const seen=new Set<string>();
  return output.split(/\r?\n/).map(line=>line.replace(/^\s*[-*•>]\s*/,"").trim()).filter(line=>line&&!/^available models/i.test(line)&&!seen.has(line)&&(seen.add(line),true)).map(id=>({id,displayName:id,source:"runtime" as const}));
}
