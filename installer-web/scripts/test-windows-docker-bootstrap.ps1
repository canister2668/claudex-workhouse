param(
  [Parameter(Mandatory = $true)]
  [string]$BootstrapScript
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$resolvedBootstrap = (Resolve-Path -LiteralPath $BootstrapScript).Path
$tokens = $null
$parseErrors = $null
[System.Management.Automation.Language.Parser]::ParseFile(
  $resolvedBootstrap,
  [ref]$tokens,
  [ref]$parseErrors
) | Out-Null
if ($parseErrors.Count -ne 0) {
  $messages = $parseErrors | ForEach-Object { $_.Message }
  throw "Generated Windows Docker bootstrap has PowerShell parse errors: $($messages -join '; ')"
}

$testRoot = Join-Path $env:RUNNER_TEMP ('claudex-windows-docker-' + [Guid]::NewGuid().ToString('N'))
$fakeBin = Join-Path $testRoot 'bin'
$fakeLocalAppData = Join-Path $testRoot 'local-app-data'
$fakeUserProfile = Join-Path $testRoot 'user-profile'
$dockerLog = Join-Path $testRoot 'docker.log'
$healthScript = Join-Path $testRoot 'health.cjs'
$fakeDocker = Join-Path $fakeBin 'docker.cmd'
$healthProcess = $null
$previousPath = $env:PATH
$previousLocalAppData = $env:LOCALAPPDATA
$previousUserProfile = $env:USERPROFILE
$previousDockerLog = $env:CLAUDEX_FAKE_DOCKER_LOG

try {
  New-Item -ItemType Directory -Path $fakeBin,$fakeLocalAppData,$fakeUserProfile -Force | Out-Null
  @'
@echo off
if "%CLAUDEX_FAKE_DOCKER_LOG%"=="" exit /b 90
echo %*>>"%CLAUDEX_FAKE_DOCKER_LOG%"
if "%1"=="version" (
  echo 27.0.0
  exit /b 0
)
if "%1"=="compose" (
  if "%2"=="version" echo 2.29.0
  exit /b 0
)
exit /b 92
'@ | Set-Content -LiteralPath $fakeDocker -Encoding ascii
  @'
const http = require("node:http");
const server = http.createServer((request, response) => {
  if (request.url === "/api/health/ready") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"status":"ready"}');
    return;
  }
  response.writeHead(404);
  response.end("not found");
});
server.listen(3410, "127.0.0.1");
'@ | Set-Content -LiteralPath $healthScript -Encoding ascii

  $node = (Get-Command node.exe).Source
  $healthProcess = Start-Process -FilePath $node -ArgumentList $healthScript -PassThru -WindowStyle Hidden
  $env:PATH = "$fakeBin;$previousPath"
  $env:LOCALAPPDATA = $fakeLocalAppData
  $env:USERPROFILE = $fakeUserProfile
  $env:CLAUDEX_FAKE_DOCKER_LOG = $dockerLog

  $healthReady = $false
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3410/api/health/ready' -TimeoutSec 1
      if ($response.StatusCode -eq 200) { $healthReady = $true; break }
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }
  if (-not $healthReady) { throw 'Fixture health server did not become ready.' }

  $firstOutput = & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $resolvedBootstrap 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Generated Windows Docker bootstrap failed its simulated first install: $($firstOutput -join [Environment]::NewLine)"
  }
  $deploymentRoot = Join-Path $fakeLocalAppData 'Claudex Workhouse Docker'
  $composeFile = Join-Path $deploymentRoot 'compose.yaml'
  $markerFile = Join-Path $deploymentRoot '.installer-owned-compose.sha256'
  if (-not (Test-Path -LiteralPath $composeFile -PathType Leaf)) { throw 'Bootstrap did not write compose.yaml.' }
  if (-not (Test-Path -LiteralPath $markerFile -PathType Leaf)) { throw 'Bootstrap did not write the installer ownership marker.' }
  $compose = Get-Content -LiteralPath $composeFile -Raw
  if ($compose -notmatch 'ghcr\.io/example/claudex-workhouse:1\.0\.0@sha256:[a]{64}') { throw 'Compose image is not pinned to the signed digest.' }
  if ($compose -match ':latest(?:\s|$)') { throw 'Compose unexpectedly contains an unpinned latest tag.' }
  if ($compose -notmatch '127\.0\.0\.1:3410:3410') { throw 'Compose is not loopback-only.' }
  if ($compose -notmatch 'CLAUDEX_WORKHOUSE_HOST_ROLES: main-server') { throw 'Compose does not preserve the main-server-only credential boundary.' }
  $calls = Get-Content -LiteralPath $dockerLog -Raw
  foreach ($expected in @('version --format', 'compose version --short', 'compose -f', 'config --quiet', 'pull', 'up -d')) {
    if (-not $calls.Contains($expected)) { throw "Fake Docker did not observe expected call: $expected" }
  }

  $secondOutput = & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $resolvedBootstrap 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Generated Windows Docker bootstrap is not safely repeatable: $($secondOutput -join [Environment]::NewLine)"
  }

  Add-Content -LiteralPath $composeFile -Value '# operator customization'
  $thirdOutput = & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $resolvedBootstrap 2>&1
  if ($LASTEXITCODE -eq 0) { throw 'Bootstrap overwrote or accepted a customized Compose file.' }
  if (($thirdOutput -join [Environment]::NewLine) -notmatch 'customized deployment already exists') {
    throw "Customized Compose refusal did not report the expected reason: $($thirdOutput -join [Environment]::NewLine)"
  }

  $global:LASTEXITCODE = 0
  Write-Host 'Windows Docker bootstrap parse, simulated install, rerun, and customization refusal passed.'
} finally {
  $env:PATH = $previousPath
  $env:LOCALAPPDATA = $previousLocalAppData
  $env:USERPROFILE = $previousUserProfile
  $env:CLAUDEX_FAKE_DOCKER_LOG = $previousDockerLog
  if ($null -ne $healthProcess -and -not $healthProcess.HasExited) {
    Stop-Process -Id $healthProcess.Id -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $testRoot) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
