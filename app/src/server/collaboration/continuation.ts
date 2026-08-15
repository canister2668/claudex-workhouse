export type CollaborationContinuation={
  available:boolean;
  canRetryFailedTurn:boolean;
  canResume:boolean;
  canAcceptPartial:boolean;
  canAddRounds:boolean;
  canAutoContinue:boolean;
  canSubmitUserInput:boolean;
  failedRunId:string|null;
  reason:string|null;
};

const retryableRun=(run:any)=>["failed","timed-out"].includes(String(run?.status))
  ||(run?.status==="cancelled"&&["stopped","provider-stopped"].includes(String(run?.errorCategory)));

/** Shared server/UI command policy. Status remains the execution lifecycle and
 * outcome remains the reason; this function derives only user capabilities. */
export function getContinuationCapabilities(session:any,runs:any[]=[]):CollaborationContinuation{
  const status=String(session?.status??""),outcome=String(session?.outcome??""),flow=String(session?.metadata?.conversationFlow??""),cancelled=status==="cancelled"||outcome==="cancelled"||Boolean(session?.cancelledAt);
  const terminalChoice=["completed","partial"].includes(status),artifactReview=session?.mode==="debate"&&session?.metadata?.conversationKind==="artifact-review";
  const automaticLimit=flow==="automatic"&&session?.metadata?.automaticContinuation===true&&terminalChoice&&["turn-limit","turn-limit-partial"].includes(outcome);
  const guidedLimit=flow==="guided"&&terminalChoice&&["round-limit","round-limit-partial"].includes(outcome);
  const waiting=status==="waiting-user"&&session?.metadata?.waitingForUser===true;
  const externalResume=status==="waiting-user"&&session?.metadata?.waitingForUser!==true;
  const conversationFailure=["guided","automatic"].includes(flow)&&!cancelled&&["partial","failed"].includes(status);
  const ordered=[...runs].sort((left,right)=>Number(left?.sequence)-Number(right?.sequence)||String(left?.createdAt??"").localeCompare(String(right?.createdAt??"")));
  const failed=[...ordered].reverse().find(retryableRun)??null;
  const hasLaterCompleted=failed?ordered.some(run=>Number(run?.sequence)>Number(failed.sequence)&&run?.status==="completed"):false;
  const canRetryFailedTurn=conversationFailure&&Boolean(failed)&&(flow==="guided"||!hasLaterCompleted);
  const completedReviewLimit=artifactReview&&terminalChoice&&["turn-limit","turn-limit-partial"].includes(outcome);
  const canAddRounds=(automaticLimit||guidedLimit||completedReviewLimit)&&session?.maxTurnsPerParticipant!==null&&(Number(session?.maxTurnsPerParticipant)||100)<100;
  const canAutoContinue=flow==="guided"&&waiting&&(Number(session?.metadata?.currentRound)||0)<100;
  const timeoutRecovery=flow==="automatic"&&conversationFailure&&(outcome==="turn-timeout"||failed?.status==="timed-out");
  /** Agreement closes the debate on its own terms, so the user gets the input box to steer it further but no round-extension button. */
  const agreementConcluded=terminalChoice&&!cancelled&&outcome==="both-concluded";
  const canSubmitUserInput=automaticLimit||waiting||timeoutRecovery||agreementConcluded||artifactReview&&terminalChoice&&!cancelled;
  const canAcceptPartial=status==="partial";
  const reason=canRetryFailedTurn?String(failed?.errorCategory||outcome||"provider-failed")
    :automaticLimit?"turn-limit"
    :guidedLimit?"round-limit"
    :artifactReview&&terminalChoice?"review-complete"
    :waiting&&outcome==="conversation-yielded"?"yield"
    :externalResume?outcome||"external-state-uncertain"
    :canAcceptPartial?outcome||"partial"
    :null;
  return{
    available:canAddRounds||canAutoContinue||canSubmitUserInput||canRetryFailedTurn||externalResume||canAcceptPartial,
    canRetryFailedTurn,
    canResume:externalResume,
    canAcceptPartial,
    canAddRounds,
    canAutoContinue,
    canSubmitUserInput,
    failedRunId:canRetryFailedTurn?failed?.id??null:null,
    reason,
  };
}

export const deriveCollaborationContinuation=getContinuationCapabilities;
