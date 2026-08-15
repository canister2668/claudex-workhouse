import { expect, test } from "@playwright/test";

test("new session review exposes provider settings, per-review tones, and explicit Fast usage", async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => localStorage.setItem("claudex-ui-locale", "ko"));
  await page.goto("/");
  const finishOwnerSetup = page.getByRole("button", { name: "이 PC를 관리자로 등록하고 계속", exact: true });
  if (await finishOwnerSetup.isVisible()) await finishOwnerSetup.click();

  await page.getByRole("button", { name: "작업 생성", exact: true }).click();
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
    await expect(settings.getByLabel("모델")).toBeVisible();
    await expect(settings.getByLabel("추론 강도")).toBeVisible();
    await expect(settings.getByLabel("캐릭터 톤")).toBeVisible();
  }

  const codex = dialog.locator('.cwho[data-provider="codex"]');
  await expect(codex.getByRole("button", { name: "Fast · 1.5× 사용량", exact: true })).toBeVisible();
  await codex.getByLabel("캐릭터 톤").click();
  const toneSheet = page.getByRole("dialog", { name: /Codex.*말투/ });
  await expect(toneSheet.getByRole("button", { name: /글로벌 설정 그대로/ })).toBeVisible();
  await toneSheet.getByRole("button", { name: "비서 모드", exact: true }).click();
  await toneSheet.getByRole("button", { name: "완료", exact: true }).click();
  await expect(codex.getByLabel("캐릭터 톤")).toContainText("비서 모드");
  await expect(codex.getByLabel("캐릭터 톤")).toContainText("이 세션만");
});
