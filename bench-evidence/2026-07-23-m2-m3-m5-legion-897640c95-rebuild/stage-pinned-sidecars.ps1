$ErrorActionPreference = 'Stop'

$root = 'D:\Lantern-M2-M3-M5-897640c95-R2'
$archive = "$root\source.tar"
$source = "$root\source"
$evidence = "$root\evidence"
$priorManifestPath = 'D:\Lantern-M2-M3-M5-897640c95\evidence\sidecar-manifest.json'
$expected = [ordered]@{
  archive_sha256 = 'A7E856B35840AA40AA416558FF0D7927E167F94D6313B1464029F7BFDBD796F5'
  package_sha256 = '192F9B6E8237344FE730D4DCF058759BD3B0457664501F3FA1F0B351F380E012'
  tauri_sha256 = '6D270BB49CAEBBD0D685EFA9AC8FFBB4A74BD1EB8E4DA71D9767F0E699772608'
}

if (-not (Test-Path -LiteralPath $archive)) { throw "Missing transferred archive: $archive" }
if (Test-Path -LiteralPath $source) { throw "Refusing to overwrite extracted source: $source" }
New-Item -ItemType Directory -Path $source, $evidence -Force | Out-Null

$archiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
if ($archiveHash -ne $expected.archive_sha256) { throw "Archive SHA-256 mismatch: $archiveHash" }

& tar.exe -xf $archive -C $source
if ($LASTEXITCODE -ne 0) { throw "Archive extraction failed: $LASTEXITCODE" }

$packageHash = (Get-FileHash -LiteralPath "$source\package.json" -Algorithm SHA256).Hash
$tauriHash = (Get-FileHash -LiteralPath "$source\src-tauri\tauri.conf.json" -Algorithm SHA256).Hash
if ($packageHash -ne $expected.package_sha256) { throw "package.json SHA-256 mismatch: $packageHash" }
if ($tauriHash -ne $expected.tauri_sha256) { throw "tauri.conf.json SHA-256 mismatch: $tauriHash" }

if (-not (Test-Path -LiteralPath $priorManifestPath)) { throw "Missing verified prior sidecar manifest: $priorManifestPath" }
$priorManifestHash = (Get-FileHash -LiteralPath $priorManifestPath -Algorithm SHA256).Hash
$manifest = Get-Content -LiteralPath $priorManifestPath -Raw | ConvertFrom-Json
if ($manifest.source -ne 'verified hash-keyed local sidecar mirror') { throw 'Unexpected sidecar source declaration' }
if (-not (Test-Path -LiteralPath $manifest.mirror_root)) { throw "Missing mirror: $($manifest.mirror_root)" }
if (-not (Test-Path -LiteralPath $manifest.audit_path)) { throw "Missing audit record: $($manifest.audit_path)" }

$staged = @()
foreach ($entry in $manifest.files) {
  $src = Join-Path $manifest.mirror_root $entry.relative_path
  $dst = Join-Path "$source\src-tauri" $entry.relative_path
  if (-not (Test-Path -LiteralPath $src)) { throw "Missing mirror file: $src" }
  $sourceHash = (Get-FileHash -LiteralPath $src -Algorithm SHA256).Hash
  if ($sourceHash -ne $entry.sha256) { throw "Mirror hash mismatch: $src" }
  $parent = Split-Path -Parent $dst
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  Copy-Item -LiteralPath $src -Destination $dst -Force
  $destinationHash = (Get-FileHash -LiteralPath $dst -Algorithm SHA256).Hash
  if ($destinationHash -ne $entry.sha256) { throw "Destination hash mismatch: $dst" }
  $staged += [ordered]@{ relative_path = $entry.relative_path; bytes = $entry.bytes; sha256 = $entry.sha256; source_sha256 = $sourceHash; destination_sha256 = $destinationHash }
}

$result = [ordered]@{
  recorded_at_utc = (Get-Date).ToUniversalTime().ToString('o')
  archive = [ordered]@{ path = $archive; sha256 = $archiveHash; expected_sha256 = $expected.archive_sha256 }
  source = [ordered]@{ path = $source; accepted_git_tree = '163d6fe1a81941ba3023552130559a5949b95ee6'; package_sha256 = $packageHash; tauri_config_sha256 = $tauriHash }
  sidecars = [ordered]@{ source = $manifest.source; mirror_root = $manifest.mirror_root; audit_path = $manifest.audit_path; audit_sha256 = (Get-FileHash -LiteralPath $manifest.audit_path -Algorithm SHA256).Hash; prior_manifest_path = $priorManifestPath; prior_manifest_sha256 = $priorManifestHash; files_verified = $staged.Count; files = $staged }
  cache_claim = 'none'
  no_sidecar_downloads = $true
}
$result | ConvertTo-Json -Depth 8 | Set-Content -Path "$evidence\stage-receipt.json" -Encoding utf8
