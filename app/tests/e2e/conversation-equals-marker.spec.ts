import{expect,test}from"@playwright/test";

test("conversation mode repairs equals-sign emotion markers without duplicating output",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    class SilentEventSource{onerror:null|(()=>void)=null;constructor(public url:string){}addEventListener(){}close(){}}
    Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});
  });
  const now=new Date().toISOString(),id="edededed-eded-4ded-8ded-edededededed",output=[
    "[[e=happy]]",
    "밥알 하나에도 정성이 고여 있어.",
    "[[e=smug]]",
    "규칙의 단도는 필요할 때 꺼낼게.",
    "[[e=neutral]]",
    "천천히 이어가자.",
  ].join("\n");
  const session={id,projectId:"project",title:"Ollama 감정 태그 복구",mode:"debate",status:"completed",outcome:"round-limit",primaryParticipantId:null,maxCalls:1,currentCallCount:1,currentStep:"completed",timeoutAt:now,controllerGeneration:1,workChainId:null,sourceTaskId:null,createdAt:now,updatedAt:now,completedAt:now,cancelledAt:null,archivedAt:null,maxTurnsPerParticipant:1,metadata:{topLevel:true,conversationFlow:"automatic",conversationKind:"casual",conversationTurnLength:"rich",currentRound:1,waitingForUser:false,enabledProviders:["ollama"],participantOrder:["ollama"]}};
  const person={id:"p-ollama",collaborationSessionId:id,provider:"ollama",role:"primary",executionHostId:"local",workspaceId:"workspace",providerSessionId:"ollama-session",permissionMode:"read",status:"completed",sessionGeneration:1,capabilitySnapshot:{newSession:true},createdAt:now,updatedAt:now,archivedAt:null};
  const run={id:"run-ollama-equals",collaborationSessionId:id,participantId:person.id,round:1,sequence:1,attempt:1,purpose:"debate-turn",providerTaskId:"task-ollama-equals",status:"completed",generation:1,errorCategory:null,completedAt:now};
  const task={id:run.providerTaskId,provider:"ollama",threadId:"ollama-session",workspaceId:"workspace",executionHostId:"local",status:"completed",result:output,updatedAt:now,requestedModel:"deepseek-v4-flash:0731"};
  const detail={session,participants:[person],runs:[run],messages:[{id:"message-user",messageType:"user-input",contentRef:"서로 대화",round:1,createdAt:now}],avatarStates:[],runOutputs:{[run.id]:output},runEvents:{[run.id]:[]},tasks:{[task.id]:task},continuation:{available:true,canAddRounds:true,canAutoContinue:false,canSubmitUserInput:true,canRetryFailedTurn:false}};
  await page.route("**/api/**",async route=>{
    const pathname=new URL(route.request().url()).pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/collaborations")return json({collaborations:[session]});
    if(pathname===`/api/collaborations/${id}`)return json(detail);
    if(pathname==="/api/tasks")return json({tasks:[],partial:false,warnings:[]});
    if(pathname==="/api/projects")return json({projects:[{id:"project",name:"Project",enabled:true,error:null}]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"local",displayName:"Local",status:"online"}]});
    if(pathname==="/api/workspaces")return json({workspaces:[{id:"workspace",projectId:"project",hostId:"local",displayName:"Workspace",canonicalPath:"/workspace"}]});
    if(pathname==="/api/emotion"){const assets=["happy","smug","neutral"].map(emotion=>({emotion,file:`${emotion}.webp`}));return json({state:{outfit:"normal"},codexState:{outfit:"Gpt-Codex"},ollamaState:{outfit:"Ollama"},outfits:["Ollama"],assets:{Ollama:assets},mode:"catch"});}
    if(pathname==="/api/provider-connections"||pathname==="/api/provider-connections/attempts")return json({accounts:[],attempts:[]});
    if(pathname==="/api/quota")return json({fetchedAt:now});
    if(pathname==="/api/push")return json({preferences:{},publicKey:""});
    return json({});
  });
  await page.goto("/");
  await page.getByRole("navigation",{name:"주요 화면"}).getByRole("button",{name:"대화",exact:true}).click();
  await page.getByRole("button",{name:/Ollama 감정 태그 복구/}).click();
  const turn=page.locator(".conversation-provider-turn.provider-ollama");
  await expect(turn.locator(".inline-leading")).toHaveCount(0);
  await expect(turn.locator(".inline-emotion-scene")).toHaveCount(3);
  await expect(turn.locator(".scene-markdown")).toHaveText(["밥알 하나에도 정성이 고여 있어.","규칙의 단도는 필요할 때 꺼낼게.","천천히 이어가자."]);
  await expect(turn.getByText("밥알 하나에도 정성이 고여 있어.",{exact:true})).toHaveCount(1);
  await expect(turn).not.toContainText("[[e=");
});
