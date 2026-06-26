<#
  robot-snapshot.ps1 - bench-side frozen-workspace snapshot tool.

  Archives a FULLY-INDEXED Keepance workspace (documents + the hidden .keepance
  folder: LanceDB vector index + SQLCipher audit/mail stores) into one .tar, and
  restores it back over the canonical workspace path in seconds - so tests stop
  re-importing and re-embedding hundreds of files every run.

  Actions:
    Status   non-destructive; reports whether a usable archive exists (+ size).
    Archive  tar the canonical workspace -> -Archive. Refuses if the workspace
             is not actually indexed (no .keepance\vectors), so we never freeze
             a half-built world.
    Restore  extract -Archive into a TEMP dir, VERIFY .keepance\vectors is present,
             and only THEN atomically swap it into -WsRoot. A failed/partial
             extract can never destroy the live workspace.

  Output contract: prints human progress to the host, then exactly ONE compact
  JSON object on the final line (the Node caller parses that line).

  Portability: the index keys live in this machine's OS keychain and the index
  bakes absolute paths, so an archive is BENCH-BOUND and PATH-BOUND. Build and
  restore only here, only to the same -WsRoot.

  Targets Windows PowerShell 5.1 (the bench default): no ?? / ternary / pipeline
  chain operators. Uses the built-in tar.exe (bsdtar, Win10 1803+).
#>
param(
  [ValidateSet('Status', 'Archive', 'Restore')]
  [string]$Action = 'Status',
  [string]$Archive = 'C:\keepance-snapshots\northcrest-golden.tar',
  [string]$WsRoot = 'C:\keepance-demo-northcrest\Northcrest Wealth Partners',
  # DANGEROUS escape hatch: allow archive/restore against a non-canonical -WsRoot.
  # The normal robot flow NEVER sets this. Without it, the destructive restore is
  # hard-locked to the canonical bench workspace so it can't clobber data elsewhere.
  [switch]$AllowNonCanonical
)

$ErrorActionPreference = 'Stop'

# The ONLY workspace the robot flow is ever allowed to archive/restore.
$CanonicalWsRoot = 'C:\keepance-demo-northcrest\Northcrest Wealth Partners'

function Emit($obj) {
  # The Node side scans upward for the last line starting with '{'.
  Write-Output ($obj | ConvertTo-Json -Compress -Depth 6)
}

function Normalize-Path($p) { return ([string]$p).TrimEnd('\', '/').ToLowerInvariant() }

# HARD-REFUSE any -WsRoot that isn't the canonical bench path (unless explicitly
# overridden). Called before any destructive op. Exits the process on refusal.
function Assert-CanonicalWsRoot {
  if ($AllowNonCanonical) { return }
  if ((Normalize-Path $WsRoot) -ne (Normalize-Path $CanonicalWsRoot)) {
    Emit @{ ok = $false; error = "refusing: -WsRoot '$WsRoot' is not the canonical bench workspace ('$CanonicalWsRoot'). Pass -AllowNonCanonical to override (DANGEROUS - can clobber data outside the bench sandbox)." }
    exit 1
  }
}

# Parent dir + leaf name of the workspace (leaf usually contains a space).
$wsParent = Split-Path -Parent $WsRoot
$wsLeaf = Split-Path -Leaf $WsRoot
$snapDir = Split-Path -Parent $Archive
$tempRoot = Join-Path $snapDir '_restore_tmp'

function Get-FileSize($p) {
  if (Test-Path -LiteralPath $p) { return (Get-Item -LiteralPath $p).Length }
  return 0
}

function Remove-Hard($p) {
  # Remove with a couple of retries: WebView2/LanceDB can briefly hold handles
  # even after the app is killed.
  for ($i = 0; $i -lt 4; $i++) {
    if (-not (Test-Path -LiteralPath $p)) { return }
    try {
      Remove-Item -LiteralPath $p -Recurse -Force
      if (-not (Test-Path -LiteralPath $p)) { return }
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  if (Test-Path -LiteralPath $p) { throw "could not remove $p (locked?)" }
}

try {
  if ($Action -eq 'Status') {
    $exists = Test-Path -LiteralPath $Archive
    $bytes = Get-FileSize $Archive
    $manifestPath = [regex]::Replace($Archive, '(?i)\.tar$', '.manifest.json')
    if ($manifestPath -eq $Archive) { $manifestPath = "$Archive.manifest.json" }
    $manifest = $null
    if (Test-Path -LiteralPath $manifestPath) {
      try { $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { $manifest = $null }
    }
    Emit @{ ok = $true; exists = [bool]$exists; archiveBytes = $bytes; archive = $Archive; manifest = $manifest }
    exit 0
  }

  if ($Action -eq 'Archive') {
    Assert-CanonicalWsRoot
    if (-not (Test-Path -LiteralPath $WsRoot)) {
      Emit @{ ok = $false; error = "workspace not found: $WsRoot" }; exit 1
    }
    $vectors = Join-Path $WsRoot '.keepance\vectors'
    if (-not (Test-Path -LiteralPath $vectors)) {
      Emit @{ ok = $false; error = "refusing to archive: workspace is not indexed (missing $vectors)" }; exit 1
    }
    if (-not (Test-Path -LiteralPath $snapDir)) { New-Item -ItemType Directory -Force -Path $snapDir | Out-Null }

    # Tar to a TEMP file first; only atomically replace the existing good archive
    # AFTER the new tar is created + validated, so a failed tar can't destroy the
    # only restore point.
    $tmpArchive = "$Archive.building.tar"
    if (Test-Path -LiteralPath $tmpArchive) { Remove-Item -LiteralPath $tmpArchive -Force }

    Write-Host "archiving '$WsRoot' -> '$tmpArchive'"
    # cd into the parent and archive the relative leaf so member paths stay relative.
    & tar.exe -C $wsParent -cf $tmpArchive $wsLeaf
    if ($LASTEXITCODE -ne 0) { Remove-Item -LiteralPath $tmpArchive -Force -EA SilentlyContinue; Emit @{ ok = $false; error = "tar create failed (exit $LASTEXITCODE) - existing archive untouched" }; exit 1 }

    $bytes = Get-FileSize $tmpArchive
    if ($bytes -le 0) { Remove-Item -LiteralPath $tmpArchive -Force -EA SilentlyContinue; Emit @{ ok = $false; error = 'archive is empty after tar - existing archive untouched' }; exit 1 }
    $sha = (Get-FileHash -LiteralPath $tmpArchive -Algorithm SHA256).Hash

    # TRUE atomic replace. When the archive already exists, use the NTFS
    # ReplaceFile primitive ([System.IO.File]::Replace) so the swap is a single
    # atomic operation: a crash or failure can never leave us with NO archive (the
    # old one stays intact on any error). This requires source + dest + backup on
    # the SAME volume, which holds because $tmpArchive / the backup live in $snapDir
    # next to $Archive. Only when there is NO existing archive (nothing to atomically
    # replace) do we fall back to a plain move.
    if (Test-Path -LiteralPath $Archive) {
      $replaceBak = "$Archive.replaced.bak"
      if (Test-Path -LiteralPath $replaceBak) { Remove-Item -LiteralPath $replaceBak -Force -EA SilentlyContinue }
      [System.IO.File]::Replace($tmpArchive, $Archive, $replaceBak)
      Remove-Item -LiteralPath $replaceBak -Force -EA SilentlyContinue
    } else {
      Move-Item -LiteralPath $tmpArchive -Destination $Archive -Force
    }

    $bytes = Get-FileSize $Archive
    Emit @{ ok = $true; archive = $Archive; archiveBytes = $bytes; sha256 = $sha; wsRoot = $WsRoot }
    exit 0
  }

  if ($Action -eq 'Restore') {
    # --- HARD LOCK: restore is destructive - only ever to the canonical bench path. ---
    Assert-CanonicalWsRoot

    # --- Guard: never touch the live workspace without a usable archive ---
    if (-not (Test-Path -LiteralPath $Archive)) {
      Emit @{ ok = $false; error = "refusing to restore: archive not found: $Archive" }; exit 1
    }
    $archiveBytes = Get-FileSize $Archive
    if ($archiveBytes -le 0) {
      Emit @{ ok = $false; error = 'refusing to restore: archive is empty (0 bytes)' }; exit 1
    }

    # --- Integrity: REQUIRE a complete, matching manifest (fail-closed). The
    #     manifest must exist, parse, and carry sha256 + workspacePath + archiveBytes,
    #     all matching the archive on disk and the target path. Any missing field,
    #     hash/size mismatch, or path mismatch => refuse (no destructive action). ---
    $manifestPath = [regex]::Replace($Archive, '(?i)\.tar$', '.manifest.json')
    if ($manifestPath -eq $Archive) { $manifestPath = "$Archive.manifest.json" }
    if (-not (Test-Path -LiteralPath $manifestPath)) {
      Emit @{ ok = $false; error = "refusing to restore: manifest not found ($manifestPath)" }; exit 1
    }
    $m = $null
    try { $m = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { $m = $null }
    if (-not $m) {
      Emit @{ ok = $false; error = "refusing to restore: manifest present but unreadable ($manifestPath)" }; exit 1
    }
    foreach ($field in @('sha256', 'workspacePath', 'archiveBytes')) {
      if ($null -eq $m.$field -or "$($m.$field)" -eq '') {
        Emit @{ ok = $false; error = "refusing to restore: manifest missing required field '$field'" }; exit 1
      }
    }
    $actualSha = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash
    if ($actualSha -ne $m.sha256) {
      Emit @{ ok = $false; error = "refusing to restore: archive sha256 mismatch vs manifest (corrupt/wrong archive)"; expected = $m.sha256; actual = $actualSha }; exit 1
    }
    if ([int64]$m.archiveBytes -ne [int64]$archiveBytes) {
      Emit @{ ok = $false; error = "refusing to restore: archive size mismatch vs manifest"; expected = [int64]$m.archiveBytes; actual = [int64]$archiveBytes }; exit 1
    }
    if ((Normalize-Path $m.workspacePath) -ne (Normalize-Path $WsRoot)) {
      Emit @{ ok = $false; error = "refusing to restore: manifest workspacePath ('$($m.workspacePath)') != target -WsRoot ('$WsRoot')" }; exit 1
    }

    # --- Extract into a temp dir; verify BEFORE any destructive change ---
    Remove-Hard $tempRoot
    New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
    Write-Host "extracting '$Archive' -> '$tempRoot'"
    & tar.exe -C $tempRoot -xf $Archive
    if ($LASTEXITCODE -ne 0) { Remove-Hard $tempRoot; Emit @{ ok = $false; error = "tar extract failed (exit $LASTEXITCODE)" }; exit 1 }

    $staged = Join-Path $tempRoot $wsLeaf
    $stagedVectors = Join-Path $staged '.keepance\vectors'
    if (-not (Test-Path -LiteralPath $stagedVectors)) {
      Remove-Hard $tempRoot
      Emit @{ ok = $false; error = "refusing to swap: extracted snapshot is missing .keepance\vectors ($stagedVectors)" }; exit 1
    }
    # Not a skeleton: the staged tree must contain at least one DOCUMENT (a file
    # outside .keepance), or we'd be replacing the real workspace with an index-only husk.
    $docCount = (Get-ChildItem -LiteralPath $staged -Recurse -File -Force -EA SilentlyContinue |
      Where-Object { $_.FullName -notlike '*\.keepance\*' } | Measure-Object).Count
    if ($docCount -lt 1) {
      Remove-Hard $tempRoot
      Emit @{ ok = $false; error = "refusing to swap: extracted snapshot has no documents (skeleton?)" }; exit 1
    }

    # --- Swap with guarded rollback (hardened per Codex review). Use a UNIQUE
    #     backup path (never clobber a prior backup), and on a failed staged move
    #     clear any partial $WsRoot before rolling back so the backup REPLACES it
    #     rather than landing inside it. If rollback itself fails, keep the backup
    #     and report it loudly - never silently lose the workspace. ---
    if (-not (Test-Path -LiteralPath $wsParent)) { New-Item -ItemType Directory -Force -Path $wsParent | Out-Null }
    $hadOriginal = Test-Path -LiteralPath $WsRoot
    $backup = "$WsRoot.bak-restore-$([guid]::NewGuid().ToString('n'))"
    $backupCreated = $false
    try {
      if ($hadOriginal) {
        Move-Item -LiteralPath $WsRoot -Destination $backup -Force
        $backupCreated = $true
      }
      Move-Item -LiteralPath $staged -Destination $WsRoot -Force
    } catch {
      $swapError = $_.Exception.Message
      $rollbackOk = $false
      $rollbackError = $null
      if ($backupCreated -and (Test-Path -LiteralPath $backup)) {
        try {
          if (Test-Path -LiteralPath $WsRoot) { Remove-Hard $WsRoot } # clear any partial staged move
          Move-Item -LiteralPath $backup -Destination $WsRoot -Force
          $rollbackOk = Test-Path -LiteralPath $WsRoot
        } catch {
          $rollbackError = $_.Exception.Message
        }
      } elseif (-not $hadOriginal) {
        $rollbackOk = $true # nothing to roll back to; canonical was absent to begin with
      }
      Remove-Hard $tempRoot
      # Keep the backup if rollback failed, so the workspace stays recoverable.
      Emit @{ ok = $false; error = 'swap failed'; swapError = $swapError; rollbackOk = $rollbackOk; rollbackError = $rollbackError; backup = $backup }
      exit 1
    }
    # Success: drop the backup + temp.
    Remove-Hard $backup
    Remove-Hard $tempRoot

    $restoredVectors = Join-Path $WsRoot '.keepance\vectors'
    $okSwap = Test-Path -LiteralPath $restoredVectors
    Emit @{ ok = [bool]$okSwap; wsRoot = $WsRoot; restoredFrom = $Archive; archiveBytes = (Get-FileSize $Archive); docCount = $docCount }
    if ($okSwap) { exit 0 } else { exit 1 }
  }
}
catch {
  Emit @{ ok = $false; error = ("$($_.Exception.Message)") }
  exit 1
}
