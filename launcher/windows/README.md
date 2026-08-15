# Windows server launcher

This is the native, per-user status launcher for the Windows main-server
package. It uses only Win32 APIs, requests `asInvoker`, binds no socket, and
starts the bundled Node runtime with the server's loopback-only configuration.

The same binary serves three forms, and each one decides what it is from what
is on disk beside it — never from a file name, a command-line switch or an
environment variable.

The portable ZIP is the third form and installs nothing. Its launcher carries no
embedded payload container and sits beside `current.json`,
`payload-manifest.json` and the versioned payload they name, so double-clicking
it verifies every payload file against the manifest and starts the server in
place. There is no welcome screen, no install location and no Install button:
the window opens directly on the same status and connection screen the installed
launcher uses. Portable mode copies nothing into the install root and writes no
Start menu or desktop shortcut, no Windows Installed apps entry and no
`InstallRoot` registry value. Only the user data root under
`%LOCALAPPDATA%\Claudex Workhouse` is written, so removing the extracted folder
removes the program. Code verification and the browser first-run setup are
ordinary product setup and still apply.

The single EXE opens a native three-stage installer wizard before touching the
payload. The welcome screen shows the per-user install location and lets the
user choose a different current-user-writable folder. The selected location is
retained for later launches and updates. Installation and integrity verification
run on a background thread with visible progress, and the final screen reports
success or failure explicitly before offering to open Workhouse. The `--install`
and `--install-root` arguments are reserved for automated package smoke tests
that exercise the same wizard state machine and long-path installation without
a synthetic UI click.

A successful installation keeps a verified launcher in the selected folder,
adds current-user Start menu and desktop shortcuts, and registers Claudex
Workhouse in Windows Installed apps. Uninstall stops the registered Workhouse
server and removes the application files, shortcuts, and Installed apps entry.
It deliberately preserves the current user's configuration, credentials, logs,
and workspaces under the data root.

The installed shortcuts do not reopen the installer. They launch the small
installed status guide, which starts the server when needed, checks its current
state, and shows the local address plus the configured LAN or external address.
When the server is ready, **Open Workhouse** opens it in the default browser;
closing the guide leaves a ready server running. Only the original single EXE
shows the installation wizard; the installed launcher and the portable folder
launcher share the wizard-free direct start path.

Every user-visible string lives in the `kPhrases` table with complete
English, Korean, and Japanese columns. The locale is resolved from the
`--lang=` argument, `CLAUDEX_WORKHOUSE_LOCALE`, the persisted
`launcher-locale` preference, then the Windows UI language, and the header
language button rewrites the whole window in place. The wizard owner-draws
its own chrome so it follows the system light/dark theme and the per-monitor
DPI of the display it is on.

Build on a supported Windows x64 runner:

```powershell
cmake -S launcher/windows -B out/windows-launcher -A x64
cmake --build out/windows-launcher --config Release
```

The MSVC build above is the only build a release may ship. A mingw-w64 cross
build (`x86_64-w64-mingw32-g++ -municode -mwindows -std=c++20`, linking
`bcrypt comctl32 winhttp shell32 ole32 uuid user32 gdi32 advapi32 dwmapi`)
produces a runnable x64 PE for local package and structural checks when no
Windows runner is available. It uses a different toolchain and CRT, so it never
substitutes for the MSVC build or for running the Windows launch tests.

`pnpm run windows:exe` builds both a diagnostic folder package and the
single-file `claudex-workhouse-server-windows-x64.exe`. The single EXE verifies
its canonical launcher hash, manifest hash, and every payload file before
extracting to a per-user staging directory and atomically selecting the
versioned payload. Payload access uses extended-length Windows paths throughout
extraction and verification so deeply nested dependencies do not depend on the
machine-wide long-path policy. The folder form remains a development fallback.

Public releases are intentionally unsigned. Promotion still requires the
signed Workhouse release manifest, SHA-256 sidecars, SBOM, provenance
attestation, Defender scan, and Windows VM gates. The workflow also confirms
that no unexpected Authenticode signature was added after packaging.
