# Deployment assets

`release-manifest.schema.json` and `release-key-ring.schema.json` describe the
structural public release interchange format. The authoritative runtime
contract is the strict verifier in
`app/src/server/deployment/release-manifest.ts`; the installer has an equivalent
browser verifier. Those verifiers additionally bind URL paths to filenames,
require one immutable release asset directory, and enforce trusted origins,
which JSON Schema alone does not express. The older
`trusted-release-metadata.schema.json`
and `trusted-worker-package-metadata.schema.json` remain only as a compatible
operator-supplied fallback.

The repository intentionally does not ship a placeholder production signing key,
image digest, manifest digest, or artifact digest. A release pipeline or trusted
server configuration must provide them. Bundle and Worker-instruction generation
fails closed when that metadata is absent or inconsistent.

The generated entries are returned in memory by `POST /api/deployment/plans`.
The response also carries one deterministic `tar.gz` archive with its SHA-256,
so the UI can download the complete directory without reconstructing it by
hand; individual entry downloads remain available for inspection.
Public installations use a key ring pinned inside the image plus fixed HTTPS
stable-channel manifest URLs. Official builds default to
`https://canister2668.github.io/claudex-workhouse/releases/stable/`; all three
settings below may be supplied together to select another trusted deployment:

- `CLAUDEX_WORKHOUSE_RELEASE_KEY_RING_FILE`
- `CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_URL`
- `CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_SIGNATURE_URL`

All three must be configured together. A partial integrated configuration
fails closed and does not fall back. Legacy operator metadata is read only when
none of the integrated release settings is present. Trust roots and URLs are
never accepted from deployment request bodies.

Selected bundles additionally pin the immutable manifest and signature beside
the versioned GitHub Release Worker assets. The mutable stable URL remains in
the installed server configuration only for future update checks; re-running
an old bundle never verifies its fixed digest against a newer stable manifest.

The repository pins only the production public key in
`deploy/release-key-ring.json`; the matching private key exists only as the
public repository's protected release secret. The signed release workflow also
requires a project `LICENSE`; it cannot publish placeholder legal terms or a
placeholder key. Repository immutable releases, public GHCR read access,
protected `release` environment secrets, and GitHub Pages must also be
configured before the tag workflow can complete.

Public release inputs also require the English, Korean, and Japanese `LICENSE`,
`NOTICE`, and `THIRD_PARTY_NOTICES` files. The Docker image stores them under
`/opt/claudex-workhouse/licenses`, portable Windows payloads store them under
`licenses/`, and the installer site publishes them under `/licenses/`. GitHub
tag source archives include the same tracked root files. New signed release
manifests identify the project license as `AGPL-3.0-only` and list the project
and third-party notice paths; generated SPDX SBOMs also receive the package
license metadata and packaged notice files.
