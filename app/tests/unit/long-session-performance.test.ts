import { describe, expect, it } from "vitest";
import { estimateOutputTokens, finalAssistantOutputResolver } from "../../src/web/conversation.js";
import { mergeLiveEvents } from "../../src/web/live-events.js";

// The per-event definition the resolver replaced: rescans the list for each
// event. Kept here as the reference the linear pass must agree with.
function referenceIsFinal(event:any,rootThreadId:string|null,events:any[],taskSettled:boolean){
  const root=(row:any)=>!rootThreadId||!row.threadId||row.threadId===rootThreadId;
  const assistant=(row:any)=>row.type==="message_completed"||(row.type==="message"&&row.metadata?.role==="agent");
  if(event.type!=="message_completed"||!assistant(event)||!root(event))return false;
  const phase=String(event.metadata?.phase??"");
  if(phase==="final_answer"||event.metadata?.section==="result")return true;
  const nativeType=String(event.metadata?.nativeType??"");
  if(phase||nativeType&&nativeType!=="assistant")return false;
  const identity=(row:any)=>Number.isSafeInteger(Number(row.sequence))?`s${row.sequence}`:`c${row.type}:${row.content}`;
  const index=events.findIndex(candidate=>candidate===event||identity(candidate)===identity(event));if(index<0)return false;
  const nextTerminal=events.findIndex((candidate,candidateIndex)=>candidateIndex>index&&candidate.type==="task_completed");
  const end=nextTerminal>=0?nextTerminal:taskSettled?events.length:-1;
  if(end<0)return false;
  return !events.slice(index+1,end).some(candidate=>candidate.type==="message_completed"&&assistant(candidate)&&root(candidate)&&!candidate.metadata?.phase&&(!candidate.metadata?.nativeType||candidate.metadata.nativeType==="assistant"));
}

describe("long session rendering cost",()=>{
  it("resolves final assistant output exactly like the per-event rescan",()=>{
    let seed=7;const random=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;
    for(let round=0;round<60;round++){
      const events:any[]=[];
      for(let index=0;index<40;index++){
        const roll=random();
        if(roll<.15)events.push({type:"task_completed",content:"done",sequence:index});
        else if(roll<.3)events.push({type:"tool_started",content:`tool ${index}`,sequence:index,metadata:{}});
        else{
          const metadata:any={role:"agent"};
          const variant=random();
          if(variant<.1)metadata.phase="commentary";else if(variant<.15)metadata.phase="final_answer";else if(variant<.2)metadata.nativeType="system";
          events.push({type:"message_completed",content:`answer ${index}`,sequence:index,threadId:random()<.15?"child":"root",metadata});
        }
      }
      for(const settled of [false,true]){
        const resolve=finalAssistantOutputResolver(events,"root",settled);
        for(const event of events)expect(resolve(event)).toBe(referenceIsFinal(event,"root",events,settled));
        // Display rows are copies of the stored events; identity still resolves them.
        for(const event of events)expect(resolve({...event})).toBe(referenceIsFinal({...event},"root",events,settled));
      }
    }
  });

  it("keeps replacing the newest anonymous lifecycle row across one burst",()=>{
    const anonymous=(content:string)=>({type:"tool_started",content,metadata:{}} as any);
    const current=[anonymous("hook"),anonymous("other"),anonymous("hook")];
    const merged=mergeLiveEvents(current,[
      {type:"tool_started",content:"hook",eventId:"a",metadata:{}} as any,
      {type:"tool_started",content:"hook",eventId:"b",metadata:{}} as any,
      {type:"tool_started",content:"hook",eventId:"c",metadata:{}} as any
    ]);
    expect(merged.map(event=>event.eventId??"-")).toEqual(["b","-","a","c"]);
  });

  it("appends a streamed burst into one delta row and trims once to the limit",()=>{
    const current=Array.from({length:10},(_,index)=>({type:"tool_started",content:`tool ${index}`,eventId:`t${index}`,metadata:{}} as any));
    const deltas=Array.from({length:5},(_,index)=>({type:"message_delta",content:`${index}`,itemId:"m",eventId:`d${index}`,metadata:{}} as any));
    const merged=mergeLiveEvents(current,deltas,8);
    expect(merged.length).toBe(8);
    expect(merged.at(-1)).toMatchObject({type:"message_delta",content:"01234",eventId:"d4"});
  });

  it("counts astral characters once when estimating output tokens",()=>{
    expect(estimateOutputTokens("😀😀😀😀😀")).toBe(estimateOutputTokens("가나다라마"));
    expect(estimateOutputTokens("  \n")).toBe(0);
  });
});
