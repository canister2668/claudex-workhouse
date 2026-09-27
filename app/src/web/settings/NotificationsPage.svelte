<script lang="ts">
  // 개인 › 알림. Split into the events that notify and how they are delivered.
  import { t } from "../i18n";
  import SettingRow from "../ui/SettingRow.svelte";
  import Switch from "../ui/Switch.svelte";
  import SettingsSection from "./SettingsSection.svelte";

  type PushPreferences = { approvals: boolean; userInput: boolean; completed: boolean; failed: boolean; hostOffline: boolean; handoff: boolean; vibration: boolean; quietStart: string | null; quietEnd: string | null };

  export let notifications = false;
  export let pushPreferences: PushPreferences;
  export let pushState: "unsupported" | "permission-needed" | "subscribed" | "disabled" | "failed" = "disabled";
  export let vibration = false;
  export let handleCompletionNotificationsChange: (event: Event) => void;
  export let disableAllPush: () => void;

  // The completion toggle must request browser permission from the same
  // gesture, so it still goes through App's handler with a synthetic event.
  function toggleCompletion(checked: boolean) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    handleCompletionNotificationsChange({ currentTarget: input } as unknown as Event);
  }
</script>

<p class="settings-page-body">{$t("settings.page.notifications.body")}</p>

<SettingsSection title={$t("settings.notifications.events")}>
  <SettingRow label={$t("display.completionNotifications")} help={$t("display.completionNotificationsBody")}><Switch checked={notifications} label={$t("display.completionNotifications")} onchange={toggleCompletion}/></SettingRow>
  <SettingRow label={$t("display.approvalNotifications")} help={$t("display.approvalNotificationsBody", { state: pushState })}><Switch bind:checked={pushPreferences.approvals} label={$t("display.approvalNotifications")}/></SettingRow>
  <SettingRow label={$t("display.userInputNotifications")} help={$t("display.userInputNotificationsBody")}><Switch bind:checked={pushPreferences.userInput} label={$t("display.userInputNotifications")}/></SettingRow>
  <SettingRow label={$t("display.failureNotifications")} help={$t("display.failureNotificationsBody")}><Switch bind:checked={pushPreferences.failed} label={$t("display.failureNotifications")}/></SettingRow>
  <SettingRow label={$t("display.hostOfflineNotifications")} help={$t("display.defaultOff")}><Switch bind:checked={pushPreferences.hostOffline} label={$t("display.hostOfflineNotifications")}/></SettingRow>
  <SettingRow label={$t("display.handoffNotifications")} help={$t("display.handoffNotificationsBody")}><Switch bind:checked={pushPreferences.handoff} label={$t("display.handoffNotifications")}/></SettingRow>
</SettingsSection>

<SettingsSection title={$t("settings.notifications.delivery")}>
  <SettingRow label={$t("display.vibration")} help={$t("display.vibrationBody")}><Switch bind:checked={vibration} label={$t("display.vibration")}/></SettingRow>
  <SettingRow label={$t("display.quietHours")} help={$t("display.quietHoursBody")}>
    <span class="quiet-hours"><input aria-label={$t("display.quietStart")} type="time" value={pushPreferences.quietStart ?? ""} oninput={(event) => pushPreferences.quietStart = (event.currentTarget as HTMLInputElement).value || null}/><span>–</span><input aria-label={$t("display.quietEnd")} type="time" value={pushPreferences.quietEnd ?? ""} oninput={(event) => pushPreferences.quietEnd = (event.currentTarget as HTMLInputElement).value || null}/></span>
  </SettingRow>
  <div class="settings-section-foot"><button type="button" class="danger-lite" onclick={disableAllPush}>{$t("display.disableAllNotifications")}</button></div>
</SettingsSection>
