import { expect, test } from "@playwright/test";

const locales = [
  { id: "ko", settings: "설정", openSettings:"설정 열기",more:"추가 작업", display: "화면·알림", language: "Language", subtitle: "GPT·Claude 노역 관리소" },
  { id: "en", settings: "Settings", openSettings:"Open settings",more:"More actions", display: "Display & notifications", language: "Language", subtitle: "GPT & Claude Agent Workhouse" },
  { id: "ja", settings: "設定", openSettings:"設定を開く",more:"その他の操作", display: "表示・通知", language: "Language", subtitle: "GPT・Claude作業管理所" }
] as const;

for (const locale of locales) {
  test(`${locale.id} brand, language setting, and mobile layout`, async ({ page }, testInfo) => {
    page.setDefaultTimeout(10_000);
    await page.addInitScript((id) => localStorage.setItem("claudex-ui-locale", id), locale.id);
    await page.route("https://assets.example.com/emoticons/**", async (route) => route.fulfill({
      contentType: "image/png",
      body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
    }));
    await page.route("**/api/bootstrap/owner-claim/status",async route=>route.fulfill({contentType:"application/json",body:JSON.stringify({required:false})}));
    await page.route("**/api/system-settings/locale", async (route) => {
      const selected = route.request().method() === "PUT"
        ? (route.request().postDataJSON() as { locale?: string })?.locale ?? locale.id
        : locale.id;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ locale: selected, saved: true, existingInstallation: true, updatedAt: new Date().toISOString() })
      });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const brand = page.getByRole("banner").locator(".brand");
    await expect(brand).toHaveAttribute("aria-label", "Claudex Workhouse");
    await expect(brand.locator("small")).toHaveText(locale.subtitle);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

    const banner=page.getByRole("banner"),more=banner.getByRole("button",{name:locale.more,exact:true});
    if(await more.isVisible())await more.click();
    await page.getByRole("button", { name: locale.openSettings, exact: true }).click();
    const settings = page.locator(".global-settings");
    await expect(settings.getByRole("heading", { name: locale.settings, exact: true })).toBeVisible();
    const tabs = settings.locator(".settings-tabs");
    if (await tabs.evaluate(element => element.scrollWidth - element.clientWidth > 1)) {
      // Overflowing tab strips must be draggable with a mouse, not scrollbar-only.
      const box = (await tabs.boundingBox())!;
      const y = box.y + box.height / 2;
      await page.mouse.move(box.x + box.width - 12, y);
      await page.mouse.down();
      await page.mouse.move(box.x + 12, y, { steps: 8 });
      await page.mouse.up();
      expect(await tabs.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    }
    await settings.getByRole("button", { name: locale.display, exact: true }).click();
    const language = settings.getByLabel(locale.language, { exact: true });
    await expect(language).toHaveValue(locale.id);
    await expect(language.locator("option")).toHaveText(["한국어", "English", "日本語"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `test-results/${testInfo.project.name}-${locale.id}-settings.png`, fullPage: true });
  });
}
