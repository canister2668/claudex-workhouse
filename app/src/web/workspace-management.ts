const SYSTEM_PROJECT_IDS = new Set(["claudex-workhouse"]);

export function isUiLockedProject(project:{id:string}) {
  return SYSTEM_PROJECT_IDS.has(project.id);
}

export function isUiLockedWorkspace(workspace:{projectId:string}) {
  return SYSTEM_PROJECT_IDS.has(workspace.projectId);
}

export function workspacesForHost<T extends {hostId:string}>(workspaces:readonly T[],hostId:string):T[] {
  return workspaces.filter(workspace=>workspace.hostId===hostId);
}
