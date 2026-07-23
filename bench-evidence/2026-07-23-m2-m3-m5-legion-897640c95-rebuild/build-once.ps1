$ErrorActionPreference = 'Stop'

$root = 'D:\Lantern-M2-M3-M5-897640c95-R2'
$source = "$root\source"
$target = "$root\build\target"
$package = "$root\package"
$evidence = "$root\evidence"
$marker = "$root\ONE-CORRECTIVE-RUST-PACKAGE-BUILD.marker"
$log = "$root\build.log"
$sccache = 'C:\Users\james\.cargo\bin\sccache.exe'
$expectedArchive = 'A7E856B35840AA40AA416558FF0D7927E167F94D6313B1464029F7BFDBD796F5'
$expectedPackage = '192F9B6E8237344FE730D4DCF058759BD3B0457664501F3FA1F0B351F380E012'
$expectedTauri = '6D270BB49CAEBBD0D685EFA9AC8FFBB4A74BD1EB8E4DA71D9767F0E699772608'

if (Test-Path -LiteralPath $marker) { throw "Corrective build marker already exists: $marker" }
if ((Get-FileHash -LiteralPath "$root\source.tar" -Algorithm SHA256).Hash -ne $expectedArchive) { throw 'Archive identity changed before build marker' }
if ((Get-FileHash -LiteralPath "$source\package.json" -Algorithm SHA256).Hash -ne $expectedPackage) { throw 'package.json identity changed before build marker' }
if ((Get-FileHash -LiteralPath "$source\src-tauri\tauri.conf.json" -Algorithm SHA256).Hash -ne $expectedTauri) { throw 'tauri config identity changed before build marker' }
if (-not (Test-Path -LiteralPath "$evidence\stage-receipt.json")) { throw 'Missing staged-sidecar receipt' }

New-Item -ItemType Directory -Path $target, $package -Force | Out-Null
$os = Get-CimInstance Win32_OperatingSystem
$disks = Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DeviceID -in @('C:', 'D:') } | Select-Object DeviceID, FreeSpace, Size
$preProcesses = @(Get-Process -Name cargo,rustc,node,powershell,sccache -ErrorAction SilentlyContinue | Select-Object ProcessName, Id, StartTime, Path)
& $sccache --show-stats | Set-Content -Path "$evidence\sccache-before.txt" -Encoding utf8

$env:CARGO_TARGET_DIR = $target
$env:RUSTC_WRAPPER = $sccache
$env:SCCACHE_DIR = 'D:\Lantern-sccache-cache'
$env:SCCACHE_CACHE_SIZE = '25G'
$env:VITE_FLAG_SELECTION_AUTHORITY_BOOT_GATE = 'true'
$env:VITE_FLAG_MEETINGS_SHELL_V1 = 'true'
$env:VITE_FLAG_SHARED_CLIENT_BAR = 'true'
$env:VITE_FLAG_V1_SHELL_FRAME = 'true'

$markerUtc = (Get-Date).ToUniversalTime()
[IO.File]::WriteAllText($marker, "revision=897640c95d50f14400fe0868904f5da3f11aa9fb`r`nmarker_utc=$($markerUtc.ToString('o'))`r`n")
$started = (Get-Date).ToUniversalTime()
Push-Location $source
try {
  cmd.exe /c "npm.cmd run tauri:build > \"$log\" 2>&1"
  $exitCode = $LASTEXITCODE
} finally {
  Pop-Location
}
$ended = (Get-Date).ToUniversalTime()

& $sccache --show-stats | Set-Content -Path "$evidence\sccache-after.txt" -Encoding utf8
$exe = Get-Item -LiteralPath "$target\release\lantern.exe" -ErrorAction SilentlyContinue
$installer = Get-ChildItem -LiteralPath "$target\release\bundle\nsis" -File -Filter '*.exe' -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
if ($exe) { Copy-Item -LiteralPath $exe.FullName -Destination "$package\lantern.exe" -Force }
if ($installer) { Copy-Item -LiteralPath $installer.FullName -Destination "$package\$($installer.Name)" -Force }
$postProcesses = @(Get-Process -Name cargo,rustc,node,powershell,sccache -ErrorAction SilentlyContinue | Select-Object ProcessName, Id, StartTime, Path)

$receipt = [ordered]@{
  revision = '897640c95d50f14400fe0868904f5da3f11aa9fb'
  build_count = 1
  marker_path = $marker
  marker_utc = $markerUtc.ToString('o')
  command = 'npm run tauri:build'
  started_utc = $started.ToString('o')
  ended_utc = $ended.ToString('o')
  elapsed_seconds = ($ended - $started).TotalSeconds
  exit_code = $exitCode
  flags = [ordered]@{ selection_authority_boot_gate = $env:VITE_FLAG_SELECTION_AUTHORITY_BOOT_GATE; meetings_shell_v1 = $env:VITE_FLAG_MEETINGS_SHELL_V1; shared_client_bar = $env:VITE_FLAG_SHARED_CLIENT_BAR; v1_shell_frame = $env:VITE_FLAG_V1_SHELL_FRAME }
  pre = [ordered]@{ resources = [ordered]@{ free_ram_bytes = [int64]$os.FreePhysicalMemory * 1KB; disks = $disks }; direct_get_process = $preProcesses }
  post = [ordered]@{ direct_get_process = $postProcesses }
  cache = [ordered]@{ enabled = $true; claim = 'none'; executable = $sccache; directory = $env:SCCACHE_DIR; before = "$evidence\sccache-before.txt"; after = "$evidence\sccache-after.txt" }
  artifacts = [ordered]@{ executable = if ($exe) { [ordered]@{ path = "$package\lantern.exe"; bytes = (Get-Item -LiteralPath "$package\lantern.exe").Length; sha256 = (Get-FileHash -LiteralPath "$package\lantern.exe" -Algorithm SHA256).Hash } } else { $null }; installer = if ($installer) { $copy = "$package\$($installer.Name)"; [ordered]@{ path = $copy; bytes = (Get-Item -LiteralPath $copy).Length; sha256 = (Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash } } else { $null } }
  log_path = $log
}
$receipt | ConvertTo-Json -Depth 8 | Set-Content -Path "$evidence\build-receipt.json" -Encoding utf8
exit $exitCode
