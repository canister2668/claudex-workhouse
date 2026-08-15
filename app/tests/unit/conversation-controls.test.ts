import { describe, expect, it } from "vitest";
import { automaticContinuationAvailable, collaborationContinuation, collaborationDetailRefreshDelay, conversationInputAvailable, focusConversationInput, waitingConversationInputAvailable } from "../../src/web/conversation-controls.js";

describe("conversation controls",()=>{
  it("shows guided user input as soon as the session enters waiting-user",()=>{
    const session={status:"waiting-user",outcome:"awaiting-user",metadata:{conversationFlow:"guided",waitingForUser:true}};
    const continuation=collaborationContinuation(session);
    expect(waitingConversationInputAvailable(session,continuation)).toBe(true);
    expect(conversationInputAvailable(session,continuation)).toBe(true);
  });

  it("uses the live continuation capability while guided session metadata catches up",()=>{
    const session={status:"waiting-user",outcome:"awaiting-user",metadata:{conversationFlow:"guided",waitingForUser:false}};
    const continuation={available:true,canRetryFailedTurn:false,canResume:false,canAcceptPartial:false,canAddRounds:false,canSubmitUserInput:true,failedRunId:null,reason:"awaiting-user"};
    expect(waitingConversationInputAvailable(session,continuation)).toBe(true);
    expect(conversationInputAvailable(session,continuation)).toBe(true);
  });

  it("keeps legacy user-participation sessions on the direct textarea path",()=>{
    const session={mode:"debate",status:"waiting-user",outcome:"awaiting-user",metadata:{conversationKind:"casual",waitingForUser:true}};
    const continuation=collaborationContinuation(session);
    expect(waitingConversationInputAvailable(session,continuation)).toBe(true);
    expect(conversationInputAvailable(session,continuation)).toBe(true);
  });

  it("shows automatic user input directly without a separate intervention action",()=>{
    const session={status:"completed",outcome:"turn-limit",metadata:{conversationFlow:"automatic",automaticContinuation:true,waitingForUser:false}};
    const continuation=collaborationContinuation({...session,maxTurnsPerParticipant:5});
    expect(automaticContinuationAvailable(session)).toBe(true);
    expect(conversationInputAvailable(session,continuation)).toBe(true);
  });

  it("does not open continuation input outside the turn-limit choice",()=>{
    const session={status:"completed",outcome:"all-succeeded",metadata:{conversationFlow:"automatic",automaticContinuation:true,waitingForUser:true}};
    const continuation=collaborationContinuation(session);
    expect(conversationInputAvailable(session,continuation)).toBe(false);
  });

  it("reloads detail only for persisted terminal data rather than every status event",()=>{
    expect(collaborationDetailRefreshDelay("collaboration/status")).toBeNull();
    expect(collaborationDetailRefreshDelay("run/completed")).toBe(50);
    expect(collaborationDetailRefreshDelay("collaboration/completed")).toBe(0);
    expect(collaborationDetailRefreshDelay("participant/status")).toBe(50);
    expect(collaborationDetailRefreshDelay("avatar/state")).toBeNull();
  });

  it("allows only valid continuation actions at the hard limit, timeout, and partial states",()=>{
    expect(collaborationContinuation({status:"completed",outcome:"turn-limit",maxTurnsPerParticipant:100,metadata:{conversationFlow:"automatic",automaticContinuation:true}})).toMatchObject({available:true,canResume:false,canAcceptPartial:false,canAddRounds:false,canSubmitUserInput:true,canRetryFailedTurn:false});
    expect(collaborationContinuation({status:"partial",outcome:"turn-timeout",maxTurnsPerParticipant:5,metadata:{conversationFlow:"automatic"}},[{id:"failed",sequence:2,status:"timed-out",errorCategory:"timeout"}])).toMatchObject({available:true,canAcceptPartial:true,canAddRounds:false,canSubmitUserInput:true,canRetryFailedTurn:true,failedRunId:"failed",reason:"timeout"});
    expect(collaborationContinuation({status:"partial",outcome:"provider-failed",maxTurnsPerParticipant:5,metadata:{conversationFlow:"automatic"}},[{id:"failed",sequence:2,status:"failed",errorCategory:"HOST_OFFLINE"}])).toMatchObject({available:true,canAddRounds:false,canSubmitUserInput:false,canRetryFailedTurn:true,failedRunId:"failed",reason:"HOST_OFFLINE"});
    expect(collaborationContinuation({mode:"debate",status:"completed",outcome:"turn-limit",maxTurnsPerParticipant:1,metadata:{conversationFlow:"automatic",conversationKind:"artifact-review"}})).toMatchObject({available:true,canAddRounds:true,canSubmitUserInput:true,reason:"review-complete"});
  });

  it("uses run lifecycle for every automatic provider failure category",()=>{
    for(const errorCategory of ["provider-failed","host-offline","HOST_OFFLINE","WORKER_TIMEOUT","worker-timeout","WORKSPACE_LEASE_EXPIRED","database-busy"]){
      expect(collaborationContinuation({status:"partial",outcome:errorCategory,metadata:{conversationFlow:"automatic"}},[{id:errorCategory,sequence:3,status:"failed",errorCategory}])).toMatchObject({canRetryFailedTurn:true,failedRunId:errorCategory,reason:errorCategory});
    }
    expect(collaborationContinuation({status:"partial",outcome:"provider-stopped",metadata:{conversationFlow:"automatic"}},[{id:"stopped",sequence:3,status:"cancelled",errorCategory:"stopped"}])).toMatchObject({canRetryFailedTurn:true,failedRunId:"stopped"});
    expect(collaborationContinuation({status:"cancelled",outcome:"cancelled",cancelledAt:"2026-01-01T00:00:00Z",metadata:{conversationFlow:"automatic"}},[{id:"stopped",sequence:3,status:"cancelled",errorCategory:"stopped"}])).toMatchObject({canRetryFailedTurn:false,failedRunId:null});
  });

  it("blocks an out-of-order automatic retry but allows a guided failed turn to be requested again",()=>{
    const runs=[{id:"failed",sequence:2,status:"failed",errorCategory:"provider-failed"},{id:"done",sequence:3,status:"completed"}];
    expect(collaborationContinuation({status:"partial",outcome:"provider-failed",metadata:{conversationFlow:"automatic"}},runs).canRetryFailedTurn).toBe(false);
    expect(collaborationContinuation({status:"partial",outcome:"provider-failed",metadata:{conversationFlow:"guided"}},runs)).toMatchObject({canRetryFailedTurn:true,failedRunId:"failed",canAcceptPartial:true});
    expect(collaborationContinuation({status:"partial",outcome:"provider-failed",metadata:{conversationFlow:"guided"}},[{id:"missing-output",sequence:3,status:"failed",errorCategory:"PROVIDER_OUTPUT_UNAVAILABLE"}])).toMatchObject({canRetryFailedTurn:true,failedRunId:"missing-output",reason:"PROVIDER_OUTPUT_UNAVAILABLE"});
  });

  it("derives resume, add-rounds, and input capabilities without changing outcome",()=>{
    expect(collaborationContinuation({status:"waiting-user",outcome:"provider-start-unconfirmed",metadata:{conversationFlow:"automatic",waitingForUser:false}})).toMatchObject({canResume:true,canSubmitUserInput:false,reason:"provider-start-unconfirmed"});
    expect(collaborationContinuation({status:"partial",outcome:"round-limit-partial",maxTurnsPerParticipant:1,metadata:{conversationFlow:"guided",waitingForUser:false}})).toMatchObject({canAddRounds:true,canSubmitUserInput:false,canAcceptPartial:true});
    expect(collaborationContinuation({status:"waiting-user",outcome:"awaiting-user",maxTurnsPerParticipant:6,metadata:{conversationFlow:"guided",waitingForUser:true}})).toMatchObject({canAddRounds:false,canSubmitUserInput:true,canResume:false});
  });

  it("opens only the input box when a debate ends by agreement",()=>{
    const review={mode:"debate",status:"completed",outcome:"both-concluded",maxTurnsPerParticipant:1,metadata:{conversationFlow:"automatic",conversationKind:"artifact-review"}};
    const casual={mode:"debate",status:"completed",outcome:"both-concluded",maxTurnsPerParticipant:1,metadata:{conversationFlow:"automatic",conversationKind:"casual"}};
    for(const session of [review,casual]){
      const continuation=collaborationContinuation(session);
      expect(continuation).toMatchObject({available:true,canSubmitUserInput:true,canAddRounds:false,canAutoContinue:false});
      expect(conversationInputAvailable(session,continuation)).toBe(true);
    }
    expect(collaborationContinuation({...casual,status:"cancelled",cancelledAt:"2026-01-01T00:00:00Z"}).canSubmitUserInput).toBe(false);
  });

  it("focuses the textarea immediately after the continuation form is rendered",()=>{let focused=false;const form={querySelector:(selector:string)=>selector==="textarea"?{focus:()=>{focused=true;}}:null};expect(focusConversationInput(form)).toBe(true);expect(focused).toBe(true);expect(focusConversationInput(null)).toBe(false);});

});
