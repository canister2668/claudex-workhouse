import { describe, expect, it } from "vitest";
import { isMarkdownEvent, parseMarkdown, workspaceDownloadHref, workspaceViewTarget } from "../../src/web/markdown.js";

describe("agent Markdown presentation", () => {
  it("turns conversational emphasis markers into readable markup",()=>{
    const html=parseMarkdown("이건 **중요해**.\n\n- 첫째\n- 둘째");
    expect(html).toContain("<strong>중요해</strong>");
    expect(html).toContain("<li>첫째</li>");
    expect(html).not.toContain("**중요해**");
  });

  it("keeps single-tilde ranges readable and reserves deletion for double tildes",()=>{
    const html=parseMarkdown("첫 검색 1~2초, 반복 50~300ms, 웜 30~200ms. ~~삭제~~");
    expect(html).toContain("1~2초");
    expect(html).toContain("50~300ms");
    expect(html).toContain("30~200ms");
    expect(html).toContain("<del>삭제</del>");
    expect(html).not.toContain("<del>2초");
  });

  it("renders headings, lists, fenced code, and tables", () => {
    const html=parseMarkdown("### 제목\n\n- 첫째\n- 둘째\n\n```ts\nconst ok = true;\n```\n\n| 항목 | 값 |\n|---|---|\n| 상태 | 완료 |");
    expect(html).toContain("<h3>제목</h3>");
    expect(html).toContain("<li>첫째</li>");
    expect(html).toContain('<code class="language-ts">');
    expect(html).toContain('class="markdown-code-block"');
    expect(html).toContain('data-copy-code');
    expect(html).toContain(">ts</span>");
    expect(html).toContain("<table>");
  });

  it("adds a copy control only to fenced code blocks",()=>{
    const html=parseMarkdown("인라인 `const x = 1`.\n\n```js\nconst x = \"<safe>\";\n```");
    expect(html.match(/data-copy-code/g)).toHaveLength(1);
    expect(html).toContain('class="markdown-code-toolbar"');
    expect(html).toContain(">js</span>");
    expect(html).toContain("&lt;safe&gt;");
  });

  it("uses Markdown only for assistant messages", () => {
    expect(isMarkdownEvent({type:"message_completed",content:"**완료**"})).toBe(true);
    expect(isMarkdownEvent({type:"message_delta",content:"작성 중"})).toBe(true);
    expect(isMarkdownEvent({type:"message",content:"결과",metadata:{role:"agent"}})).toBe(true);
    expect(isMarkdownEvent({type:"message",content:"요청",metadata:{role:"user"}})).toBe(false);
    expect(isMarkdownEvent({type:"tool_completed",content:"로그"})).toBe(false);
  });

  it("routes archives inside the active local workspace to an authenticated download", () => {
    const context={workspaceId:"workspace-1",workspacePath:"/srv/claudex-workhouse",executionHostId:"local"};
    expect(workspaceDownloadHref("/srv/claudex-workhouse/releases/가이드.zip",context)).toBe("/api/workspaces/workspace-1/files/download?path=releases%2F%EA%B0%80%EC%9D%B4%EB%93%9C.zip");
    const html=parseMarkdown("[배포본](/srv/claudex-workhouse/releases/가이드.zip)",context);
    expect(html).toContain('href="/api/workspaces/workspace-1/files/download?path=releases%2F%EA%B0%80%EC%9D%B4%EB%93%9C.zip"');
    expect(html).toContain('title="파일 다운로드"');
  });

  it("opens reviewable documents in the viewer and leaves download to its toolbar",()=>{
    const context={workspaceId:"workspace-1",workspacePath:"/srv/claudex-workhouse",executionHostId:"local"};
    for(const relative of ["reports/update.html","reports/notes.md","reports/manual.pdf","reports/brief.docx","reports/data.json"]){
      const href=workspaceDownloadHref(`/srv/claudex-workhouse/${relative}`,context);
      expect(href).toContain("/open-file?");
      expect(href).toContain("view=file");
      expect(href).not.toContain("/files/download");
    }
    expect(workspaceDownloadHref("/srv/claudex-workhouse/releases/module.risum",context))
      .toBe("/api/workspaces/workspace-1/files/download?path=releases%2Fmodule.risum");
  });

  it("presents source locations as viewer references and preserves line numbers",()=>{
    const context={workspaceId:"workspace-1",workspacePath:"/srv/claudex-workhouse",executionHostId:"local"};
    expect(workspaceDownloadHref("/srv/claudex-workhouse/app/src/web/markdown.ts:117",context)).toBe("/open-file?path=app%2Fsrc%2Fweb%2Fmarkdown.ts&line=117&workspace=workspace-1&view=file");
    const html=parseMarkdown("[markdown.ts](/srv/claudex-workhouse/app/src/web/markdown.ts:117)",context);
    expect(html).toContain('href="/open-file?path=app%2Fsrc%2Fweb%2Fmarkdown.ts&line=117&workspace=workspace-1&view=file"');
    expect(html).toContain('title="파일 열기"');
    expect(html).not.toContain("/files/download");
  });

  it("extracts the workspace from cross-workspace viewer links",()=>{
    expect(workspaceViewTarget("/api/workspaces/risu-workspace/files/view?path=docs%2Fbot.html&line=8")).toEqual({
      workspaceId:"risu-workspace",path:"docs/bot.html",line:8,
    });
    expect(workspaceViewTarget("/?view=file&workspace=risu-workspace&path=docs%2Fbot.html&line=8")).toEqual({
      workspaceId:"risu-workspace",path:"docs/bot.html",line:8,
    });
    expect(workspaceViewTarget("/open-file?view=file&workspace=risu-workspace&path=docs%2Fbot.html&line=8")).toEqual({
      workspaceId:"risu-workspace",path:"docs/bot.html",line:8,
    });
    expect(workspaceViewTarget("/api/workspaces/risu-workspace/files/view?path=..%2Fsecret.html")).toBeNull();
    expect(workspaceViewTarget("/api/workspaces/risu-workspace/files/download?path=docs%2Fbot.html")).toBeNull();
  });

  it("honors an explicit download request even for a normally viewable Markdown file",()=>{
    const context={workspaceId:"workspace-1",workspacePath:"/srv/claudex-workhouse",executionHostId:"local"};
    expect(workspaceDownloadHref("/srv/claudex-workhouse/reports/review.md?download=1",context)).toBe("/api/workspaces/workspace-1/files/download?path=reports%2Freview.md");
    const html=parseMarkdown("[리뷰 다운로드](/srv/claudex-workhouse/reports/review.md?download=1)",context);
    expect(html).toContain("/files/download?path=reports%2Freview.md");
    expect(html).toContain('title="파일 다운로드"');
  });

  it("does not rewrite external, cross-workspace, traversal, or remote-host links", () => {
    const local={workspaceId:"workspace-1",workspacePath:"/srv/claudex-workhouse",executionHostId:"local"};
    expect(workspaceDownloadHref("https://example.com/file.zip",local)).toBe("https://example.com/file.zip");
    expect(workspaceDownloadHref("/srv/other/file.zip",local)).toBe("/srv/other/file.zip");
    expect(workspaceDownloadHref("/srv/claudex-workhouse/../secret.txt",local)).toBe("/srv/claudex-workhouse/../secret.txt");
    expect(workspaceDownloadHref("/remote/work/file.zip",{workspaceId:"remote",workspacePath:"/remote/work",executionHostId:"worker-1"})).toBe("/remote/work/file.zip");
  });

  it("routes absolute HTML paths through the most specific registered local workspace",()=>{
    const context={
      workspaceId:"workhouse",workspacePath:"/srv/claudex-workhouse",executionHostId:"local",
      workspaces:[
        {id:"risu",canonicalPath:"/srv/projects/example",hostId:"local"},
        {id:"risu-docs",canonicalPath:"/srv/projects/example/docs",hostId:"local"},
        {id:"remote",canonicalPath:"/remote/docs",hostId:"worker-1"},
      ],
    };
    expect(workspaceDownloadHref("/srv/projects/example/docs/module/intro.html",context))
      .toBe("/open-file?path=module%2Fintro.html&workspace=risu-docs&view=file");
    expect(workspaceDownloadHref("/srv/projects/example/save/card.html",context))
      .toBe("/open-file?path=save%2Fcard.html&workspace=risu&view=file");
    expect(workspaceDownloadHref("/remote/docs/intro.html",context)).toBe("/remote/docs/intro.html");
  });

  it("opens external websites in a new tab without changing internal links",()=>{
    const html=parseMarkdown("[외부](https://example.com/docs) [내부](/settings)");
    expect(html).toContain('<a target="_blank" rel="noopener noreferrer" href="https://example.com/docs">외부</a>');
    expect(html).toContain('<a href="/settings">내부</a>');
    expect(html).not.toContain('target="_blank" rel="noopener noreferrer" href="/settings"');
  });

  it("downgrades an out-of-workspace absolute download path to escaped code",()=>{
    const context={workspaceId:"workspace-1",workspacePath:"/srv/claudex-workhouse",executionHostId:"local"};
    const html=parseMarkdown("[preview](/tmp/claudex-skin-preview.html?download=1)",context);
    expect(html).not.toContain("<a ");
    expect(html).toContain("<code>/tmp/claudex-skin-preview.html?download=1</code>");
    expect(parseMarkdown("[preview](/tmp/file.html?download=1&next=1)",context)).toContain("<code>/tmp/file.html?download=1&amp;next=1</code>");
  });

  it("downgrades a multi-segment absolute file path outside the workspace",()=>{
    const context={workspaceId:"workspace-1",workspacePath:"/srv/claudex-workhouse",executionHostId:"local"};
    const html=parseMarkdown("[archive](/srv/other/export.zip)",context);
    expect(html).not.toContain("<a ");
    expect(html).toContain("<code>/srv/other/export.zip</code>");
  });

  it("keeps app routes and external websites as links",()=>{
    const html=parseMarkdown("[설정](/settings) [외부](https://example.com/docs)");
    expect(html).toContain('<a href="/settings">설정</a>');
    expect(html).toContain('<a target="_blank" rel="noopener noreferrer" href="https://example.com/docs">외부</a>');
  });

  it("keeps rewriting an absolute file path inside the local workspace",()=>{
    const context={workspaceId:"workspace-1",workspacePath:"/srv/claudex-workhouse",executionHostId:"local"};
    const html=parseMarkdown("[report](/srv/claudex-workhouse/output/report.html?download=1)",context);
    expect(html).toContain('<a href="/api/workspaces/workspace-1/files/download?path=output%2Freport.html"');
    expect(html).not.toContain("<code>");
  });

  it("renders an absolute workspace image path through the preview route",()=>{
    const context={workspaceId:"workspace-1",workspacePath:"/srv/claudex-workhouse",executionHostId:"local"};
    const html=parseMarkdown("![시안 A](/srv/claudex-workhouse/docs/shots/plan-a.png)",context);
    expect(html).toContain('src="/api/workspaces/workspace-1/files/preview?path=docs%2Fshots%2Fplan-a.png&amp;pathBase=workspace"');
    expect(html).toContain('alt="시안 A"');
    expect(html).toContain('loading="lazy"');
    expect(html).not.toContain('src="/srv/claudex-workhouse');
  });

  it("promotes a completed agent's ordinary workspace image link inline",()=>{
    const context={workspaceId:"workspace-1",workspacePath:"/srv/claudex-workhouse",executionHostId:"local",inlineImages:true};
    const html=parseMarkdown("[라이트 시안](/srv/claudex-workhouse/docs/shots/plan-a.png)",context);
    expect(html).toContain('<figure class="markdown-image">');
    expect(html).toContain('src="/api/workspaces/workspace-1/files/preview?path=docs%2Fshots%2Fplan-a.png&amp;pathBase=workspace"');
    expect(html).toContain('alt="라이트 시안"');
    expect(html).toContain("<figcaption>라이트 시안</figcaption>");
    expect(html).not.toContain("/files/download");
  });

  it("keeps linked images as links when inline promotion is disabled or explicitly downloaded",()=>{
    const context={workspaceId:"workspace-1",workspacePath:"/srv/claudex-workhouse",executionHostId:"local"};
    const disabled=parseMarkdown("[시안](/srv/claudex-workhouse/plan.png)",context);
    expect(disabled).not.toContain("<img");
    expect(disabled).toContain("/open-file?path=plan.png");
    const forced=parseMarkdown("[원본](/srv/claudex-workhouse/plan.png?download=1)",{...context,inlineImages:true});
    expect(forced).not.toContain("<img");
    expect(forced).toContain("/files/download?path=plan.png");
  });

  it("limits inline linked images and excludes unsupported, external, and remote targets",()=>{
    const local={workspaceId:"workspace-1",workspacePath:"/srv/claudex-workhouse",executionHostId:"local",inlineImages:true};
    const many=parseMarkdown(Array.from({length:13},(_,index)=>`[시안 ${index+1}](/srv/claudex-workhouse/shot-${index+1}.png)`).join("\n"),local);
    expect(many.match(/<img/g)).toHaveLength(12);
    expect(many).toContain("/open-file?path=shot-13.png");
    expect(parseMarkdown("[벡터](/srv/claudex-workhouse/plan.svg)",local)).not.toContain("<img");
    expect(parseMarkdown("[외부](https://example.com/plan.png)",local)).not.toContain("<img");
    expect(parseMarkdown("[원격](/remote/work/plan.png)",{workspaceId:"remote",workspacePath:"/remote/work",executionHostId:"worker-1",inlineImages:true})).not.toContain("<img");
  });

  it("captions an image with its Markdown title and keeps remote images untouched",()=>{
    const context={workspaceId:"workspace-1",workspacePath:"/srv/claudex-workhouse",executionHostId:"local"};
    const html=parseMarkdown('![차트](/srv/claudex-workhouse/chart.png "월간 추이")',context);
    expect(html).toContain("<figcaption>월간 추이</figcaption>");
    expect(parseMarkdown("![외부](https://example.com/a.png)")).toContain('src="https://example.com/a.png"');
  });

  it("downgrades an unresolvable local image path instead of showing a broken image",()=>{
    const context={workspaceId:"workspace-1",workspacePath:"/srv/claudex-workhouse",executionHostId:"local"};
    const html=parseMarkdown("![shot](/volume2/elsewhere/shots/plan-a.png)",context);
    expect(html).not.toContain("<img");
    expect(html).toContain("<code>/volume2/elsewhere/shots/plan-a.png</code>");
  });

  it("downgrades workspace-looking file links for remote execution hosts",()=>{
    const context={workspaceId:"remote",workspacePath:"/remote/work",executionHostId:"worker-1"};
    const html=parseMarkdown("[bundle](/remote/work/output/bundle.zip)",context);
    expect(html).not.toContain("<a ");
    expect(html).toContain("<code>/remote/work/output/bundle.zip</code>");
  });
});
