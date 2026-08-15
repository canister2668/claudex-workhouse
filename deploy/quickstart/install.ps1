$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Set-Location $PSScriptRoot
docker compose version | Out-Null
$archive = Get-ChildItem -File -Filter '*.docker.tar' | Select-Object -First 1
if (-not $archive) { $archive = Get-ChildItem -File -Filter '*docker*.tar' | Select-Object -First 1 }
$image = $env:CLAUDEX_IMAGE
if ($archive) {
  $output = docker load -i $archive.FullName
  $output | Write-Host
  $loaded = $output | Select-String '^Loaded image: (.+)$' | Select-Object -Last 1
  if ($loaded) { $image = $loaded.Matches[0].Groups[1].Value }
}
if (-not $image) { $image = 'claudex-workhouse-public-local:1.0.0' }
$port = if ($env:CLAUDEX_PORT) { $env:CLAUDEX_PORT } else { '3410' }
$lan = Get-NetIPAddress -AddressFamily IPv4 -AddressState Preferred |
  Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.|172\.(1[7-9]|2[0-9]|3[01])\.)' -and $_.InterfaceAlias -notmatch 'Loopback|vEthernet|Docker' } |
  Sort-Object InterfaceMetric | Select-Object -First 1 -ExpandProperty IPAddress
if (-not $lan) { $lan = '127.0.0.1' }
$origin = "http://${lan}:$port"
if (-not (Test-Path '.env')) {
  @("CLAUDEX_IMAGE=$image", "CLAUDEX_PORT=$port", "CLAUDEX_ORIGIN=$origin") | Set-Content -Encoding ascii '.env'
}
docker compose --env-file .env up -d
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  docker compose --env-file .env exec -T workhouse node -e "fetch('http://127.0.0.1:3410/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>$null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $ready) { throw '서버가 준비되지 않았습니다. Docker Desktop의 Workhouse 로그를 확인하세요.' }
Write-Host "설치 완료: $origin"
Start-Process $origin
