import { expect, test } from "@playwright/test";

// The session composer grows with what is typed; the conversation input did not,
// so it stayed one line tall and scrolled internally — every line but the last
// was hidden while composing. The live conversation regression that exercises
// the real input only runs against real providers, so this measures the shipped
// stylesheet directly in the browser instead of leaving the rule unguarded.
test("the conversation input grows with its content and stops before it takes the screen", async ({ page }) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tasks: [], partial: false, warnings: [], projects: [], workspaces: [], hosts: [], collaborations: [] }) })
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const measure = await page.evaluate(async () => {
    const form = document.createElement("form");
    form.className = "conversation-input";
    const textarea = document.createElement("textarea");
    textarea.rows = 1;
    form.append(textarea);
    document.body.append(form);
    const height = () => textarea.getBoundingClientRect().height;
    const lines = (count: number) => Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n");

    const empty = height();
    textarea.value = lines(6);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const grown = height();

    textarea.value = lines(80);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const capped = height(), scrolls = textarea.scrollHeight > textarea.clientHeight;

    const sizing = getComputedStyle(textarea).getPropertyValue("field-sizing").trim();
    form.remove();
    return { empty, grown, capped, scrolls, sizing };
  });

  expect(measure.sizing).toBe("content");
  expect(measure.grown).toBeGreaterThan(measure.empty + 20);
  // Capped so the docked input cannot swallow a phone screen, and it scrolls past that.
  expect(measure.capped).toBeLessThanOrEqual(140);
  expect(measure.scrolls).toBe(true);
});
