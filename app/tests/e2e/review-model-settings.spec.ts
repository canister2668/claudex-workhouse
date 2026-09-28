import { expect, test } from "@playwright/test";

test("new session review exposes provider settings, per-review tones, and explicit Fast usage", async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => localStorage.setItem("claudex-ui-locale", "ko"));
  // New-session paths only offer connected providers. Report the participants
  // this spec configures as connected instead of relying on the server's own
  // credentials (a fresh managed E2E server has none of them).
  await page.route("**/api/provider-connections", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ singleUser: true, attempts: [], accounts: ["codex", "claude", "antigravity", "deepseek", "ollama"].map((provider) => ({ provider, state: "connected", checkedAt: new Date().toISOString() })) })
  }));
  // A fresh managed server would otherwise open its first-run setup wizard over the dialog.
  await page.route("**/api/setup", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ required: false }) }));
  // Codex's 속도 control appears only for a catalog model that offers the priority tier.
  await page.route("**/api/providers/codex/models", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ catalog: { models: [{ id: "gpt-review", model: "gpt-review", displayName: "GPT Review", hidden: false, isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "medium" }], serviceTiers: [{ id: "priority", name: "priority" }], defaultServiceTier: null }], permissions: [], fetchedAt: new Date().toISOString(), stale: false } })
  }));
  await page.goto("/");
  const finishOwnerSetup = page.getByRole("button", { name: "이 PC를 관리자로 등록하고 계속", exact: true });
  const createButton = page.getByRole("button", { name: "작업 생성", exact: true });
  // A fresh server first asks to register the owner; wait for either screen.
  await expect(finishOwnerSetup.or(createButton)).toBeVisible();
  if (await finishOwnerSetup.isVisible()) await finishOwnerSetup.click();

  await createButton.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator(".create-kinds").getByRole("button", { name: "검토", exact: true }).click();

  // Participants are chips, and each selected participant owns a settings block
  // marked with its provider id rather than a nested fieldset.
  const participants = dialog.locator("#create-provider .chips");
  for (const provider of ["Gemini", "DeepSeek", "Ollama"]) {
    const button = participants.getByRole("button", { name: provider, exact: true });
    await button.click();
    await expect(button).toHaveClass(/active/);
  }

  for (const [provider, id] of [["Gemini", "antigravity"], ["DeepSeek", "deepseek"], ["Ollama", "ollama"]]) {
    const settings = dialog.locator(`.cwho[data-provider="${id}"]`);
    await expect(settings, provider).toBeVisible();
    await expect(settings.getByLabel("모델", { exact: true })).toBeVisible();
    await expect(settings.getByLabel("추론 강도", { exact: true })).toBeVisible();
    await expect(settings.getByLabel("캐릭터 톤", { exact: true })).toBeVisible();
  }

  const codex = dialog.locator('.cwho[data-provider="codex"]');
  await expect(codex.getByLabel("속도", { exact: true })).toBeVisible();
  await expect(codex.getByLabel("속도", { exact: true }).locator("option", { hasText: "빠르게" })).toHaveCount(1);
  await codex.getByLabel("캐릭터 톤", { exact: true }).click();
  const toneSheet = page.getByRole("dialog", { name: /Codex.*말투/ });
  await expect(toneSheet.getByRole("button", { name: /글로벌 설정 그대로/ })).toBeVisible();
  await toneSheet.getByRole("button", { name: "비서 모드", exact: true }).click();
  await toneSheet.getByRole("button", { name: "완료", exact: true }).click();
  await expect(codex.getByLabel("캐릭터 톤", { exact: true })).toContainText("비서 모드");
  await expect(codex.getByLabel("캐릭터 톤", { exact: true })).toContainText("이 세션만");
});
