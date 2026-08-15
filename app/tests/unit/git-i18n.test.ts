import { describe, expect, it } from "vitest";
import { GIT_TRANSLATIONS, GIT_TRANSLATION_KEYS } from "../../src/web/git-i18n";

describe("Git translations",()=>{
  it("provides every required key in Korean, English, and Japanese",()=>{for(const locale of ["ko","en","ja"] as const)for(const key of GIT_TRANSLATION_KEYS)expect(GIT_TRANSLATIONS[locale][key]).toBeTruthy();});
});
