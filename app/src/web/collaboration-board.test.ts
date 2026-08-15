import {describe,expect,it} from "vitest";
import {boardDefaultRole,boardDefaultRoles,normalizeBoardRole,type CollaborationBoardExecutionConfig} from "./collaboration-board";

const config:CollaborationBoardExecutionConfig={defaultProvider:"grok",fullAccessAcknowledged:false,providers:[
  {provider:"codex",models:[{id:"gpt-a",displayName:"GPT A",supportedReasoningEfforts:[{reasoningEffort:"low"},{reasoningEffort:"high"}],defaultReasoningEffort:"high",serviceTiers:[{id:"priority"}]}],efforts:[],defaultModel:"gpt-a",defaultReasoningEffort:"high",defaultServiceTier:"priority",defaultWorkMode:"default",defaultAutomationLevel:"confirm",defaultPermissionProfile:":workspace"},
  {provider:"grok",models:[{id:"grok-a",displayName:"Grok A"}],efforts:[{id:"default"},{id:"high"}],defaultModel:"grok-a",defaultReasoningEffort:"high",defaultServiceTier:null,defaultWorkMode:"default",defaultAutomationLevel:"auto",defaultPermissionProfile:":workspace-write"},
  {provider:"claude",models:[{id:"claude-a",displayName:"Claude A"}],efforts:[{id:"medium"}],defaultModel:"claude-a",defaultReasoningEffort:"medium",defaultServiceTier:null,defaultWorkMode:"plan",defaultAutomationLevel:"read",defaultPermissionProfile:":read-only"}
]};

describe("collaboration board execution defaults",()=>{
  it("snapshots the selected global provider and its complete defaults",()=>{expect(boardDefaultRoles(config)).toEqual({implementer:boardDefaultRole(config,"grok")});expect(boardDefaultRole(config,"codex")).toMatchObject({model:"gpt-a",reasoningEffort:"high",serviceTier:"priority",workMode:"default",automationLevel:"confirm",permissionProfile:":workspace"});});
  it("repairs legacy permission strings and disabled models from global configuration",()=>{expect(normalizeBoardRole(config,{provider:"codex",model:"removed",permissionProfile:"workspace-write"})).toMatchObject({model:"gpt-a",permissionProfile:":workspace",automationLevel:"confirm"});});
});
