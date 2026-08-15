import type { VerifiedRelease } from "./types";

function powershellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export interface WindowsDockerDownload {
  readonly fileName: string;
  readonly content: string;
  readonly launchCommand: string;
}

/**
 * Emit a current-user bootstrap for the recommended Windows deployment:
 * Docker Desktop hosts the main server while the native Worker keeps provider
 * credentials and Workspace access in the interactive Windows account.
 */
export function createWindowsDockerDownload(
  release: VerifiedRelease
): WindowsDockerDownload {
  const key = release.verifiedKey;
  const server = release.manifest.server;
  const fileName = `install-claudex-workhouse-docker-${release.manifest.version}.ps1`;
  const launchCommand =
    `powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ` +
    `"$env:USERPROFILE\\Downloads\\${fileName}"`;
  const imageReference = `${server.image}:${server.tag}@${server.digest}`;
  const content = `$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$workhouseVersion = ${powershellLiteral(release.manifest.version)}
$workhouseKeyId = ${powershellLiteral(key.keyId)}
$workhouseKeyNotBefore = ${powershellLiteral(key.notBefore)}
$workhouseKeyExpiresAt = ${powershellLiteral(key.expiresAt)}
$workhouseManifestBase64 = ${powershellLiteral(base64(release.manifestBytes))}
$workhouseSignatureBase64 = ${powershellLiteral(base64(release.signatureBytes))}
$workhouseModulusBase64 = ${powershellLiteral(key.modulusBase64)}
$workhouseExponentBase64 = ${powershellLiteral(key.exponentBase64)}
$workhouseImage = ${powershellLiteral(server.image)}
$workhouseImageTag = ${powershellLiteral(server.tag)}
$workhouseImageDigest = ${powershellLiteral(server.digest)}
$workhouseImageReference = ${powershellLiteral(imageReference)}
$workhouseManifest = [Convert]::FromBase64String($workhouseManifestBase64)
$workhouseSignature = [Convert]::FromBase64String($workhouseSignatureBase64)

$workhouseNow = [DateTimeOffset]::UtcNow
$workhouseKeyStart = [DateTimeOffset]::Parse(
  $workhouseKeyNotBefore,
  [Globalization.CultureInfo]::InvariantCulture,
  [Globalization.DateTimeStyles]::AssumeUniversal
)
$workhouseKeyEnd = [DateTimeOffset]::Parse(
  $workhouseKeyExpiresAt,
  [Globalization.CultureInfo]::InvariantCulture,
  [Globalization.DateTimeStyles]::AssumeUniversal
)
if ($workhouseNow -lt $workhouseKeyStart -or $workhouseNow -ge $workhouseKeyEnd) {
  throw 'The pinned release signing key is not currently valid.'
}

$workhouseRsaParameters = New-Object System.Security.Cryptography.RSAParameters
$workhouseRsaParameters.Modulus = [Convert]::FromBase64String($workhouseModulusBase64)
$workhouseRsaParameters.Exponent = [Convert]::FromBase64String($workhouseExponentBase64)
$workhouseRsa = [System.Security.Cryptography.RSA]::Create()
try {
  $workhouseRsa.ImportParameters($workhouseRsaParameters)
  $workhouseSignatureValid = $workhouseRsa.VerifyData(
    $workhouseManifest,
    $workhouseSignature,
    [System.Security.Cryptography.HashAlgorithmName]::SHA256,
    [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
  )
} finally {
  $workhouseRsa.Dispose()
}
if (-not $workhouseSignatureValid) {
  throw 'The embedded release manifest signature is invalid.'
}

$workhouseRelease = [Text.Encoding]::UTF8.GetString($workhouseManifest) | ConvertFrom-Json
$workhousePlatforms = @($workhouseRelease.server.platforms)
if (
  $workhouseRelease.schemaVersion -notin @(1, 2, 3) -or
  $workhouseRelease.version -ne $workhouseVersion -or
  $workhouseRelease.signing.keyId -ne $workhouseKeyId -or
  $workhouseRelease.signing.algorithm -ne 'rsa-sha256' -or
  $workhouseRelease.server.image -ne $workhouseImage -or
  $workhouseRelease.server.tag -ne $workhouseImageTag -or
  $workhouseRelease.server.digest -ne $workhouseImageDigest -or
  $workhousePlatforms -notcontains 'linux/amd64'
) {
  throw 'The signed manifest does not match the selected Docker Desktop image.'
}
$workhousePublished = [DateTimeOffset]::Parse(
  [string]$workhouseRelease.publishedAt,
  [Globalization.CultureInfo]::InvariantCulture,
  [Globalization.DateTimeStyles]::AssumeUniversal
)
$workhouseExpires = [DateTimeOffset]::Parse(
  [string]$workhouseRelease.expiresAt,
  [Globalization.CultureInfo]::InvariantCulture,
  [Globalization.DateTimeStyles]::AssumeUniversal
)
if (
  $workhousePublished -gt $workhouseNow.AddMinutes(5) -or
  $workhouseExpires -le $workhouseNow -or
  $workhousePublished -lt $workhouseKeyStart -or
  $workhouseExpires -gt $workhouseKeyEnd
) {
  throw 'The signed release manifest is expired or outside the signing-key validity window.'
}

$docker = Get-Command docker -ErrorAction SilentlyContinue
if ($null -eq $docker) {
  throw 'Docker Desktop is not installed or docker.exe is not on PATH. Install Docker Desktop, start it, and run this file again.'
}
& $docker.Source version --format '{{.Server.Version}}' | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw 'Docker Desktop is installed but its Linux container engine is not ready.'
}
& $docker.Source compose version --short | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw 'Docker Compose v2 is required.'
}

$workhouseRoot = Join-Path $env:LOCALAPPDATA 'Claudex Workhouse Docker'
$workhouseComposeFile = Join-Path $workhouseRoot 'compose.yaml'
$workhouseComposeMarker = Join-Path $workhouseRoot '.installer-owned-compose.sha256'
[IO.Directory]::CreateDirectory($workhouseRoot) | Out-Null
$workhouseCompose = @'
name: claudex-workhouse
services:
  claudex-workhouse:
    image: ${imageReference}
    restart: unless-stopped
    user: "10001:10001"
    ports:
      - "127.0.0.1:3410:3410"
    environment:
      CLAUDEX_WORKHOUSE_ROOT: /opt/claudex-workhouse
      HOME: /opt/claudex-workhouse/runtime/home
      CLAUDEX_WORKHOUSE_HOST: 0.0.0.0
      CLAUDEX_WORKHOUSE_PORT: 3410
      CLAUDEX_WORKHOUSE_EXTERNAL_ORIGIN: http://127.0.0.1:3410
      CLAUDEX_WORKHOUSE_AUTH_MODE: local
      CLAUDEX_WORKHOUSE_OWNER_CLAIM: required
      CLAUDEX_WORKHOUSE_HOST_ROLES: main-server
      CLAUDEX_WORKHOUSE_INSTALL_METHOD: docker-desktop
      CLAUDEX_WORKHOUSE_DEPLOYMENT_PLATFORM: windows-docker
    volumes:
      - claudex-workhouse-config:/opt/claudex-workhouse/config
      - claudex-workhouse-data:/opt/claudex-workhouse/data
      - claudex-workhouse-runtime:/opt/claudex-workhouse/runtime
      - claudex-workhouse-workspaces:/opt/claudex-workhouse/workspaces
    tmpfs:
      - /opt/claudex-workhouse/run:mode=700,uid=10001,gid=10001
      - /tmp:mode=1777
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
volumes:
  claudex-workhouse-config:
  claudex-workhouse-data:
  claudex-workhouse-runtime:
  claudex-workhouse-workspaces:
'@

$workhouseUtf8 = New-Object Text.UTF8Encoding($false)
$workhouseSha256 = [Security.Cryptography.SHA256]::Create()
try {
  $workhouseComposeHash = ([BitConverter]::ToString(
    $workhouseSha256.ComputeHash($workhouseUtf8.GetBytes($workhouseCompose))
  )).Replace('-', '').ToLowerInvariant()
} finally {
  $workhouseSha256.Dispose()
}
if (Test-Path -LiteralPath $workhouseComposeFile) {
  $workhouseExisting = [IO.File]::ReadAllText($workhouseComposeFile)
  if ($workhouseExisting -ne $workhouseCompose) {
    $workhouseExistingHash = (Get-FileHash -LiteralPath $workhouseComposeFile -Algorithm SHA256).Hash.ToLowerInvariant()
    $workhouseOwnedHash = if (Test-Path -LiteralPath $workhouseComposeMarker) {
      ([IO.File]::ReadAllText($workhouseComposeMarker)).Trim().ToLowerInvariant()
    } else { '' }
    if ($workhouseOwnedHash -ne $workhouseExistingHash) {
      throw "A customized deployment already exists at $workhouseComposeFile. Back it up or update it explicitly instead of overwriting it."
    }
    [IO.File]::WriteAllText($workhouseComposeFile, $workhouseCompose, $workhouseUtf8)
  }
} else {
  [IO.File]::WriteAllText($workhouseComposeFile, $workhouseCompose, $workhouseUtf8)
}
[IO.File]::WriteAllText($workhouseComposeMarker, "$workhouseComposeHash\`n", $workhouseUtf8)

Push-Location $workhouseRoot
try {
  & $docker.Source compose -f $workhouseComposeFile config --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Generated Docker Compose configuration is invalid.' }
  & $docker.Source compose -f $workhouseComposeFile pull
  if ($LASTEXITCODE -ne 0) { throw 'The verified Workhouse image could not be pulled.' }
  & $docker.Source compose -f $workhouseComposeFile up -d
  if ($LASTEXITCODE -ne 0) { throw 'Workhouse could not be started in Docker Desktop.' }
} finally {
  Pop-Location
}

$workhouseReady = $false
for ($workhouseAttempt = 0; $workhouseAttempt -lt 45; $workhouseAttempt++) {
  try {
    $workhouseHealth = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3410/api/health/ready' -TimeoutSec 2
    if ($workhouseHealth.StatusCode -eq 200) { $workhouseReady = $true; break }
  } catch {
    Start-Sleep -Seconds 2
  }
}
if (-not $workhouseReady) {
  throw "Workhouse did not become ready. Run: docker compose -f '$workhouseComposeFile' logs"
}

Write-Host "Claudex Workhouse $workhouseVersion is ready."
Write-Host "Deployment files: $workhouseRoot"
Write-Host 'Next: finish owner claim in the browser, then install and pair the Windows Worker.'
try {
  Start-Process 'http://127.0.0.1:3410'
} catch {
  Write-Warning 'The browser could not be opened automatically. Open http://127.0.0.1:3410 manually.'
}
`;
  return Object.freeze({ fileName, content, launchCommand });
}
