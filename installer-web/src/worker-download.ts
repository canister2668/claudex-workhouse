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

export interface WindowsWorkerDownload {
  readonly fileName: string;
  readonly content: string;
  readonly launchCommand: string;
}

/**
 * GitHub Release binaries intentionally remain on GitHub's immutable release
 * storage. Its final download CDN is not a browser-readable CORS origin, so
 * the static page emits a current-user PowerShell downloader that verifies the
 * exact signed manifest and artifact bytes on the Windows host.
 */
export function createWindowsWorkerDownload(
  release: VerifiedRelease
): WindowsWorkerDownload {
  const worker = release.manifest.workers["windows-x64"];
  const key = release.verifiedKey;
  const fileName = `download-claudex-workhouse-worker-${release.manifest.version}.ps1`;
  const launchCommand =
    `powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ` +
    `"$env:USERPROFILE\\Downloads\\${fileName}"`;
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
$workhousePackageUrl = ${powershellLiteral(worker.url)}
$workhousePackageName = ${powershellLiteral(worker.filename)}
$workhousePackageSize = [long]${worker.size}
$workhousePackageSha256 = ${powershellLiteral(worker.sha256)}
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
$workhouseWorker = $workhouseRelease.workers.'windows-x64'
if (
  $workhouseRelease.schemaVersion -notin @(1, 2, 3) -or
  $workhouseRelease.version -ne $workhouseVersion -or
  $workhouseRelease.signing.keyId -ne $workhouseKeyId -or
  $workhouseRelease.signing.algorithm -ne 'rsa-sha256' -or
  $workhouseWorker.platform -ne 'windows' -or
  $workhouseWorker.architecture -ne 'x64' -or
  $workhouseWorker.format -ne 'zip' -or
  $workhouseWorker.filename -ne $workhousePackageName -or
  $workhouseWorker.url -ne $workhousePackageUrl -or
  [long]$workhouseWorker.size -ne $workhousePackageSize -or
  $workhouseWorker.sha256 -ne $workhousePackageSha256
) {
  throw 'The signed manifest does not match the selected Windows Worker package.'
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

function Receive-WorkhouseHttpsFile {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][long]$ExpectedBytes
  )
  Add-Type -AssemblyName System.Net.Http
  $workhouseCurrentUri = [Uri]::new($Uri, [UriKind]::Absolute)
  for ($workhouseRedirect = 0; $workhouseRedirect -le 5; $workhouseRedirect++) {
    if (
      $workhouseCurrentUri.Scheme -ne [Uri]::UriSchemeHttps -or
      -not [string]::IsNullOrEmpty($workhouseCurrentUri.UserInfo)
    ) {
      throw 'Worker downloads require HTTPS without embedded credentials.'
    }
    $workhouseHandler = [Net.Http.HttpClientHandler]::new()
    $workhouseHandler.AllowAutoRedirect = $false
    $workhouseClient = [Net.Http.HttpClient]::new($workhouseHandler)
    $workhouseResponse = $null
    try {
      $workhouseResponse = $workhouseClient.GetAsync(
        $workhouseCurrentUri,
        [Net.Http.HttpCompletionOption]::ResponseHeadersRead
      ).GetAwaiter().GetResult()
      $workhouseStatus = [int]$workhouseResponse.StatusCode
      if ($workhouseStatus -in @(301, 302, 303, 307, 308)) {
        if ($workhouseRedirect -ge 5) { throw 'Worker download exceeded five redirects.' }
        $workhouseNextUri = $workhouseResponse.Headers.Location
        if ($null -eq $workhouseNextUri) { throw 'Worker redirect did not include a Location header.' }
        if (-not $workhouseNextUri.IsAbsoluteUri) {
          $workhouseNextUri = [Uri]::new($workhouseCurrentUri, $workhouseNextUri)
        }
        if ($workhouseNextUri.Scheme -ne [Uri]::UriSchemeHttps) {
          throw 'HTTPS redirect downgrade is not allowed.'
        }
        $workhouseCurrentUri = $workhouseNextUri
        continue
      }
      if (-not $workhouseResponse.IsSuccessStatusCode) {
        throw "Worker download failed with HTTP status $workhouseStatus."
      }
      $workhouseLength = $workhouseResponse.Content.Headers.ContentLength
      if ($null -ne $workhouseLength -and $workhouseLength -ne $ExpectedBytes) {
        throw 'Worker Content-Length does not match the signed manifest.'
      }
      $workhouseInput = $null
      $workhouseOutput = $null
      try {
        $workhouseInput = $workhouseResponse.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $workhouseOutput = [IO.File]::Open(
          $Destination,
          [IO.FileMode]::CreateNew,
          [IO.FileAccess]::Write,
          [IO.FileShare]::None
        )
        $workhouseBuffer = New-Object byte[] 81920
        [long]$workhouseDownloaded = 0
        while (($workhouseRead = $workhouseInput.Read($workhouseBuffer, 0, $workhouseBuffer.Length)) -gt 0) {
          $workhouseDownloaded += $workhouseRead
          if ($workhouseDownloaded -gt $ExpectedBytes) {
            throw 'Worker download exceeds the size in the signed manifest.'
          }
          $workhouseOutput.Write($workhouseBuffer, 0, $workhouseRead)
        }
      } finally {
        if ($null -ne $workhouseOutput) { $workhouseOutput.Dispose() }
        if ($null -ne $workhouseInput) { $workhouseInput.Dispose() }
      }
      if ($workhouseDownloaded -ne $ExpectedBytes) {
        throw 'Worker package size does not match the signed manifest.'
      }
      return
    } finally {
      if ($null -ne $workhouseResponse) { $workhouseResponse.Dispose() }
      $workhouseClient.Dispose()
      $workhouseHandler.Dispose()
    }
  }
  throw 'Worker redirect handling failed.'
}

$workhouseDownloads = Join-Path $env:USERPROFILE 'Downloads'
New-Item -ItemType Directory -Path $workhouseDownloads -Force | Out-Null
$workhouseDestination = Join-Path $workhouseDownloads $workhousePackageName
$workhouseTemporary = Join-Path $env:TEMP (
  'claudex-workhouse-worker-' + [Guid]::NewGuid().ToString('N') + '.partial'
)
try {
  if (Test-Path -LiteralPath $workhouseDestination) {
    $workhouseExisting = Get-Item -LiteralPath $workhouseDestination
    $workhouseExistingSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $workhouseDestination).Hash.ToLowerInvariant()
    if ($workhouseExisting.Length -eq $workhousePackageSize -and $workhouseExistingSha -eq $workhousePackageSha256) {
      Write-Host "The verified package already exists: $workhouseDestination"
      return
    }
    throw "A different file already exists at $workhouseDestination. Move it aside and retry."
  }
  Receive-WorkhouseHttpsFile -Uri $workhousePackageUrl -Destination $workhouseTemporary -ExpectedBytes $workhousePackageSize
  $workhouseDownloadedSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $workhouseTemporary).Hash.ToLowerInvariant()
  if ($workhouseDownloadedSha -ne $workhousePackageSha256) {
    throw 'Worker package SHA-256 does not match the signed manifest.'
  }
  Move-Item -LiteralPath $workhouseTemporary -Destination $workhouseDestination
  $workhouseTemporary = $null
  Write-Host "Verified Worker package saved: $workhouseDestination"
  Write-Host 'Extract the entire ZIP, then follow README-FIRST.txt.'
  Write-Host 'Create the 10-minute pairing code in the existing Workhouse server.'
} finally {
  if (
    -not [string]::IsNullOrWhiteSpace([string]$workhouseTemporary) -and
    (Test-Path -LiteralPath $workhouseTemporary)
  ) {
    Remove-Item -LiteralPath $workhouseTemporary -Force
  }
}
`;
  return Object.freeze({ fileName, content, launchCommand });
}
