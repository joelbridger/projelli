# Download Piper and the bundled English voice for a Windows Tauri build.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/fetch-piper-sidecar.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/fetch-piper-sidecar.ps1 -SkipVoice
#
# This is the Windows companion to fetch-piper-sidecar.sh. It intentionally
# uses the same pinned sources, hashes, and destinations.
[CmdletBinding()]
param(
    [switch]$SkipVoice
)

$ErrorActionPreference = 'Stop'

$PiperVersion = '2023.11.14-2'
$TargetTriple = 'x86_64-pc-windows-msvc'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$BinariesDir = Join-Path $RepoRoot 'src-tauri\binaries'
$VoicesDir = Join-Path $RepoRoot 'src-tauri\voices'
$ArchiveName = 'piper_windows_amd64.zip'
$BinaryName = 'piper.exe'
$DestinationBinary = "piper-$TargetTriple.exe"
$ReleaseUrl = "https://github.com/rhasspy/piper/releases/download/$PiperVersion/$ArchiveName"
$HuggingFaceCommit = 'e21c7de8d4eab79b902f0d61e662b3f21664b8d2'
$HuggingFaceBase = "https://huggingface.co/rhasspy/piper-voices/resolve/$HuggingFaceCommit"

$ExpectedHashes = @{
    'piper_windows_amd64.zip' = 'f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea'
    'en_US-amy-medium.onnx' = 'b3a6e47b57b8c7fbe6a0ce2518161a50f59a9cdd8a50835c02cb02bdd6206c18'
    'en_US-amy-medium.onnx.json' = '95a23eb4d42909d38df73bb9ac7f45f597dbfcde2d1bf9526fdeaf5466977d77'
}

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

function Download-File {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Destination
}

New-Item -ItemType Directory -Force -Path $BinariesDir, $VoicesDir | Out-Null
$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("lantern-piper-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

try {
    $ArchivePath = Join-Path $TempDir $ArchiveName
    Write-Host "Downloading Piper $PiperVersion for $TargetTriple..."
    Download-File -Url $ReleaseUrl -Destination $ArchivePath
    Assert-Sha256 -Path $ArchivePath -Expected $ExpectedHashes[$ArchiveName]
    Expand-Archive -LiteralPath $ArchivePath -DestinationPath $TempDir -Force

    $SourceDir = Join-Path $TempDir 'piper'
    $SourceBinary = Join-Path $SourceDir $BinaryName
    if (-not (Test-Path -LiteralPath $SourceBinary -PathType Leaf)) {
        throw "Piper binary not found in archive: $BinaryName"
    }

    # Keep all sibling DLLs and espeak-ng-data next to the executable, matching
    # the Bash script and Piper's runtime lookup behavior.
    Copy-Item -Path (Join-Path $SourceDir '*') -Destination $BinariesDir -Recurse -Force
    Move-Item -LiteralPath (Join-Path $BinariesDir $BinaryName) -Destination (Join-Path $BinariesDir $DestinationBinary) -Force
    if (-not (Test-Path -LiteralPath (Join-Path $BinariesDir $DestinationBinary) -PathType Leaf)) {
        throw "Staged Piper binary is missing: $DestinationBinary"
    }
    if ((Get-Item -LiteralPath (Join-Path $BinariesDir $DestinationBinary)).Length -eq 0) {
        throw "Staged Piper binary is empty: $DestinationBinary"
    }
    Write-Host "Piper binary: $(Join-Path $BinariesDir $DestinationBinary)"

    if (-not $SkipVoice) {
        $VoiceId = 'en_US-amy-medium'
        $VoiceDestination = Join-Path $VoicesDir $VoiceId
        $VoiceSourceDir = 'en/en_US/amy/medium'
        New-Item -ItemType Directory -Force -Path $VoiceDestination | Out-Null

        Write-Host "Downloading bundled voice: $VoiceId from HuggingFace..."
        foreach ($VoiceFile in @("$VoiceId.onnx", "$VoiceId.onnx.json")) {
            $VoicePath = Join-Path $VoiceDestination $VoiceFile
            Download-File -Url "$HuggingFaceBase/$VoiceSourceDir/$VoiceFile" -Destination $VoicePath
            Assert-Sha256 -Path $VoicePath -Expected $ExpectedHashes[$VoiceFile]
            Write-Host "  staged: $VoicePath"
        }
        Write-Host "Voice files staged to: $VoiceDestination"
    } else {
        Write-Host 'Skipping bundled voice download (-SkipVoice).'
    }

    Write-Host ''
    Write-Host 'Done. Piper is ready for Tauri builds.'
} finally {
    Remove-Item -LiteralPath $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
