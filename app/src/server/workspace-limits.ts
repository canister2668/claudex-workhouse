// Shared workspace limits. Kept free of Node built-ins so the web bundle can import
// it too: the viewer decides whether to offer the HTML preview tab, and the server
// enforces the same ceiling, so the two must not drift.
//
// The preview renders inside `<iframe sandbox="">` after the document is sanitized,
// so the ceiling is a memory and main-thread budget rather than a security control:
// the whole file is returned as JSON, parsed into a DOM, walked attribute by
// attribute, then serialized again.
export const MAX_HTML_PREVIEW_BYTES = 5 * 1024 * 1024;
export const MAX_WORKSPACE_DOWNLOAD_BYTES = 1024 * 1024 * 1024;

export function formatByteLimit(bytes: number) {
  const mib = bytes / (1024 * 1024);
  return `${Number.isInteger(mib) ? mib : mib.toFixed(1)} MiB`;
}
