// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Claudex Workhouse.

import type { CollaborationBoardAutomation, CollaborationBoardAutomationStage, ProviderId, WorkChain } from "./types.js";
import { CollaborationBoardService, normalizeBoardAutomation } from "./collaboration-board.js";

type BoardSession={id:string;kind:"task"|"collaboration";role:string|null;status:string;provider:ProviderId|null;createdAt:string|null;updatedAt:string|null;result:string|null;error:string|null};
type DecoratedCard=WorkChain&{sessions:BoardSession[];activeSessionCount:number};
type ActionResult={task?:{id:string};collaboration?:{session:{id:string}}};
type ActionName="start-work"|"request-review"|"start-revision";
type ActionRunner=(action:ActionName,chainId:string,context:{approvedProviders:Set<ProviderId>;fullAccessAcknowledged:boolean})=>Promise<ActionResult>;

const active=new Set(["pending","queued","starting","running","cancel-requested","unknown"]);
const failed=new Set(["failed","partial","timed-out","cancelled","stop-unconfirmed"]);
const roleForStage=(stage:CollaborationBoardAutomationStage)=>stage==="review"?"review":stage==="revision"?"revision":"implementer";
const actionForStage=(stage:CollaborationBoardAutomationStage):ActionName|null=>stage==="work"?"start-work":stage==="review"?"request-review":stage==="revision"?"start-revision":null;
const sessionId=(result:ActionResult)=>result.task?.id??result.collaboration?.session.id??null;
const excerpt=(value:string|null|undefined)=>String(value??"").trim().slice(0,2000);
export function boardAutomationOutcome(input:{stage:CollaborationBoardAutomationStage;sessionStatus:string;automationState:CollaborationBoardAutomation["state"];stopAfter:"work"|"review"|null}){
  if(active.has(input.sessionStatus))return"wait" as const;
  if(failed.has(input.sessionStatus)||input.sessionStatus==="waiting"||input.sessionStatus==="waiting-user")return"block" as const;
  if(input.automationState==="stopping"||input.stopAfter===input.stage)return"pause" as const;
  return input.stage==="review"?"approval" as const:"review" as const;
}

export class CollaborationBoardAutomationEngine{
  private running=new Set<string>();
  constructor(private service:CollaborationBoardService,private runAction:ActionRunner){}

  async start(id:string,revision:number,input:{stopAfter:"work"|"review"|null;approvedProviders:Set<ProviderId>;fullAccessAcknowledged:boolean}){
    await this.service.verifyRevision(id,revision);const card=await this.service.detail(id) as DecoratedCard;
    if(!card.workspaceId)throw Object.assign(new Error("Collaboration board automation requires an available workspace."),{statusCode:409,code:"BOARD_WORKSPACE_UNAVAILABLE"});
    if(!card.roles.implementer?.provider||!card.roles.reviewer?.provider||card.roles.implementer.provider===card.roles.reviewer.provider)throw Object.assign(new Error("Distinct implementer and reviewer providers are required for automation."),{statusCode:409,code:"BOARD_REVIEW_ROLES_REQUIRED"});
    if(card.roles.implementer.automationLevel==="full"&&!input.fullAccessAcknowledged)throw Object.assign(new Error("Full access automation requires the existing global acknowledgement."),{statusCode:409,code:"FULL_ACCESS_ACKNOWLEDGEMENT_REQUIRED"});
    if(card.activeSessionCount)throw Object.assign(new Error("Wait for the active linked session before starting automation."),{statusCode:409,code:"BOARD_AUTOMATION_SESSION_ACTIVE"});
    const timestamp=new Date().toISOString(),automation:CollaborationBoardAutomation={mode:"auto",state:"running",stage:"work",stopAfter:input.stopAfter,round:1,approvedProviders:[...input.approvedProviders],fullAccessAcknowledged:input.fullAccessAcknowledged,pauseReason:null,lastSessionId:null,startedAt:timestamp};
    const next=await this.service.setAutomation(id,revision,automation,"automation_started",{stage:"work",stopAfter:input.stopAfter});void this.tickCard(id);return next;
  }

  async pause(id:string,revision:number){await this.service.verifyRevision(id,revision);const card=await this.service.detail(id) as DecoratedCard,automation=normalizeBoardAutomation(card.automation);if(automation.mode!=="auto")return card;const stopping=card.activeSessionCount>0;return this.service.setAutomation(id,revision,{...automation,state:stopping?"stopping":"paused",pauseReason:"user"},stopping?"automation_stop_requested":"automation_paused",{stage:automation.stage});}

  async resume(id:string,revision:number){const card=await this.service.verifyRevision(id,revision) as DecoratedCard,automation=normalizeBoardAutomation(card.automation);if(automation.mode!=="auto"||!["paused","blocked"].includes(automation.state))throw Object.assign(new Error("This automation is not paused or blocked."),{statusCode:409,code:"BOARD_AUTOMATION_NOT_PAUSED"});if(automation.stage==="approval")throw Object.assign(new Error("Choose approve or revise at the approval stage."),{statusCode:409,code:"BOARD_AUTOMATION_DECISION_REQUIRED"});if(automation.state==="paused"&&automation.stage==="review"){const next=await this.service.setAutomation(id,revision,{...automation,state:"paused",stage:"approval",pauseReason:"decision-required",lastSessionId:null},"automation_approval_required",{round:automation.round});return this.service.setStatus(id,next.revision,"approval",{type:"system",id:"board-automation"});}const nextStage=automation.state==="blocked"?(automation.stage??"work"):automation.stage==="work"?"review":automation.stage??"work",next=await this.service.setAutomation(id,revision,{...automation,state:"running",stage:nextStage,pauseReason:null,lastSessionId:null,startedAt:new Date().toISOString()},"automation_resumed",{stage:nextStage});void this.tickCard(id);return next;}

  async decide(id:string,revision:number,decision:"approve"|"revise"){
    const card=await this.service.verifyRevision(id,revision) as DecoratedCard,automation=normalizeBoardAutomation(card.automation);if(automation.mode!=="auto"||automation.stage!=="approval"||automation.state!=="paused")throw Object.assign(new Error("The card is not awaiting an automation decision."),{statusCode:409,code:"BOARD_AUTOMATION_DECISION_UNAVAILABLE"});
    if(decision==="approve"){let next=await this.service.setAutomation(id,revision,{...automation,mode:"manual",state:"idle",stage:null,pauseReason:null,lastSessionId:null},"automation_approved",{round:automation.round});next=await this.service.setStatus(id,next.revision,"completed",{type:"system",id:"board-automation"});return next;}
    const next=await this.service.setAutomation(id,revision,{...automation,state:"running",stage:"revision",round:automation.round+1,pauseReason:null,lastSessionId:null,startedAt:new Date().toISOString()},"automation_revision_requested",{round:automation.round+1});void this.tickCard(id);return next;
  }

  async tick(){const cards=await this.service.listAutomationCards();await Promise.all(cards.filter(card=>card.automation.mode==="auto"&&["running","stopping"].includes(card.automation.state)).map(card=>this.tickCard(card.id)));}
  async tickCard(id:string){if(this.running.has(id))return;this.running.add(id);try{await this.process(id);}catch(error){await this.block(id,error).catch(()=>{});}finally{this.running.delete(id);}}

  private async process(id:string){
    let card=await this.service.detail(id) as DecoratedCard,automation=normalizeBoardAutomation(card.automation);if(automation.mode!=="auto"||!["running","stopping"].includes(automation.state)||!automation.stage)return;const stage=automation.stage;
    let session=automation.lastSessionId?card.sessions.find(item=>item.id===automation.lastSessionId):undefined;
    if(!session){
      const role=roleForStage(stage),startedAt=automation.startedAt??"";session=card.sessions.filter(item=>item.role===role&&String(item.createdAt??"")>=startedAt).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))[0];
      if(session){card=await this.service.setAutomation(id,card.revision,{...automation,lastSessionId:session.id},"automation_session_recovered",{stage:automation.stage,sessionId:session.id}) as DecoratedCard;automation=normalizeBoardAutomation(card.automation);}
    }
    if(!session){
      if(automation.state==="stopping"){await this.service.setAutomation(id,card.revision,{...automation,state:"paused",pauseReason:"user"},"automation_paused",{stage:automation.stage});return;}
      const action=actionForStage(stage);if(!action)return;
      const claim=await this.service.automationEvent(id,"automation_dispatch",`automation:dispatch:${automation.startedAt}:${automation.round}:${automation.stage}`,{stage:automation.stage,round:automation.round});if(!claim.inserted)throw new Error("A previously claimed automation dispatch has no linked session; manual verification is required.");
      const result=await this.runAction(action,id,{approvedProviders:new Set(automation.approvedProviders),fullAccessAcknowledged:automation.fullAccessAcknowledged}),kind=automation.stage==="review"?"review":automation.stage==="revision"?"revision":"work";
      card=await this.service.detail(id) as DecoratedCard;await this.service.recordStarted(id,card.revision,kind,result,{type:"system",id:"board-automation"});card=await this.service.detail(id) as DecoratedCard;await this.service.setAutomation(id,card.revision,{...normalizeBoardAutomation(card.automation),lastSessionId:sessionId(result)},"automation_stage_started",{stage:automation.stage,round:automation.round});return;
    }
    const outcome=boardAutomationOutcome({stage,sessionStatus:session.status,automationState:automation.state,stopAfter:automation.stopAfter});if(outcome==="wait")return;
    const reportKey=`automation:report:${session.kind}:${session.id}:${session.status}`,report={stage:automation.stage,round:automation.round,status:session.status,provider:session.provider,sessionId:session.id,summary:excerpt(session.result),error:excerpt(session.error)};await this.service.automationEvent(id,"automation_stage_report",reportKey,report,session.kind==="task"?{taskId:session.id}:{collaborationSessionId:session.id});
    card=await this.service.detail(id) as DecoratedCard;automation=normalizeBoardAutomation(card.automation);
    if(outcome==="block"){await this.service.setAutomation(id,card.revision,{...automation,state:"blocked",pauseReason:`session:${session.status}`},"automation_blocked",report);return;}
    if(outcome==="pause"){await this.service.setAutomation(id,card.revision,{...automation,state:"paused",pauseReason:automation.state==="stopping"?"user":"stop-point"},"automation_paused",{stage:automation.stage,round:automation.round});return;}
    const nextStage:CollaborationBoardAutomationStage=outcome,nextState=nextStage==="approval"?"paused":"running";const next=await this.service.setAutomation(id,card.revision,{...automation,state:nextState,stage:nextStage,pauseReason:nextStage==="approval"?"decision-required":null,lastSessionId:null,startedAt:nextStage==="approval"?automation.startedAt:new Date().toISOString()},nextStage==="approval"?"automation_approval_required":"automation_advanced",{from:automation.stage,to:nextStage,round:automation.round});if(nextStage==="approval")await this.service.setStatus(id,next.revision,"approval",{type:"system",id:"board-automation"});
  }

  private async block(id:string,cause:unknown){const card=await this.service.detail(id) as DecoratedCard,automation=normalizeBoardAutomation(card.automation);if(automation.mode!=="auto"||automation.state==="blocked")return;const message=excerpt(cause instanceof Error?cause.message:String(cause));await this.service.setAutomation(id,card.revision,{...automation,state:"blocked",pauseReason:message||"dispatch-failed"},"automation_blocked",{stage:automation.stage,round:automation.round,error:message});}
}
