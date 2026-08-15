// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Claudex Workhouse.

import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../../app/node_modules/esbuild/lib/main.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(scriptDir);
const dist = path.join(root, "dist");
const DEFAULT_IMAGE_REPOSITORY = "ghcr.io/canister2668/claudex-workhouse";
const IMAGE_REPOSITORY =
  /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{2,5})?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+$/;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

function failClosed(message) {
  return {
    configured: false,
    manifestUrl: "",
    signatureUrl: "",
    keyRing: [],
    expectedChannel: "stable",
    allowedImageRepositories: [],
    allowedWorkerOrigins: [],
    configurationError: message
  };
}

function httpsUrl(value, field) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname.includes("..") ||
    url.href !== value
  ) {
    throw new Error(
      `${field} must be a canonical HTTPS URL without credentials, query, fragment, or traversal.`
    );
  }
  return value;
}

function canonicalDate(value, field) {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(Date.parse(value)).toISOString() !== value
  ) {
    throw new Error(`${field} must be a canonical ISO-8601 timestamp.`);
  }
  return value;
}

function exactObject(value, field, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  const allowed = new Set(keys);
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) throw new Error(`${field}.${unexpected} is not supported.`);
  return value;
}

function commaValues(value) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function origin(value, field) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${field} must be an HTTPS origin without a path.`);
  }
  return url.origin;
}

function loadBuildConfig() {
  const manifestUrl = process.env.CLAUDEX_INSTALLER_MANIFEST_URL?.trim() ?? "";
  const signatureUrl = process.env.CLAUDEX_INSTALLER_MANIFEST_SIGNATURE_URL?.trim() ?? "";
  const keyRingFile = process.env.CLAUDEX_INSTALLER_KEY_RING_FILE?.trim() ?? "";
  if (!manifestUrl && !signatureUrl && !keyRingFile) {
    return failClosed(
      "공식 manifest URL, detached signature URL, 공개 키 ring이 빌드에 설정되지 않았습니다."
    );
  }
  if (!manifestUrl || !signatureUrl || !keyRingFile) {
    return failClosed("릴리스 신뢰 설정이 일부만 제공되어 설치를 안전하게 비활성화했습니다.");
  }
  try {
    const manifest = httpsUrl(manifestUrl, "manifest URL");
    const signature = httpsUrl(signatureUrl, "signature URL");
    if (new URL(manifest).origin !== new URL(signature).origin) {
      throw new Error("manifest and signature must use the same trusted HTTPS origin.");
    }
    const parsed = exactObject(
      JSON.parse(fs.readFileSync(path.resolve(keyRingFile), "utf8")),
      "key ring",
      ["schemaVersion", "keys"]
    );
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.keys)) {
      throw new Error("key ring schemaVersion or keys is invalid.");
    }
    if (parsed.keys.length < 1 || parsed.keys.length > 32) {
      throw new Error("key ring must contain between one and 32 public keys.");
    }
    const seen = new Set();
    const keyRing = parsed.keys.map((candidate, index) => {
      const key = exactObject(candidate, `key ring entry ${index}`, [
        "keyId",
        "algorithm",
        "publicKeyPem",
        "notBefore",
        "expiresAt",
        "revoked"
      ]);
      if (
        typeof key.keyId !== "string" ||
        !KEY_ID.test(key.keyId) ||
        key.algorithm !== "rsa-sha256" ||
        typeof key.publicKeyPem !== "string" ||
        key.publicKeyPem.length > 16 * 1024 ||
        typeof key.revoked !== "boolean"
      ) {
        throw new Error(`key ring entry ${index} is invalid.`);
      }
      if (seen.has(key.keyId)) throw new Error(`key ring keyId is duplicated: ${key.keyId}.`);
      seen.add(key.keyId);
      const notBefore = canonicalDate(key.notBefore, `key ring entry ${index}.notBefore`);
      const expiresAt = canonicalDate(key.expiresAt, `key ring entry ${index}.expiresAt`);
      if (Date.parse(notBefore) >= Date.parse(expiresAt)) {
        throw new Error(`key ring entry ${index} has an invalid validity window.`);
      }
      let publicKey;
      try {
        publicKey = crypto.createPublicKey(key.publicKeyPem);
      } catch {
        throw new Error(`key ring entry ${index} is not a parseable public key.`);
      }
      if (publicKey.asymmetricKeyType !== "rsa") {
        throw new Error(`key ring entry ${index} must be an RSA public key.`);
      }
      return {
        keyId: key.keyId,
        algorithm: "rsa-sha256",
        publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
        notBefore,
        expiresAt,
        revoked: key.revoked
      };
    });
    const expectedChannel =
      process.env.CLAUDEX_INSTALLER_RELEASE_CHANNEL?.trim() || "stable";
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(expectedChannel)) {
      throw new Error("release channel is invalid.");
    }
    const repositoryValues = commaValues(
      process.env.CLAUDEX_INSTALLER_IMAGE_REPOSITORIES
    );
    const allowedImageRepositories = repositoryValues.length
      ? repositoryValues
      : [DEFAULT_IMAGE_REPOSITORY];
    if (
      allowedImageRepositories.some(
        (value) => !IMAGE_REPOSITORY.test(value) || value.includes("@")
      )
    ) {
      throw new Error("allowed image repositories contain an invalid repository.");
    }
    const workerValues = commaValues(process.env.CLAUDEX_INSTALLER_WORKER_ORIGINS);
    const allowedWorkerOrigins = (
      workerValues.length ? workerValues : [new URL(manifest).origin]
    ).map((value, index) => origin(value, `worker origin ${index}`));
    return {
      configured: true,
      manifestUrl: manifest,
      signatureUrl: signature,
      keyRing,
      expectedChannel,
      allowedImageRepositories,
      allowedWorkerOrigins
    };
  } catch (error) {
    console.warn(
      `installer trust configuration rejected: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return failClosed("릴리스 신뢰 설정을 검증하지 못해 설치를 안전하게 비활성화했습니다.");
  }
}

const config = loadBuildConfig();
const connectOrigins = config.configured
  ? [
      ...new Set([
        new URL(config.manifestUrl).origin,
        new URL(config.signatureUrl).origin
      ])
    ]
  : ["'none'"];

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, "assets"), { recursive: true });

await build({
  entryPoints: [path.join(root, "src", "main.ts")],
  outfile: path.join(dist, "assets", "app.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  sourcemap: false,
  legalComments: "none",
  define: {
    __CLAUDEX_INSTALLER_CONFIG__: JSON.stringify(config)
  }
});

const html = fs
  .readFileSync(path.join(root, "index.html"), "utf8")
  .replace("__CLAUDEX_CONNECT_SRC__", connectOrigins.join(" "));
fs.writeFileSync(path.join(dist, "index.html"), html);
fs.copyFileSync(path.join(root, "styles.css"), path.join(dist, "styles.css"));
const repositoryRoot=path.dirname(root),legalDist=path.join(dist,"licenses");
fs.mkdirSync(legalDist,{recursive:true});
for(const name of["LICENSE","LICENSE.ko.md","LICENSE.ja.md","NOTICE.md","NOTICE.ko.md","NOTICE.ja.md","THIRD_PARTY_NOTICES.md","THIRD_PARTY_NOTICES.ko.md","THIRD_PARTY_NOTICES.ja.md"]){
  fs.copyFileSync(path.join(repositoryRoot,name),path.join(legalDist,name));
}

console.log(
  `installer-web build complete: ${dist} trust=${config.configured ? "configured" : "fail-closed"}`
);
