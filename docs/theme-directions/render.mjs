// Renders the skin gallery for each direction. Run from anywhere; Playwright is
// resolved from app/node_modules.
import { createRequire } from "node:module";
import fs from "node:fs";

const require = createRequire(new URL("../../app/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const here = new URL("./", import.meta.url);
const gallery = new URL("./gallery.html", here);
if (!fs.existsSync(gallery)) throw new Error("gallery.html is missing");

const browser = await chromium.launch();
for (const dir of ["", "a", "b", "c"]) {
  for (const theme of ["light", "dark"]) {
    if (dir === "" && theme === "dark") continue;
    const page = await browser.newPage({ viewport: { width: 1320, height: 900 }, deviceScaleFactor: 1.5 });
    await page.goto(`${gallery.href}?theme=${theme}${dir ? `&dir=${dir}` : ""}`);
    await page.waitForTimeout(700);
    await page.screenshot({ path: new URL(`./shot-${dir || "now"}-${theme}.png`, here).pathname, fullPage: true });
    await page.close();
  }
}
await browser.close();
console.log("rendered");
