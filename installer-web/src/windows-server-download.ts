import type{VerifiedRelease}from"./types";

function literal(value:string){return`'${value.replace(/'/g,"''")}'`;}
function base64(bytes:Uint8Array){let value="";for(let offset=0;offset<bytes.length;offset+=0x8000)value+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));return btoa(value);}
function powershellEncodedCommand(command:string){const bytes=new Uint8Array(command.length*2);for(let index=0;index<command.length;index++){const unit=command.charCodeAt(index);bytes[index*2]=unit&0xff;bytes[index*2+1]=unit>>>8;}return base64(bytes);}
export function createWindowsServerDownload(release:VerifiedRelease){
  const server=release.manifest.windowsServer;if(release.manifest.schemaVersion<2||!server)throw new Error("이 릴리스에는 Windows 메인 서버 EXE가 없습니다.");
  const certificateSha256=server.authenticode.status==="valid"?server.authenticode.certificateSha256:"";
  const key=release.verifiedKey,fileName=`download-claudex-workhouse-server-${release.manifest.version}.ps1`;
  const launchScript=`$k=Get-Item -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders' -ErrorAction SilentlyContinue;$v=if($null-ne$k){$k.GetValue('{374DE290-123F-4565-9164-39C4925E467B}',$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}else{$null};$d=if([string]::IsNullOrWhiteSpace([string]$v)){Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)) 'Downloads'}else{[Environment]::ExpandEnvironmentVariables([string]$v)};& ([IO.Path]::Combine($d,${literal(fileName)}))`;
  const launchCommand=`powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${powershellEncodedCommand(launchScript)}`;
  const content=`$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$version = ${literal(release.manifest.version)}
$keyId = ${literal(key.keyId)}
$keyStartText = ${literal(key.notBefore)}
$keyEndText = ${literal(key.expiresAt)}
$manifestBytes = [Convert]::FromBase64String(${literal(base64(release.manifestBytes))})
$signatureBytes = [Convert]::FromBase64String(${literal(base64(release.signatureBytes))})
$modulus = ${literal(key.modulusBase64)}
$exponent = ${literal(key.exponentBase64)}
$packageUrl = ${literal(server.url)}
$packageName = ${literal(server.filename)}
$packageSize = [long]${server.size}
$packageSha256 = ${literal(server.sha256)}
$authenticodeStatus = ${literal(server.authenticode.status)}
$certificateSha256 = ${literal(certificateSha256)}

$now = [DateTimeOffset]::UtcNow
$keyStart = [DateTimeOffset]::Parse($keyStartText,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeUniversal)
$keyEnd = [DateTimeOffset]::Parse($keyEndText,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeUniversal)
if ($now -lt $keyStart -or $now -ge $keyEnd) { throw 'The pinned release signing key is not currently valid.' }
$parameters = New-Object Security.Cryptography.RSAParameters
$parameters.Modulus = [Convert]::FromBase64String($modulus)
$parameters.Exponent = [Convert]::FromBase64String($exponent)
$rsa = [Security.Cryptography.RSA]::Create()
try {
  $rsa.ImportParameters($parameters)
  $valid = $rsa.VerifyData($manifestBytes,$signatureBytes,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)
} finally { $rsa.Dispose() }
if (-not $valid) { throw 'The embedded release manifest signature is invalid.' }

$release = [Text.Encoding]::UTF8.GetString($manifestBytes) | ConvertFrom-Json
if ($release.schemaVersion -lt 2 -or $release.schemaVersion -gt 3) { throw 'The signed release does not contain a Windows server contract.' }
$asset = $release.windowsServer
if (
  $release.version -ne $version -or
  $release.signing.keyId -ne $keyId -or
  $release.signing.algorithm -ne 'rsa-sha256' -or
  $asset.platform -ne 'windows' -or
  $asset.architecture -ne 'x64' -or
  $asset.format -ne 'exe' -or
  $asset.filename -ne $packageName -or
  $asset.url -ne $packageUrl -or
  [long]$asset.size -ne $packageSize -or
  $asset.sha256 -ne $packageSha256 -or
  $asset.authenticode.status -ne $authenticodeStatus -or
  ($authenticodeStatus -eq 'valid' -and (
    $asset.authenticode.certificateSha256 -ne $certificateSha256 -or
    $asset.authenticode.timestamped -ne $true
  ))
) { throw 'The signed manifest does not match the selected Windows server EXE.' }
$published = [DateTimeOffset]::Parse([string]$release.publishedAt,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeUniversal)
$expires = [DateTimeOffset]::Parse([string]$release.expiresAt,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeUniversal)
if ($published -gt $now.AddMinutes(5) -or $expires -le $now -or $published -lt $keyStart -or $expires -gt $keyEnd) { throw 'The signed release manifest is expired or outside the signing-key validity window.' }

function Receive-WorkhouseFile {
  param([string]$Uri,[string]$Destination,[long]$ExpectedBytes)
  Add-Type -AssemblyName System.Net.Http
  $current = [Uri]::new($Uri,[UriKind]::Absolute)
  for ($redirect=0; $redirect -le 5; $redirect++) {
    if ($current.Scheme -ne 'https' -or -not [string]::IsNullOrEmpty($current.UserInfo)) { throw 'Downloads require HTTPS without embedded credentials.' }
    $handler=[Net.Http.HttpClientHandler]::new();$handler.AllowAutoRedirect=$false
    $client=[Net.Http.HttpClient]::new($handler);$response=$null
    try {
      $response=$client.GetAsync($current,[Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
      $status=[int]$response.StatusCode
      if ($status -in @(301,302,303,307,308)) {
        if ($redirect -ge 5) { throw 'Download exceeded five redirects.' }
        $next=$response.Headers.Location;if($null -eq $next){throw 'Redirect did not include Location.'}
        if(-not $next.IsAbsoluteUri){$next=[Uri]::new($current,$next)}
        if($next.Scheme -ne 'https'){throw 'HTTPS redirect downgrade is not allowed.'}
        $current=$next;continue
      }
      if(-not $response.IsSuccessStatusCode){throw "Download failed with HTTP status $status."}
      $length=$response.Content.Headers.ContentLength;if($null -ne $length -and $length -ne $ExpectedBytes){throw 'Content-Length does not match the signed manifest.'}
      $stream=$null;$output=$null
      try {
        $stream=$response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $output=[IO.File]::Open($Destination,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        $buffer=New-Object byte[] 81920;[long]$downloaded=0
        while(($read=$stream.Read($buffer,0,$buffer.Length))-gt 0){$downloaded+=$read;if($downloaded-gt $ExpectedBytes){throw 'Download exceeds signed size.'};$output.Write($buffer,0,$read)}
      } finally {if($null-ne$output){$output.Dispose()};if($null-ne$stream){$stream.Dispose()}}
      if($downloaded-ne$ExpectedBytes){throw 'Downloaded size does not match the signed manifest.'}
      return
    } finally {if($null-ne$response){$response.Dispose()};$client.Dispose();$handler.Dispose()}
  }
}
function Assert-WorkhouseAuthenticode {
  param([string]$Path)
  $auth=Get-AuthenticodeSignature -LiteralPath $Path
  if($authenticodeStatus -eq 'unsigned'){
    if($auth.Status-ne[Management.Automation.SignatureStatus]::NotSigned){throw "Expected an unsigned Windows server, received Authenticode status: $($auth.Status)"}
    return
  }
  if($auth.Status-ne[Management.Automation.SignatureStatus]::Valid -or $null-eq$auth.SignerCertificate -or $null-eq$auth.TimeStamperCertificate){throw "Windows server Authenticode validation failed: $($auth.Status)"}
  $actual=$auth.SignerCertificate.GetCertHashString([Security.Cryptography.HashAlgorithmName]::SHA256).ToLowerInvariant()
  if($actual-ne$certificateSha256){throw 'Windows server signing certificate does not match the signed manifest.'}
}

$downloadsKey=Get-Item -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders' -ErrorAction SilentlyContinue
$downloadsValue=if($null-ne$downloadsKey){$downloadsKey.GetValue('{374DE290-123F-4565-9164-39C4925E467B}',$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}else{$null}
$downloads=if([string]::IsNullOrWhiteSpace([string]$downloadsValue)){Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)) 'Downloads'}else{[Environment]::ExpandEnvironmentVariables([string]$downloadsValue)}
$driveAbsolute = $downloads.Length -ge 3 -and [char]::IsLetter($downloads[0]) -and $downloads[1] -eq ':' -and ($downloads[2] -eq '\\' -or $downloads[2] -eq '/')
$uncAbsolute = $downloads.Length -ge 5 -and $downloads[0] -eq '\\' -and $downloads[1] -eq '\\' -and $downloads[2] -notin @('?','.') -and $downloads.Substring(2).Contains('\\')
if(-not($driveAbsolute-or$uncAbsolute)){throw 'Windows Downloads known folder path is invalid.'}
[IO.Directory]::CreateDirectory($downloads)|Out-Null
$destination=Join-Path $downloads $packageName
$temporary=Join-Path $env:TEMP ('claudex-workhouse-server-'+[Guid]::NewGuid().ToString('N')+'.exe')
try {
  if(Test-Path -LiteralPath $destination){
    $existing=Get-Item -LiteralPath $destination
    $existingHash=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
    if($existing.Length-ne$packageSize -or $existingHash-ne$packageSha256){throw "A different file already exists at $destination."}
    Assert-WorkhouseAuthenticode -Path $destination
    Write-Host "The verified Windows server already exists: $destination";return
  }
  Receive-WorkhouseFile -Uri $packageUrl -Destination $temporary -ExpectedBytes $packageSize
  $hash=(Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant()
  if($hash-ne$packageSha256){throw 'Windows server EXE SHA-256 does not match the signed manifest.'}
  Assert-WorkhouseAuthenticode -Path $temporary
  [IO.File]::Move($temporary,$destination);$temporary=$null
  Write-Host "Verified Windows server saved: $destination"
  if($authenticodeStatus -eq 'unsigned'){Write-Warning 'This free release is not Authenticode-signed. Windows may show Microsoft Defender SmartScreen. Use only the official GitHub release and verify the SHA-256 shown above.'}
  Write-Host 'Double-click the EXE to start Claudex Workhouse for the current user.'
} finally {if(-not[string]::IsNullOrWhiteSpace([string]$temporary)-and(Test-Path -LiteralPath $temporary)){Remove-Item -LiteralPath $temporary -Force}}
`;
  return Object.freeze({fileName,content,launchCommand,launchScript});
}
