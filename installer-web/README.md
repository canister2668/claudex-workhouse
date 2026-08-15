# Claudex Workhouse static installer

This directory builds the first-install page without a running Workhouse server
or any Workhouse API. It contains no production release key or placeholder
artifact.

## Fail-closed development build

With no release configuration, the build succeeds but every download remains
disabled:

```sh
cd installer-web
npm run build
```

The static output is written to `installer-web/dist`.

## Trusted release build

CI supplies all three values:

```sh
CLAUDEX_INSTALLER_MANIFEST_URL=https://.../release-manifest.json
CLAUDEX_INSTALLER_MANIFEST_SIGNATURE_URL=https://.../release-manifest.json.sig
CLAUDEX_INSTALLER_KEY_RING_FILE=/absolute/path/to/public-release-keys.json
npm run build
```

The key-ring file uses the same strict schema as
`deploy/release-key-ring.schema.json`:

```json
{
  "schemaVersion": 1,
  "keys": [
    {
      "keyId": "release-2026-01",
      "algorithm": "rsa-sha256",
      "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
      "revoked": false,
      "notBefore": "2026-01-01T00:00:00.000Z",
      "expiresAt": "2027-01-01T00:00:00.000Z"
    }
  ]
}
```

Only public verification keys are embedded. Private signing keys must remain in
the protected release pipeline. The build normalizes each RSA SPKI PEM and the
browser calculates its SHA-256 fingerprint after importing it with WebCrypto;
the key-ring schema does not contain a separately trusted hash.

The installer defaults to the `stable` channel,
`ghcr.io/canister2668/claudex-workhouse`, and Worker downloads on the manifest
origin. CI may pin a different signed-release policy with:

```sh
CLAUDEX_INSTALLER_RELEASE_CHANNEL=stable
CLAUDEX_INSTALLER_IMAGE_REPOSITORIES=ghcr.io/canister2668/claudex-workhouse
CLAUDEX_INSTALLER_WORKER_ORIGINS=https://github.com
```

The manifest and signature endpoints must allow browser CORS requests from the
installer origin, and redirects are rejected. The manifest signature is
verified over the exact response bytes with WebCrypto RSA PKCS#1 v1.5 and
SHA-256 before any download is enabled.

GitHub Release's final asset CDN does not guarantee browser-readable CORS.
Consequently, each Windows button downloads a current-user PowerShell
downloader bound to the already verified manifest, signature, and public key.
The Worker downloader accepts schema v1 or v2 and verifies the ZIP's exact
size and SHA-256 before saving it.

Schema v2 may additionally expose the Windows main server EXE. Its downloader
requires the signed v2 binding, verifies HTTPS redirects, exact size and
SHA-256, and the manifest's explicit Authenticode state. Public Windows files
are intentionally unsigned, so the page warns about Unknown publisher and
SmartScreen while still requiring the project-signed manifest and exact file
digest. It saves to the current user's Windows Known Folder Downloads path and
never starts the EXE automatically. Schema v1 keeps the main-server control
disabled. The static page never proxies release bytes or places a pairing code
in either script.

The recommended Windows control emits another current-user PowerShell script
for Docker Desktop. It re-verifies the embedded signed manifest, pins the exact
server image digest, writes a loopback-only Compose deployment below
`%LOCALAPPDATA%`, health-checks it, and opens first-run setup. Provider logins
and local Workspace access remain in the separately paired Windows Worker. The
unsigned single-EXE control remains an advanced compatibility path.

## Sanitized installation screenshots

The repository-only fixture creates an ephemeral demo signing key and manifest;
neither is a production trust root and no private key is retained:

```sh
node installer-web/scripts/build-screenshot-fixture.mjs
cd app
CLAUDEX_CAPTURE_INSTALLER=1 sh scripts/test-e2e-docker.sh \
  --project=desktop-1280 tests/e2e/installer-screenshots.spec.ts
```

The resulting `docs/images/install/*.ko.png` files contain only generated demo
release metadata. Open and inspect every generated image before committing it.

## Commands

```sh
npm run check
npm test
npm run build
```

The Synology/Linux archive is assembled only in browser memory. Owner claim and
Worker pairing are deliberately not implemented here: `install.sh` prints the
server-created claim URL, and Worker pairing starts in the existing server UI.
