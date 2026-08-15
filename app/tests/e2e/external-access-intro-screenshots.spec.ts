import{expect,test}from"@playwright/test";

// Public-fixture capture for the external-access intro article. It never
// touches a real tailnet, Cloudflare account, DNS record or the live
// external-access store: every /api/external-access route is fulfilled from
// the fixtures below.
const out="test-results/external-access-intro";
const FIXTURE={
  email:"owner@example.com",
  cloudflareHost:"workhouse.example.com",
  tailscaleHost:"demo-node.example.ts.net",
  teamDomain:"https://team.cloudflareaccess.com",
  audience:"",
  localOrigin:"http://127.0.0.1:3410"
} as const;

const at=(minutes:number)=>new Date(Date.UTC(2026,7,14,9,0,0)-minutes*60_000).toISOString();

const detection=(provider:"local"|"tailscale"|"cloudflare",overrides:Record<string,unknown>)=>({
  provider,state:"not_detected",management:"diagnostic-only",checkedAt:at(0),installed:false,serviceRunning:null,
  authenticated:null,connected:null,configured:false,permission:"unknown",version:null,externalUrl:null,
  details:{},warnings:[],...overrides
});

const DETECTIONS={
  tailscale:[
    detection("local",{state:"healthy",management:"guided",installed:true,serviceRunning:true,authenticated:true,connected:true,permission:"sufficient"}),
    detection("tailscale",{state:"connected",management:"managed",installed:true,serviceRunning:true,authenticated:true,connected:true,configured:false,permission:"sufficient",version:"1.92.1",details:{magicDns:true,serve:false,funnel:false}}),
    detection("cloudflare",{state:"not_detected"})
  ],
  cloudflare:[
    detection("local",{state:"healthy",management:"guided",installed:true,serviceRunning:true,authenticated:true,connected:true,permission:"sufficient"}),
    detection("tailscale",{state:"not_detected"}),
    detection("cloudflare",{state:"installed",management:"managed-with-helper",installed:true,serviceRunning:false,authenticated:null,permission:"sufficient",version:"2026.6.1",details:{configCandidates:1}})
  ]
} as const;

const PLANS={
  tailscale:{
    id:"plan-tailscale-demo",provider:"tailscale",action:"tailscale_serve_apply",createdAt:at(1),expiresAt:at(-9),
    configurationRevision:3,detectedStateRevision:"rev-demo",planDigest:"sha256:demo",
    steps:[
      {id:"s1",label:"Tailscale Serve HTTPS를 loopback 3410 포트로 연결합니다.",action:"tailscale_serve_apply",reversible:true},
      {id:"s2",label:"Workhouse 인증 방식을 Tailscale 신원 확인으로 기록합니다.",action:"tailscale_serve_apply",reversible:true},
      {id:"s3",label:`허용 사용자를 ${FIXTURE.email} 한 명으로 제한합니다.`,action:"tailscale_serve_apply",reversible:true}
    ],
    commands:[
      {label:"Serve",argv:["tailscale","serve","--bg","--https=443",FIXTURE.localOrigin],execution:"automatic"},
      {label:"Restart",argv:["docker","compose","restart","workhouse"],execution:"operator"}
    ],
    files:[{pathLabel:"config/external-access/profile.json",operation:"create"}],
    services:[{name:"claudex-workhouse",operation:"restart"}],
    publicExposure:"tailnet",
    authenticationBoundary:"tailnet 로그인 사용자 중 허용 이메일 정확히 일치",
    adminRequired:false,
    externalActions:["Tailscale 앱에서 이 장치가 승인된 상태인지 확인하세요.","적용 뒤 인증 설정을 읽도록 서비스는 운영자가 재시작합니다."],
    rollbackSteps:["tailscale serve --https=443 off","외부 접속 구성을 로컬 전용으로 되돌리기"],
    input:{}
  },
  cloudflare:{
    id:"plan-cloudflare-demo",provider:"cloudflare",action:"cloudflare_validate",createdAt:at(1),expiresAt:at(-9),
    configurationRevision:4,detectedStateRevision:"rev-demo",planDigest:"sha256:demo",
    steps:[
      {id:"s1",label:"기존 Tunnel이 loopback 3410 포트에 도달하는지 확인합니다.",action:"cloudflare_validate",reversible:true},
      {id:"s2",label:"Access 팀 도메인과 audience로 JWT 검증을 설정합니다.",action:"cloudflare_validate",reversible:true},
      {id:"s3",label:`허용 사용자를 ${FIXTURE.email} 한 명으로 제한합니다.`,action:"cloudflare_validate",reversible:true}
    ],
    commands:[
      {label:"Health",argv:["curl","-sS",`${FIXTURE.localOrigin}/api/health/live`],execution:"automatic"},
      {label:"Restart",argv:["docker","compose","restart","workhouse"],execution:"operator"}
    ],
    files:[{pathLabel:"config/external-access/profile.json",operation:"update"}],
    services:[{name:"claudex-workhouse",operation:"restart"}],
    publicExposure:"internet",
    authenticationBoundary:"Cloudflare Access 로그인 뒤 허용 이메일 정확히 일치",
    adminRequired:false,
    externalActions:["Zero Trust에서 exact-email Allow 정책과 Tunnel 경로를 직접 확인하세요.","Tunnel token은 브라우저로 다시 전달되지 않습니다."],
    rollbackSteps:["Workhouse 인증 설정을 이전 값으로 되돌리기","Zero Trust에서 hostname 경로 제거"],
    input:{}
  }
} as const;

const check=(code:string,status:string,detail:string)=>({code,status,detail,checkedAt:at(0)});
const CHECKS={
  tailscale:[
    check("tailscale.serve.https","passed","HTTPS 주소가 응답합니다."),
    check("workhouse.health.local","passed","로컬 health 검사를 통과했습니다."),
    check("auth.identity.header","passed","tailnet 신원이 허용 이메일과 일치합니다."),
    check("auth.anonymous.blocked","passed","로그인하지 않은 요청은 차단됩니다."),
    check("workhouse.restart.required","warning","인증 설정 반영을 위한 재시작은 운영자가 수행합니다.")
  ],
  cloudflare:[
    check("cloudflare.dns.resolved","passed","hostname이 Cloudflare로 해석됩니다."),
    check("cloudflare.tls.valid","passed","TLS 인증서가 유효합니다."),
    check("cloudflare.access.redirect","passed","비로그인 요청이 Access 로그인으로 이동합니다."),
    check("workhouse.health.local","passed","로컬 health 검사를 통과했습니다."),
    check("cloudflare.access.policy","warning","exact-email 정책 내용은 Zero Trust에서 직접 확인해야 합니다."),
    check("workhouse.restart.required","warning","인증 설정 반영을 위한 재시작은 운영자가 수행합니다.")
  ]
} as const;

type Kind="tailscale"|"cloudflare";

test(`captures sanitized external access wizard screens`,async({page})=>{
  test.skip(process.env.CLAUDEX_CAPTURE_EXTERNAL_ACCESS!=="1","External access screenshots are generated only on request");
  test.setTimeout(180_000);

  let kind:Kind="tailscale";
  const finalOrigin=()=>kind==="tailscale"?`https://${FIXTURE.tailscaleHost}`:`https://${FIXTURE.cloudflareHost}`;

  await page.addInitScript(()=>{
    localStorage.clear();
    localStorage.setItem("claudex-ui-locale","ko");
    // The wizard falls back to REST polling when its EventSource fails, which
    // keeps the capture deterministic without a live operation stream.
    class ClosedEventSource{
      onerror:null|(()=>void)=null;
      constructor(){setTimeout(()=>this.onerror?.(),30);}
      addEventListener(){}
      close(){}
    }
    Object.defineProperty(globalThis,"EventSource",{value:ClosedEventSource,configurable:true});
  });

  await page.route("**/api/**",async route=>{
    const request=route.request(),pathname=new URL(request.url()).pathname;
    const json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/bootstrap/owner-claim/status")return json({required:false,claimed:true});
    if(pathname==="/api/setup")return json({required:false,progress:{step:10,completed:true,accessMode:"local",steps:{}}});
    if(pathname==="/api/infrastructure/overview")return json({server:{id:"local",displayName:"Personal NAS",roles:["main-server"],platform:"linux",architecture:"x64",appVersion:"1.0.0",connectionStatus:"online",healthStatus:"healthy",internalUrl:FIXTURE.localOrigin},executionHosts:[]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"demo-host",type:"local",displayName:"Personal NAS",platform:"linux",architecture:"x64",status:"online",lastSeenAt:at(0),capabilities:{}}]});
    if(pathname.startsWith("/api/workspaces"))return json({workspaces:[{id:"demo-workspace",projectId:"demo-project",hostId:"demo-host",displayName:"Demo Workspace",canonicalPath:"/demo/workspace"}]});
    if(pathname==="/api/projects")return json({projects:[{id:"demo-project",name:"Demo Workspace",enabled:true,error:null}]});
    if(pathname==="/api/tasks")return json({tasks:[],partial:false,warnings:[]});
    if(pathname==="/api/collaborations")return json({collaborations:[]});
    if(pathname==="/api/external-access/v1/configuration")return json({authMode:"local",externalOrigin:FIXTURE.localOrigin,environmentManaged:{},profiles:[]});
    if(pathname==="/api/external-access/v1/detect")return json(DETECTIONS[kind]);
    if(pathname==="/api/external-access/v1/plans")return json(PLANS[kind]);
    if(/\/plans\/[^/]+\/apply$/.test(pathname))return json({id:"op-demo",profileId:"profile-demo",provider:kind,action:PLANS[kind].action,planDigest:"sha256:demo",status:"running",stage:"applying",safeErrorCode:null,startedAt:at(0),updatedAt:at(0),finishedAt:null,rollbackStatus:null,interrupted:false,checks:[]});
    if(/\/operations\/[^/]+$/.test(pathname))return json({id:"op-demo",profileId:"profile-demo",provider:kind,action:PLANS[kind].action,planDigest:"sha256:demo",status:"succeeded",stage:"verified",safeErrorCode:null,startedAt:at(1),updatedAt:at(0),finishedAt:at(0),rollbackStatus:null,interrupted:false,checks:CHECKS[kind]});
    if(pathname==="/api/external-access/v1/tests")return json(CHECKS[kind]);
    return json({});
  });

  const openWizard=async()=>{
    await page.goto("/",{waitUntil:"domcontentloaded"});
    const more=page.getByRole("button",{name:"추가 작업"});
    if(await more.isVisible().catch(()=>false))await more.click();
    await page.getByRole("button",{name:"설정 열기"}).click();
    const settings=page.getByRole("dialog",{name:"설정"});
    await expect(settings).toBeVisible();
    // Let the settings panel grow to its content so the wizard section is fully
    // painted; otherwise the element screenshot captures the dialog backdrop
    // where the section extends past the panel's scroll viewport.
    await page.addStyleTag({content:".modal.global-settings{max-height:none!important;height:auto!important}.settings-tab-panel{max-height:none!important;overflow:visible!important}"});
    await settings.getByRole("button",{name:"서버 및 Worker",exact:true}).click();
    const section=settings.locator(".external-access");
    await expect(section.getByRole("heading",{name:"외부 접속"})).toBeVisible();
    await section.getByRole("button",{name:"설정",exact:true}).click();
    await expect(section.getByRole("heading",{name:"접속 방식 선택"})).toBeVisible();
    return section;
  };

  const shot=async(locator:any,name:string)=>{
    // The section must never overflow horizontally in the published image.
    expect(await locator.evaluate((element:HTMLElement)=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(0);
    // A section taller than the viewport would be captured with a clipped grey
    // band, and the settings dialog header would overlap its top edge.
    const height=await locator.evaluate((element:HTMLElement)=>element.getBoundingClientRect().height);
    const viewport=page.viewportSize()!;
    expect(height).toBeLessThanOrEqual(viewport.height-120);
    await locator.scrollIntoViewIfNeeded();
    await locator.screenshot({path:`${out}/${name}.png`,animations:"disabled"});
  };

  await page.setViewportSize({width:900,height:1500});

  // 01 method choice + 02 Tailscale detection + 03 plan + 04 completion
  kind="tailscale";
  let section=await openWizard();
  await section.getByRole("button",{name:/Tailscale/}).click();
  await shot(section,"01-choose-method");

  await section.getByRole("button",{name:"설치 및 상태 감지"}).click();
  await expect(section.getByRole("heading",{name:"감지 결과"})).toBeVisible();
  await shot(section,"02-tailscale-detected");

  await section.getByRole("button",{name:"다음"}).click();
  await expect(section.getByRole("heading",{name:"필요한 설정값"})).toBeVisible();
  await section.getByLabel("외부 hostname").fill(FIXTURE.tailscaleHost);
  await section.getByLabel("허용 이메일 (정확히 일치)").fill(FIXTURE.email);
  await section.getByRole("button",{name:"변경 내용 확인"}).click();
  await expect(section.getByRole("heading",{name:"실행 전 변경 계획"})).toBeVisible();
  await shot(section,"03-tailscale-plan");

  await section.getByRole("button",{name:"승인하고 적용"}).click();
  await expect(section.getByRole("heading",{name:"외부 접속 준비 완료"})).toBeVisible({timeout:15_000});
  await expect(section.locator("img.qr")).toBeVisible();
  await shot(section,"04-tailscale-complete");

  // 05 Cloudflare input + 06 plan + 07 connection checks
  kind="cloudflare";
  section=await openWizard();
  await section.getByRole("button",{name:/Cloudflare/}).click();
  await section.getByRole("button",{name:"설치 및 상태 감지"}).click();
  await expect(section.getByRole("heading",{name:"감지 결과"})).toBeVisible();
  await section.getByRole("button",{name:"다음"}).click();
  await expect(section.getByRole("heading",{name:"필요한 설정값"})).toBeVisible();
  await section.getByLabel("외부 hostname").fill(FIXTURE.cloudflareHost);
  await section.getByLabel("허용 이메일 (정확히 일치)").fill(FIXTURE.email);
  await section.getByLabel("Access 팀 도메인").fill(FIXTURE.teamDomain);
  await section.getByLabel("Access audience").fill(FIXTURE.audience);
  // Run mode stays "기존 Tunnel 검증": no Tunnel token field is rendered, so no
  // secret can appear in the captured image.
  await expect(section.getByLabel("Tunnel token")).toHaveCount(0);
  await shot(section,"05-cloudflare-input");

  await section.getByRole("button",{name:"변경 내용 확인"}).click();
  await expect(section.getByRole("heading",{name:"실행 전 변경 계획"})).toBeVisible();
  await shot(section,"06-cloudflare-plan");

  await section.getByRole("button",{name:"승인하고 적용"}).click();
  await expect(section.getByRole("heading",{name:"외부 접속 준비 완료"})).toBeVisible({timeout:15_000});
  await section.getByRole("button",{name:"다시 검사"}).click();
  await expect(section.getByRole("heading",{name:"연결 시험"})).toBeVisible();
  await shot(section,"07-cloudflare-checks");

  // 08 mobile final address and QR
  await page.setViewportSize({width:360,height:900});
  await section.getByRole("button",{name:"다음"}).click();
  await expect(section.getByRole("heading",{name:"외부 접속 준비 완료"})).toBeVisible();
  await expect(section.locator("img.qr")).toBeVisible();
  await expect(section.getByRole("link",{name:new RegExp(FIXTURE.cloudflareHost)})).toBeVisible();
  await shot(section,"08-mobile-final-address");

  expect(finalOrigin()).toBe(`https://${FIXTURE.cloudflareHost}`);
});
