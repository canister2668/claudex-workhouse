# Deployment and infrastructure, phase 1

This phase separates installation planning from live infrastructure state. It
does not turn Claudex Workhouse into a remote operating-system administrator.
The operator still runs one official command or package on the target device.

The server-hosted PWA starts only after a server exists. A future Android or
desktop shell may keep its own registered-server list and reuse the owner-claim
payload below; this repository does not pretend that its PWA can install the
first server before it is reachable.

## Pure deployment module

`app/src/server/deployment` exposes:

- `createDeploymentPlan` / `validateDeploymentPlan`
- `generateMainServerBundle`
- `createDeploymentBundleArchive`
- `createWorkerInstallInstructions`
- the serializable `DeploymentBundle` and Worker instruction types
- validators for trusted release metadata, paths, ports, origins, and pairing codes

`DeploymentPlan` is a deeply frozen pre-installation snapshot. It is not updated
with connection or health state and must not replace `ExecutionHost` runtime
records.

`POST /api/deployment/plans` returns the selected immutable plan, the four
in-memory artifacts, and a single digest-addressed `tar.gz` download payload.
Each entry carries its archive path, media type, mode, SHA-256, and content. The
UI offers both the complete archive and individual files without giving the
server Docker-host access or persisting generated plans. `POST
/api/deployment/worker-instructions` returns the current-user Worker commands
for a one-time WorkerHub pairing.

### Server/API integration example

All public functions and types are exported from
`app/src/server/deployment/index.ts`:

```ts
import {
  createDeploymentBundleArchive,
  createDeploymentPlan,
  createWorkerInstallInstructions,
  generateMainServerBundle,
  validateTrustedReleaseMetadata,
  validateTrustedWorkerPackageMetadata
} from "./deployment/index.js";

const plan = createDeploymentPlan({
  target: "main-server",
  platform: "synology",
  dataPath: "/volume1/containers/claudex-workhouse",
  roles: ["main-server", "worker"],
  publicAccess: "local-only"
});

const release = validateTrustedReleaseMetadata(parsedTrustedReleaseFile);
const bundle = generateMainServerBundle(plan, {
  release,
  serverOrigin: "http://192.168.1.20:3410"
});
const archive = createDeploymentBundleArchive(bundle);

const pairing = workerHub.createPairing();
const workerInstructions = createWorkerInstallInstructions(workerPlan, {
  serverOrigin: config.externalOrigin,
  pairingCode: pairing.code,
  workerPackage: validateTrustedWorkerPackageMetadata(selectedTrustedWorkerPackage)
});
```

The pure deployment functions never read process environment or disk by
themselves. The Fastify integration loads trusted JSON from
administrator-controlled files on demand and selects the package matching the
requested platform and architecture. The configured environment variables are:

```text
CLAUDEX_WORKHOUSE_TRUSTED_RELEASE_METADATA_FILE
CLAUDEX_WORKHOUSE_TRUSTED_WORKER_PACKAGE_METADATA_DIR
```

The first file contains one server release document. The Worker directory uses
`windows-x64.json`, `linux-x64.json`, and `linux-arm64.json` as applicable. The
pure module does not add these trust roots to `config.ts`, and the API never
accepts a signing key or trust metadata from the browser. The trusted server
configuration, not the artifact host or installation-plan request, provides the
trust root.

## Supported planning matrix

| Platform | Main server | Worker | Installation plan |
| --- | --- | --- | --- |
| Synology DSM | Yes | As the local server runtime | Docker Compose |
| QNAP | Yes | As the local server runtime | Docker Compose |
| General Docker NAS | Yes | As the local server runtime | Docker Compose |
| Linux x64/arm64 | Yes | Yes | Docker Compose server; current-user portable Worker |
| Windows x64 | No | Yes | Current-user portable/PowerShell Worker |
| Windows arm64 | No | No in phase 1 | Rejected |

Linux direct/systemd server installation and Windows main-server installation are
rejected rather than represented as unfinished options.

Role constraints are explicit:

- a main-server plan contains `main-server` and may also contain `worker`;
- a Worker plan contains only `worker`;
- duplicate roles and role escalation are rejected.

## First main-server owner claim

A fresh main server creates its Ed25519 identity locally and stores only the
SHA-256 hash of a ten-minute `server-owner` enrollment token. The local
`/api/bootstrap/owner-claim/local` endpoint returns the claim URL and QR payload
only to a direct loopback request; forwarded proxy headers are rejected.

The QR contains the direct server URL, enrollment ID, one-time token, server
fingerprint, protocol version, and expiry. It never contains provider, GitHub,
Cloudflare, NAS, Windows, or SSH credentials. Completion atomically consumes the
enrollment and stores only the owner-credential hash. Reuse, expiry, fingerprint
mismatch, and concurrent second consumption are rejected.

The same-origin PWA checks that the fingerprint in the claim fragment matches
the server status, removes the fragment from browser history immediately, and
then completes the claim. An Android or independent bootstrap client must
additionally pin the scanned fingerprint/public key before accepting the
connection; a page and status response delivered by the same compromised proxy
cannot independently prove the server's identity.

Owner claim is separate from the existing post-start `SetupWizard`, which
continues to configure Provider, Git, and Workspace state after ownership is
established. Existing authenticated installations migrate without a surprise
claim unless `CLAUDEX_WORKHOUSE_OWNER_CLAIM=required` explicitly forces the new
bootstrap flow.

Main-server data paths must be normalized absolute POSIX paths with at least two
safe components. Traversal, shell syntax, and operating-system directories are
rejected. Published ports are restricted to integer ports 1024–65535. Port
availability still requires a target-host probe in the API/UI integration layer.

## Trusted release input

There is deliberately no default production image, digest, signing key, manifest,
or Worker artifact in this repository. The integration layer must load an
independently trusted release configuration matching
`deploy/trusted-release-metadata.schema.json` or
`deploy/trusted-worker-package-metadata.schema.json`.

Generation fails closed when:

- trusted metadata is missing;
- an image is tag-based instead of `repository@sha256:...`;
- the manifest or artifact digest is malformed;
- a release URL is not HTTPS or includes credentials/query data;
- the supplied signing-key fingerprint does not match the exact PEM;
- package platform/architecture does not match the plan.

The signing public key is public trust material, not a credential. The release
pipeline must distribute it independently of the artifact host. Downloading a
key, checksum, and artifact from the same untrusted location is not sufficient.

## Main-server bundle

The in-memory bundle contains exactly:

```text
compose.yaml
.env
install.sh
README-FIRST.txt
```

The API also serializes those exact entries into
`claudex-workhouse-<plan-id>.tar.gz`. The archive uses fixed metadata, preserves
the declared `0600`/`0700` modes, exposes its compressed SHA-256, and extracts
under a fresh plan-specific `claudex-workhouse-<plan-id>/` directory. The
copyable command verifies the archive SHA-256 before extraction and refuses an
already existing extraction directory. The archive contains no credential or
provider token.

The Compose file:

- embeds a digest-pinned image reference;
- keeps all Linux capabilities dropped and enables `no-new-privileges`;
- does not grant container control over the host runtime;
- mounts only the selected `config`, `data`, `logs`, `runtime`, `snapshots`, and
  `workspaces`
  directories;
- runs explicitly as uid:gid `10001:10001`; the installer assigns that ownership
  to the five bind-directory roots when run as root, or verifies an operator
  already runs as exactly `10001:10001`;
- uses tmpfs for the run directory and `/tmp`;
- sets `CLAUDEX_WORKHOUSE_OWNER_CLAIM=required`;
- never includes provider, GitHub, Cloudflare, NAS, Windows, or SSH credentials.

For `local-only`, the generated port bind is reachable on the LAN and a plain
HTTP origin is accepted only for loopback, `.local`, or RFC1918 IPv4 addresses.
Single-label LAN host names are accepted as well.
Existing Cloudflare, Tailscale, and custom reverse-proxy modes retain a loopback
host bind and require an HTTPS origin. The generator does not create or modify
those external-access systems.

`install.sh` is intentionally bounded. It:

1. checks Docker, Compose v2, and the tools needed for verification;
2. verifies the host is x64/arm64, enforces an explicitly selected architecture,
   and checks the required bundle files are present;
3. creates the selected deployment directories;
4. downloads the manifest and detached signature over HTTPS;
5. verifies the independently pinned key fingerprint, manifest SHA-256, RSA
   signature, selected release version, and image digest;
6. refuses to overwrite a different existing Compose or environment file;
7. pulls and starts the digest-pinned Compose service;
8. checks `/api/health/ready` (SQLite and persistent-directory readiness);
9. runs a bounded Node probe inside the application container and prints the
   loopback-only `/api/bootstrap/owner-claim/local` output for the claim URL/QR
   flow. Non-2xx claim responses make that probe fail; the host never attempts
   to impersonate a loopback request through the Docker bridge.

A rerun repeats verification and `compose up -d`. It does not remove data or
force-recreate the deployment. If owner claim has already completed, the claim
display can be unavailable without making an otherwise healthy rerun destructive.
The installer never invokes an elevation tool. If it is neither root nor
uid:gid `10001:10001`, it stops before creating deployment directories and
explains the ownership prerequisite. It never recursively changes ownership of
existing contents. Docker port-binding failures include an explicit port
collision hint; changing the plan uses a fresh deployment directory because a
different existing `.env` is never overwritten.

If the successful owner-claim response or long-lived owner cookie is lost, the
operator can run the following command locally inside the Compose deployment:

```sh
docker compose --env-file .env -f compose.yaml exec -T claudex-workhouse \
  node app/dist-server/bootstrap/owner-recovery-cli.js
```

The CLI proves possession of the server's Ed25519 identity over a direct
loopback request, atomically revokes the previous owner credential, and prints a
new ten-minute claim URL. It does not bypass Cloudflare Access remotely and does
not expose the private identity key.

## Worker instructions

Worker planning reuses the existing WorkerHub pairing and current-user Worker
CLI. It does not define another registration or credential system.

The instruction object contains structured copyable commands:

- Windows: current-user folders, PowerShell downloads and digest checks, RSA
  manifest verification through Windows cryptography APIs, x64 and selected
  version checks, portable extraction with a bundled Node runtime, UI/CLI
  pairing, and current-user logon auto-start. Users do not install Node or npm.
- Linux: current-user folders, signed-manifest/artifact verification, portable
  architecture and selected version checks, portable extraction, CLI pairing,
  and the existing `systemd --user` install flow.

Only the pairing command contains the 10-minute one-time pairing code. UI/API
integrations must not persist that command or include it in logs. Provider
credentials stay in the official CLI state of the OS user running the Worker.
The instructions contain no root/SYSTEM service, administrator password, package
manager elevation, firewall change, or Workspace permission expansion.

Worker package metadata uses the same signed-manifest trust boundary and is
caller-supplied. A Windows package must be an x64 ZIP. Linux packages are
architecture-specific tarballs. Until official artifacts and their signed
metadata exist, instruction generation remains disabled.

The Windows release packaging job must provide a trusted x64 `node.exe` through
`CLAUDEX_WORKHOUSE_WINDOWS_NODE_EXE`; packaging fails if it is absent. That
runtime is embedded before the ZIP is signed and hashed, and the installer
rejects an extracted package without it.

## Existing network access

For a LAN-only plan, enter a reachable private address or `.local` hostname.
The generated Compose port is bound on the LAN and the owner-claim QR advertises
that direct origin.

For an existing Cloudflare Tunnel, enter its HTTPS public origin and keep the
tunnel origin pointed at the generated loopback port. Account passwords and
Cloudflare API access are never requested. Use the Infrastructure diagnostics
after installation to confirm HTTP, SSE, and the Worker WebSocket endpoint; the
generator does not create Access policies.

For an existing Tailscale setup, use an HTTPS `tailscale serve` or MagicDNS
origin that proxies the generated loopback port. The phase-1 installer does not
log in to Tailscale or alter host networking. A custom reverse proxy follows the
same HTTPS-origin and loopback-bind boundary.

Connecting an existing server from an independent client requires only its URL
and that client's normal authenticated session. It does not make the current
main server the owner or controller of another main server.

## Explicitly excluded

This phase does not implement self-update, database restore, external disaster
recovery backup, automatic tunnel/account setup, SSH installation, Docker-host
control, a general infrastructure engine, multi-server cloud orchestration, new
Workspace path restrictions, or a new provider authentication flow.
