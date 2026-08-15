import type { ProviderQuota } from "./quota.js";

export type QuotaReservationStatus="waiting-quota"|"claiming"|"starting"|"started"|"cancelled"|"failed";

export type QuotaTaskReservation={
  id:string;
  provider:"codex"|"claude";
  projectId:string;
  executionHostId:string;
  workspaceId:string;
  title:string|null;
  request:Record<string,unknown>;
  permissionSnapshot:Record<string,unknown>;
  status:QuotaReservationStatus;
  criterion:"next-five-hour-reset";
  idempotencyKey:string;
  createdAt:string;
  updatedAt:string;
  nextCheckAt:string;
  lastQuotaCheckAt:string|null;
  lastQuotaStatus:string|null;
  claimStartedAt:string|null;
  taskId:string|null;
  error:string|null;
  quotaCheckCount:number;
};

export type ReservationQuotaDecision={
  action:"claim"|"wait";
  reason:"available"|"five-hour-exhausted"|"other-window-exhausted"|"unknown";
  nextCheckAt:string;
};

const UNKNOWN_BACKOFF_MS=60_000;
const EXHAUSTED_BACKOFF_MS=30_000;
const MAX_BACKOFF_MS=15*60_000;

function boundedBackoff(base:number,attempt:number){
  return Math.min(MAX_BACKOFF_MS,base*2**Math.min(Math.max(0,attempt),5));
}

function validPercent(value:unknown):value is number{
  return typeof value==="number"&&Number.isFinite(value);
}

export function reservationQuotaDecision(quota:ProviderQuota|undefined,nowMs=Date.now(),attempt=0):ReservationQuotaDecision{
  const fallback=(delay:number)=>new Date(nowMs+delay).toISOString();
  if(!quota||quota.error||!quota.fiveHour||!validPercent(quota.fiveHour.pct)){
    return{action:"wait",reason:"unknown",nextCheckAt:fallback(boundedBackoff(UNKNOWN_BACKOFF_MS,attempt))};
  }
  if(quota.sevenDay&&validPercent(quota.sevenDay.pct)&&quota.sevenDay.pct>=100){
    const reset=Date.parse(quota.sevenDay.resetsAt??"");
    return{action:"wait",reason:"other-window-exhausted",nextCheckAt:new Date(Number.isFinite(reset)&&reset>nowMs?reset:nowMs+boundedBackoff(EXHAUSTED_BACKOFF_MS,attempt)).toISOString()};
  }
  if(quota.exhausted===true&&quota.fiveHour.pct<100){
    return{action:"wait",reason:"other-window-exhausted",nextCheckAt:fallback(boundedBackoff(EXHAUSTED_BACKOFF_MS,attempt))};
  }
  if(quota.fiveHour.pct>=100){
    const reset=Date.parse(quota.fiveHour.resetsAt??"");
    return{action:"wait",reason:"five-hour-exhausted",nextCheckAt:new Date(Number.isFinite(reset)&&reset>nowMs?reset:nowMs+boundedBackoff(EXHAUSTED_BACKOFF_MS,attempt)).toISOString()};
  }
  return{action:"claim",reason:"available",nextCheckAt:new Date(nowMs).toISOString()};
}

export function initialReservationCheckAt(quota:ProviderQuota|undefined,nowMs=Date.now()){
  const reset=Date.parse(quota?.fiveHour?.resetsAt??"");
  return new Date(Number.isFinite(reset)&&reset>nowMs?reset:nowMs+UNKNOWN_BACKOFF_MS).toISOString();
}

export function reservationPermissionSnapshot(request:Record<string,unknown>){
  return{
    automationLevel:request.automationLevel??null,
    permissionProfile:request.permissionProfile??null,
    workMode:request.workMode??"default",
    dangerConfirmation:request.dangerConfirmation===true,
    fullAccessAcknowledged:request.fullAccessAcknowledged===true,
    acknowledgementVersion:request.acknowledgementVersion??null
  };
}

export function permissionSnapshotMatches(reservation:Pick<QuotaTaskReservation,"request"|"permissionSnapshot">){
  return JSON.stringify(reservation.permissionSnapshot)===JSON.stringify(reservationPermissionSnapshot(reservation.request));
}

type ReservationStore={
  listDueQuotaTaskReservations(now:string,limit?:number):Promise<QuotaTaskReservation[]>;
  rescheduleQuotaTaskReservation(id:string,now:string,fields:Record<string,unknown>):Promise<QuotaTaskReservation|null>;
  claimQuotaTaskReservation(id:string,now:string,quotaStatus:string):Promise<QuotaTaskReservation|null>;
};

export async function runQuotaReservationPump(input:{
  store:ReservationStore;
  quota:Record<"codex"|"claude",ProviderQuota|undefined>;
  start:(reservation:QuotaTaskReservation)=>Promise<unknown>;
  now?:()=>number;
}){
  const now=input.now??Date.now,due=await input.store.listDueQuotaTaskReservations(new Date(now()).toISOString(),100);
  let started=0;
  for(const row of due){
    const checkedAt=now(),decision=reservationQuotaDecision(input.quota[row.provider],checkedAt,row.quotaCheckCount);
    if(decision.action==="wait"){
      await input.store.rescheduleQuotaTaskReservation(row.id,new Date(checkedAt).toISOString(),{nextCheckAt:decision.nextCheckAt,lastQuotaCheckAt:new Date(checkedAt).toISOString(),lastQuotaStatus:decision.reason});
      continue;
    }
    const claimed=await input.store.claimQuotaTaskReservation(row.id,new Date(checkedAt).toISOString(),decision.reason);
    if(!claimed)continue;
    await input.start(claimed);started++;
  }
  return{examined:due.length,started};
}
