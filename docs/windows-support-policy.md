# Windows portable server support and release policy

Status: **portable ZIP is a release candidate; nothing is released yet.** The
portable server (`claudex-workhouse-server-windows-x64-portable.zip`) now
verifies its payload, starts, and runs Claude Code and Codex tasks directly in
the server process, without a Worker. It is not advertised as supported until
the acceptance run below passes. The single-EXE installer and the native
Windows Worker remain in development. The released main-server host is still
Linux or a Linux-based NAS with Docker.

Resolved for the portable server:

- Payload verification. The launcher counted payload files through
  `std::filesystem::recursive_directory_iterator`/`is_regular_file`, whose CRT
  status probe does not resolve every extended-length path on MinGW builds, so
  a file the Win32 open found went uncounted and the start only succeeded once
  that entry was removed from `payload-manifest.json`. Enumeration, opening and
  hashing are now all Win32 (`FindFirstFileExW`, `CreateFileW`, `ReadFile`) on
  the same `\\?\` paths, the manifest and the folder are compared by name, and
  only name-surrogate reparse points (links, junctions) are refused, so OneDrive
  and WOF-compressed files verify. The payload drops `node_modules` test and
  example trees, `.bin` links, type declarations and source maps, and the
  packager writes the ZIP itself with ASCII names only, within the Explorer
  `MAX_PATH` budget (150 characters per entry, root folder included).
- Worker dependency. `managedLocalWorkerEnabled()` is false on every platform.
  Task workers prove liveness with an exclusively-locked `<state>.alive` file
  and accept a stop through a `<state>.stop` request, falling back to
  `taskkill /T /F` on the process tree (`app/src/server/worker-liveness.ts`).
  The server discovers `claude.exe` and `codex.exe` with the verified Windows
  discovery (`app/src/server/windows/direct-providers.ts`).

Outstanding before any Windows target can be released:

- The clean, non-administrator Windows 11 acceptance run named below has never
  been performed. The portable ZIP has been exercised under Wine (payload
  verification, start-up, readiness, direct task completion and stop), which
  is not a substitute.
- Antigravity and Grok tasks and login (refused on the Windows server), Claude
  usage probes, and the Claude model list
  refresh still depend on python3 and a POSIX pseudo-terminal and are
  unavailable on Windows.
- The single-EXE installer and the native Worker path are unchanged and still
  unverified.

The repository now enforces the private-package version ceiling, Windows
artifact-size and runtime/SQLite pins, isolation labels, signed manifest v2,
SHA-256 sidecars, and explicit unsigned-release metadata. These are code and
workflow controls, not evidence that the Windows toolchain, Defender
environment, or non-administrator acceptance run has actually succeeded.

## Advanced compatibility release

- Architecture: Windows x64 (`AMD64`) only.
- Operating system: a Microsoft-supported Windows 11 x64 release with current
  security updates. A currently supported GitHub Windows runner may build and
  test platform-neutral contracts, but a clean, non-administrator Windows 11
  VM is a separate mandatory stable-promotion acceptance environment.
- Windows 10, Windows on Arm, Windows Server as an end-user host, 32-bit
  Windows, Wine, and network-share installation roots are unsupported in the
  first release.
- The launcher and server run as the current interactive user. They do not
  install a LocalSystem service or request UAC elevation.

Windows 10 reached general end of support on 2025-10-14, so a new security-
sensitive local control plane must not advertise it as supported. A later
decision may add a specifically named LTSC edition only after a dedicated CI
and lifecycle review.

## Runtime and database

- Bundle the latest security-patched Node.js 24 LTS x64 runtime that has passed
  the Windows release workflow. The exact Node archive version and SHA-256
  must be pinned in release metadata, and the launcher must never download an
  unbound runtime.
- Node 24 is the Windows server bundle and Windows SQLite contract baseline.
  Existing Linux/Docker and Worker builds remain on their current Node 22
  baseline until a separate repository-wide upgrade is reviewed. Windows CI
  must therefore run the server/SQLite contracts using the exact bundled Node
  24 binary, not whichever Node happens to host the release script.
- Use a separately bundled Node SQLite worker based on an exact pinned
  `better-sqlite3` release with a Windows x64 prebuilt binary. The Workhouse
  release binds that native binary to the bundled Node ABI and records it in
  the SBOM. A source pin records the upstream asset URL and SHA-256, and the
  build must verify those bytes before adding its own payload hash.
- Do not use `node:sqlite` for the first stable build. In Node 24.18.0 it is
  documented as release-candidate stability, while the database is a
  recovery-critical component whose online-backup and WAL contract has not
  been proven here.
- Linux and Synology retain the existing Python NDJSON SQLite worker until the
  shared contract suite proves the Node worker equivalent. Selecting the
  Windows implementation does not authorize a Linux database migration.

The dependency must be re-reviewed before every major `better-sqlite3` or Node
upgrade. WAL, online backup, `quick_check`, integer and blob binding, timeout,
worker crash, and restart behavior are release gates rather than inferred
compatibility.

## Execution policy

- A newly created Windows configuration defaults to `confirm`.
- `read` uses the Provider's supported read-only policy.
- `read`, `confirm`, and `automatic` must display and audit the effective
  Provider policy separately from native host isolation. None may label a
  Windows execution as natively sandboxed when no enforced adapter exists.
- `full` remains an explicit high-risk user choice.
- Existing Linux settings and existing user settings are never rewritten to
  the Windows default.

## Artifact budget

- The public Windows server artifact is
  `claudex-workhouse-server-windows-x64-portable.zip`.
- The portable payload must be no larger than 200 MiB before compression.
- The size gate includes the launcher, compressed Node runtime, server/web
  payload, native SQLite module, notices, and bootstrap assets. Provider CLIs
  and user data are not embedded.
- Exceeding the budget blocks promotion; it is not bypassed by an installer
  that downloads an unsigned secondary payload.

## Unsigned Windows distribution and stable promotion

The project does not purchase a commercial Authenticode certificate. The
launcher inside the portable ZIP is therefore unsigned and Windows may show
`Unknown publisher` or Microsoft Defender SmartScreen.

Stable promotion still fails closed unless all of the following are true:

1. The portable ZIP URL, byte size, and SHA-256 are bound into the signed
   Workhouse release manifest.
2. A separate SHA-256 sidecar is published for the portable ZIP.
3. Windows CI confirms the bundled launcher is not unexpectedly
   Authenticode-signed and the payload manifest passes inspection.
4. Windows CI smoke, SBOM, provenance/attestation, Defender scan, and immutable
   release-asset checks pass against the exact published bytes.
5. A clean, non-administrator Windows 11 acceptance run passes without UAC or
   firewall prompts.

The installer must explain the unsigned status before download and verify the
project-signed release manifest plus the portable ZIP SHA-256. Users should download
only from the official GitHub Releases page. Authenticode can be added later as
an optional distribution improvement without weakening these integrity gates.

## Version policy

While `app/package.json` remains `private: true`, package and release
validation must reject versions above `1.0.0`. Windows work does not relax this
repository-wide rule.

## Primary references

- Microsoft Windows lifecycle:
  <https://learn.microsoft.com/en-us/lifecycle/faq/windows>
- Node.js release schedule:
  <https://nodejs.org/en/about/previous-releases>
- Node.js 24.18.0 SQLite API stability:
  <https://nodejs.org/docs/v24.18.0/api/sqlite.html>
- `better-sqlite3` releases:
  <https://github.com/WiseLibs/better-sqlite3/releases>
