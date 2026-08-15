import { expect, test } from "@playwright/test";

// A Claude thread gets one task row per user turn. The task list is served from
// an in-memory snapshot that a follow-up does not publish into, so the browser
// can keep polling a list that only knows the finished turn. The open session
// must still follow the turn that is actually running: otherwise the header
// reads 완료 while the avatar hook, which tracks the provider's newest task,
// keeps animating.
test("a follow-up turn keeps the open session on the running task", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("claudex-ui-locale", "ko");
    class SilentEventSource { constructor(public url: string) {} addEventListener() {} close() {} }
    Object.defineProperty(globalThis, "EventSource", { value: SilentEventSource, configurable: true });
  });

  const now = new Date().toISOString();
  const threadId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const base = {
    provider: "claude", threadId, providerSessionId: threadId, projectId: "project",
    prompt: "먼저 보낸 요청", result: null, error: null, log: "", owned: true,
    ownership: "claudex-workhouse", source: "claudex-workhouse", executionHostId: "local",
    workspaceId: "workspace", metadata: {}, canMutate: true
  };
  const finished = { ...base, id: "claude:finished", nativeId: "finished", title: "완료된 턴", status: "completed", createdAt: now, updatedAt: now };
  const running = { ...base, id: "claude:running", nativeId: "running", title: "완료된 턴", status: "running", prompt: "이어서 보낸 요청", createdAt: new Date(Date.parse(now) + 1000).toISOString(), updatedAt: new Date(Date.parse(now) + 1000).toISOString() };

  let started = false;
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const json = (value: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(value) });
    if (pathname === "/api/tasks" && route.request().method() === "POST") return json({ task: finished });
    // The list snapshot never learns about the follow-up row.
    if (pathname === "/api/tasks") return json({ tasks: [finished], partial: false, warnings: [], snapshot: true });
    if (pathname === "/api/tasks/claude/claude%3Afinished/messages") { started = true; return json({ task: running }); }
    if (pathname === "/api/tasks/claude/claude%3Arunning") return json({ task: running });
    if (pathname === "/api/tasks/claude/claude%3Afinished") return json({ task: finished });
    if (pathname.endsWith("/events")) return json({ taskId: started ? running.id : finished.id, status: started ? "running" : "completed", latestSequence: 0, events: [] });
    if (pathname.endsWith("/message-queue")) return json({ items: [], activeTask: started ? running : finished });
    if (pathname === "/api/projects") return json({ projects: [{ id: "project", name: "Project", enabled: true, error: null }] });
    if (pathname === "/api/hosts") return json({ hosts: [{ id: "local", displayName: "Local", status: "online", platform: "linux" }] });
    if (pathname === "/api/workspaces" || pathname === "/api/location-options") return json({ projects: [{ id: "project", name: "Project", enabled: true, error: null }], workspaces: [{ id: "workspace", projectId: "project", hostId: "local", displayName: "Workspace", canonicalPath: "/workspace" }] });
    if (pathname === "/api/collaborations") return json({ collaborations: [] });
    if (pathname === "/api/quota") return json({ claude: {}, codex: {}, fetchedAt: now });
    if (pathname === "/api/emotion") return json({ state: {}, codexState: {}, outfits: [], assets: [], mode: "catch" });
    if (pathname.startsWith("/api/system-settings/")) return json({ settings: null, candidates: { claude: [], codex: [] } });
    return json({});
  });

  await page.goto("/?task=claude:finished", { waitUntil: "domcontentloaded" });
  const badge = page.locator(".task-heading .state-text");
  await expect(badge).toHaveText("완료");

  await page.locator(".composer textarea").fill("이어서 보낸 요청");
  await page.locator(".composer .send").click();
  await expect.poll(() => started).toBe(true);

  // The follow-up is the turn the worker is running, so the session must show it
  // and must not fall back to the finished row the stale list still reports.
  await expect(badge).toHaveText("실행 중");
  await expect(badge).toHaveText("실행 중", { timeout: 12_000 });
});

// A turn started by the message queue is not initiated by this browser, so the
// session can only learn about it from the queue's activeTask report. The queue
// item disappears at dispatch, which used to end the watch before the new task
// was reported.
test("a queued turn moves the open session onto the task the queue started", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("claudex-ui-locale", "ko");
    class SilentEventSource { constructor(public url: string) {} addEventListener() {} close() {} }
    Object.defineProperty(globalThis, "EventSource", { value: SilentEventSource, configurable: true });
  });

  const now = new Date().toISOString();
  const threadId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const base = {
    provider: "claude", threadId, providerSessionId: threadId, projectId: "project",
    result: null, error: null, log: "", owned: true, ownership: "claudex-workhouse",
    source: "claudex-workhouse", executionHostId: "local", workspaceId: "workspace",
    metadata: {}, canMutate: true, title: "큐 세션"
  };
  const finished = { ...base, id: "claude:queue-finished", nativeId: "qf", status: "completed", prompt: "먼저", createdAt: now, updatedAt: now };
  const started = { ...base, id: "claude:queue-started", nativeId: "qs", status: "running", prompt: "큐에서 시작", createdAt: new Date(Date.parse(now) + 2000).toISOString(), updatedAt: new Date(Date.parse(now) + 2000).toISOString() };

  let dispatched = false;
  setTimeout(() => { dispatched = true; }, 1500);
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const json = (value: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(value) });
    // The dispatcher publishes the turn it started into the list snapshot, which
    // is how a browser that did not send the message learns about it at all.
    if (pathname === "/api/tasks") return json({ tasks: dispatched ? [started, finished] : [finished], partial: false, warnings: [], snapshot: true });
    if (pathname === "/api/tasks/claude/claude%3Aqueue-started") return json({ task: started });
    if (pathname === "/api/tasks/claude/claude%3Aqueue-finished") return json({ task: finished });
    // The item is already gone at this point; only activeTask reveals the turn.
    if (pathname.endsWith("/message-queue")) return json({ items: [], activeTask: dispatched ? started : finished });
    if (pathname.endsWith("/events")) return json({ taskId: dispatched ? started.id : finished.id, status: dispatched ? "running" : "completed", latestSequence: 0, events: [] });
    if (pathname === "/api/projects") return json({ projects: [{ id: "project", name: "Project", enabled: true, error: null }] });
    if (pathname === "/api/hosts") return json({ hosts: [{ id: "local", displayName: "Local", status: "online", platform: "linux" }] });
    if (pathname === "/api/workspaces" || pathname === "/api/location-options") return json({ projects: [{ id: "project", name: "Project", enabled: true, error: null }], workspaces: [{ id: "workspace", projectId: "project", hostId: "local", displayName: "Workspace", canonicalPath: "/workspace" }] });
    if (pathname === "/api/collaborations") return json({ collaborations: [] });
    if (pathname === "/api/quota") return json({ claude: {}, codex: {}, fetchedAt: now });
    if (pathname === "/api/emotion") return json({ state: {}, codexState: {}, outfits: [], assets: [], mode: "catch" });
    if (pathname.startsWith("/api/system-settings/")) return json({ settings: null, candidates: { claude: [], codex: [] } });
    return json({});
  });

  await page.goto("/?task=claude:queue-finished", { waitUntil: "domcontentloaded" });
  const badge = page.locator(".task-heading .state-text");
  await expect(badge).toHaveText("완료");
  await expect(badge).toHaveText("실행 중", { timeout: 20_000 });
});
