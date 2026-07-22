[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Z0-9][A-Z0-9-]{11,79}$')][string]$BuildId,
  [Parameter(Mandatory=$true)][string]$SourceArchive,
  [Parameter(Mandatory=$true)][string]$TrackedManifest,
  [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-f]{40}$')][string]$ApprovedCommit,
  [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-f]{40}$')][string]$ApprovedTree,
  [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-f]{64}$')][string]$ServerArchiveSha256,
  [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-f]{64}$')][string]$ArchiveManifestSha256,
  [Parameter(Mandatory=$true)][string]$SevenZipPath
)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
foreach($name in @('TAURI_SIGNING_PRIVATE_KEY','TAURI_PRIVATE_KEY','AZURE_CLIENT_SECRET')){if(Test-Path "Env:$name"){throw "signing environment is forbidden: $name"}}
# Only the two presence-only Gmail inputs survive. Build-affecting caller values
# are cleared before any validated source command can execute.
$hostilePattern='^(VITE_|CARGO_|RUST|NODE_OPTIONS$|NPM_CONFIG_|npm_config_|CC$|CXX$|CFLAGS$|CPPFLAGS$|LDFLAGS$|OPENSSL_|PKG_CONFIG_|MAKEFLAGS$|TAURI_|TARGET_TRIPLE$|FETCH_)'
Get-ChildItem Env:|Where-Object {$_.Name -match $hostilePattern}|ForEach-Object {Remove-Item -LiteralPath "Env:$($_.Name)"}
$archive=(Resolve-Path -LiteralPath $SourceArchive).Path;$manifest=(Resolve-Path -LiteralPath $TrackedManifest).Path
$seven=(Resolve-Path -LiteralPath $SevenZipPath).Path
$fixedParent='C:\APH-Final-Builds';$buildRoot=Join-Path $fixedParent $BuildId
if(Test-Path -LiteralPath $buildRoot){throw 'fixed build root already exists'}
$source=Join-Path $buildRoot 'source';$evidence=Join-Path $buildRoot '.aph-provenance';$commands=Join-Path $evidence 'commands'
$node=(Get-Command node.exe).Source;$npm=(Get-Command npm.cmd).Source;$bash=(Get-Command bash.exe).Source;$cargo=(Get-Command cargo.exe).Source
$vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if(!(Test-Path -LiteralPath $vswhere)){throw 'Visual Studio locator is missing'}
$vsRoot=(& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.Roslyn.Compiler -property installationPath).Trim()
$csc=Join-Path $vsRoot 'MSBuild\Current\Bin\Roslyn\csc.exe';if(!(Test-Path -LiteralPath $csc)){throw 'reviewed Roslyn compiler is missing'}
$tempRecorder=Join-Path $env:TEMP ("aph-native-recorder-$BuildId.exe")
if(Test-Path -LiteralPath $tempRecorder){throw 'recorder bootstrap output already exists'}
$recorderSourceBefore=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'Recorder.cs') -Algorithm SHA256).Hash
& $csc /nologo /optimize+ /target:exe ('/out:'+$tempRecorder) (Join-Path $PSScriptRoot 'Recorder.cs');if($LASTEXITCODE -ne 0){throw 'native recorder compilation failed'}
if((Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'Recorder.cs') -Algorithm SHA256).Hash -cne $recorderSourceBefore){throw 'recorder source changed during bootstrap'}
New-Item -ItemType Directory -Path $buildRoot|Out-Null
$tempEmpty=Join-Path $env:TEMP ("aph-empty-$BuildId.json")
& $tempRecorder inventory $buildRoot initial $tempEmpty;if($LASTEXITCODE -ne 0){throw 'fresh root inventory failed'}
$initial=Get-Content -Raw $tempEmpty|ConvertFrom-Json;if($initial.rows.Count -ne 0){throw 'new fixed build root was not empty'}
New-Item -ItemType Directory -Path $evidence|Out-Null;New-Item -ItemType Directory -Path $commands|Out-Null
$recorder=Join-Path $evidence 'aph-native-recorder.exe';Move-Item $tempRecorder $recorder;Move-Item $tempEmpty (Join-Path $evidence 'empty.json')
$guards=[System.Collections.Generic.List[object]]::new();$commandIndex=0
function QuoteProcessArg([string]$Value){if($Value.Contains('"')){throw 'quote in process argument forbidden'};'"'+$Value+'"'}
function StartFileGuard([string]$File,[string]$Logical,[string]$Stem){
  $before=Join-Path $evidence "$Stem-before.json";& $recorder inventory-file $File $Logical protected $before;if($LASTEXITCODE -ne 0){throw "$Stem pre-read failed"}
  $ready=Join-Path $evidence "$Stem-ready";$release=Join-Path $evidence "$Stem-release";$after=Join-Path $evidence "$Stem-guarded.json"
  $guardArgs=@('guard-file',$File,$Logical,'protected',$after,$ready,$release)|ForEach-Object {QuoteProcessArg $_}
  $process=Start-Process -FilePath $recorder -ArgumentList $guardArgs -PassThru -NoNewWindow
  $deadline=(Get-Date).AddMinutes(10);while(!(Test-Path -LiteralPath $ready)){if($process.HasExited){throw "$Stem guard failed"};if((Get-Date) -gt $deadline){Stop-Process -Id $process.Id;throw "$Stem guard timeout"};Start-Sleep -Milliseconds 50}
  $guards.Add([pscustomobject]@{Name=$Stem;Process=$process;Release=$release})
}
function StartListGuard([string]$Root,[string]$List,[string]$Stem){
  $before=Join-Path $evidence "$Stem-before.json";& $recorder inventory-list $Root $List protected $before;if($LASTEXITCODE -ne 0){throw "$Stem pre-read failed"}
  $ready=Join-Path $evidence "$Stem-ready";$release=Join-Path $evidence "$Stem-release";$after=Join-Path $evidence "$Stem-guarded.json"
  $guardArgs=@('guard-list',$Root,$List,'protected',$after,$ready,$release)|ForEach-Object {QuoteProcessArg $_}
  $process=Start-Process -FilePath $recorder -ArgumentList $guardArgs -PassThru -NoNewWindow
  $deadline=(Get-Date).AddMinutes(10);while(!(Test-Path -LiteralPath $ready)){if($process.HasExited){throw "$Stem guard failed"};if((Get-Date) -gt $deadline){Stop-Process -Id $process.Id;throw "$Stem guard timeout"};Start-Sleep -Milliseconds 50}
  $guards.Add([pscustomobject]@{Name=$Stem;Process=$process;Release=$release})
}
function Run([string]$Cwd,[string]$Exe,[string[]]$Argv,[string]$LogicalCwd){
  $script:commandIndex++;$receipt=Join-Path $commands ($script:commandIndex.ToString('000')+'.json')
  & powershell.exe -NoLogo -NoProfile -ExecutionPolicy RemoteSigned -File (Join-Path $PSScriptRoot 'invoke-recorded.ps1') -Cwd $Cwd -LogicalCwd $LogicalCwd -Executable $Exe -Argv $Argv -Receipt $receipt
  if($LASTEXITCODE -ne 0){throw 'independent command runner failed'}
}
# Protect the archive, manifest, and trusted controller before extraction or
# execution. No file from the archive is executed until the Git proof below.
StartFileGuard $recorder 'aph-native-recorder.exe' 'recorder'
StartFileGuard $archive 'source-archive.zip' 'archive'
StartFileGuard $manifest 'tracked-manifest.json' 'manifest'
$controllerList=Join-Path $evidence 'controller-inputs.txt'
$controllerPaths=@('Recorder.cs','archive.mjs','contract.mjs','finalize-measured-capsule.mjs','invoke-recorded.ps1','measure-build.ps1','reconcile-build.mjs','reconcile-payload.mjs','validate-mcpb.mjs','verify-source-archive.mjs')|Sort-Object
[IO.File]::WriteAllLines($controllerList,[string[]]$controllerPaths,[Text.UTF8Encoding]::new($false))
StartListGuard $PSScriptRoot $controllerList 'controller'
Run $buildRoot $node @((Join-Path $PSScriptRoot 'verify-source-archive.mjs'),$archive,$manifest,$source,(Join-Path $evidence 'source-validated.json')) 'ROOT'
Copy-Item -LiteralPath $manifest -Destination (Join-Path $evidence 'tracked-manifest.json')
$sourceReceipt=Get-Content -Raw (Join-Path $evidence 'source-validated.json')|ConvertFrom-Json
if($sourceReceipt.commit -cne $ApprovedCommit -or $sourceReceipt.tree -cne $ApprovedTree){throw 'validated archive is not the approved commit/tree'}
if($sourceReceipt.archive_sha256 -cne $ServerArchiveSha256 -or $sourceReceipt.archive_manifest_sha256 -cne $ArchiveManifestSha256){throw 'validated archive receipts differ from approval receipts'}
$trackedList=Join-Path $evidence 'tracked-inputs.txt';$trackedPaths=@($sourceReceipt.files.path)|Sort-Object
[IO.File]::WriteAllLines($trackedList,[string[]]$trackedPaths,[Text.UTF8Encoding]::new($false))
StartListGuard $source $trackedList 'tracked'
Run $source $npm @('ci','--ignore-scripts') 'ROOT'
Run $source $node @('scripts/copy-build-assets.mjs') 'ROOT'
$env:TARGET_TRIPLE='x86_64-pc-windows-msvc';$env:FETCH_PIPER_VOICE='1'
Run $source $bash @('scripts/fetch-piper-sidecar.sh') 'ROOT'
Run $source $bash @('scripts/fetch-llama-sidecar.sh') 'ROOT'
Run $source $bash @('scripts/stage-meeting-voice-sidecars.sh') 'ROOT'
Remove-Item Env:FETCH_PIPER_VOICE;Remove-Item Env:TARGET_TRIPLE
Run (Join-Path $source 'src-tauri') $cargo @('build','--locked','--release','--bin','lantern-mcp') 'ROOT/src-tauri'
$rawMcp=Join-Path $source 'src-tauri\binaries\lantern-mcp-x86_64-pc-windows-msvc.exe'
Copy-Item (Join-Path $source 'src-tauri\target\release\lantern-mcp.exe') $rawMcp
$rawList=Join-Path $evidence 'raw-mcp.txt';[IO.File]::WriteAllText($rawList,"src-tauri/binaries/lantern-mcp-x86_64-pc-windows-msvc.exe`n",[Text.UTF8Encoding]::new($false))
& $recorder inventory-list $source $rawList raw-mcp (Join-Path $evidence 'raw-mcp.json');if($LASTEXITCODE -ne 0){throw 'raw MCP measurement failed'}
New-Item -ItemType Directory -Force (Join-Path $source 'mcpb-dist')|Out-Null
$appVersion=(Get-Content -Raw (Join-Path $source 'package.json')|ConvertFrom-Json).version
Run $source $node @('scripts/build-mcpb.mjs','--binary','src-tauri/binaries/lantern-mcp-x86_64-pc-windows-msvc.exe','--target','x86_64-pc-windows-msvc','--output','mcpb-dist/lantern-windows.mcpb','--version',$appVersion) 'ROOT'
New-Item -ItemType Directory -Force (Join-Path $source 'src-tauri\resources\mcpb')|Out-Null
$companion=Join-Path $source 'mcpb-dist\lantern-windows.mcpb';$embedded=Join-Path $source 'src-tauri\resources\mcpb\lantern-windows.mcpb'
Copy-Item $companion $embedded
Run $source $node @((Join-Path $PSScriptRoot 'validate-mcpb.mjs'),$embedded,$companion,(Join-Path $evidence 'raw-mcp.json'),(Join-Path $evidence 'mcpb-validated.json')) 'ROOT'
Remove-Item -LiteralPath $rawMcp
Remove-Item -LiteralPath (Join-Path $source 'src-tauri\target\release\lantern-mcp.exe')
Run $source $npm @('run','build') 'ROOT'
$mergedRel='src-tauri/tauri.control-day-effective.generated.json';$merged=Join-Path $source ($mergedRel-replace'/','\')
Run $source $node @('scripts/windows-final-build/prepare-config.mjs',$mergedRel) 'ROOT'
$env:TAURI_CONFIG=Get-Content -Raw $merged
Run (Join-Path $source 'src-tauri') $cargo @('build','--locked','--release','--bin','lantern') 'ROOT/src-tauri'
Remove-Item Env:TAURI_CONFIG
$inputList=Join-Path $evidence 'inputs.txt';Run $source $node @('scripts/windows-final-build/write-input-list.mjs',(Join-Path $evidence 'tracked-manifest.json'),$mergedRel,$inputList) 'ROOT'
StartListGuard $source $inputList 'packager'
Run $source $npm @('exec','--','tauri','build','--bundles','nsis','--config',$mergedRel) 'ROOT'
$installer=@(Get-ChildItem (Join-Path $source 'src-tauri\target\release\bundle\nsis') -Filter '*-setup.exe' -File);if($installer.Count -ne 1){throw 'expected exactly one NSIS installer'}
StartFileGuard $installer[0].FullName 'installer/setup.exe' 'installer'
$extract=Join-Path $buildRoot 'installer-payload';if(Test-Path $extract){throw 'payload root already exists'};New-Item -ItemType Directory -Path $extract|Out-Null
Run $source $seven @('x','-y',('-o'+$extract),$installer[0].FullName) 'ROOT'
& $recorder inventory $extract installer-payload (Join-Path $evidence 'payload.json');if($LASTEXITCODE -ne 0){throw 'payload inventory failed'}
$x=(Get-FileHash -LiteralPath (Join-Path $source 'src-tauri\target\release\lantern.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
Run $source $node @((Join-Path $PSScriptRoot 'reconcile-payload.mjs'),$merged,(Join-Path $evidence 'packager-before.json'),(Join-Path $evidence 'payload.json'),$x) 'ROOT'
& powershell.exe -NoLogo -NoProfile -ExecutionPolicy RemoteSigned -File (Join-Path $PSScriptRoot 'measure-build.ps1') -BuildRoot $buildRoot -SevenZipPath $seven -RecorderPath $recorder -CscPath $csc
if($LASTEXITCODE -ne 0){throw 'independent build measurement failed'}
& $node (Join-Path $PSScriptRoot 'reconcile-build.mjs') $buildRoot $BuildId;if($LASTEXITCODE -ne 0){throw 'independent reconciliation failed'}
StartFileGuard (Join-Path $evidence 'capsule-fragment.json') 'capsule-fragment.json' 'fragment'
foreach($guard in $guards){New-Item -ItemType File -Path $guard.Release|Out-Null}
foreach($guard in $guards){if(!$guard.Process.WaitForExit(120000)){Stop-Process -Id $guard.Process.Id;throw "$($guard.Name) guard did not finish"};if($guard.Process.ExitCode -ne 0){throw "$($guard.Name) guard rejected closure"}}
& $node (Join-Path $PSScriptRoot 'finalize-measured-capsule.mjs') $buildRoot;if($LASTEXITCODE -ne 0){throw 'capsule final closure failed'}
Write-Output "Capsule ready: $(Join-Path $buildRoot 'build-capsule.json')"
