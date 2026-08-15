import fs from "node:fs";
import path from "node:path";
import {describe,expect,it}from"vitest";

const app=fs.readFileSync(path.join(process.cwd(),"src","web","App.svelte"),"utf8");
const styles=fs.readFileSync(path.join(process.cwd(),"src","web","styles.css"),"utf8");
const conversation=fs.readFileSync(path.join(process.cwd(),"src","web","Conversation.svelte"),"utf8");
const codexSessions=fs.readFileSync(path.join(process.cwd(),"src","web","CodexSessions.svelte"),"utf8");
const activityStrip=fs.readFileSync(path.join(process.cwd(),"src","web","SessionActivityStrip.svelte"),"utf8");
const sessionStyles=fs.readFileSync(path.join(process.cwd(),"src","web","sessions.css"),"utf8");
const modelBadges=fs.readFileSync(path.join(process.cwd(),"src","web","SessionModelBadges.svelte"),"utf8");
const contextMeter=fs.readFileSync(path.join(process.cwd(),"src","web","ContextMeter.svelte"),"utf8");
const avatarDock=fs.readFileSync(path.join(process.cwd(),"src","web","AgentAvatarDock.svelte"),"utf8");

describe("workhouse overview redesign",()=>{
  it("keeps overview and session browsing as distinct, reachable views",()=>{
    expect(app).toContain("let overviewOpen=liveWorkRedesignEnabled()");
    expect(app).toContain('class:active={overviewOpen} onclick={openOverview}');
    expect(app).not.toContain('{#if !selected&&!selectedCollaboration&&!codexDetailOpen}\n      <nav class="primary-nav"');
    expect(app).toContain("function closeCurrentDetail()");
    expect(app).not.toContain('["conversation",$t("nav.conversation")]');
    expect(app).toContain('{#if engine!=="conversation"}');
  });

  it("uses task and host state instead of decorative progress data",()=>{
    expect(app).toContain("latestThreadRows(overviewTasks).filter(task=>active.has(task.status))");
    expect(app).toContain("<TaskLivenessPanel {task}");
    expect(app).toContain("{#each hosts as host}");
    expect(app).not.toContain("overview-progress");
  });

  it("provides mobile navigation and reduced-motion behavior",()=>{
    expect(app).toContain("class:overview-open=");
    expect(app).toContain("selected=data.task;overviewOpen=false;events=[];finishCreateForm()");
    expect(app).not.toContain("suppressAutomaticNotices=");
    expect(styles).toContain(".shell.overview-open .agent-status-tray .tray-item.auto{display:none}");
    expect(avatarDock).toContain("orderedItems.filter(item=>connectedProviders[item.provider]&&!detached(item.provider,floatingPinned,floatingPositions))");
    expect(avatarDock).not.toContain("floatingPinned[item.provider]||!suppressAutomaticNotices");
    expect(styles).toContain(".primary-nav{position:fixed");
    expect(styles).toContain(".shell.detail-open{padding-bottom:calc(74px + env(safe-area-inset-bottom))}");
    expect(sessionStyles).toContain(".conversation-control-dock{bottom:calc(72px + env(safe-area-inset-bottom));");
    expect(styles).toContain(".shell:not(.detail-open){padding-bottom:");
    expect(styles).toContain(".overview-task-card,.task-card{transition:none}");
  });

  it("shows real active-work visibility in session lists and task details",()=>{
    expect(app).toContain("class:active-task={active.has(task.status)}");
    expect(app).toContain("<SessionActivityStrip provider={task.provider} taskId={task.id}");
    expect(app.match(/<TaskLivenessPanel/g)).toHaveLength(1);
    expect(codexSessions).toContain("class:active-task={activeStatus(item.status)}");
    expect(codexSessions).not.toContain("<TaskLivenessPanel");
    expect(app).toContain('class="task-list session-browser-list"');
    expect(codexSessions).toContain('class="session-list session-browser-list"');
    expect(app).toContain("<SessionModelBadges provider={task.provider}");
    expect(codexSessions).toContain('<SessionModelBadges provider="codex"');
    expect(codexSessions).not.toContain('class="settings-line"');
    expect(modelBadges).toContain('class="session-model-chip model"');
    expect(sessionStyles).toContain(".session-card.active-task .preview{display:none}");
    expect(sessionStyles).toContain(".session-browser-list{width:100%;max-width:var(--page-max);margin-inline:auto;padding:18px 22px 110px");
    expect(sessionStyles).toContain("flex-direction:column;gap:16px");
    expect(sessionStyles).toContain(".session-card{min-height:112px}");
    expect(sessionStyles).not.toContain(".session-card.terminal-task{min-height:58px");
    expect(styles).not.toContain(".task-card.terminal-task{min-height:64px");
    expect(sessionStyles).toContain("flex-wrap:nowrap;overflow:hidden;white-space:nowrap");
    expect(activityStrip).toContain("<HeartbeatBar");
    expect(activityStrip).toContain("subscribeTaskLiveness");
    expect(conversation).toContain("processVisibility(processRows,provider,sourceTaskId,liveMode)");
    expect(conversation).toContain("statusVisibility.commandCount");
    expect(conversation).toContain('class="work-status-badge"');
    expect(conversation).toContain("buildProgressRows(processRows)");
    expect(conversation).toContain("<BuildProgressCard {build}/>");
    expect(activityStrip).toContain("streamEnabled");
    expect(app).toContain('class="path-tail-ellipsis" title={file.path} dir="rtl"');
    expect(codexSessions).toContain('class="path-tail-ellipsis" title={file.path} dir="rtl"');
    expect(styles).toContain(".path-tail-ellipsis{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}");
    expect(conversation).not.toContain('class="process-panel"');
    expect(conversation).toContain('class="provider-quota {quotaTone}"');
    expect(conversation).toContain("providerQuota?.fiveHour??providerQuota?.sevenDay??null");
    expect(conversation).toContain('`${$t("quota.weekly")} ${$t("quota.label")}`');
    expect(conversation).not.toContain('class="session-quota');
    expect(contextMeter).toContain("class:context-window-card={open}");
    expect(contextMeter).toContain("onclick={()=>open=!open}");
    expect(contextMeter).toContain("{#if !open}");
    expect(conversation).toContain("deriveTaskLiveness(rows");
    expect(conversation).toContain("<HeartbeatBar lastEventAt=");
    expect(conversation).not.toContain("overview-progress");
  });

  it("surfaces Codex parallel agents in the task panel, the session list, and the conversation",()=>{
    const livenessPanel=fs.readFileSync(path.join(process.cwd(),"src","web","TaskLivenessPanel.svelte"),"utf8");
    // Task panel: roster at full density, chips when the card is compressed,
    // and a waiting child promoted onto the parent card at every density.
    expect(livenessPanel).toContain('{#if state.agentTally.total&&density==="full"}');
    expect(livenessPanel).toContain('{#if state.agentTally.total&&density!=="full"}{@render agentChips()}{/if}');
    expect(livenessPanel).toContain("{#if waitingAgent}");
    expect(livenessPanel).toContain('$t("fanout.waitingAgent",{name:waitingAgent.name})');
    expect(livenessPanel).toContain("rootThreadId:task.threadId??null");
    expect(livenessPanel).toContain("sortAgentsByAttention(state.agents)");
    // Session list reads the worker roll-up instead of opening a stream per row.
    expect(app).toContain("const fanoutSummary=(task:Task)=>{");
    expect(app).toContain('{#if fanoutSummary(task)}{@const fanout=fanoutSummary(task)!}<span class="fanout-badge"');
    // Conversation: pinned bar survives scrolling past the spawning turn.
    expect(conversation).toContain('{#if fanoutBarVisible}');
    expect(conversation).toContain("$: fanoutBarVisible=parallelAgentsActive(liveAgents);");
    expect(conversation).toContain("$: if(!fanoutBarVisible&&lanesOpen)lanesOpen=false;");
    expect(conversation).toContain("{#if liveAgents.length>2}");
    expect(conversation).toContain("sortAgentsByAttention(parallelAgentCards(turn.process,rootThreadId))");
    expect(conversation).toContain('class="parallel-agent-elapsed"');
    expect(conversation).toContain('aria-expanded={lanesOpen}');
    expect(conversation).toContain('fanout.detailsClose":"fanout.details');
    expect(styles).toContain(".fanout-sticky{position:sticky;top:0;");
    expect(styles).toContain(".fanout-lanes{max-height:min(38dvh,340px)");
    expect(styles).toContain(".parallel-agent-row.waiting{border-left-color:var(--amber)}");
  });

  it("keeps the background Codex browser safe when session identities collide or its detail closes",()=>{
    expect(codexSessions).toContain("{#each pageSessions as item}");
    expect(codexSessions).not.toContain('{#each pageSessions as item (`${item.threadId??"job"}:${item.jobId??""}`)}');
    expect(codexSessions).toContain('request={selected?.preview??""}');
    expect(codexSessions).toContain('{#key selected?.threadId??selected?.taskId??"closed"}');
  });
});
