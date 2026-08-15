export const CLAUDEX_WORKHOUSE_PROJECT_ID = "claudex-workhouse";

export function isClaudexWorkhouseProjectId(projectId: unknown) {
  return projectId === CLAUDEX_WORKHOUSE_PROJECT_ID;
}

export function assertWorkspaceManagementAllowed(projectId: unknown) {
  if (!isClaudexWorkhouseProjectId(projectId)) return;
  throw Object.assign(new Error("The Claudex Workhouse system workspace cannot be modified or removed."), {
    statusCode: 403,
    code: "SYSTEM_WORKSPACE_LOCKED"
  });
}
