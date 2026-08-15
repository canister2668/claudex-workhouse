import { createPublicKey } from "node:crypto";
import {
  DeploymentValidationError,
  type DeploymentPlan,
  type TrustedWorkerPackageMetadata,
  type WorkerInstallCommand,
  type WorkerInstallInstructions
} from "./types.js";
import {
  validateDeploymentPlan,
  validatePairingCode,
  validateServerOrigin,
  validateTrustedWorkerPackageMetadata
} from "./validation.js";

export interface WorkerInstallOptions {
  readonly workerPackage?: TrustedWorkerPackageMetadata;
  readonly serverOrigin: string;
  readonly pairingCode: string;
}

function powershellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function shellLiteral(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function base64UrlToBase64(value: string): string {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  return base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
}

function windowsCommands(
  metadata: TrustedWorkerPackageMetadata,
  serverOrigin: string,
  pairingCode: string
): readonly WorkerInstallCommand[] {
  const manifestMaximumBytes = 1_048_576;
  const signatureMaximumBytes = 16_384;
  const expandedArchiveMaximumBytes = 2_147_483_648;
  const archiveEntryMaximumCount = 50_000;
  const packageUrl = powershellLiteral(metadata.artifact.url);
  const manifestUrl = powershellLiteral(metadata.manifest.url);
  const signatureUrl = powershellLiteral(metadata.manifest.signatureUrl);
  const fileName = powershellLiteral(metadata.artifact.fileName);
  const artifactSha = powershellLiteral(metadata.artifact.sha256);
  const artifactSize = metadata.artifact.size;
  const manifestSha = powershellLiteral(metadata.manifest.sha256);
  const keySha = powershellLiteral(metadata.manifest.signingPublicKeySha256);
  const releaseVersion = powershellLiteral(metadata.version);
  const publicKeyBase64 = Buffer.from(
    metadata.manifest.signingPublicKeyPem,
    "utf8"
  ).toString("base64");
  const publicKeyJwk = createPublicKey(metadata.manifest.signingPublicKeyPem).export({
    format: "jwk"
  }) as { kty?: string; n?: string; e?: string };
  if (publicKeyJwk.kty !== "RSA" || !publicKeyJwk.n || !publicKeyJwk.e) {
    throw new DeploymentValidationError(
      "workerPackage.manifest.signingPublicKeyPem",
      "must expose RSA modulus and exponent"
    );
  }
  const publicKeyModulusBase64 = base64UrlToBase64(publicKeyJwk.n);
  const publicKeyExponentBase64 = base64UrlToBase64(publicKeyJwk.e);
  const entrypointParts = metadata.artifact.entrypoint.split("/");
  const packageRoot = entrypointParts[0];
  if (!packageRoot || entrypointParts.length < 2) {
    throw new DeploymentValidationError(
      "workerPackage.artifact.entrypoint",
      "must be inside the official package root"
    );
  }
  const entrypoint = metadata.artifact.entrypoint.replaceAll("/", "\\");
  const portableLauncher = metadata.artifact.launcher!.replaceAll("/", "\\");
  const portableRuntime = `${packageRoot}\\node.exe`;
  const portableAppCli = `${packageRoot}\\app\\desktop-worker\\cli.js`;
  const setup = `$workhouseArchitecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
if ($workhouseArchitecture -ne 'X64') { throw "This Worker package requires Windows x64; detected $workhouseArchitecture." }
$workhouseInstallId = [Guid]::NewGuid().ToString('N')
$workhouseTemp = Join-Path $env:TEMP "claudex-workhouse-worker-install-$workhouseInstallId"
$workhouseTarget = Join-Path $env:LOCALAPPDATA 'Claudex Workhouse Worker'
$workhouseTargetParent = Split-Path -Parent $workhouseTarget
$workhouseStaging = Join-Path $workhouseTargetParent ".claudex-workhouse-worker-staging-$workhouseInstallId"
$workhouseBackup = Join-Path $workhouseTargetParent ".claudex-workhouse-worker-backup-$workhouseInstallId"
$workhouseReplacementComplete = $false
$workhouseTargetReplaced = $false
$workhouseInstallComplete = $false
$workhousePreviousTaskInstalled = $false
foreach ($workhouseReservedPath in @($workhouseTemp, $workhouseStaging, $workhouseBackup)) {
  if (Test-Path -LiteralPath $workhouseReservedPath) { throw "Refusing to reuse installer path: $workhouseReservedPath" }
}
New-Item -ItemType Directory -Path $workhouseTemp, $workhouseStaging | Out-Null
$workhouseArchive = Join-Path $workhouseTemp ${fileName}
$workhouseManifest = Join-Path $workhouseTemp 'release-manifest'
$workhouseSignature = Join-Path $workhouseTemp 'release-manifest.sig'
$workhousePublicKey = Join-Path $workhouseTemp 'release-signing-key.pem'

Add-Type -AssemblyName System.Net.Http
function Receive-WorkhouseHttpsFile {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][long]$MaximumBytes,
    [long]$ExpectedBytes = -1
  )
  $workhouseCurrentUri = [Uri]::new($Uri, [UriKind]::Absolute)
  for ($workhouseRedirectCount = 0; $workhouseRedirectCount -le 5; $workhouseRedirectCount++) {
    if (
      $workhouseCurrentUri.Scheme -ne [Uri]::UriSchemeHttps -or
      -not ([string]::IsNullOrEmpty($workhouseCurrentUri.UserInfo))
    ) {
      throw 'Worker release downloads require an HTTPS URL without embedded credentials.'
    }
    $workhouseHandler = [System.Net.Http.HttpClientHandler]::new()
    $workhouseHandler.AllowAutoRedirect = $false
    $workhouseClient = [System.Net.Http.HttpClient]::new($workhouseHandler)
    $workhouseResponse = $null
    try {
      $workhouseResponse = $workhouseClient.GetAsync(
        $workhouseCurrentUri,
        [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead
      ).GetAwaiter().GetResult()
      $workhouseStatus = [int]$workhouseResponse.StatusCode
      if ($workhouseStatus -in @(301, 302, 303, 307, 308)) {
        if ($workhouseRedirectCount -ge 5) { throw 'Worker release download exceeded five redirects.' }
        $workhouseNextUri = $workhouseResponse.Headers.Location
        if ($null -eq $workhouseNextUri) { throw 'Worker release redirect did not include a Location header.' }
        if (-not $workhouseNextUri.IsAbsoluteUri) {
          $workhouseNextUri = [Uri]::new($workhouseCurrentUri, $workhouseNextUri)
        }
        if ($workhouseNextUri.Scheme -ne [Uri]::UriSchemeHttps) {
          throw 'HTTPS redirect downgrade is not allowed for Worker release downloads.'
        }
        $workhouseCurrentUri = $workhouseNextUri
        continue
      }
      if (-not $workhouseResponse.IsSuccessStatusCode) {
        throw "Worker release download failed with HTTP status $workhouseStatus."
      }
      $workhouseContentLength = $workhouseResponse.Content.Headers.ContentLength
      if ($null -ne $workhouseContentLength -and $workhouseContentLength -gt $MaximumBytes) {
        throw 'Worker release response exceeds its allowed size.'
      }
      if (
        $ExpectedBytes -ge 0 -and
        $null -ne $workhouseContentLength -and
        $workhouseContentLength -ne $ExpectedBytes
      ) {
        throw 'Worker package Content-Length does not match signed metadata.'
      }
      $workhouseInput = $null
      $workhouseOutput = $null
      try {
        $workhouseInput = $workhouseResponse.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $workhouseOutput = [System.IO.File]::Open(
          $Destination,
          [System.IO.FileMode]::CreateNew,
          [System.IO.FileAccess]::Write,
          [System.IO.FileShare]::None
        )
        $workhouseBuffer = New-Object byte[] 81920
        [long]$workhouseDownloadedBytes = 0
        while (($workhouseReadBytes = $workhouseInput.Read($workhouseBuffer, 0, $workhouseBuffer.Length)) -gt 0) {
          $workhouseDownloadedBytes += $workhouseReadBytes
          if ($workhouseDownloadedBytes -gt $MaximumBytes) {
            throw 'Worker release response exceeds its allowed size.'
          }
          $workhouseOutput.Write($workhouseBuffer, 0, $workhouseReadBytes)
        }
      } finally {
        if ($null -ne $workhouseOutput) { $workhouseOutput.Dispose() }
        if ($null -ne $workhouseInput) { $workhouseInput.Dispose() }
      }
      if ($ExpectedBytes -ge 0 -and $workhouseDownloadedBytes -ne $ExpectedBytes) {
        throw 'Worker package size does not match signed metadata.'
      }
      return
    } finally {
      if ($null -ne $workhouseResponse) { $workhouseResponse.Dispose() }
      $workhouseClient.Dispose()
      $workhouseHandler.Dispose()
    }
  }
  throw 'Worker release download redirect handling failed.'
}`;
  const download = `Receive-WorkhouseHttpsFile -Uri ${packageUrl} -Destination $workhouseArchive -MaximumBytes ${artifactSize} -ExpectedBytes ${artifactSize}
Receive-WorkhouseHttpsFile -Uri ${manifestUrl} -Destination $workhouseManifest -MaximumBytes ${manifestMaximumBytes}
Receive-WorkhouseHttpsFile -Uri ${signatureUrl} -Destination $workhouseSignature -MaximumBytes ${signatureMaximumBytes}`;
  const verify = `[System.IO.File]::WriteAllBytes($workhousePublicKey, [Convert]::FromBase64String(${powershellLiteral(publicKeyBase64)}))
if ((Get-FileHash -Algorithm SHA256 $workhousePublicKey).Hash.ToLowerInvariant() -ne ${keySha}) { throw 'Release signing key fingerprint mismatch.' }
if ((Get-FileHash -Algorithm SHA256 $workhouseManifest).Hash.ToLowerInvariant() -ne ${manifestSha}) { throw 'Release manifest digest mismatch.' }
$workhouseRsaParameters = New-Object System.Security.Cryptography.RSAParameters
$workhouseRsaParameters.Modulus = [Convert]::FromBase64String(${powershellLiteral(publicKeyModulusBase64)})
$workhouseRsaParameters.Exponent = [Convert]::FromBase64String(${powershellLiteral(publicKeyExponentBase64)})
$workhouseRsa = [System.Security.Cryptography.RSA]::Create()
try {
  $workhouseRsa.ImportParameters($workhouseRsaParameters)
  $workhouseSignatureValid = $workhouseRsa.VerifyData(
    [System.IO.File]::ReadAllBytes($workhouseManifest),
    [System.IO.File]::ReadAllBytes($workhouseSignature),
    [System.Security.Cryptography.HashAlgorithmName]::SHA256,
    [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
  )
} finally {
  $workhouseRsa.Dispose()
}
if (-not $workhouseSignatureValid) { throw 'Release manifest signature verification failed.' }
if (-not (Select-String -SimpleMatch ${releaseVersion} -Path $workhouseManifest -Quiet)) { throw 'Signed manifest does not contain the selected Worker version.' }
if (-not (Select-String -SimpleMatch ${artifactSha} -Path $workhouseManifest -Quiet)) { throw 'Signed manifest does not contain the Worker artifact digest.' }
if ((Get-Item -LiteralPath $workhouseArchive).Length -ne ${artifactSize}) { throw 'Worker package size mismatch.' }
if ((Get-FileHash -Algorithm SHA256 $workhouseArchive).Hash.ToLowerInvariant() -ne ${artifactSha}) { throw 'Worker package digest mismatch.' }`;
  const extract = `Add-Type -AssemblyName System.IO.Compression.FileSystem
$workhouseStagingRoot = [System.IO.Path]::GetFullPath(
  $workhouseStaging + [System.IO.Path]::DirectorySeparatorChar
)
$workhouseSeenEntries = [System.Collections.Generic.HashSet[string]]::new(
  [System.StringComparer]::OrdinalIgnoreCase
)
[long]$workhouseExpandedBytes = 0
$workhouseEntryCount = 0
$workhouseZip = [System.IO.Compression.ZipFile]::OpenRead($workhouseArchive)
try {
  foreach ($workhouseEntry in $workhouseZip.Entries) {
    $workhouseEntryCount++
    if ($workhouseEntryCount -gt ${archiveEntryMaximumCount}) {
      throw 'Worker ZIP contains too many entries.'
    }
    $workhouseEntryName = $workhouseEntry.FullName
    $workhouseTrimmedEntryName = $workhouseEntryName.TrimEnd('/')
    if (
      [string]::IsNullOrWhiteSpace($workhouseTrimmedEntryName) -or
      $workhouseEntryName.StartsWith('/') -or
      $workhouseEntryName.Contains('\\') -or
      $workhouseEntryName.Contains(':') -or
      $workhouseEntryName.Contains('//') -or
      [System.IO.Path]::IsPathRooted($workhouseEntryName)
    ) {
      throw 'Worker ZIP contains an unsafe entry path.'
    }
    foreach ($workhousePathSegment in $workhouseTrimmedEntryName.Split('/')) {
      if (
        [string]::IsNullOrWhiteSpace($workhousePathSegment) -or
        $workhousePathSegment -eq '.' -or
        $workhousePathSegment -eq '..'
      ) {
        throw 'Worker ZIP contains an unsafe entry path.'
      }
    }
    $workhouseEntryDestination = [System.IO.Path]::GetFullPath(
      (Join-Path $workhouseStaging $workhouseEntryName.Replace('/', [System.IO.Path]::DirectorySeparatorChar))
    )
    if (-not $workhouseEntryDestination.StartsWith(
      $workhouseStagingRoot,
      [System.StringComparison]::OrdinalIgnoreCase
    )) {
      throw 'Worker ZIP entry escapes the staging directory.'
    }
    if (-not $workhouseSeenEntries.Add($workhouseEntryDestination)) {
      throw 'Worker ZIP contains duplicate or case-colliding entry paths.'
    }
    $workhouseUnixEntryType = (([long]$workhouseEntry.ExternalAttributes -shr 16) -band 0xF000)
    if ($workhouseUnixEntryType -eq 0xA000) {
      throw 'Worker ZIP contains a symbolic link.'
    }
    if (
      ($workhouseEntry.ExternalAttributes -band [int][System.IO.FileAttributes]::ReparsePoint) -ne 0
    ) {
      throw 'Worker ZIP contains a reparse-point entry.'
    }
    $workhouseExpandedBytes += $workhouseEntry.Length
    if ($workhouseExpandedBytes -gt ${expandedArchiveMaximumBytes}) {
      throw 'Worker ZIP expands beyond the allowed size.'
    }
  }
} finally {
  $workhouseZip.Dispose()
}
[System.IO.Compression.ZipFile]::ExtractToDirectory($workhouseArchive, $workhouseStaging)
$workhouseReparsePoint = Get-ChildItem -LiteralPath $workhouseStaging -Force -Recurse |
  Where-Object { ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 } |
  Select-Object -First 1
if ($null -ne $workhouseReparsePoint) { throw 'Extracted Worker package contains a reparse point.' }
if (-not (Test-Path -LiteralPath (Join-Path $workhouseStaging ${powershellLiteral(entrypoint)}) -PathType Leaf)) { throw 'Worker CLI is missing from the verified package.' }
if (-not (Test-Path -LiteralPath (Join-Path $workhouseStaging ${powershellLiteral(portableLauncher)}) -PathType Leaf)) { throw 'Worker UI launcher is missing from the verified package.' }
if (-not (Test-Path -LiteralPath (Join-Path $workhouseStaging ${powershellLiteral(portableRuntime)}) -PathType Leaf)) { throw 'Bundled Worker runtime is missing from the verified package.' }
if (-not (Test-Path -LiteralPath (Join-Path $workhouseStaging ${powershellLiteral(portableAppCli)}) -PathType Leaf)) { throw 'Bundled Worker application is missing from the verified package.' }
$workhousePreviousInstallMoved = $false
try {
  if (Get-Command schtasks.exe -ErrorAction SilentlyContinue) {
    & schtasks.exe /Query /TN 'ClaudexWorkhouseWorker' *> $null
    if ($LASTEXITCODE -eq 0) {
      $workhousePreviousTaskInstalled = $true
      & schtasks.exe /End /TN 'ClaudexWorkhouseWorker' *> $null
      $workhouseRuntimePath = Join-Path $workhouseTarget ${powershellLiteral(portableRuntime)}
      $workhouseRunningProcesses = @()
      for ($workhouseStopAttempt = 0; $workhouseStopAttempt -lt 40; $workhouseStopAttempt++) {
        $workhouseRunningProcesses = @(
          Get-CimInstance Win32_Process -ErrorAction Stop |
            Where-Object {
              -not [string]::IsNullOrWhiteSpace([string]$_.ExecutablePath) -and
              [string]::Equals(
                [System.IO.Path]::GetFullPath([string]$_.ExecutablePath),
                [System.IO.Path]::GetFullPath($workhouseRuntimePath),
                [System.StringComparison]::OrdinalIgnoreCase
              )
            }
        )
        if ($workhouseRunningProcesses.Count -eq 0) { break }
        Start-Sleep -Milliseconds 250
      }
      if ($workhouseRunningProcesses.Count -gt 0) {
        throw 'The existing Worker or one of its active jobs is still running. Stop its jobs and retry the update.'
      }
      & schtasks.exe /Delete /F /TN 'ClaudexWorkhouseWorker' *> $null
      if ($LASTEXITCODE -ne 0) {
        throw 'The existing Worker auto-start task could not be removed safely.'
      }
    }
  }
  if (Test-Path -LiteralPath $workhouseTarget) {
    Move-Item -LiteralPath $workhouseTarget -Destination $workhouseBackup
    $workhousePreviousInstallMoved = $true
  }
  Move-Item -LiteralPath $workhouseStaging -Destination $workhouseTarget
  [System.IO.File]::WriteAllText((Join-Path $workhouseTarget '.claudex-package-sha256'), ${artifactSha} + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
  $workhouseStaging = $null
  $workhouseTargetReplaced = $true
} catch {
  if ($workhouseTargetReplaced -and (Test-Path -LiteralPath $workhouseTarget)) {
    Remove-Item -LiteralPath $workhouseTarget -Recurse -Force
    $workhouseTargetReplaced = $false
  }
  if ($workhousePreviousInstallMoved -and (Test-Path -LiteralPath $workhouseBackup)) {
    Move-Item -LiteralPath $workhouseBackup -Destination $workhouseTarget
    $workhouseBackup = $null
  }
  if (
    $workhousePreviousTaskInstalled -and
    (Test-Path -LiteralPath (Join-Path $workhouseTarget ${powershellLiteral(entrypoint)}) -PathType Leaf)
  ) {
    & (Join-Path $workhouseTarget ${powershellLiteral(entrypoint)}) install-service
    if ($LASTEXITCODE -ne 0) {
      Write-Warning 'The previous Worker was restored, but its current-user auto-start task could not be restored.'
    }
  }
  throw
}
}`;
  const launcher = `& (Join-Path $workhouseTarget ${powershellLiteral(portableLauncher)})`;
  const pair = `& (Join-Path $workhouseTarget ${powershellLiteral(entrypoint)}) pair --url ${powershellLiteral(serverOrigin)} --code ${powershellLiteral(pairingCode)}
if ($LASTEXITCODE -ne 0) { throw 'Worker pairing failed.' }`;
  const autoStart = `& (Join-Path $workhouseTarget ${powershellLiteral(entrypoint)}) install-service
if ($LASTEXITCODE -ne 0) { throw 'Worker current-user auto-start setup failed.' }
$workhouseInstallComplete = $true
$workhouseReplacementComplete = $true
if (Test-Path -LiteralPath $workhouseBackup) {
  Remove-Item -LiteralPath $workhouseBackup -Recurse -Force
}
$workhouseBackup = $null`;
  return Object.freeze([
    Object.freeze({ id: "prepare", label: "Create current-user folders", shell: "powershell", command: setup, containsPairingCode: false }),
    Object.freeze({ id: "download", label: "Download the signed release files", shell: "powershell", command: download, containsPairingCode: false }),
    Object.freeze({ id: "verify-release", label: "Verify release signature and package digest", shell: "powershell", command: verify, containsPairingCode: false }),
    Object.freeze({ id: "extract", label: "Extract and validate the portable Worker", shell: "powershell", command: extract, containsPairingCode: false }),
    Object.freeze({ id: "pair", label: "Pair from the CLI instead of the UI", shell: "powershell", command: pair, containsPairingCode: true }),
    Object.freeze({ id: "auto-start", label: "Enable current-user logon auto-start", shell: "powershell", command: autoStart, containsPairingCode: false }),
    Object.freeze({ id: "launch", label: "Open the current-user Worker UI", shell: "powershell", command: launcher, containsPairingCode: false })
  ]);
}

function linuxCommands(
  metadata: TrustedWorkerPackageMetadata,
  serverOrigin: string,
  pairingCode: string
): readonly WorkerInstallCommand[] {
  const manifestMaximumBytes = 1_048_576;
  const signatureMaximumBytes = 16_384;
  const fileName = shellLiteral(metadata.artifact.fileName);
  const publicKey = metadata.manifest.signingPublicKeyPem.trimEnd();
  const entrypointParts = metadata.artifact.entrypoint.split("/");
  const packageRoot = entrypointParts[0];
  if (!packageRoot || entrypointParts.length < 3) {
    throw new DeploymentValidationError(
      "workerPackage.artifact.entrypoint",
      "must be inside the official Linux package root"
    );
  }
  const entrypoint = shellLiteral(metadata.artifact.entrypoint);
  const portableRuntime = shellLiteral(`${packageRoot}/runtime/node`);
  const portableAppCli = shellLiteral(`${packageRoot}/app/desktop-worker/cli.js`);
  const requestedArchitecture = shellLiteral(metadata.architecture);
  const setup = `umask 077
case "$(uname -m)" in
  x86_64|amd64) WORKHOUSE_ARCHITECTURE=x64 ;;
  aarch64|arm64) WORKHOUSE_ARCHITECTURE=arm64 ;;
  *) printf 'Unsupported Worker architecture: %s\\n' "$(uname -m)" >&2; exit 1 ;;
esac
test "$WORKHOUSE_ARCHITECTURE" = ${requestedArchitecture} || {
  printf 'Worker package architecture does not match this host.\\n' >&2
  exit 1
}
WORKHOUSE_TEMP="$(mktemp -d "\${TMPDIR:-/tmp}/claudex-workhouse-worker-install.XXXXXX")"
WORKHOUSE_TARGET="\${XDG_DATA_HOME:-$HOME/.local/share}/claudex-workhouse-worker"
WORKHOUSE_TARGET_PARENT="$(dirname -- "$WORKHOUSE_TARGET")"
mkdir -p "$WORKHOUSE_TARGET_PARENT"
WORKHOUSE_STAGING="$(mktemp -d "$WORKHOUSE_TARGET_PARENT/.claudex-workhouse-worker-staging.XXXXXX")"
WORKHOUSE_BACKUP="$WORKHOUSE_STAGING.backup"
WORKHOUSE_REPLACEMENT_COMPLETE=0
test ! -e "$WORKHOUSE_BACKUP" || {
  printf 'Refusing to reuse Worker backup path.\\n' >&2
  exit 1
}
WORKHOUSE_ARCHIVE="$WORKHOUSE_TEMP"/${fileName}
WORKHOUSE_MANIFEST="$WORKHOUSE_TEMP/release-manifest"
WORKHOUSE_SIGNATURE="$WORKHOUSE_TEMP/release-manifest.sig"
WORKHOUSE_PUBLIC_KEY="$WORKHOUSE_TEMP/release-signing-key.pem"`;
  const download = `workhouse_download_bounded() {
  WORKHOUSE_DOWNLOAD_URL=$1
  WORKHOUSE_DOWNLOAD_DESTINATION=$2
  WORKHOUSE_DOWNLOAD_MAXIMUM=$3
  curl --fail --show-error --silent --location --max-redirs 5 --proto '=https' --proto-redir '=https' --max-filesize "$WORKHOUSE_DOWNLOAD_MAXIMUM" --url "$WORKHOUSE_DOWNLOAD_URL" |
    head -c "$((WORKHOUSE_DOWNLOAD_MAXIMUM + 1))" >"$WORKHOUSE_DOWNLOAD_DESTINATION"
  WORKHOUSE_DOWNLOAD_SIZE="$(wc -c <"$WORKHOUSE_DOWNLOAD_DESTINATION" | tr -d '[:space:]')"
  test "$WORKHOUSE_DOWNLOAD_SIZE" -le "$WORKHOUSE_DOWNLOAD_MAXIMUM" || {
    printf 'Worker release response exceeds its allowed size.\\n' >&2
    exit 1
  }
}
workhouse_download_bounded ${shellLiteral(metadata.artifact.url)} "$WORKHOUSE_ARCHIVE" ${metadata.artifact.size}
workhouse_download_bounded ${shellLiteral(metadata.manifest.url)} "$WORKHOUSE_MANIFEST" ${manifestMaximumBytes}
workhouse_download_bounded ${shellLiteral(metadata.manifest.signatureUrl)} "$WORKHOUSE_SIGNATURE" ${signatureMaximumBytes}`;
  const verify = `cat >"$WORKHOUSE_PUBLIC_KEY" <<'CLAUDEX_WORKER_RELEASE_KEY'
${publicKey}
CLAUDEX_WORKER_RELEASE_KEY
test "$(wc -c <"$WORKHOUSE_MANIFEST" | tr -d '[:space:]')" -le ${shellLiteral(String(manifestMaximumBytes))} || {
  printf 'Worker release manifest exceeds its allowed size.\\n' >&2
  exit 1
}
test "$(wc -c <"$WORKHOUSE_SIGNATURE" | tr -d '[:space:]')" -le ${shellLiteral(String(signatureMaximumBytes))} || {
  printf 'Worker release signature exceeds its allowed size.\\n' >&2
  exit 1
}
printf '%s  %s\\n' ${shellLiteral(metadata.manifest.signingPublicKeySha256)} "$WORKHOUSE_PUBLIC_KEY" | sha256sum -c -
printf '%s  %s\\n' ${shellLiteral(metadata.manifest.sha256)} "$WORKHOUSE_MANIFEST" | sha256sum -c -
openssl dgst -sha256 -verify "$WORKHOUSE_PUBLIC_KEY" -signature "$WORKHOUSE_SIGNATURE" "$WORKHOUSE_MANIFEST"
grep -F -- ${shellLiteral(metadata.version)} "$WORKHOUSE_MANIFEST" >/dev/null
grep -F -- ${shellLiteral(metadata.artifact.sha256)} "$WORKHOUSE_MANIFEST" >/dev/null
test "$(wc -c <"$WORKHOUSE_ARCHIVE" | tr -d '[:space:]')" = ${shellLiteral(String(metadata.artifact.size))} || {
  printf 'Worker package size mismatch.\\n' >&2
  exit 1
}
printf '%s  %s\\n' ${shellLiteral(metadata.artifact.sha256)} "$WORKHOUSE_ARCHIVE" | sha256sum -c -`;
  const extract = `WORKHOUSE_ARCHIVE_ENTRIES="$WORKHOUSE_TEMP/archive-entries.txt"
WORKHOUSE_ARCHIVE_VERBOSE="$WORKHOUSE_TEMP/archive-entries-verbose.txt"
tar -tzf "$WORKHOUSE_ARCHIVE" >"$WORKHOUSE_ARCHIVE_ENTRIES"
while IFS= read -r WORKHOUSE_ARCHIVE_ENTRY; do
  case "$WORKHOUSE_ARCHIVE_ENTRY" in
    ''|/*|*\\\\*|*:*|*//*)
      printf 'Worker archive contains an unsafe path.\\n' >&2
      exit 1
      ;;
  esac
  case "/\${WORKHOUSE_ARCHIVE_ENTRY%/}/" in
    */../*|*/./*)
      printf 'Worker archive contains a path traversal component.\\n' >&2
      exit 1
      ;;
  esac
done <"$WORKHOUSE_ARCHIVE_ENTRIES"
LC_ALL=C tar -tvzf "$WORKHOUSE_ARCHIVE" >"$WORKHOUSE_ARCHIVE_VERBOSE"
if grep -Ev '^[-d]' "$WORKHOUSE_ARCHIVE_VERBOSE" >/dev/null; then
  printf 'Worker archive contains a symbolic link, hard link, or special file.\\n' >&2
  exit 1
fi
tar -xzf "$WORKHOUSE_ARCHIVE" --no-same-owner --no-same-permissions -C "$WORKHOUSE_STAGING"
if find "$WORKHOUSE_STAGING" -type l -print -quit | grep . >/dev/null; then
  printf 'Extracted Worker package contains a symbolic link.\\n' >&2
  exit 1
fi
test -x "$(printf '%s/%s' "$WORKHOUSE_STAGING" ${entrypoint})" || {
  printf 'Worker executable is missing from the verified package.\\n' >&2
  exit 1
}
test -x "$(printf '%s/%s' "$WORKHOUSE_STAGING" ${portableRuntime})" || {
  printf 'Bundled Worker runtime is missing from the verified package.\\n' >&2
  exit 1
}
test -f "$(printf '%s/%s' "$WORKHOUSE_STAGING" ${portableAppCli})" || {
  printf 'Bundled Worker application is missing from the verified package.\\n' >&2
  exit 1
}
WORKHOUSE_PREVIOUS_INSTALL_MOVED=0
if [ -e "$WORKHOUSE_TARGET" ] || [ -L "$WORKHOUSE_TARGET" ]; then
  mv -- "$WORKHOUSE_TARGET" "$WORKHOUSE_BACKUP"
  WORKHOUSE_PREVIOUS_INSTALL_MOVED=1
fi
if mv -- "$WORKHOUSE_STAGING" "$WORKHOUSE_TARGET"; then
  WORKHOUSE_STAGING=
  printf '%s\n' ${shellLiteral(metadata.artifact.sha256)} >"$WORKHOUSE_TARGET/.claudex-package-sha256"
  chmod 600 "$WORKHOUSE_TARGET/.claudex-package-sha256"
  WORKHOUSE_REPLACEMENT_COMPLETE=1
else
  WORKHOUSE_MOVE_STATUS=$?
  if [ "$WORKHOUSE_PREVIOUS_INSTALL_MOVED" -eq 1 ] && [ -e "$WORKHOUSE_BACKUP" ]; then
    mv -- "$WORKHOUSE_BACKUP" "$WORKHOUSE_TARGET"
    WORKHOUSE_BACKUP=
  fi
  exit "$WORKHOUSE_MOVE_STATUS"
fi
if [ "$WORKHOUSE_PREVIOUS_INSTALL_MOVED" -eq 1 ] && [ -e "$WORKHOUSE_BACKUP" ]; then
  rm -rf -- "$WORKHOUSE_BACKUP"
  WORKHOUSE_BACKUP=
fi`;
  const launcher = `"$(printf '%s/%s' "$WORKHOUSE_TARGET" ${entrypoint})" status`;
  const pair = `"$(printf '%s/%s' "$WORKHOUSE_TARGET" ${entrypoint})" pair --url ${shellLiteral(serverOrigin)} --code ${shellLiteral(pairingCode)}`;
  const autoStart = `"$(printf '%s/%s' "$WORKHOUSE_TARGET" ${entrypoint})" install-service`;
  return Object.freeze([
    Object.freeze({ id: "prepare", label: "Create current-user folders", shell: "sh", command: setup, containsPairingCode: false }),
    Object.freeze({ id: "download", label: "Download the signed release files", shell: "sh", command: download, containsPairingCode: false }),
    Object.freeze({ id: "verify-release", label: "Verify release signature and package digest", shell: "sh", command: verify, containsPairingCode: false }),
    Object.freeze({ id: "extract", label: "Extract the portable Worker", shell: "sh", command: extract, containsPairingCode: false }),
    Object.freeze({ id: "launch", label: "Check the current-user Worker", shell: "sh", command: launcher, containsPairingCode: false }),
    Object.freeze({ id: "pair", label: "Pair the Worker", shell: "sh", command: pair, containsPairingCode: true }),
    Object.freeze({ id: "auto-start", label: "Enable the systemd user service", shell: "sh", command: autoStart, containsPairingCode: false })
  ]);
}

export function createWorkerInstallInstructions(
  inputPlan: DeploymentPlan,
  options: WorkerInstallOptions
): WorkerInstallInstructions {
  const plan = validateDeploymentPlan(inputPlan);
  if (plan.target !== "worker") {
    throw new DeploymentValidationError("target", "only Worker plans produce Worker instructions");
  }
  if (!options?.workerPackage) {
    throw new DeploymentValidationError(
      "workerPackage",
      "trusted Worker package metadata is not configured; instructions are disabled"
    );
  }
  if (!plan.architecture) {
    throw new DeploymentValidationError(
      "architecture",
      "select or detect the Worker architecture before choosing a package"
    );
  }
  const metadata = validateTrustedWorkerPackageMetadata(options.workerPackage);
  if (metadata.platform !== plan.platform || metadata.architecture !== plan.architecture) {
    throw new DeploymentValidationError(
      "workerPackage",
      "package platform and architecture must match the deployment plan"
    );
  }
  const serverOrigin = validateServerOrigin(options.serverOrigin, plan.publicAccess);
  const pairingCode = validatePairingCode(options.pairingCode);
  const windows = plan.platform === "windows";
  const commands = windows
    ? windowsCommands(metadata, serverOrigin, pairingCode)
    : linuxCommands(metadata, serverOrigin, pairingCode);
  return Object.freeze({
    kind: "claudex-worker-install-instructions",
    formatVersion: 1,
    plan,
    package: Object.freeze({
      version: metadata.version,
      url: metadata.artifact.url,
      sha256: metadata.artifact.sha256,
      size: metadata.artifact.size,
      fileName: metadata.artifact.fileName,
      signingPublicKeySha256: metadata.manifest.signingPublicKeySha256
    }),
    userScope: "current-user",
    serviceType: windows ? "current-user-logon-task" : "systemd-user",
    prerequisites: Object.freeze([
      windows
        ? "Windows PowerShell 5.1 or newer; the verified portable package supplies its runtime"
        : "curl, OpenSSL, sha256sum, and tar; the verified portable package supplies its Node.js runtime",
      "A one-time Worker pairing code from the target Claudex Workhouse server"
    ]),
    commands,
    notes: Object.freeze([
      "Run these commands as the desktop user whose provider login and Workspace files the Worker will use.",
      "Do not run the Worker as SYSTEM or root.",
      "The pairing command contains a short-lived one-time code; do not save it in scripts or logs.",
      "Provider credentials remain on this execution host and are not copied by the installer."
    ])
  });
}

export function renderWorkerInstallScript(instructions: WorkerInstallInstructions): string {
  const shells = new Set(instructions.commands.map((command) => command.shell));
  if (shells.size !== 1) {
    throw new DeploymentValidationError("commands", "Worker install commands must use one shell");
  }
  const shell = instructions.commands[0]?.shell;
  if (shell !== "sh" && shell !== "powershell") {
    throw new DeploymentValidationError("commands", "Worker install commands are unavailable");
  }
  const body = instructions.commands.map((command) => command.command).join("\n\n");
  if (shell === "powershell") {
    return `$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$workhouseTemp = $null
$workhouseStaging = $null
$workhouseBackup = $null
$workhouseTarget = $null
$workhouseReplacementComplete = $false
$workhouseTargetReplaced = $false
$workhouseInstallComplete = $false
$workhousePreviousTaskInstalled = $false
try {
${body}
} finally {
  if (-not $workhouseInstallComplete -and $workhouseTargetReplaced) {
    try {
      if (Get-Command schtasks.exe -ErrorAction SilentlyContinue) {
        & schtasks.exe /End /TN 'ClaudexWorkhouseWorker' *> $null
        & schtasks.exe /Delete /F /TN 'ClaudexWorkhouseWorker' *> $null
      }
      if (
        -not ([string]::IsNullOrWhiteSpace([string]$workhouseTarget)) -and
        (Test-Path -LiteralPath $workhouseTarget)
      ) {
        Remove-Item -LiteralPath $workhouseTarget -Recurse -Force
      }
      if (
        -not ([string]::IsNullOrWhiteSpace([string]$workhouseBackup)) -and
        (Test-Path -LiteralPath $workhouseBackup)
      ) {
        Move-Item -LiteralPath $workhouseBackup -Destination $workhouseTarget
        $workhouseBackup = $null
      }
      if (
        $workhousePreviousTaskInstalled -and
        -not ([string]::IsNullOrWhiteSpace([string]$workhouseTarget)) -and
        (Test-Path -LiteralPath (Join-Path $workhouseTarget ${powershellLiteral("claudex-workhouse-worker-windows-x64\\Worker CLI.cmd")}) -PathType Leaf)
      ) {
        & (Join-Path $workhouseTarget ${powershellLiteral("claudex-workhouse-worker-windows-x64\\Worker CLI.cmd")}) install-service
        if ($LASTEXITCODE -ne 0) {
          Write-Warning 'The previous Worker files were restored, but its current-user auto-start task could not be restored.'
        }
      }
    } catch {
      Write-Warning "Worker installer could not restore its previous installation: $($_.Exception.Message)"
    }
  }
  if (
    -not ([string]::IsNullOrWhiteSpace([string]$workhouseBackup)) -and
    (Test-Path -LiteralPath $workhouseBackup)
  ) {
    try {
      if (
        -not ([string]::IsNullOrWhiteSpace([string]$workhouseTarget)) -and
        -not (Test-Path -LiteralPath $workhouseTarget)
      ) {
        Move-Item -LiteralPath $workhouseBackup -Destination $workhouseTarget
        $workhouseBackup = $null
      } elseif ($workhouseInstallComplete) {
        Remove-Item -LiteralPath $workhouseBackup -Recurse -Force
        $workhouseBackup = $null
      }
    } catch {
      Write-Warning "Worker installer could not restore or remove its backup: $($_.Exception.Message)"
    }
  }
  foreach ($workhouseCleanupPath in @($workhouseStaging, $workhouseTemp)) {
    if (
      -not ([string]::IsNullOrWhiteSpace([string]$workhouseCleanupPath)) -and
      (Test-Path -LiteralPath $workhouseCleanupPath)
    ) {
      try {
        Remove-Item -LiteralPath $workhouseCleanupPath -Recurse -Force
      } catch {
        Write-Warning "Worker installer could not remove staging data: $($_.Exception.Message)"
      }
    }
  }
}`;
  }
  return `set -eu
WORKHOUSE_TEMP=
WORKHOUSE_STAGING=
WORKHOUSE_BACKUP=
WORKHOUSE_TARGET=
WORKHOUSE_REPLACEMENT_COMPLETE=0
workhouse_cleanup() {
  WORKHOUSE_CLEANUP_STATUS=$?
  trap - EXIT HUP INT TERM
  set +e
  if [ -n "$WORKHOUSE_BACKUP" ] && { [ -e "$WORKHOUSE_BACKUP" ] || [ -L "$WORKHOUSE_BACKUP" ]; }; then
    if [ -n "$WORKHOUSE_TARGET" ] && ! { [ -e "$WORKHOUSE_TARGET" ] || [ -L "$WORKHOUSE_TARGET" ]; }; then
      mv -- "$WORKHOUSE_BACKUP" "$WORKHOUSE_TARGET"
      WORKHOUSE_BACKUP=
    elif [ "$WORKHOUSE_REPLACEMENT_COMPLETE" -eq 1 ]; then
      rm -rf -- "$WORKHOUSE_BACKUP"
      WORKHOUSE_BACKUP=
    fi
  fi
  if [ -n "$WORKHOUSE_STAGING" ] && { [ -e "$WORKHOUSE_STAGING" ] || [ -L "$WORKHOUSE_STAGING" ]; }; then
    rm -rf -- "$WORKHOUSE_STAGING"
  fi
  if [ -n "$WORKHOUSE_TEMP" ] && { [ -e "$WORKHOUSE_TEMP" ] || [ -L "$WORKHOUSE_TEMP" ]; }; then
    rm -rf -- "$WORKHOUSE_TEMP"
  fi
  exit "$WORKHOUSE_CLEANUP_STATUS"
}
trap workhouse_cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

${body}`;
}
