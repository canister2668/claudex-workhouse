import { describe, expect, it } from "vitest";
import { selectWorkspaceViewerLayout } from "../../src/web/workspace-viewer-layout";

describe("workspace viewer layout", () => {
  it("enters each layout without reversing the initial order", () => {
    const windowed = { layout: "window", reversed: false } as const;
    expect(selectWorkspaceViewerLayout(windowed, "columns")).toEqual({ layout: "columns", reversed: false });
    expect(selectWorkspaceViewerLayout(windowed, "rows")).toEqual({ layout: "rows", reversed: false });
    expect(selectWorkspaceViewerLayout(windowed, "fullscreen")).toEqual({ layout: "fullscreen", reversed: false });
  });

  it("reverses split order when the active split button is pressed again", () => {
    expect(selectWorkspaceViewerLayout({ layout: "columns", reversed: false }, "columns")).toEqual({ layout: "columns", reversed: true });
    expect(selectWorkspaceViewerLayout({ layout: "columns", reversed: true }, "columns")).toEqual({ layout: "columns", reversed: false });
    expect(selectWorkspaceViewerLayout({ layout: "rows", reversed: false }, "rows")).toEqual({ layout: "rows", reversed: true });
  });

  it("resets reversal when changing layout", () => {
    expect(selectWorkspaceViewerLayout({ layout: "columns", reversed: true }, "rows")).toEqual({ layout: "rows", reversed: false });
    expect(selectWorkspaceViewerLayout({ layout: "rows", reversed: true }, "window")).toEqual({ layout: "window", reversed: false });
  });
});
