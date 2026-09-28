import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectChangedFiles, readSessionPanelOpen, SESSION_PANEL_DEFAULT_OPEN_WIDTH, SESSION_PANEL_STORAGE_KEY, sessionPanelAvailable, writeSessionPanelOpen } from "../../src/web/session-panel.js";

const web=(file:string)=>fs.readFileSync(path.join(process.cwd(),"src","web",file),"utf8");
const memoryStorage=(initial:Record<string,string>={})=>{
  const values=new Map(Object.entries(initial));
  return{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},values};
};

describe("left session panel preference",()=>{
  it("starts open on wide screens and closed below 1280px when nothing is saved",()=>{
    expect(SESSION_PANEL_DEFAULT_OPEN_WIDTH).toBe(1280);
    expect(readSessionPanelOpen(memoryStorage(),1280)).toBe(true);
    expect(readSessionPanelOpen(memoryStorage(),1920)).toBe(true);
    expect(readSessionPanelOpen(memoryStorage(),1279)).toBe(false);
    expect(readSessionPanelOpen(null,900)).toBe(false);
  });

  it("remembers an explicit open or closed choice at every width",()=>{
    const storage=memoryStorage();
    writeSessionPanelOpen(storage,false);
    expect(storage.values.get(SESSION_PANEL_STORAGE_KEY)).toBe("closed");
    expect(readSessionPanelOpen(storage,1920)).toBe(false);
    writeSessionPanelOpen(storage,true);
    expect(storage.values.get(SESSION_PANEL_STORAGE_KEY)).toBe("open");
    expect(readSessionPanelOpen(storage,1000)).toBe(true);
  });

  it("falls back to the width default when storage is unreadable or holds junk",()=>{
    const broken={getItem:()=>{throw new Error("blocked");},setItem:()=>{throw new Error("blocked");}};
    expect(readSessionPanelOpen(broken,1440)).toBe(true);
    expect(()=>writeSessionPanelOpen(broken,true)).not.toThrow();
    expect(readSessionPanelOpen(memoryStorage({[SESSION_PANEL_STORAGE_KEY]:"maybe"}),1000)).toBe(false);
  });

  it("only shows where it adds a way to jump between sessions",()=>{
    const base={compactShell:false,settingsOpen:false,viewerSplit:false,sessionsListView:false};
    expect(sessionPanelAvailable(base)).toBe(true);
    expect(sessionPanelAvailable({...base,compactShell:true})).toBe(false);
    expect(sessionPanelAvailable({...base,settingsOpen:true})).toBe(false);
    expect(sessionPanelAvailable({...base,viewerSplit:true})).toBe(false);
    expect(sessionPanelAvailable({...base,sessionsListView:true})).toBe(false);
  });

  it("toggles from the header's left edge and persists the choice",()=>{
    const app=web("App.svelte");
    const header=app.slice(app.indexOf('<header class="mobile-topbar app-topbar">'),app.indexOf("</header>",app.indexOf('<header class="mobile-topbar app-topbar">')));
    expect(header.indexOf('class="icon-button session-panel-toggle"')).toBeGreaterThan(-1);
    expect(header.indexOf('class="icon-button session-panel-toggle"')).toBeLessThan(header.indexOf("{@render brandBlock()}"));
    expect(app).toContain("function toggleSessionPanel(){sessionPanelOpen=!sessionPanelOpen;writeSessionPanelOpen(localStorage,sessionPanelOpen);}");
    expect(app).toContain("let sessionPanelOpen=readSessionPanelOpen(");
    expect(app).toContain('class:session-panel-open={sessionPanelShown}');
    expect(app).toContain("{#if sessionPanelShown}{@render sessionPanel()}{/if}");
  });

  it("reuses the sessions list data and keeps the chosen tab when a row opens",()=>{
    const app=web("App.svelte");
    const panel=app.slice(app.indexOf("{#snippet sessionPanel()}"),app.indexOf("{/snippet}",app.indexOf("{#snippet sessionPanel()}")));
    expect(panel).toContain("browserRows.slice(0,SESSION_PANEL_ROW_LIMIT)");
    expect(panel).toContain("onclick={()=>selectPanelEngine(item[0])}");
    expect(panel).toContain("onclick={()=>selectViewTab(tab,selectPanelEngine)}");
    expect(panel).toContain("oninput={(event)=>updateSearchQuery(event.currentTarget.value)}");
    expect(panel).toContain('class:current={key===sessionPanelCurrent} aria-current={key===sessionPanelCurrent?"page":undefined}');
    expect(panel).toContain("onclick={()=>void openFromSessionPanel(entry)}");
    // Filtering in the panel never navigates or closes the session on screen.
    expect(app).toContain("const selectPanelEngine=(value:typeof engine)=>setEngine(value,true);");
    expect(app).toContain("function selectEngine(value:typeof engine){closeOverlayView();overviewOpen=false;setEngine(value);}");
    expect(app).toContain("const narrowTab=engine!==\"all\"&&engine!==task.provider;");
    expect(app).toContain("if(narrowTab)engine=task.provider;");
    expect(app).toContain("await openTask(entry.task);await tick();");
    // A native Codex session stays on screen while the panel shows another tab.
    expect(app).toContain('hidden={engine!=="codex"&&!codexDetailOpen}><CodexSessions active={engine==="codex"||codexDetailOpen}');
  });

  it("pushes the content on desktop while the header keeps its full-width row",()=>{
    const styles=web("styles.css");
    expect(styles).toContain(".shell{--session-panel-width:300px}");
    expect(styles).toContain(".shell.session-panel-open{padding-left:var(--session-panel-width)}");
    expect(styles).toContain(".shell.session-panel-open>.app-topbar{margin-left:calc(-1 * var(--session-panel-width))}");
    expect(styles).toMatch(/\.session-panel\{position:fixed;[^}]*top:var\(--topbar-height\);[^}]*width:var\(--session-panel-width\)/);
  });
});

describe("changed files chip",()=>{
  it("rolls file events up per path with live +/- totals",()=>{
    const files=collectChangedFiles([
      {type:"file_change_started",metadata:{path:"src/a.ts",pathBase:"workspace",additions:3,deletions:1}},
      {type:"message_completed",metadata:{path:"ignored.ts"}},
      {type:"file_change_completed",metadata:{path:"src/a.ts",pathBase:"workspace",additions:2,deletions:0}},
      {type:"file_change_completed",metadata:{path:"src/b.ts",pathBase:"task-cwd",additions:1}},
      {type:"file_change_completed",metadata:{path:""}},
    ]);
    expect(files).toEqual([
      {path:"src/a.ts",add:5,del:1,pathBase:"workspace"},
      {path:"src/b.ts",add:1,del:0,pathBase:"task-cwd"},
    ]);
    expect(collectChangedFiles([])).toEqual([]);
  });

  it("marks a path reported under two bases as unresolved so it is not opened",()=>{
    const [file]=collectChangedFiles([
      {type:"file_change_completed",metadata:{path:"x.ts",pathBase:"workspace"}},
      {type:"file_change_completed",metadata:{path:"x.ts",pathBase:"task-cwd"}},
    ]);
    expect(file.pathBase).toBe("unresolved");
    expect(collectChangedFiles([{type:"file_change_completed",metadata:{path:"y.ts",pathBase:"elsewhere"}}])[0].pathBase).toBe("unresolved");
  });

  it("hides with no changes and opens a popover on desktop or a bottom sheet on phones",()=>{
    const chip=web("ChangedFilesChip.svelte");
    expect(chip).toMatch(/\{#if files\.length\}\s*<button bind:this=\{trigger\} type="button" class="changed-files-chip"/);
    expect(chip).toContain('{$t("session.changedFilesChip", { count: files.length })}');
    expect(chip).toContain("const SHEET_WIDTH = 760;");
    expect(chip).toContain('class="changed-files-pop" class:sheet popover="manual" role="dialog"');
    expect(chip).toContain("function choose(file: ChangedFileEntry) { if (!canOpen(file)) return; close(); onopen(file); }");
    expect(chip).toContain("$effect(() => { if (!files.length) close(); });");
    const styles=web("styles.css");
    expect(styles).toContain(".changed-files-pop.sheet{left:0;right:0;bottom:0;top:auto;width:auto;");
  });

  it("sits in the task heading of both session views and opens the workspace viewer like the rail did",()=>{
    const app=web("App.svelte"),codex=web("CodexSessions.svelte");
    for(const source of [app,codex]){
      expect(source).toContain('<span class="task-heading-tools"><ChangedFilesChip files={detailFileEntries} canOpen={detailFileCanOpen} onopen={openDetailFile}/>');
      expect(source).toContain("detailFileEntries=collectChangedFiles(");
      expect(source).not.toContain("session-side-rail");
    }
    expect(app).toContain("openConversationFile({path:file.path,pathBase:file.pathBase as \"workspace\"|\"task-cwd\",sourceTaskId:selected.id})");
    expect(web("styles.css")).not.toContain(".session-side-rail");
  });
});

describe("session heading menu",()=>{
  it("keeps every former rail action and the full result behind the heading ⋯",()=>{
    const app=web("App.svelte");
    const menu=app.slice(app.indexOf("{#snippet sessionActionsMenu(task:Task)}"),app.indexOf("{/snippet}\n\n{#snippet sessionPanel()}"));
    expect(menu).toContain('<Menu label={$t("session.controls")}');
    for(const label of ['$t("outcome.viewDetails")','$t("session.fork")','$t("handoff.title")','$t("assist.chooseReviewer")','$t("handoff.workChain")','"collaborationBoard.addToBoard"','$t("pr.action")'])expect(menu).toContain(label);
    expect(app).toContain("{@render sessionActionsMenu(selected)}");
  });

  it("offers the full result from the finished work-status card",()=>{
    const conversation=web("Conversation.svelte"),app=web("App.svelte");
    expect(conversation).toContain('{#if !busy&&onviewoutcome}<button type="button" class="ui-btn ui-btn-sm work-status-outcome" onclick={()=>onviewoutcome?.()}>');
    expect(app).toContain("onviewoutcome={selectedOutcomeAvailable?showTaskOutcome:null}");
    expect(app).toContain('{#if outcomeDesktopOpen&&selectedOutcomeAvailable}<div class="outcome-in-place"><TaskOutcomeSummary {api} task={selected}');
    // The compact sheet behind the composer badge is unchanged.
    expect(app).toContain("mobileCollapsible={canContinue()&&selected.owned} mobileExpanded={outcomeMobileExpanded} mobileDismissed={outcomeMobileDismissed} hideOnWide");
  });
});
