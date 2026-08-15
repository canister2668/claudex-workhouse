import { describe, expect, it } from "vitest";
import { localizedTaskSuffix, normalizeStoredLocale, supportedLocaleSchema, uiLocaleSettingsSchema } from "../../src/server/ui-locale.js";

describe("ui locale settings", () => {
  it.each(["ko", "en", "ja"])("accepts %s", (locale) => {
    expect(supportedLocaleSchema.parse(locale)).toBe(locale);
  });

  it("rejects unsupported locales on the server", () => {
    expect(uiLocaleSettingsSchema.safeParse({ locale: "zh" }).success).toBe(false);
    expect(normalizeStoredLocale({ locale: "fr" })).toBeNull();
  });

  it("localizes server-generated task suffixes",()=>{expect(localizedTaskSuffix("en","compact")).toBe("Context compact");expect(localizedTaskSuffix("ja","controlHandoff")).toBe("制御の引き継ぎ");});
});
