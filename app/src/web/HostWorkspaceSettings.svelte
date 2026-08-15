<script lang="ts">
  import InfrastructureSettings from "./InfrastructureSettings.svelte";
  import ProjectWorkspaceSettings from "./ProjectWorkspaceSettings.svelte";

  export let api:(path:string,init?:RequestInit)=>Promise<any>;
  export let projects:Array<{id:string;name:string;slug?:string;description?:string|null;enabled:boolean;archivedAt?:string|null}>=[];
  export let onviewworkspace:(workspace:any)=>void=()=>{};
</script>

<!-- Compatibility composition for callers outside the global settings tabs. -->
<div class="legacy-host-workspace-settings">
  <InfrastructureSettings {api}/>
  <ProjectWorkspaceSettings {api} {projects} {onviewworkspace}/>
</div>

<style>
  .legacy-host-workspace-settings{display:grid;gap:1.2rem}
</style>
