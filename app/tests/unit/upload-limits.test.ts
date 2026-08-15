import { describe, expect, it } from "vitest";
import { addBrowserUploadBytes, MAX_BROWSER_UPLOAD_BYTES } from "../../src/server/upload-limits.js";

describe("browser upload budget", () => {
  it("allows one file or several files up to 90 MiB total", () => {
    expect(addBrowserUploadBytes(0, MAX_BROWSER_UPLOAD_BYTES)).toBe(MAX_BROWSER_UPLOAD_BYTES);
    expect(addBrowserUploadBytes(40 * 1024 * 1024, 50 * 1024 * 1024)).toBe(MAX_BROWSER_UPLOAD_BYTES);
  });

  it("rejects a file or aggregate request above 90 MiB", () => {
    expect(() => addBrowserUploadBytes(0, MAX_BROWSER_UPLOAD_BYTES + 1)).toThrow("90 MiB");
    expect(() => addBrowserUploadBytes(60 * 1024 * 1024, 31 * 1024 * 1024)).toThrow("90 MiB");
  });
});
