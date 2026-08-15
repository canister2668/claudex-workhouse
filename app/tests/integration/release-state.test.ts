import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DeckDatabase } from "../../src/server/db/client.js";

function state(sequence: number, digest: string, channel = "stable") {
  return {
    schemaVersion: 1,
    channel,
    releaseSequence: sequence,
    version: `1.0.${sequence}`,
    manifestSha256: digest.repeat(64),
    imageDigest: `sha256:${digest.repeat(64)}`,
    verifiedKeyId: "release-test",
    verifiedAt: "2026-07-27T12:00:00.000Z",
    manifestUrl: "https://releases.example.test/manifest.json"
  };
}

describe("atomic release sequence state", () => {
  it("keeps the highest accepted sequence and rejects downgrade, equivocation, and channel replacement", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "claudex-release-state-"));
    const dbPath = path.join(root, "state.sqlite");
    const db = new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"), dbPath);
    try {
      await db.ping();
      const [first, second] = await Promise.all([
        db.acceptReleaseState(state(2, "a"), "2026-07-27T12:00:00.000Z"),
        db.acceptReleaseState(state(3, "b"), "2026-07-27T12:00:01.000Z")
      ]);
      expect([first.accepted, second.accepted]).toContain(true);
      expect((await db.getSystemSetting("deployment.release-state.v1"))?.value).toMatchObject({
        channel: "stable",
        releaseSequence: 3,
        manifestSha256: "b".repeat(64)
      });
      await expect(db.acceptReleaseState(
        state(2, "a"),
        "2026-07-27T12:00:02.000Z"
      )).resolves.toMatchObject({ accepted: false, reason: "downgrade" });
      await expect(db.acceptReleaseState(
        state(3, "c"),
        "2026-07-27T12:00:03.000Z"
      )).resolves.toMatchObject({ accepted: false, reason: "equivocation" });
      await expect(db.acceptReleaseState(
        state(4, "d", "beta"),
        "2026-07-27T12:00:04.000Z"
      )).resolves.toMatchObject({ accepted: false, reason: "channel-mismatch" });
    } finally {
      await db.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
