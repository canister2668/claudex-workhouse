import {describe,expect,it} from "vitest";
import {approvalDecisionRequest} from "../../src/web/approval-request";

describe("browser approval request contract",()=>{
  it.each(["accept","acceptForSession","decline"] as const)("sends %s to the task-scoped server route",(decision)=>{
    const key="11111111-1111-4111-8111-111111111111";
    const request=approvalDecisionRequest({id:"codex:task/one",provider:"codex"},"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",decision,key);
    expect(request.path).toBe("/api/tasks/codex/codex%3Atask%2Fone/approvals/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(request.options).toMatchObject({method:"POST",headers:{"Idempotency-Key":key}});
    expect(JSON.parse(String(request.options.body))).toEqual({decision,confirmDetailView:true});
  });
});
