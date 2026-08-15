import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe,expect,it } from "vitest";
import { listPendingUserInputs,persistUserInput,submitUserInput,userInputRecord,waitForUserInput } from "../../src/server/user-input-bridge.js";

describe("Codex user input bridge",()=>{
  function state(){const root=fs.mkdtempSync(path.join(os.tmpdir(),"deck-input-"));return{root,file:path.join(root,"task.json")};}
  it("keeps only bounded structured questions",()=>{const item=userInputRecord("task",{threadId:"thread",turnId:"turn",itemId:"item",questions:[{id:"choice",header:"방식",question:"어떻게 진행할까요?",options:[{label:"최소 수정",description:"회귀를 줄입니다."}]}]});expect(item.questions).toEqual([{id:"choice",header:"방식",question:"어떻게 진행할까요?",options:[{label:"최소 수정",description:"회귀를 줄입니다."}],isOther:false,isSecret:false}]);});
  it("submits once and removes transient answer files",async()=>{const {root,file}=state(),item=userInputRecord("task",{questions:[{id:"choice",question:"선택",options:[{label:"A"}]}]});persistUserInput(file,item);expect(listPendingUserInputs(file)).toHaveLength(1);submitUserInput(file,item.id,{choice:{answers:["A"]}});await expect(waitForUserInput(file,item)).resolves.toEqual({choice:{answers:["A"]}});expect(listPendingUserInputs(file)).toHaveLength(0);expect(()=>submitUserInput(file,item.id,{choice:{answers:["A"]}})).toThrow(/no longer pending/);fs.rmSync(root,{recursive:true,force:true});});
  it("rejects missing and mismatched answers",()=>{const {root,file}=state(),item=userInputRecord("task",{questions:[{id:"choice",question:"선택"}]});persistUserInput(file,item);expect(()=>submitUserInput(file,item.id,{})).toThrow(/Every question/);expect(()=>submitUserInput(file,item.id,{other:{answers:["A"]}})).toThrow(/does not match/);fs.rmSync(root,{recursive:true,force:true});});
  it("expires without submitting an empty provider answer",async()=>{const {root,file}=state(),item=userInputRecord("task",{questions:[{id:"choice",question:"선택"}]});item.expiresAt=new Date(Date.now()-1).toISOString();persistUserInput(file,item);await expect(waitForUserInput(file,item)).rejects.toMatchObject({code:"USER_INPUT_TIMEOUT"});expect(listPendingUserInputs(file)).toHaveLength(0);fs.rmSync(root,{recursive:true,force:true});});
});
