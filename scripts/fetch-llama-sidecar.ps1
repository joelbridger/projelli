# Download the pinned Windows llama.cpp server sidecar and its runtime DLLs.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/fetch-llama-sidecar.ps1
#
# This is the Windows companion to fetch-llama-sidecar.sh. It intentionally
# uses the same pinned source, hash, and destination.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$LlamaVersion = 'b9789'
$TargetTriple = 'x86_64-pc-windows-msvc'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$BinariesDir = Join-Path $RepoRoot 'src-tauri\binaries'
$ArchiveName = "llama-$LlamaVersion-bin-win-cpu-x64.zip"
$ServerName = 'llama-server.exe'
$DestinationBinary = "llama-server-$TargetTriple.exe"
$ReleaseUrl = "https://github.com/ggml-org/llama.cpp/releases/download/$LlamaVersion/$ArchiveName"
$ExpectedArchiveHash = 'b5e7b4ba66ae0a885cb670f88bfca35f73e45aeca565f1da4ce437b3a3cbae96'

function Assert-Sha256 {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Expected
    )

    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
    if ($actual -ne $Expected) {
        throw "SHA256 mismatch for $Path. Expected $Expected, got $actual."
    }
    Write-Host "SHA256 verified: $(Split-Path -Leaf $Path)"
}

New-Item -ItemType Directory -Force -Path $BinariesDir | Out-Null
$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("lantern-llama-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

try {
    $ArchivePath = Join-Path $TempDir $ArchiveName
    Write-Host "Downloading llama.cpp $LlamaVersion for $TargetTriple..."
    Invoke-WebRequest -UseBasicParsing -Uri $ReleaseUrl -OutFile $ArchivePath
    Assert-Sha256 -Path $ArchivePath -Expected $ExpectedArchiveHash
    Expand-Archive -LiteralPath $ArchivePath -DestinationPath $TempDir -Force

    $SourceBinary = Get-ChildItem -LiteralPath $TempDir -Recurse -File -Filter $ServerName | Select-Object -First 1
    if ($null -eq $SourceBinary) {
        throw "llama-server binary not found in archive: $ServerName"
    }
    $SourceDir = $SourceBinary.DirectoryName

    Copy-Item -LiteralPath $SourceBinary.FullName -Destination (Join-Path $BinariesDir $DestinationBinary) -Force
    $Libraries = @(Get-ChildItem -LiteralPath $SourceDir -File -Filter '*.dll')
    if ($Libraries.Count -eq 0) {
        throw "No sibling runtime libraries matching *.dll found in $ArchiveName"
    }
    foreach ($Library in $Libraries) {
        Copy-Item -LiteralPath $Library.FullName -Destination $BinariesDir -Force
    }

    $StagedBinary = Join-Path $BinariesDir $DestinationBinary
    if (-not (Test-Path -LiteralPath $StagedBinary -PathType Leaf)) {
        throw "Staged llama-server binary is missing: $DestinationBinary"
    }
    if ((Get-Item -LiteralPath $StagedBinary).Length -eq 0) {
        throw "Staged llama-server binary is empty: $DestinationBinary"
    }

    Write-Host "llama-server binary: $StagedBinary"
    Write-Host "Runtime libraries copied: $($Libraries.Count)"
    Write-Host ''
    Write-Host 'Done. llama.cpp is ready for Tauri builds.'
} finally {
    Remove-Item -LiteralPath $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
