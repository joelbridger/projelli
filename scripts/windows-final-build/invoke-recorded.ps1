[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Cwd,
  [Parameter(Mandatory=$true)][ValidateSet('ROOT','ROOT/src-tauri')][string]$LogicalCwd,
  [Parameter(Mandatory=$true)][string]$Executable,
  [Parameter(Mandatory=$true)][string[]]$Argv,
  [Parameter(Mandatory=$true)][string]$Receipt
)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
if(Test-Path -LiteralPath $Receipt){throw 'command receipt already exists'}
if(@($Argv|Where-Object {$_ -match 'SECRET|CLIENT_ID'}).Count){throw 'secret name/value command-line exposure forbidden'}
$hostile=@(Get-ChildItem Env:|Where-Object {
  $_.Name -match '^(VITE_|CARGO_|RUST|NODE_OPTIONS$|NPM_CONFIG_|npm_config_|CC$|CXX$|CFLAGS$|CPPFLAGS$|LDFLAGS$|OPENSSL_|PKG_CONFIG_|MAKEFLAGS$|TAURI_)' -and
  !(($_.Name -eq 'TAURI_CONFIG') -and $_.Value)
})
if($hostile.Count){throw "build-affecting environment reached command runner: $($hostile.Name -join ',')"}
$started=(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ')
Push-Location -LiteralPath $Cwd
try { & $Executable @Argv; $code=$LASTEXITCODE } finally { Pop-Location }
$ended=(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ')
$record=[ordered]@{cwd=$LogicalCwd;argv=@((Split-Path $Executable -Leaf))+$Argv;started_utc=$started;ended_utc=$ended;exit_code=$code}
[IO.File]::WriteAllText($Receipt,($record|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
if($code -ne 0){throw "recorded command failed with exit code $code"}
