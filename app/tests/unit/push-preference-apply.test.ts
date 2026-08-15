import fs from "node:fs";
import path from "node:path";
import {describe,expect,it} from "vitest";
import {applyPushPreference,PUSH_PREFERENCE_TIMEOUT_MS} from "../../src/web/push-preference-apply.js";

const never=()=>new Promise<void>(()=>{});

describe("global settings save must survive Web Push",()=>{
  it("reports success when the browser applies the preference",async()=>{
    let enabled=false;
    expect(await applyPushPreference(true,{enable:async()=>{enabled=true;},disable:never})).toEqual({applied:true,reason:"applied",detail:null});
    expect(enabled).toBe(true);
  });

  it("uses the disable handler when notifications are turned off",async()=>{
    let disabled=false;
    expect((await applyPushPreference(false,{enable:never,disable:async()=>{disabled=true;}})).applied).toBe(true);
    expect(disabled).toBe(true);
  });

  it("resolves instead of hanging when a permission prompt is never answered",async()=>{
    // Windows browsers leave `Notification.requestPermission()` pending while
    // the permission bubble sits unanswered. Awaiting it inside the save left
    // the Save button dimmed forever with no success or failure message.
    const started=Date.now();
    expect(await applyPushPreference(true,{enable:never,disable:never},20)).toEqual({applied:false,reason:"timeout",detail:null});
    expect(Date.now()-started).toBeLessThan(PUSH_PREFERENCE_TIMEOUT_MS);
  });

  it("does not turn a push subscription failure into a settings save failure",async()=>{
    // An installation without VAPID keys rejects `PushManager.subscribe()`.
    const result=await applyPushPreference(true,{enable:async()=>{throw new Error("Registration failed - no applicationServerKey");},disable:never});
    expect(result.applied).toBe(false);
    expect(result.reason).toBe("failed");
    expect(result.detail).toContain("applicationServerKey");
  });

  it("never rejects, so the caller always reaches its own outcome message",async()=>{
    await expect(applyPushPreference(false,{enable:never,disable:async()=>{throw new Error("boom");}})).resolves.toMatchObject({applied:false});
  });

  it("is the only way the global settings save touches Web Push",()=>{
    const source=fs.readFileSync(path.resolve("src/web/App.svelte"),"utf8");
    const save=source.slice(source.indexOf("async function saveGlobalSettings"));
    const body=save.slice(0,save.indexOf("\n  function urlBase64"));
    expect(body).toContain("applyPushPreference(notifications,{enable:enablePush,disable:disablePush})");
    expect(body).not.toMatch(/await\s+(enablePush|disablePush)\(\)/);
    expect(body).not.toContain("await applyPushPreference");
    // Durable settings release the save flow immediately; a later push
    // failure only replaces the success notice with the partial-success one.
    expect(body).toContain('globalSaveNotice=$t("settings.globalSaved")');
    expect(body).toContain('if(!push.applied)globalSaveNotice=$t("settings.globalSavedPushSkipped")');
  });
});
