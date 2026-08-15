import { describe, expect, it } from "vitest";
import { initialReservationCheckAt, permissionSnapshotMatches, reservationPermissionSnapshot, reservationQuotaDecision } from "../../src/server/quota-task-reservations.js";

const now=Date.parse("2026-07-29T09:00:00.000Z");
const window=(pct:number,resetsAt:string|null,durationMins:number)=>({pct,resetsAt,durationMins});

describe("quota task reservation decisions",()=>{
  it("does not start before an observed five-hour recovery",()=>{
    expect(reservationQuotaDecision({fiveHour:window(100,"2026-07-29T10:00:00.000Z",300),sevenDay:window(20,null,10080),status:"ok"},now)).toEqual({
      action:"wait",reason:"five-hour-exhausted",nextCheckAt:"2026-07-29T10:00:00.000Z"
    });
  });

  it("keeps waiting when the estimate passed but the latest reading is still exhausted",()=>{
    const decision=reservationQuotaDecision({fiveHour:window(100,"2026-07-29T08:00:00.000Z",300),sevenDay:window(20,null,10080),status:"ok"},now);
    expect(decision.action).toBe("wait");
    expect(decision.reason).toBe("five-hour-exhausted");
    expect(Date.parse(decision.nextCheckAt)).toBeGreaterThan(now);
  });

  it("uses bounded backoff for unknown quota instead of starting",()=>{
    const decision=reservationQuotaDecision({fiveHour:null,sevenDay:null,status:"partial",error:"unavailable"},now);
    expect(decision).toEqual({action:"wait",reason:"unknown",nextCheckAt:"2026-07-29T09:01:00.000Z"});
  });

  it("backs repeated unknown readings off exponentially with a fifteen-minute cap",()=>{
    const quota={fiveHour:null,sevenDay:null,status:"partial" as const,error:"unavailable"};
    expect(reservationQuotaDecision(quota,now,2).nextCheckAt).toBe("2026-07-29T09:04:00.000Z");
    expect(reservationQuotaDecision(quota,now,99).nextCheckAt).toBe("2026-07-29T09:15:00.000Z");
  });

  it("starts only after five-hour recovery with no other exhausted observed window",()=>{
    expect(reservationQuotaDecision({fiveHour:window(3,null,300),sevenDay:window(45,null,10080),status:"ok"},now).action).toBe("claim");
    expect(reservationQuotaDecision({fiveHour:window(3,null,300),sevenDay:window(100,"2026-08-01T00:00:00.000Z",10080),status:"ok"},now)).toMatchObject({action:"wait",reason:"other-window-exhausted"});
    expect(reservationQuotaDecision({fiveHour:window(3,null,300),sevenDay:null,status:"partial",exhausted:true},now)).toMatchObject({action:"wait",reason:"other-window-exhausted"});
  });

  it("uses the provider five-hour reset as the initial expected check",()=>{
    expect(initialReservationCheckAt({fiveHour:window(100,"2026-07-29T10:00:00.000Z",300),sevenDay:null,status:"partial"},now)).toBe("2026-07-29T10:00:00.000Z");
  });

  it("detects any permission escalation or mutation after reservation",()=>{
    const request={automationLevel:"read",permissionProfile:":read-only",workMode:"plan",dangerConfirmation:false};
    const reservation={request,permissionSnapshot:reservationPermissionSnapshot(request)};
    expect(permissionSnapshotMatches(reservation as any)).toBe(true);
    expect(permissionSnapshotMatches({...reservation,request:{...request,automationLevel:"full"}} as any)).toBe(false);
  });
});
