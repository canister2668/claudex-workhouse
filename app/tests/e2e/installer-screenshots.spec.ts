import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const installerRoot = "/installer-web/dist";
const imageRoot = "/docs/images/install";

function contentType(file: string): string {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".sig")) return "application/octet-stream";
  return "text/plain; charset=utf-8";
}

test("capture sanitized Docker installation flow", async ({ page }) => {
  test.skip(process.env.CLAUDEX_CAPTURE_INSTALLER !== "1", "installer screenshots are generated only on request");
  fs.mkdirSync(imageRoot, { recursive: true });
  await page.route("https://installer.demo/**", async (route) => {
    const url = new URL(route.request().url());
    const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (relative.includes("..")) return route.abort();
    const file = path.join(installerRoot, ...relative.split("/"));
    if (!file.startsWith(`${installerRoot}${path.sep}`) || !fs.existsSync(file)) {
      return route.fulfill({ status: 404, body: "Not found" });
    }
    return route.fulfill({ status: 200, contentType: contentType(file), body: fs.readFileSync(file) });
  });

  await page.goto("https://installer.demo/");
  await expect(page.locator(".release.verified")).toContainText("서명 검증 완료");
  // Every Windows target is in development, so the installer offers the Docker
  // routes only and renders the rest as disabled cards.
  await expect(page.locator(".platforms.in-development button")).toHaveCount(3);
  await expect(page.locator(".platforms.in-development button").first()).toBeDisabled();
  for (const checkbox of await page.locator('[data-check]').all()) await checkbox.check();
  await page.screenshot({ path: `${imageRoot}/synology.ko.png`, fullPage: true, animations: "disabled" });

  await page.locator('[data-platform="linux"]').click();
  for (const checkbox of await page.locator('[data-check]').all()) await checkbox.check();
  await page.screenshot({ path: `${imageRoot}/linux.ko.png`, fullPage: true, animations: "disabled" });
});
