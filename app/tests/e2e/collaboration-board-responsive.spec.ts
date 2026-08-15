import { expect, test } from "@playwright/test";

test("collaboration board session cards do not overflow the viewport", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("claudex-ui-locale", "ko");
    class QuietEventSource {
      onerror:((event:Event)=>void)|null=null;
      constructor(public url:string){}
      addEventListener(){}
      close(){}
    }
    (globalThis as any).EventSource=QuietEventSource;
  });

  const now=new Date().toISOString();
  const sessions=[
    {id:"codex:board-revision",kind:"task",title:"과거세션카드 소멸 수정 · Revision",provider:"codex",role:"revision",status:"completed",executionHostId:"local",permissionProfile:"workspace-write",createdAt:now,updatedAt:now,result:"이어 수정해 남은 결함을 제거했습니다. - [claude-transcript.ts](/srv/claudex-workhouse/app/src/server/claude-transcript.ts)",error:null},
    {id:"claude:board-review",kind:"task",title:"과거세션카드 소멸 수정 · Review · independent-review-with-an-unbroken-token",provider:"claude",role:"review",status:"completed",executionHostId:"local",permissionProfile:"read-only",createdAt:now,updatedAt:now,result:"쓰기 도구가 비활성(read-only turn)이라 여기에 리뷰를 남깁니다. this-is-a-very-long-unbroken-review-token-that-must-wrap-inside-the-card",error:null},
    {id:"grok:board-review",kind:"task",title:"과거세션카드 소멸 수정 · Review · independent-review",provider:"grok",role:"review",status:"completed",executionHostId:"local",permissionProfile:"read-only",createdAt:now,updatedAt:now,result:"과거 세션 카드 수정 결과가 모바일 카드 폭 안에서 보여야 합니다.",error:null}
  ];
  const card={id:"20202020-2020-4020-8020-202020202020",projectId:"risuai",title:"협업 게시판 반응형 E2E",description:"긴 세션 로그가 있어도 가로 스크롤이 생기지 않아야 합니다.",boardStatus:"review",priority:"high",boardVisible:true,workspaceId:"workspace-local",targetBranch:"feature/collaboration-board-with-a-very-long-branch-name",roles:{implementer:{provider:"codex",permissionProfile:"workspace-write"},reviewer:{provider:"claude",permissionProfile:"read-only"},secondaryReviewer:{provider:"grok",model:"grok-4.5",permissionProfile:"read-only"}},lastActivityAt:now,completedAt:null,archivedAt:null,revision:1,sessions,activeSessionCount:0};

  await page.route(/\/api\/collaboration-board\/cards(?:\?.*)?$/,route=>route.fulfill({contentType:"application/json",body:JSON.stringify({cards:[card]})}));
  await page.route(`**/api/collaboration-board/cards/${card.id}`,route=>route.fulfill({contentType:"application/json",body:JSON.stringify({card})}));
  await page.route(`**/api/collaboration-board/cards/${card.id}/events`,route=>route.fulfill({contentType:"application/json",body:JSON.stringify({events:[{id:"30303030-3030-4030-8030-303030303030",chainId:card.id,eventType:"card_created",createdAt:now,payload:{}}]})}));
  await page.route(/\/api\/tasks(?:\?.*)?$/,route=>route.fulfill({contentType:"application/json",body:JSON.stringify({tasks:[]})}));
  await page.route(/\/api\/collaborations(?:\?.*)?$/,route=>route.fulfill({contentType:"application/json",body:JSON.stringify({collaborations:[]})}));

  await page.goto("/",{waitUntil:"domcontentloaded"});
  await page.locator(".board-card").filter({hasText:card.title}).click();
  await expect(page.getByRole("heading",{name:"연결된 세션",exact:true})).toBeVisible();

  const layout=await page.evaluate(()=>{
    const scroller=document.scrollingElement as HTMLElement;
    const candidates=[document.documentElement,...document.querySelectorAll<HTMLElement>(".board-detail,.detail-panel,.sessions>button")];
    return {
      documentOverflow:scroller.scrollWidth-scroller.clientWidth,
      escaped:candidates.map(element=>{const rect=element.getBoundingClientRect();return{className:String(element.className),left:rect.left,right:rect.right}}).filter(rect=>rect.left < -1||rect.right > window.innerWidth+1)
    };
  });
  expect(layout.documentOverflow).toBeLessThanOrEqual(1);
  expect(layout.escaped).toEqual([]);
  await expect(page.locator(".sessions>button")).toHaveCount(3);
  await page.screenshot({path:`test-results/${testInfo.project.name}-collaboration-board-responsive.png`,fullPage:true});
});
