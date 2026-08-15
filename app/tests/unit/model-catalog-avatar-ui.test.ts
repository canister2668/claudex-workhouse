import fs from "node:fs";
import path from "node:path";
import {describe,expect,it} from "vitest";

const read=(name:string)=>fs.readFileSync(path.join(process.cwd(),"src","web",name),"utf8");
describe("model catalog avatar notice UI",()=>{
  it("reuses the existing avatar path for every provider and keeps routing in App",()=>{const app=read("App.svelte"),dock=read("AgentAvatarDock.svelte"),avatar=read("EmotionAvatar.svelte");expect(app).toContain('new EventSource("/api/model-catalog/events")');expect(app).toContain('action:{type:"open-provider-models",provider}');expect(app).toContain("function handleAvatarNoticeAction");expect(dock).toContain("externalState={runtimeNotices[provider]??null}");expect(dock).toContain("class:notice-active={noticeActive}");expect(dock).toContain("onExternalAction={forwardNoticeAction}");expect(avatar).toContain("onExternalAction?.(externalState.action)");expect(avatar).not.toContain("openGlobalSettings");expect(avatar).not.toContain("open-provider-models");});

  it("keeps an idle avatar at full color while an external notice is active",()=>{const styles=read("styles.css");expect(styles).toContain(".tray-item.status-idle:not(.notice-active) .avatar-panel img");expect(styles).toContain(".tray-item.status-idle:not(.notice-active) .avatar-panel>.provider-name-mark");expect(styles).not.toContain(".tray-item.status-idle .avatar-panel img{");});
});
