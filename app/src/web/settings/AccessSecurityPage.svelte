<script lang="ts">
  // 관리 › 접근·보안. Recent authenticated access and external exposure, moved
  // out of the host tab. Provider sign-ins live on each agent page.
  import { t } from "../i18n";
  import AccessActivity from "../AccessActivity.svelte";
  import ExternalAccessWizard from "../ExternalAccessWizard.svelte";
  export let api: (path: string, init?: RequestInit) => Promise<any>;
</script>

<p class="settings-page-body">{$t("settings.page.access.body")}</p>
<AccessActivity {api}/>
<ExternalAccessWizard {api}/>
<p class="settings-note">{$t("access.securityNote")}</p>
