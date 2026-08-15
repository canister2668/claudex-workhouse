import { describe,expect,it } from "vitest";
import { collaborationMessageKey, collaborationRunKey, duplicateDiagnostics, inlineSceneKey, processRowKey, upsertStableRows } from "../../src/web/collaboration-identity.js";

describe("collaboration render identities",()=>{
  it("prefixes types and scopes rows to the session and run",()=>{const run={id:"run-1"},person={id:"person-1"};expect(collaborationRunKey("session",run)).toBe("run:session:run-1");expect(processRowKey("session",run,person,{id:"sequence:1"})).toBe("process:session:run-1:person-1:sequence:1");expect(inlineSceneKey("session",run,person,{id:"offset:1"})).toBe("scene:session:run-1:person-1:offset:1");expect(collaborationMessageKey("session",{id:"1"})).not.toBe(collaborationRunKey("session",{id:"1"}));});

  it("reports the complete duplicate context for render isolation logs",()=>{const rows=[{id:"same",runId:"run",participantId:"person"},{id:"same",runId:"run",participantId:"person"}];expect(duplicateDiagnostics({rows,keyFor:row=>collaborationMessageKey("session",row),itemType:"message",sessionId:"session",runIdFor:row=>row.runId,participantIdFor:row=>row.participantId,itemIdFor:row=>row.id})).toEqual([{key:"message:session:same",itemType:"message",sessionId:"session",runId:"run",participantId:"person",itemId:"same",count:2}]);});

  it("upserts duplicate overlay rows with the latest payload",()=>{expect(upsertStableRows([{id:"task",status:"running"},{id:"task",status:"completed"}],row=>`task:codex:${row.id}`)).toEqual([{id:"task",status:"completed"}]);});
});
