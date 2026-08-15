import{describe,expect,it}from"vitest";
import{DEFAULT_SETUP_PREFERENCES,normalizeSetupPreferences,setupPanelRequired}from"../../src/server/setup-preferences";

describe("setup preferences",()=>{
  it("shows incomplete setup by default",()=>{expect(DEFAULT_SETUP_PREFERENCES.showOnStartup).toBe(true);expect(setupPanelRequired({completed:false},DEFAULT_SETUP_PREFERENCES)).toBe(true);});
  it("lets the owner hide an incomplete or broken setup without marking it complete",()=>{const preferences=normalizeSetupPreferences({showOnStartup:false});expect(preferences.showOnStartup).toBe(false);expect(setupPanelRequired({completed:false},preferences)).toBe(false);});
  it("never auto-opens completed setup",()=>{expect(setupPanelRequired({completed:true},DEFAULT_SETUP_PREFERENCES)).toBe(false);});
});
