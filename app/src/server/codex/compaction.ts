// A long image-heavy history can spend several minutes reconnecting and then
// compacting over HTTPS. The old two-minute budget interrupted that recovery.
export const CODEX_COMPACTION_TIMEOUT_MS = 10 * 60_000;

export async function waitForCodexCompaction<T>(completion: Promise<T>, timeoutMs = CODEX_COMPACTION_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      completion,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("Codex context compaction timed out."), {code:"CODEX_COMPACTION_TIMEOUT"})), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
