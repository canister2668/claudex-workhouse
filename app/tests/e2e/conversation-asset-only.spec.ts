import{expect,test}from"@playwright/test";

test("conversation mode renders every Claude asset-only emotion beat",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    class SilentEventSource{onerror:null|(()=>void)=null;constructor(public url:string){}addEventListener(){}close(){}}
    Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});
  });
  const now=new Date().toISOString(),id="cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",output="[[e:embarrassed]]\n[[e:pout]]\n[[e:wink]]";
  const session={id,projectId:"project",title:"대사 없는 클로드 에셋",mode:"debate",status:"waiting-user",outcome:"awaiting-user",primaryParticipantId:null,maxCalls:1,currentCallCount:1,currentStep:"waiting-user",timeoutAt:now,controllerGeneration:1,workChainId:null,sourceTaskId:null,createdAt:now,updatedAt:now,completedAt:null,cancelledAt:null,archivedAt:null,maxTurnsPerParticipant:1,metadata:{topLevel:true,conversationFlow:"guided",conversationKind:"casual",conversationTurnLength:"rich",currentRound:1,waitingForUser:true,enabledProviders:["claude"],participantOrder:["claude"]}};
  const person={id:"p-claude",collaborationSessionId:id,provider:"claude",role:"primary",executionHostId:"local",workspaceId:"workspace",providerSessionId:"claude-session",permissionMode:"read",status:"completed",sessionGeneration:1,capabilitySnapshot:{newSession:true},createdAt:now,updatedAt:now,archivedAt:null};
  const run={id:"run-claude-assets",collaborationSessionId:id,participantId:person.id,round:1,sequence:1,attempt:1,purpose:"debate-turn",providerTaskId:"task-claude-assets",status:"completed",generation:1,errorCategory:null,completedAt:now};
  const task={id:run.providerTaskId,provider:"claude",threadId:"claude-session",workspaceId:"workspace",executionHostId:"local",status:"completed",result:output,updatedAt:now,requestedModel:"claude-test"};
  const detail={session,participants:[person],runs:[run],messages:[{id:"message-user",messageType:"user-input",contentRef:"에셋만 출력해 주세요.",round:1,createdAt:now}],avatarStates:[],runOutputs:{[run.id]:output},runEvents:{[run.id]:[]},tasks:{[task.id]:task},continuation:{available:true,canAddRounds:true,canAutoContinue:true,canSubmitUserInput:true,canRetryFailedTurn:false}};
  await page.route("**/api/**",async route=>{
    const pathname=new URL(route.request().url()).pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/collaborations")return json({collaborations:[session]});
    if(pathname===`/api/collaborations/${id}`)return json(detail);
    if(pathname==="/api/tasks")return json({tasks:[],partial:false,warnings:[]});
    if(pathname==="/api/projects")return json({projects:[{id:"project",name:"Project",enabled:true,error:null}]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"local",displayName:"Local",status:"online"}]});
    if(pathname==="/api/workspaces")return json({workspaces:[{id:"workspace",projectId:"project",hostId:"local",displayName:"Workspace",canonicalPath:"/workspace"}]});
    if(pathname==="/api/emotion"){const assets=["embarrassed","pout","wink"].map(emotion=>({emotion,file:`${emotion}.webp`}));return json({state:{outfit:"normal"},codexState:{outfit:"Gpt-Codex"},outfits:["normal"],assets:{normal:assets},mode:"catch"});}
    if(pathname==="/api/providers/claude/permissions")return json({models:[],permissions:[],efforts:[],catalog:{models:[],stale:false}});
    if(pathname==="/api/provider-connections"||pathname==="/api/provider-connections/attempts")return json({accounts:[],attempts:[]});
    if(pathname==="/api/quota")return json({claude:{},codex:{},fetchedAt:now});
    if(pathname==="/api/push")return json({preferences:{},publicKey:""});
    return json({});
  });
  await page.goto("/");
  await page.getByRole("navigation",{name:"주요 화면"}).getByRole("button",{name:"대화",exact:true}).click();
  await page.getByRole("button",{name:/대사 없는 클로드 에셋/}).click();
  const turn=page.locator(".conversation-provider-turn.provider-claude");
  await expect(turn.locator(".inline-emotion-scene")).toHaveCount(3);
  const images=turn.locator(".inline-emotion-scene img");
  await expect(images).toHaveCount(3);
  await expect(images.nth(0)).toHaveAttribute("src","/emoticons/normal/embarrassed.webp");
  await expect(images.nth(1)).toHaveAttribute("src","/emoticons/normal/pout.webp");
  await expect(images.nth(2)).toHaveAttribute("src","/emoticons/normal/wink.webp");
  await turn.scrollIntoViewIfNeeded();
  await expect.poll(()=>images.evaluateAll(nodes=>nodes.every(node=>(node as HTMLImageElement).complete&&(node as HTMLImageElement).naturalWidth>0))).toBe(true);
  await expect(turn).not.toContainText("[[e:");
});
