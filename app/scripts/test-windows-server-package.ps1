# SPDX-License-Identifier: AGPL-3.0-only
# This file is part of Claudex Workhouse.

param(
  [Parameter(Mandatory = $true)][string]$SingleExe,
  [Parameter(Mandatory = $true)][string]$PortableZip,
  [Parameter(Mandatory = $true)][string]$ExpectedCommit,
  [string]$StatusGuideScreenshot = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($ExpectedCommit -notmatch '^[a-fA-F0-9]{7,64}$') {
  throw 'ExpectedCommit must be a hexadecimal commit identifier.'
}

$singleExePath = (Resolve-Path -LiteralPath $SingleExe).Path
$portableZipPath = (Resolve-Path -LiteralPath $PortableZip).Path
$testRoot = Join-Path $env:RUNNER_TEMP ("claudex-workhouse-windows-smoke-" + [Guid]::NewGuid().ToString('N'))
$portableRoot = Join-Path $testRoot 'portable'
New-Item -ItemType Directory -Path $portableRoot -Force | Out-Null
Expand-Archive -LiteralPath $portableZipPath -DestinationPath $portableRoot
$portableLauncher = Get-ChildItem -LiteralPath $portableRoot -Filter 'Claudex Workhouse.exe' -File -Recurse | Select-Object -First 1
if ($null -eq $portableLauncher) {
  throw 'Portable ZIP does not contain Claudex Workhouse.exe.'
}

function Wait-ServerStopped {
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    try {
      Invoke-WebRequest -UseBasicParsing -NoProxy -Uri 'http://127.0.0.1:3410/api/health/live' -TimeoutSec 1 | Out-Null
    } catch {
      $client = [Net.Sockets.TcpClient]::new()
      try {
        $connect = $client.ConnectAsync('127.0.0.1', 3410)
        if (-not $connect.Wait(1000) -or -not $client.Connected) { return }
      } catch {
        return
      } finally {
        $client.Dispose()
      }
    }
    Start-Sleep -Milliseconds 500
  }
  throw 'Windows server remained reachable after its launcher stopped.'
}

function Stop-TestInstalledServer {
  $registration = Get-ItemProperty -LiteralPath 'HKCU:\Software\Claudex Workhouse' -ErrorAction SilentlyContinue
  $serverPidProperty = if ($null -ne $registration) { $registration.PSObject.Properties['ServerPid'] } else { $null }
  $serverProcessId = if ($null -ne $serverPidProperty) { [int]$serverPidProperty.Value } else { 0 }
  if ($serverProcessId -le 0) { return }
  $serverProcess = Get-Process -Id $serverProcessId -ErrorAction SilentlyContinue
  if ($null -eq $serverProcess) { return }
  Stop-Process -Id $serverProcessId -Force
  $serverProcess.WaitForExit(10000) | Out-Null
}

function Save-WindowScreenshot([Diagnostics.Process]$Process, [string]$Destination) {
  if (-not $Destination) { return }
  Add-Type -AssemblyName System.Drawing
  if (-not ('ClaudexNativeWindowCapture' -as [type])) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ClaudexNativeWindowCapture {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
}
'@
  }
  $Process.Refresh()
  $rectangle = [ClaudexNativeWindowCapture+Rect]::new()
  if ($Process.MainWindowHandle -eq 0 -or -not [ClaudexNativeWindowCapture]::GetWindowRect($Process.MainWindowHandle, [ref]$rectangle)) {
    throw 'The installed status guide window bounds could not be read for screenshot capture.'
  }
  $width = $rectangle.Right - $rectangle.Left
  $height = $rectangle.Bottom - $rectangle.Top
  if ($width -lt 100 -or $height -lt 100) { throw "The installed status guide screenshot bounds are invalid: ${width}x${height}." }
  $parent = Split-Path -Parent $Destination
  if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  $bitmap = [Drawing.Bitmap]::new($width, $height)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($rectangle.Left, $rectangle.Top, 0, 0, $bitmap.Size)
    $bitmap.Save($Destination, [Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function Test-InstallerWizard([string]$Launcher, [string]$Locale, [string]$ExpectedTitle) {
  Wait-ServerStopped
  $localData = Join-Path $testRoot ('wizard-local-app-data-' + $Locale)
  New-Item -ItemType Directory -Path $localData -Force | Out-Null
  $previousLocalAppData = $env:LOCALAPPDATA
  $previousLocale = $env:CLAUDEX_WORKHOUSE_LOCALE
  $env:LOCALAPPDATA = $localData
  $env:CLAUDEX_WORKHOUSE_LOCALE = $Locale
  $launcherProcess = $null
  try {
    $launcherProcess = Start-Process -FilePath $Launcher -PassThru
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
      $launcherProcess.Refresh()
      if ($launcherProcess.HasExited) {
        throw "Installer wizard exited before becoming visible with code $($launcherProcess.ExitCode)."
      }
      if ($launcherProcess.MainWindowHandle -ne 0 -and $launcherProcess.MainWindowTitle -like "*$ExpectedTitle*") { break }
      Start-Sleep -Milliseconds 250
    }
    $launcherProcess.Refresh()
    if ($launcherProcess.MainWindowHandle -eq 0 -or $launcherProcess.MainWindowTitle -notlike "*$ExpectedTitle*") {
      throw "Single EXE did not show the $Locale installer wizard before installation (title: '$($launcherProcess.MainWindowTitle)')."
    }
    $currentFile = Join-Path $localData 'Claudex Workhouse\server\current.json'
    if (Test-Path -LiteralPath $currentFile -PathType Leaf) {
      throw 'Installer wizard began installing before the user selected Install.'
    }
    Write-Host "single-exe installer wizard visibility test passed for $Locale."
  } finally {
    if ($null -ne $launcherProcess -and -not $launcherProcess.HasExited) {
      Stop-Process -Id $launcherProcess.Id -Force
      $launcherProcess.WaitForExit(10000) | Out-Null
    }
    $env:LOCALAPPDATA = $previousLocalAppData
    $env:CLAUDEX_WORKHOUSE_LOCALE = $previousLocale
    Wait-ServerStopped
  }
}

function Test-Launcher([string]$Label, [string]$Launcher, [bool]$ExpectInstalledPayload, [string]$InstallRoot = '', [bool]$LegacyAclFixture = $false, [bool]$StaleSameVersionPayloadFixture = $false) {
  Wait-ServerStopped
  $localData = Join-Path $testRoot ($Label + '-local-app-data')
  New-Item -ItemType Directory -Path $localData -Force | Out-Null
  $previousLocalAppData = $env:LOCALAPPDATA
  $env:LOCALAPPDATA = $localData
  $staleMarker = ''
  if ($StaleSameVersionPayloadFixture) {
    if (-not $InstallRoot) { throw 'The stale same-version payload fixture requires an install root.' }
    $stalePayload = Join-Path $InstallRoot 'versions\1.0.0'
    $staleMarker = Join-Path $stalePayload 'stale-payload.txt'
    New-Item -ItemType Directory -Path (Join-Path $stalePayload 'app') -Force | Out-Null
    'stale-node' | Set-Content -LiteralPath (Join-Path $stalePayload 'node.exe') -Encoding ascii
    'stale-start' | Set-Content -LiteralPath (Join-Path $stalePayload 'app\start.mjs') -Encoding ascii
    'must-be-replaced' | Set-Content -LiteralPath $staleMarker -Encoding ascii
  }
  if ($LegacyAclFixture) {
    $legacyDataRoot = Join-Path $localData 'Claudex Workhouse'
    $legacyConfigRoot = Join-Path $legacyDataRoot 'config'
    $legacyConfig = Join-Path $legacyConfigRoot 'claudex-workhouse.json'
    New-Item -ItemType Directory -Path $legacyConfigRoot -Force | Out-Null
    @{host='127.0.0.1';port=3410;externalOrigin='http://127.0.0.1:3410';allowedEmail='admin@example.com';teamDomain='';audience='';authMode='local';promptMaxLength=50000;commandTimeoutMs=60000;commandOutputLimit=1048576;claudeBinary='runtime/bin/claude'} | ConvertTo-Json | Set-Content -LiteralPath $legacyConfig -Encoding utf8
    @{projects=@(@{id='claudex-workhouse';name='Claudex Workhouse';path=$InstallRoot})} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $legacyConfigRoot 'projects.json') -Encoding utf8
    & icacls.exe $legacyConfig /inheritance:r /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the legacy inaccessible-ACL fixture.' }
    try {
      Get-Content -LiteralPath $legacyConfig -Raw -ErrorAction Stop | Out-Null
      throw 'Legacy ACL fixture remained readable and did not reproduce the field failure.'
    } catch [System.UnauthorizedAccessException] {
      Write-Host 'legacy inaccessible-ACL fixture reproduced.'
    }
  }
  $launcherProcess = $null
  $lastProbeError = $null
  try {
    $launcherArguments = @('--install')
    if ($InstallRoot) { $launcherArguments += ('--install-root="' + $InstallRoot + '"') }
    $launcherProcess = Start-Process -FilePath $Launcher -ArgumentList $launcherArguments -PassThru
    $deadline = (Get-Date).AddMinutes(5)
    $nextProgress = Get-Date
    $live = $null
    $ready = $null
    while ((Get-Date) -lt $deadline) {
      $launcherErrorFile = Join-Path $localData 'Claudex Workhouse\logs\windows-launcher-error.log'
      if (Test-Path -LiteralPath $launcherErrorFile -PathType Leaf) {
        throw "$Label launcher error: $((Get-Content -LiteralPath $launcherErrorFile -Raw).Trim())"
      }
      if ($launcherProcess.HasExited) {
        throw "$Label launcher exited before the server became ready with code $($launcherProcess.ExitCode)."
      }
      try {
        $live = Invoke-RestMethod -NoProxy -Uri 'http://127.0.0.1:3410/api/health/live' -TimeoutSec 2
        $ready = Invoke-RestMethod -NoProxy -Uri 'http://127.0.0.1:3410/api/health/ready' -TimeoutSec 2
        if ($live.ok -eq $true -and $ready.ok -eq $true) { break }
      } catch { $lastProbeError = $_.Exception.Message }
      if ((Get-Date) -ge $nextProgress) {
        $currentFile = if ($InstallRoot) { Join-Path $InstallRoot 'current.json' } else { Join-Path $localData 'Claudex Workhouse\server\current.json' }
        Write-Host "$Label waiting: installedPayload=$((Test-Path -LiteralPath $currentFile -PathType Leaf)) probe=$lastProbeError"
        $nextProgress = (Get-Date).AddSeconds(15)
      }
      Start-Sleep -Seconds 1
    }
    if ($null -eq $live -or $live.ok -ne $true -or $null -eq $ready -or $ready.ok -ne $true) {
      $exitDetail = if ($launcherProcess.HasExited) { " launcherExit=$($launcherProcess.ExitCode)" } else { '' }
      throw "$Label server did not pass live and ready probes.$exitDetail lastProbe=$lastProbeError"
    }
    $about = Invoke-RestMethod -NoProxy -Uri 'http://127.0.0.1:3410/api/about' -TimeoutSec 5
    if ([string]$about.commitSha -ne $ExpectedCommit.ToLowerInvariant()) {
      throw "$Label server commit $($about.commitSha) did not match $ExpectedCommit."
    }
    if ($ExpectInstalledPayload) {
      $currentFile = if ($InstallRoot) { Join-Path $InstallRoot 'current.json' } else { Join-Path $localData 'Claudex Workhouse\server\current.json' }
      if (-not (Test-Path -LiteralPath $currentFile -PathType Leaf)) {
        throw 'Single EXE did not install and activate its embedded payload.'
      }
      $current = Get-Content -LiteralPath $currentFile -Raw | ConvertFrom-Json
      if ([string]$current.version -ne '1.0.0') {
        throw "Installed payload version $($current.version) did not match 1.0.0."
      }
      if ($staleMarker -and (Test-Path -LiteralPath $staleMarker)) {
        throw 'Single EXE retained the stale same-version payload instead of replacing it.'
      }
    }
    Write-Host "$Label launch test passed for commit $($about.commitSha)."
  } finally {
    if ($null -ne $launcherProcess -and -not $launcherProcess.HasExited) {
      Stop-Process -Id $launcherProcess.Id -Force
      $launcherProcess.WaitForExit(10000) | Out-Null
    }
    Stop-TestInstalledServer
    $env:LOCALAPPDATA = $previousLocalAppData
    Wait-ServerStopped
  }
}

# --diagnose resolves the launcher form exactly as a normal start does, then
# writes what it found and exits. It is how a failed field start is told apart
# from a product decision, so the expected verdict is asserted here.
function Get-LauncherDiagnosis([string]$Launcher, [string]$LocalAppData) {
  $log = Join-Path $LocalAppData 'Claudex Workhouse\logs\windows-launcher-diagnostics.log'
  Remove-Item -LiteralPath $log -Force -ErrorAction SilentlyContinue
  $previousLocalAppData = $env:LOCALAPPDATA
  $env:LOCALAPPDATA = $LocalAppData
  try {
    $process = Start-Process -FilePath $Launcher -ArgumentList @('--diagnose') -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw "Launcher diagnostics exited with code $($process.ExitCode)." }
  } finally {
    $env:LOCALAPPDATA = $previousLocalAppData
  }
  if (-not (Test-Path -LiteralPath $log -PathType Leaf)) { throw 'Launcher diagnostics did not write windows-launcher-diagnostics.log.' }
  return (Get-Content -LiteralPath $log -Raw).Trim()
}

function Assert-LauncherMode([string]$Label, [string]$Launcher, [string]$LocalAppData, [string]$ExpectedMode, [string]$ExpectedEmbedded) {
  New-Item -ItemType Directory -Path $LocalAppData -Force | Out-Null
  $diagnosis = Get-LauncherDiagnosis -Launcher $Launcher -LocalAppData $LocalAppData
  if ($diagnosis -notlike "mode=$ExpectedMode *") {
    throw "$Label resolved the wrong launcher form. Expected mode=$ExpectedMode, diagnosis: $diagnosis"
  }
  if ($diagnosis -notlike "*embeddedPayload=$ExpectedEmbedded*") {
    throw "$Label reported the wrong embedded payload state. Expected embeddedPayload=$ExpectedEmbedded, diagnosis: $diagnosis"
  }
  Write-Host "$Label diagnosis: $diagnosis"
}

# An incomplete portable folder must fail as a portable start, with a cause and
# a log. It must never be answered with the installation wizard, which is what
# hid a real path-resolution fault in the field.
function Test-PortableBrokenLayout([string]$PortableFolder, [string]$SetupTitle) {
  Wait-ServerStopped
  $broken = Join-Path $testRoot 'portable-broken'
  New-Item -ItemType Directory -Path $broken -Force | Out-Null
  foreach ($name in @('Claudex Workhouse.exe', 'current.json', 'payload-manifest.json')) {
    Copy-Item -LiteralPath (Join-Path $PortableFolder $name) -Destination (Join-Path $broken $name)
  }
  $localData = Join-Path $testRoot 'portable-broken-local-app-data'
  New-Item -ItemType Directory -Path $localData -Force | Out-Null
  $launcher = Join-Path $broken 'Claudex Workhouse.exe'
  Assert-LauncherMode -Label 'portable-broken' -Launcher $launcher -LocalAppData $localData -ExpectedMode 'portable' -ExpectedEmbedded 'no'
  $previousLocalAppData = $env:LOCALAPPDATA
  $previousLocale = $env:CLAUDEX_WORKHOUSE_LOCALE
  $env:LOCALAPPDATA = $localData
  $env:CLAUDEX_WORKHOUSE_LOCALE = 'en'
  $errorLog = Join-Path $localData 'Claudex Workhouse\logs\windows-launcher-error.log'
  Remove-Item -LiteralPath $errorLog -Force -ErrorAction SilentlyContinue
  $launcherProcess = $null
  try {
    $launcherProcess = Start-Process -FilePath $launcher -PassThru
    $deadline = (Get-Date).AddMinutes(2)
    while ((Get-Date) -lt $deadline -and -not (Test-Path -LiteralPath $errorLog -PathType Leaf)) {
      $launcherProcess.Refresh()
      if ($launcherProcess.HasExited) { throw "Broken portable launcher exited with code $($launcherProcess.ExitCode) instead of reporting the failure." }
      if ($launcherProcess.MainWindowHandle -ne 0 -and $launcherProcess.MainWindowTitle -like "*$SetupTitle*") {
        throw "Broken portable folder opened the installation wizard (title: '$($launcherProcess.MainWindowTitle)')."
      }
      Start-Sleep -Milliseconds 500
    }
    if (-not (Test-Path -LiteralPath $errorLog -PathType Leaf)) {
      throw 'Broken portable folder did not report a portable startup failure.'
    }
    $reported = (Get-Content -LiteralPath $errorLog -Raw).Trim()
    if ($reported -notlike '*mode=portable*') {
      throw "Portable startup failure did not identify the launcher form: $reported"
    }
    $launcherProcess.Refresh()
    if ($launcherProcess.MainWindowTitle -like "*$SetupTitle*") {
      throw "Broken portable folder fell back to the installation wizard (title: '$($launcherProcess.MainWindowTitle)')."
    }
    if (Test-Path -LiteralPath (Join-Path $localData 'Claudex Workhouse\server')) {
      throw 'Broken portable folder installed into the AppData install root.'
    }
    Write-Host "portable broken-layout failure test passed: $reported"
  } finally {
    if ($null -ne $launcherProcess -and -not $launcherProcess.HasExited) {
      Stop-Process -Id $launcherProcess.Id -Force
      $launcherProcess.WaitForExit(10000) | Out-Null
    }
    $env:LOCALAPPDATA = $previousLocalAppData
    $env:CLAUDEX_WORKHOUSE_LOCALE = $previousLocale
    Wait-ServerStopped
  }
}

# The extracted portable ZIP must behave as a portable program: double-clicking
# the launcher with no arguments verifies the adjacent payload and starts the
# server, without an installation wizard and without installing anything.
function Test-PortableDirectStart([string]$Launcher, [string]$Locale, [string]$ExpectedTitle, [string]$SetupTitle) {
  Wait-ServerStopped
  $localData = Join-Path $testRoot ('portable-direct-local-app-data-' + $Locale)
  New-Item -ItemType Directory -Path $localData -Force | Out-Null
  $previousLocalAppData = $env:LOCALAPPDATA
  $previousLocale = $env:CLAUDEX_WORKHOUSE_LOCALE
  $env:LOCALAPPDATA = $localData
  $env:CLAUDEX_WORKHOUSE_LOCALE = $Locale
  $startMenuShortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'Claudex Workhouse\Claudex Workhouse.lnk'
  $desktopShortcut = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Claudex Workhouse.lnk'
  $uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Claudex Workhouse'
  foreach ($file in @($startMenuShortcut, $desktopShortcut)) {
    if (Test-Path -LiteralPath $file) { throw "A stale shortcut invalidates the portable test: $file" }
  }
  if (Test-Path -LiteralPath $uninstallKey) { throw 'A stale Windows Apps registration invalidates the portable test.' }
  Assert-LauncherMode -Label "portable-direct-$Locale" -Launcher $Launcher -LocalAppData $localData -ExpectedMode 'portable' -ExpectedEmbedded 'no'
  $launcherProcess = $null
  $lastProbeError = $null
  try {
    # No arguments at all: exactly what a double-click does.
    $launcherProcess = Start-Process -FilePath $Launcher -PassThru
    $deadline = (Get-Date).AddMinutes(5)
    $nextProgress = Get-Date
    $live = $null
    $ready = $null
    $seenTitle = ''
    while ((Get-Date) -lt $deadline) {
      $launcherErrorFile = Join-Path $localData 'Claudex Workhouse\logs\windows-launcher-error.log'
      if (Test-Path -LiteralPath $launcherErrorFile -PathType Leaf) {
        throw "portable-direct launcher error: $((Get-Content -LiteralPath $launcherErrorFile -Raw).Trim())"
      }
      $launcherProcess.Refresh()
      if ($launcherProcess.HasExited) {
        throw "portable-direct launcher exited before the server became ready with code $($launcherProcess.ExitCode)."
      }
      if ($launcherProcess.MainWindowHandle -ne 0 -and $launcherProcess.MainWindowTitle) {
        $seenTitle = $launcherProcess.MainWindowTitle
        if ($seenTitle -like "*$SetupTitle*") {
          throw "Portable launcher opened the installation wizard (title: '$seenTitle')."
        }
      }
      try {
        $live = Invoke-RestMethod -NoProxy -Uri 'http://127.0.0.1:3410/api/health/live' -TimeoutSec 2
        $ready = Invoke-RestMethod -NoProxy -Uri 'http://127.0.0.1:3410/api/health/ready' -TimeoutSec 2
        if ($live.ok -eq $true -and $ready.ok -eq $true) { break }
      } catch { $lastProbeError = $_.Exception.Message }
      if ((Get-Date) -ge $nextProgress) {
        Write-Host "portable-direct waiting: title='$seenTitle' probe=$lastProbeError"
        $nextProgress = (Get-Date).AddSeconds(15)
      }
      Start-Sleep -Seconds 1
    }
    if ($null -eq $live -or $live.ok -ne $true -or $null -eq $ready -or $ready.ok -ne $true) {
      throw "portable-direct server did not pass live and ready probes. lastProbe=$lastProbeError"
    }
    $about = Invoke-RestMethod -NoProxy -Uri 'http://127.0.0.1:3410/api/about' -TimeoutSec 5
    if ([string]$about.commitSha -ne $ExpectedCommit.ToLowerInvariant()) {
      throw "portable-direct server commit $($about.commitSha) did not match $ExpectedCommit."
    }
    $launcherProcess.Refresh()
    $seenTitle = $launcherProcess.MainWindowTitle
    if ($seenTitle -ne $ExpectedTitle) {
      throw "Portable launcher window title '$seenTitle' is not the $Locale status window '$ExpectedTitle'."
    }
    $installRoot = Join-Path $localData 'Claudex Workhouse\server'
    if (Test-Path -LiteralPath $installRoot) {
      throw 'Portable launcher copied its payload into the AppData install root.'
    }
    $registration = Get-ItemProperty -LiteralPath 'HKCU:\Software\Claudex Workhouse' -ErrorAction SilentlyContinue
    if ($null -ne $registration) {
      foreach ($name in @('InstallRoot', 'ServerPid')) {
        if ($null -ne $registration.PSObject.Properties[$name]) {
          throw "Portable launcher wrote the $name registry value."
        }
      }
    }
    if (Test-Path -LiteralPath $uninstallKey) { throw 'Portable launcher registered itself in Windows Installed apps.' }
    foreach ($file in @($startMenuShortcut, $desktopShortcut)) {
      if (Test-Path -LiteralPath $file) { throw "Portable launcher created a shortcut: $file" }
    }
    $configuration = Join-Path $localData 'Claudex Workhouse\config\claudex-workhouse.json'
    if (-not (Test-Path -LiteralPath $configuration -PathType Leaf)) {
      throw 'Portable launcher did not create the user configuration under the data root.'
    }
    Write-Host "portable direct-start test passed for $Locale at commit $($about.commitSha)."
  } finally {
    if ($null -ne $launcherProcess -and -not $launcherProcess.HasExited) {
      Stop-Process -Id $launcherProcess.Id -Force
      $launcherProcess.WaitForExit(10000) | Out-Null
    }
    Stop-TestInstalledServer
    $env:LOCALAPPDATA = $previousLocalAppData
    $env:CLAUDEX_WORKHOUSE_LOCALE = $previousLocale
    Wait-ServerStopped
  }
}

function Test-CodexRuntimeInstall([string]$InstallRoot, [string]$DataRoot) {
  $current = Get-Content -LiteralPath (Join-Path $InstallRoot 'current.json') -Raw | ConvertFrom-Json
  $payloadRoot = Join-Path $InstallRoot ([string]$current.payloadDirectory)
  $node = Join-Path $payloadRoot 'node.exe'
  $installer = Join-Path $payloadRoot 'bin\codex-runtime.mjs'
  $previousRoot = $env:CLAUDEX_WORKHOUSE_ROOT
  try {
    $env:CLAUDEX_WORKHOUSE_ROOT = $DataRoot
    $output = @(& $node $installer ensure 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "Managed Codex installation failed: $($output -join "`n")" }
    $result = $output[-1] | ConvertFrom-Json
    if ($result.ok -ne $true -or -not $result.version) { throw "Managed Codex installer returned an invalid result: $($output -join "`n")" }
    $stateFile = Join-Path $DataRoot 'runtime\codex-runtime.json'
    if (-not (Test-Path -LiteralPath $stateFile -PathType Leaf)) { throw 'Managed Codex state was not activated.' }
    $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    if ($state.schema -ne 1 -or [string]$state.source -ne 'openai-standalone' -or [string]$state.version -ne [string]$result.version -or [string]$state.sha256 -notmatch '^[a-f0-9]{64}$') {
      throw 'Managed Codex state did not bind the verified release.'
    }
    $codex = [IO.Path]::GetFullPath((Join-Path $DataRoot ([string]$state.binary)))
    $releaseRoot = [IO.Path]::GetFullPath((Join-Path $DataRoot 'runtime\codex-home\packages\standalone\releases'))
    if (-not $codex.StartsWith($releaseRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $codex -PathType Leaf)) { throw 'Managed Codex executable was not activated from a versioned release.' }
    foreach ($segment in @($releaseRoot, (Split-Path -Parent (Split-Path -Parent $codex)), (Split-Path -Parent $codex))) {
      if ((Get-Item -LiteralPath $segment -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Managed Codex release path contains a reparse point: $segment" }
    }
    foreach ($obsolete in @((Join-Path $DataRoot 'runtime\codex-bin'), (Join-Path $DataRoot 'runtime\codex-home\packages\standalone\current'))) {
      if (Test-Path -LiteralPath $obsolete) { throw "Obsolete Codex junction remained after installation: $obsolete" }
    }
    & $codex --version | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Managed Codex executable failed its version check.' }
    Write-Host "managed Codex runtime installation test passed for version $($result.version)."
  } finally {
    $env:CLAUDEX_WORKHOUSE_ROOT = $previousRoot
  }
}

function Test-InstalledIntegration([string]$InstallRoot, [string]$DataRoot, [string]$SingleExe) {
  $installedLauncher = Join-Path $InstallRoot 'Claudex Workhouse.exe'
  $startMenuShortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'Claudex Workhouse\Claudex Workhouse.lnk'
  $desktopShortcut = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Claudex Workhouse.lnk'
  $uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Claudex Workhouse'
  foreach ($file in @($installedLauncher, $startMenuShortcut, $desktopShortcut)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Installed integration file is missing: $file" }
  }
  if ((Get-Item -LiteralPath $installedLauncher).Length -ge (Get-Item -LiteralPath $SingleExe).Length) {
    throw 'Installed launcher retained the embedded payload instead of the small reusable launcher.'
  }
  $shortcutTarget = (New-Object -ComObject WScript.Shell).CreateShortcut($desktopShortcut).TargetPath
  if ([IO.Path]::GetFullPath($shortcutTarget) -ne [IO.Path]::GetFullPath($installedLauncher)) {
    throw "The installed shortcut target '$shortcutTarget' does not match '$installedLauncher'."
  }
  $registered = Get-ItemProperty -LiteralPath $uninstallKey
  if ([string]$registered.InstallLocation -ne $InstallRoot -or [string]$registered.UninstallString -notlike '*--uninstall*') {
    throw 'Windows uninstall registration does not match the selected install root.'
  }
  Wait-ServerStopped
  $previousLocalAppData = $env:LOCALAPPDATA
  $previousLocale = $env:CLAUDEX_WORKHOUSE_LOCALE
  $env:LOCALAPPDATA = Split-Path -Parent $DataRoot
  $env:CLAUDEX_WORKHOUSE_LOCALE = 'ko'
  $guideProcess = $null
  $guideErrorFile = Join-Path $DataRoot 'logs\windows-launcher-error.log'
  Remove-Item -LiteralPath $guideErrorFile -Force -ErrorAction SilentlyContinue
  try {
    $guideProcess = Start-Process -FilePath $installedLauncher -PassThru
    $deadline = (Get-Date).AddMinutes(2)
    $bootstrap = $null
    $lastGuideProbeError = $null
    $nextGuideProgress = Get-Date
    while ((Get-Date) -lt $deadline) {
      $guideProcess.Refresh()
      if ($guideProcess.HasExited) { throw "Installed status guide exited early with code $($guideProcess.ExitCode)." }
      if (Test-Path -LiteralPath $guideErrorFile -PathType Leaf) {
        throw "Installed status guide launcher error: $((Get-Content -LiteralPath $guideErrorFile -Raw).Trim())"
      }
      try {
        $bootstrap = Invoke-RestMethod -NoProxy -Uri 'http://127.0.0.1:3410/api/bootstrap/status' -TimeoutSec 2
      } catch {
        $bootstrap = $null
        $lastGuideProbeError = $_.Exception.Message
      }
      if ($guideProcess.MainWindowHandle -ne 0 -and $guideProcess.MainWindowTitle -eq 'Claudex Workhouse 서버' -and $null -ne $bootstrap -and [string]$bootstrap.product -eq 'claudex-workhouse' -and [int]$bootstrap.schemaVersion -eq 1) { break }
      if ((Get-Date) -ge $nextGuideProgress) {
        $guideRegistration = Get-ItemProperty -LiteralPath 'HKCU:\Software\Claudex Workhouse' -ErrorAction SilentlyContinue
        $guidePidProperty = if ($null -ne $guideRegistration) { $guideRegistration.PSObject.Properties['ServerPid'] } else { $null }
        $registeredPid = if ($null -ne $guidePidProperty) { $guidePidProperty.Value } else { 'none' }
        $listener = Get-NetTCPConnection -LocalPort 3410 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        $listenerPid = if ($null -ne $listener) { $listener.OwningProcess } else { 'none' }
        $registeredProcess = if ($registeredPid -ne 'none') { Get-Process -Id $registeredPid -ErrorAction SilentlyContinue } else { $null }
        $registeredState = if ($null -ne $registeredProcess) { "running:$($registeredProcess.ProcessName)" } else { 'absent' }
        Write-Host "installed-guide waiting: title='$($guideProcess.MainWindowTitle)' serverPid=$registeredPid serverState=$registeredState listenerPid=$listenerPid probe=$lastGuideProbeError"
        $nextGuideProgress = (Get-Date).AddSeconds(15)
      }
      Start-Sleep -Milliseconds 500
    }
    $guideProcess.Refresh()
    if ($guideProcess.MainWindowTitle -ne 'Claudex Workhouse 서버') {
      throw "Installed launcher reopened setup instead of the status guide (title: '$($guideProcess.MainWindowTitle)')."
    }
    if ($null -eq $bootstrap -or [string]$bootstrap.product -ne 'claudex-workhouse' -or [int]$bootstrap.schemaVersion -ne 1) {
      throw "Installed status guide did not start a verifiable Workhouse server. Last probe: $lastGuideProbeError"
    }
    Save-WindowScreenshot -Process $guideProcess -Destination $StatusGuideScreenshot
    Write-Host 'installed shortcut target and server status guide test passed.'
  } finally {
    if ($null -ne $guideProcess -and -not $guideProcess.HasExited) {
      Stop-Process -Id $guideProcess.Id -Force
      $guideProcess.WaitForExit(10000) | Out-Null
    }
    Stop-TestInstalledServer
    $env:LOCALAPPDATA = $previousLocalAppData
    $env:CLAUDEX_WORKHOUSE_LOCALE = $previousLocale
    Wait-ServerStopped
  }
  $uninstaller = Start-Process -FilePath $installedLauncher -ArgumentList @('--uninstall', '--quiet') -PassThru -Wait
  if ($uninstaller.ExitCode -ne 0) { throw "Installed uninstaller exited with code $($uninstaller.ExitCode)." }
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline -and (Test-Path -LiteralPath $InstallRoot)) { Start-Sleep -Milliseconds 250 }
  if (Test-Path -LiteralPath $InstallRoot) { throw 'Installed uninstaller did not remove the application directory.' }
  foreach ($file in @($startMenuShortcut, $desktopShortcut)) {
    if (Test-Path -LiteralPath $file) { throw "Installed uninstaller left a shortcut behind: $file" }
  }
  if (Test-Path -LiteralPath $uninstallKey) { throw 'Installed uninstaller left the Windows Apps registration behind.' }
  if (-not (Test-Path -LiteralPath $DataRoot -PathType Container)) { throw 'Installed uninstaller removed the preserved user data directory.' }
  Write-Host 'installed launcher, shortcuts, Apps registration, and uninstall test passed.'
}

try {
  Assert-LauncherMode -Label 'single-exe' -Launcher $singleExePath `
    -LocalAppData (Join-Path $testRoot 'diagnose-single-exe-local-app-data') -ExpectedMode 'installer' -ExpectedEmbedded 'yes'
  Test-InstallerWizard -Launcher $singleExePath -Locale 'en' -ExpectedTitle 'Claudex Workhouse Setup'
  Test-InstallerWizard -Launcher $singleExePath -Locale 'ko' -ExpectedTitle 'Claudex Workhouse 설치'
  # Keep the executable and working-directory paths below MAX_PATH while making
  # the payload's deeply nested dependency paths exceed it.
  $longInstallRoot = Join-Path $testRoot ('custom-install-' + ('long-segment-' * 6))
  $payloadManifest = Get-Content -LiteralPath (Join-Path $portableLauncher.DirectoryName 'payload-manifest.json') -Raw | ConvertFrom-Json
  $longestPayloadPath = ($payloadManifest.files | ForEach-Object { (Join-Path (Join-Path $longInstallRoot 'versions\1.0.0') ([string]$_.path)).Length } | Measure-Object -Maximum).Maximum
  if ($longestPayloadPath -le 260) { throw "Long-path smoke fixture reached only $longestPayloadPath characters." }
  Test-Launcher -Label 'single-exe' -Launcher $singleExePath -ExpectInstalledPayload $true -InstallRoot $longInstallRoot -LegacyAclFixture $true -StaleSameVersionPayloadFixture $true
  $singleExeDataRoot = Join-Path $testRoot 'single-exe-local-app-data\Claudex Workhouse'
  Test-CodexRuntimeInstall -InstallRoot $longInstallRoot -DataRoot $singleExeDataRoot
  Test-InstalledIntegration -InstallRoot $longInstallRoot -DataRoot $singleExeDataRoot -SingleExe $singleExePath
  Test-PortableDirectStart -Launcher $portableLauncher.FullName -Locale 'en' -ExpectedTitle 'Claudex Workhouse Server' -SetupTitle 'Claudex Workhouse Setup'
  Test-PortableDirectStart -Launcher $portableLauncher.FullName -Locale 'ko' -ExpectedTitle 'Claudex Workhouse 서버' -SetupTitle 'Claudex Workhouse 설치'
  Test-PortableBrokenLayout -PortableFolder $portableLauncher.DirectoryName -SetupTitle 'Claudex Workhouse Setup'
} finally {
  if (Test-Path -LiteralPath $testRoot) {
    try { Remove-Item -LiteralPath $testRoot -Recurse -Force } catch { Write-Warning "Smoke-test cleanup was denied: $($_.Exception.Message)" }
  }
}
