export type WorkspaceViewerLayout = "window" | "columns" | "rows" | "fullscreen";

export type WorkspaceViewerLayoutState = {
  layout: WorkspaceViewerLayout;
  reversed: boolean;
};

export function selectWorkspaceViewerLayout(
  current: WorkspaceViewerLayoutState,
  next: WorkspaceViewerLayout
): WorkspaceViewerLayoutState {
  if (current.layout === next && (next === "columns" || next === "rows")) {
    return { layout: next, reversed: !current.reversed };
  }
  if (current.layout === next) return current;
  return { layout: next, reversed: false };
}
