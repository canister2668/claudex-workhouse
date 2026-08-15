export const MAX_BROWSER_UPLOAD_BYTES = 90 * 1024 * 1024;

export function addBrowserUploadBytes(current: number, next: number) {
  if (!Number.isSafeInteger(current) || current < 0 || !Number.isSafeInteger(next) || next < 0) {
    throw new Error("Browser upload sizes must be non-negative safe integers.");
  }
  const total = current + next;
  if (total > MAX_BROWSER_UPLOAD_BYTES) {
    throw Object.assign(new Error("Uploads exceed the 90 MiB total request limit."), {
      statusCode: 413,
      code: "UPLOAD_TOO_LARGE"
    });
  }
  return total;
}
