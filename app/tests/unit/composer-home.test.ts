import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSay } from "../../src/web/create-summary";
import { en } from "../../src/web/i18n/en";
import { ko } from "../../src/web/i18n/ko";
import { ja } from "../../src/web/i18n/ja";

const web = (file: string) => fs.readFileSync(path.join(process.cwd(), "src", "web", file), "utf8");
const app = web("App.svelte");
const styles = web("styles.css");
const picker = web("ModelPicker.svelte");
const dialog = app.slice(app.indexOf('<div class="modal create-panel create-composer"'), app.indexOf("{#if toneSheetProvider}"));
const home = app.slice(app.indexOf("{:else if overviewOpen}"), app.indexOf('{#if engine!=="codex"||!codexDetailOpen}'));

describe("prompt-first composer", () => {
  it("puts the request first, states the run as one sentence of tokens, and folds the rest under 고급", () => {
    const textarea = dialog.indexOf('<textarea class="composer-textarea"');
    const sentence = dialog.indexOf('<p class="composer-sentence">');
    const advanced = dialog.indexOf('<details class="composer-advanced" id="create-automation" bind:open={createAdvancedOpen}>');
    expect(textarea).toBeGreaterThan(0);
    expect(sentence).toBeGreaterThan(textarea);
    expect(advanced).toBeGreaterThan(sentence);
    // Agent·model, workspace, and automation are the three tokens; the branch is read-only.
    expect(dialog).toContain('{:else if part.name==="agent"}<ModelPicker fields={["provider","model"]} layout="tokens"');
    expect(dialog).toContain('<select id="create-workspace" aria-label={$t("create.workLocation")}');
    expect(dialog).toContain('<select aria-label={$t("automation.level")} value={createAutomationNow}');
    expect(dialog).toContain('<ModelPicker fields={["effort","tier"]} layout="row"');
    expect(dialog).toContain('id="create-host"');
    expect(dialog).toContain('<span class="composer-branch">{createBranch()??$t("common.unknown")}</span>');
    expect(dialog).toContain('<Switch checked={createWorkModeNow==="plan"} label={$t("workMode.plan")}');
    expect(dialog).toContain('<summary><span>{$t("create.advanced")}</span><small>{createAdvancedSummary}</small></summary>');
    // The old quick-create branch and the single-kind chip sections are gone.
    expect(app).not.toContain("let quickCreate");
    expect(app).not.toContain("class:quick-create");
    expect(styles).not.toContain(".quick-create-summary");
    expect(dialog).not.toContain('<h4 class="cover">{$t("create.sectionEngine")}</h4>');
    // The session-type tabs stay, and the other kinds keep their sentence summary.
    expect(dialog).toContain('<div class="create-kinds" role="group" aria-label={$t("create.sessionType")}>');
    expect(dialog).toContain('<p class="create-say">');
  });

  it("starts with 시작 and ⌘Enter / Ctrl+Enter regardless of the Enter-to-send preference", () => {
    expect(dialog).toContain('createKind==="single"?$t("create.start"):');
    expect(dialog).toContain('<kbd class="composer-shortcut" aria-hidden="true">{$t("create.submitShortcut")}</kbd>');
    expect(app).toContain('const modifierEnter=event.key==="Enter"&&(event.metaKey||event.ctrlKey)&&!event.altKey&&!event.isComposing;if(!(modifierEnter||shouldSubmitOnEnter(event,enterToSend))||');
  });

  it("renders the sentence from the dictionary so every locale orders its own tokens", () => {
    for (const locale of [ko, en, ja]) {
      const names = buildSay(locale["create.composerSentence"], { agent: "Codex", workspace: "repo", automation: "auto" }).filter(part => part.kind !== "text").map(part => (part as { name: string }).name);
      expect(names).toEqual(["agent", "workspace", "automation"]);
    }
    expect(app).toContain('buildSay($t("create.composerSentence"),{agent:providerDisplayName(createProvider),workspace:createWorkspaceLabel(),automation:automationLabel(createAutomationNow)})');
    // A Korean particle follows the agent token and agrees with the agent name.
    expect(buildSay(ko["create.composerSentence"], { agent: "Codex", workspace: "repo", automation: "auto" }).map(part => part.kind === "text" ? part.value : `<${part.name}>`).join("")).toBe("<agent>가 <workspace>에서 <automation>");
  });

  it("writes model and effort back to the same per-provider variable the payload reads", () => {
    expect(app).toContain('function setCreateModel(value:string){if(createProvider==="codex"){createModel=value;createModelChanged();}else if(createProvider==="claude")createClaudeModel=value;else setCreateCompatibleModel(createProvider as CompatibleExecutionProvider,value);}');
    expect(app).toContain('function setCreateEffort(value:string){if(createProvider==="codex")createEffort=value;else if(createProvider==="claude")createClaudeEffort=value;else createCompatibleEfforts={...createCompatibleEfforts,[createProvider]:value};}');
  });
});

describe("shared model picker", () => {
  it("chooses agent → model → effort → speed with labelled selects and no fetching", () => {
    expect(picker).toContain('export let fields: Field[] = ["provider", "model", "effort", "tier"];');
    for (const key of ["create.engine", "model.label", "model.reasoningEffort", "model.speed"]) expect(picker).toContain(`aria-label={$t("${key}")}`);
    expect(picker).not.toMatch(/fetch\(|api\(/);
    expect(picker).toContain('{#if has("tier") && hasPriority}');
    expect(picker).toContain('{#if effortEmptyLabel !== null}<option value="">{effortEmptyLabel}</option>{/if}');
  });

  it("is the one picker behind new task, session settings, assist, delegation, and agent defaults", () => {
    expect(web("SessionSettingsFields.svelte")).toContain('<ModelPicker fields={["model","effort","tier"]} layout="stack"');
    expect(web("ProviderExecutionPicker.svelte")).toContain('<ModelPicker fields={["provider","model","effort","tier"]} layout="stack"');
    expect(web("ProviderExecutionPicker.svelte")).not.toContain('role="tablist"');
    const policy = web("settings/ExecutionPolicyPage.svelte");
    expect(policy).toContain('<ModelPicker fields={["model","effort"]} layout="stack" provider="claude"');
    expect(policy).toContain('<ModelPicker fields={["model","effort","tier"]} layout="stack" provider="codex"');
    expect(policy).toContain('effortEmptyLabel={$t("model.selectedDefault")}');
    const provider = web("settings/ProviderPage.svelte");
    expect(provider).toContain('idPrefix="defaults-codex" onmodel={() => globalCodexModelChanged()}');
    expect(provider).toContain('idPrefix="defaults-claude"');
    expect(provider).toContain("idPrefix={`defaults-${compatible}`}");
    expect(provider).toContain('idPrefix="delegation-codex"');
    // Review and conversation participants use the same picker per block.
    expect(dialog.match(/<ModelPicker fields=\{\["model","effort"(?:,"tier")?\]\} layout="row" size="sm"/g)).toHaveLength(6);
    expect(dialog).not.toContain('<label class="cf">{$t("model.label")}<select');
  });
});

describe("home", () => {
  it("leads with the summary line and four KPI tiles, then 확인 필요 → 실행 중 → 최근 완료", () => {
    expect(home).toContain('<p class="home-line">{$t("home.summaryLine",{running:overviewRunning.length,waiting:overviewWaiting.length})}</p>');
    expect(home.match(/<button type="button" class="home-kpi"/g)).toHaveLength(4);
    for (const key of ["home.kpi.running", "home.kpi.completedToday", "home.kpi.uncommitted", "home.kpi.workers"]) expect(home).toContain(`{$t("${key}")}`);
    const attention = home.indexOf('<section class="overview-panel home-attention">');
    const running = home.indexOf('<section class="overview-panel overview-active"');
    const recent = home.indexOf('<section class="overview-panel overview-recent">');
    const quick = home.indexOf('<section class="overview-panel overview-quick">');
    const workspaces = home.indexOf('<section class="overview-panel home-workspaces">');
    expect(attention).toBeGreaterThan(0);
    expect(running).toBeGreaterThan(attention);
    expect(recent).toBeGreaterThan(running);
    expect(quick).toBeGreaterThan(recent);
    expect(workspaces).toBeGreaterThan(quick);
    expect(home).toContain('<StatusBadge state="attention"/>');
    expect(home).toContain('density={overviewExpandedTaskId===task.id?"full":"compact"}');
    expect(home).toContain('{@const overviewDirty=workspaces.filter(item=>Boolean(item.lastGitStatus?.dirty)).length}');
    expect(home).toContain('{$t("home.workspaceDirty",{count:Array.isArray(workspace.lastGitStatus?.changedFiles)?workspace.lastGitStatus.changedFiles.length:0})}');
  });

  it("keeps the compact running rows alive with a sparkline and the elapsed time", () => {
    const panel = web("TaskLivenessPanel.svelte");
    expect(panel).toContain('<span class="liveness-compact-line"><span class="liveness-spark" aria-hidden="true">');
    expect(panel).toContain('<b class="liveness-elapsed">{duration()}</b>');
    expect(styles).toContain(".liveness-compact-line .liveness-spark{flex:1;max-width:180px;height:14px;gap:3px}");
  });

  it("defines every composer and home key in all three locales", () => {
    const keys = Object.keys(en).filter(key => key.startsWith("home.") || ["create.composerSentence", "create.start", "create.submitShortcut", "create.advanced", "create.branch", "create.branchHelp", "create.planFirstHelp", "create.agentToken"].includes(key));
    expect(keys.length).toBeGreaterThanOrEqual(20);
    for (const key of keys) {
      expect(ko[key as keyof typeof ko], key).toBeTruthy();
      expect(ja[key as keyof typeof ja], key).toBeTruthy();
    }
  });
});
