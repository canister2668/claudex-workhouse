import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  DeploymentValidationError,
  type TrustedWorkerPackageMetadata
} from "./types.js";
import { validateTrustedWorkerPackageMetadata } from "./validation.js";

export interface VerifiedLocalWorkerPackage {
  readonly filePath: string;
  readonly fileName: string;
  readonly size: number;
  readonly sha256: string;
  readonly content: Buffer;
}

/**
 * Verifies the exact local package bytes against independently trusted Worker
 * metadata. This is intentionally separate from the remote-download installer:
 * a file merely existing below packages/ is never enough to make it downloadable.
 */
export async function verifyLocalWorkerPackage(
  packagesDirectory: string,
  inputMetadata: TrustedWorkerPackageMetadata
): Promise<VerifiedLocalWorkerPackage> {
  const metadata = validateTrustedWorkerPackageMetadata(inputMetadata);
  const root = path.resolve(packagesDirectory);
  const filePath = path.resolve(root, metadata.artifact.fileName);
  if (path.dirname(filePath) !== root) {
    throw new DeploymentValidationError(
      "workerPackage.artifact.fileName",
      "must resolve directly below the configured package directory"
    );
  }

  let handle: fs.promises.FileHandle;
  try {
    handle = await fs.promises.open(filePath, "r");
  } catch {
    throw new DeploymentValidationError(
      "workerPackage.artifact",
      "the trusted local Worker package is unavailable"
    );
  }

  try {
    const before = await handle.stat();
    if (!before.isFile()) {
      throw new DeploymentValidationError(
        "workerPackage.artifact",
        "the trusted local Worker package must be a regular file"
      );
    }
    if (before.size !== metadata.artifact.size) {
      throw new DeploymentValidationError(
        "workerPackage.artifact.size",
        "does not match the trusted Worker package size"
      );
    }

    const content = await handle.readFile();
    const sha256 = crypto.createHash("sha256").update(content).digest("hex");
    const after = await handle.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new DeploymentValidationError(
        "workerPackage.artifact",
        "changed while it was being verified"
      );
    }
    if (sha256 !== metadata.artifact.sha256) {
      throw new DeploymentValidationError(
        "workerPackage.artifact.sha256",
        "does not match the trusted Worker package digest"
      );
    }

    return Object.freeze({
      filePath,
      fileName: metadata.artifact.fileName,
      size: before.size,
      sha256,
      content
    });
  } finally {
    await handle.close().catch(() => {});
  }
}
