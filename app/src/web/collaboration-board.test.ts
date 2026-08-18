import {describe,expect,it} from "vitest";
import {awaitingBoardApproval,BOARD_BRANCH_MAX,BOARD_DESCRIPTION_MAX,BOARD_TITLE_MAX,boardAutomationReasonKey,boardCollaborationWaitingKey,boardDecisionSessions,boardDefaultRole,boardDefaultRoles,boardWaitingCollaborationSessions,cardNeedsAttention,normalizeBoardCard,normalizeBoardRole,type CollaborationBoardExecutionConfig} from "./collaboration-board";

const config:CollaborationBoardExecutionConfig={defaultProvider:"grok",fullAccessAcknowledged:false,providers:[
  {provider:"codex",models:[{id:"gpt-a",displayName:"GPT A",supportedReasoningEfforts:[{reasoningEffort:"low"},{reasoningEffort:"high"}],defaultReasoningEffort:"high",serviceTiers:[{id:"priority"}]}],efforts:[],defaultModel:"gpt-a",defaultReasoningEffort:"high",defaultServiceTier:"priority",defaultWorkMode:"default",defaultAutomationLevel:"confirm",defaultPermissionProfile:":workspace"},
  {provider:"grok",models:[{id:"grok-a",displayName:"Grok A"}],efforts:[{id:"default"},{id:"high"}],defaultModel:"grok-a",defaultReasoningEffort:"high",defaultServiceTier:null,defaultWorkMode:"default",defaultAutomationLevel:"auto",defaultPermissionProfile:":workspace-write"},
  {provider:"claude",models:[{id:"claude-a",displayName:"Claude A"}],efforts:[{id:"medium"}],defaultModel:"claude-a",defaultReasoningEffort:"medium",defaultServiceTier:null,defaultWorkMode:"plan",defaultAutomationLevel:"read",defaultPermissionProfile:":read-only"}
]};

describe("collaboration board execution defaults",()=>{
  it("snapshots the selected global provider and its complete defaults",()=>{expect(boardDefaultRoles(config)).toEqual({implementer:boardDefaultRole(config,"grok")});expect(boardDefaultRole(config,"codex")).toMatchObject({model:"gpt-a",reasoningEffort:"high",serviceTier:"priority",workMode:"default",automationLevel:"confirm",permissionProfile:":workspace"});});
  it("repairs legacy permission strings and disabled models from global configuration",()=>{expect(normalizeBoardRole(config,{provider:"codex",model:"removed",permissionProfile:"workspace-write"})).toMatchObject({model:"gpt-a",permissionProfile:":workspace",automationLevel:"confirm"});});
});

describe("board attention and reason labels",()=>{
  it("treats blocked automation and approval as attention even without failed sessions",()=>{
    const card=normalizeBoardCard({id:"card",title:"Card",boardStatus:"completed",automation:{mode:"auto",state:"blocked",stage:"work",pauseReason:"session:waiting-user"},sessions:[]});
    expect(cardNeedsAttention(card)).toBe(true);
    expect(boardAutomationReasonKey(card.automation.pauseReason)).toBe("waitingUser");
  });
  it("maps the default-effort zod payload to an execution-settings reason",()=>{
    expect(boardAutomationReasonKey('[\n  {\n    "code": "custom",\n    "message": "Unknown compatible-runtime reasoning effort."\n  }\n]')).toBe("executionSettings");
  });
  it("shows approval actions only when the server can accept a decision",()=>{
    const decidable=normalizeBoardCard({id:"card",title:"Card",boardStatus:"approval",automation:{mode:"auto",state:"paused",stage:"approval"}});
    const revising=normalizeBoardCard({id:"card",title:"Card",boardStatus:"approval",automation:{mode:"auto",state:"running",stage:"revision"}});
    const statusOnly=normalizeBoardCard({id:"card",title:"Card",boardStatus:"approval",automation:{mode:"manual",state:"idle",stage:null}});
    expect(awaitingBoardApproval(decidable)).toBe(true);
    expect(awaitingBoardApproval(revising)).toBe(false);
    expect(awaitingBoardApproval(statusOnly)).toBe(false);
  });
  it("keeps editor field limits aligned with the server schema",()=>{
    expect({title:BOARD_TITLE_MAX,description:BOARD_DESCRIPTION_MAX,branch:BOARD_BRANCH_MAX}).toEqual({title:100,description:10_000,branch:200});
  });
  it("surfaces waiting collaboration sessions separately from task decision panels",()=>{
    const card=normalizeBoardCard({id:"card",title:"Card",sessions:[
      {id:"task-1",kind:"task",provider:"codex",status:"waiting-user"},
      {id:"collab-1",kind:"collaboration",status:"waiting-approval"},
      {id:"collab-2",kind:"collaboration",status:"completed"}
    ]});
    expect(boardDecisionSessions(card).map(item=>item.id)).toEqual(["task-1"]);
    expect(boardWaitingCollaborationSessions(card).map(item=>item.id)).toEqual(["collab-1"]);
    expect(boardCollaborationWaitingKey("waiting-approval")).toBe("collaborationBoard.collaborationWaitingApproval");
    expect(boardCollaborationWaitingKey("waiting-user")).toBe("collaborationBoard.collaborationWaitingUser");
  });
});
