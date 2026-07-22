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
$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
foreach($signingName in @('TAURI_SIGNING_PRIVATE_KEY','TAURI_PRIVATE_KEY','AZURE_CLIENT_SECRET')){if(Test-Path "Env:$signingName"){throw "signing environment is forbidden for the control-day unsigned build: $signingName"}}
$FixedParent='C:\APH-Final-Builds'; $BuildRoot=Join-Path $FixedParent $BuildId
if(Test-Path -LiteralPath $BuildRoot){throw 'fixed build root already exists'}
$Evidence=Join-Path $BuildRoot '.aph-provenance'; $Source=Join-Path $BuildRoot 'source'
$Diary=[System.Collections.Generic.List[object]]::new()
function Hash([string]$Path){(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
function Run([string]$Cwd,[string]$Exe,[string[]]$Argv,[string]$LogicalCwd){
  $start=(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ')
  Push-Location $Cwd; try {& $Exe @Argv; $code=$LASTEXITCODE} finally {Pop-Location}
  $end=(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ')
  if($code-ne 0){throw "recorded command failed with exit code $code"}
  $Diary.Add([ordered]@{cwd=$LogicalCwd;argv=@((Split-Path $Exe -Leaf))+$Argv;started_utc=$start;ended_utc=$end;exit_code=0})
}
function Tool([string]$Name,[string]$Exe,[string[]]$VersionArgs){
  $version=((& $Exe @VersionArgs 2>&1|Out-String).Trim()-replace '[^\x20-\x7e]',' ')
  [ordered]@{name=$Name;version=$version;executable_sha256=(Hash $Exe)}
}
$archive=(Resolve-Path -LiteralPath $SourceArchive).Path; $manifest=(Resolve-Path -LiteralPath $TrackedManifest).Path
$received=Hash $archive; if($received-cne $ServerArchiveSha256){throw 'server and Legion archive hashes differ'}
if((Hash $manifest)-cne $ArchiveManifestSha256){throw 'tracked archive manifest hash differs from server receipt'}
$vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if(!(Test-Path -LiteralPath $vswhere)){throw 'Visual Studio locator is missing'}
$vsRoot=(& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.Roslyn.Compiler -property installationPath).Trim()
$csc=Join-Path $vsRoot 'MSBuild\Current\Bin\Roslyn\csc.exe'; if(!(Test-Path -LiteralPath $csc)){throw 'reviewed Roslyn compiler is missing'}
$tempRecorder=Join-Path $env:TEMP ("aph-native-recorder-$BuildId.exe");$tempEmpty=Join-Path $env:TEMP ("aph-empty-$BuildId.json")
if((Test-Path $tempRecorder)-or(Test-Path $tempEmpty)){throw 'fixed recorder bootstrap output already exists'}
$compileStart=(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ')
& $csc /nologo /optimize+ /target:exe ('/out:'+$tempRecorder) (Join-Path $PSScriptRoot 'Recorder.cs');if($LASTEXITCODE-ne 0){throw 'native recorder compilation failed'}
$compileEnd=(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ')
New-Item -ItemType Directory -Path $BuildRoot|Out-Null
& $tempRecorder inventory $BuildRoot initial $tempEmpty;if($LASTEXITCODE-ne 0){throw 'fresh-root inventory failed'}
$emptyObject=Get-Content -Raw $tempEmpty|ConvertFrom-Json; if($emptyObject.rows.Count-ne 0){throw 'new fixed build root was not empty'}
New-Item -ItemType Directory -Path $Evidence|Out-Null;New-Item -ItemType Directory -Path $Source|Out-Null
$recorder=Join-Path $Evidence 'aph-native-recorder.exe';$empty=Join-Path $Evidence 'empty.json';Move-Item $tempRecorder $recorder;Move-Item $tempEmpty $empty
$Diary.Add([ordered]@{cwd='ROOT';argv=@('csc.exe','/nologo','/optimize+','/target:exe','/out:RECORDER','Recorder.cs');started_utc=$compileStart;ended_utc=$compileEnd;exit_code=0})
Run $Source $SevenZipPath @('x','-y',('-o'+$Source),$archive) 'ROOT'
Copy-Item -LiteralPath $manifest -Destination (Join-Path $Evidence 'tracked-manifest.json')
$node=(Get-Command node.exe).Source; $npm=(Get-Command npm.cmd).Source; $bash=(Get-Command bash.exe).Source; $cargo=(Get-Command cargo.exe).Source
Run $Source $npm @('ci','--ignore-scripts') 'ROOT'
Run $Source $node @('scripts/copy-build-assets.mjs') 'ROOT'
$env:TARGET_TRIPLE='x86_64-pc-windows-msvc'; $env:FETCH_PIPER_VOICE='1'
Run $Source $bash @('scripts/fetch-piper-sidecar.sh') 'ROOT'
Run $Source $bash @('scripts/fetch-llama-sidecar.sh') 'ROOT'
Run $Source $bash @('scripts/stage-meeting-voice-sidecars.sh') 'ROOT'
Run (Join-Path $Source 'src-tauri') $cargo @('build','--release','--bin','lantern-mcp') 'ROOT/src-tauri'
$rawMcp=Join-Path $Source 'src-tauri\binaries\lantern-mcp-x86_64-pc-windows-msvc.exe'
Copy-Item (Join-Path $Source 'src-tauri\target\release\lantern-mcp.exe') $rawMcp
New-Item -ItemType Directory -Force (Join-Path $Source 'mcpb-dist')|Out-Null
$appVersion=(Get-Content -Raw (Join-Path $Source 'package.json')|ConvertFrom-Json).version
Run $Source $node @('scripts/build-mcpb.mjs','--binary','src-tauri/binaries/lantern-mcp-x86_64-pc-windows-msvc.exe','--target','x86_64-pc-windows-msvc','--output','mcpb-dist/lantern-windows.mcpb','--version',$appVersion) 'ROOT'
New-Item -ItemType Directory -Force (Join-Path $Source 'src-tauri\resources\mcpb')|Out-Null
Copy-Item (Join-Path $Source 'mcpb-dist\lantern-windows.mcpb') (Join-Path $Source 'src-tauri\resources\mcpb\lantern-windows.mcpb')
Remove-Item -LiteralPath $rawMcp
Run $Source $npm @('run','build') 'ROOT'
$mergedRel='src-tauri/tauri.control-day-effective.generated.json'; $merged=Join-Path $Source ($mergedRel-replace '/', '\')
Run $Source $node @('scripts/windows-final-build/prepare-config.mjs',$mergedRel) 'ROOT'
$env:TAURI_CONFIG=Get-Content -Raw $merged
Run (Join-Path $Source 'src-tauri') $cargo @('build','--release','--bin','lantern') 'ROOT/src-tauri'
$list=Join-Path $Evidence 'inputs.txt'; Run $Source $node @('scripts/windows-final-build/write-input-list.mjs',(Join-Path $Evidence 'tracked-manifest.json'),$mergedRel,$list) 'ROOT'
$before=Join-Path $Evidence 'before.json'; Run $Source $recorder @('inventory-list',$Source,$list,'input',$before) 'ROOT'
$guarded=Join-Path $Evidence 'guarded.json';$ready=Join-Path $Evidence 'guard-ready';$release=Join-Path $Evidence 'guard-release'
$guardStart=(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ')
$guard=Start-Process -FilePath $recorder -ArgumentList @('guard-list',$Source,$list,'input',$guarded,$ready,$release) -PassThru -NoNewWindow
$guardDeadline=(Get-Date).AddMinutes(10);while(!(Test-Path -LiteralPath $ready)){if($guard.HasExited){throw 'native input guard failed before ready'};if((Get-Date)-gt$guardDeadline){Stop-Process -Id $guard.Id;throw 'native input guard did not become ready'};Start-Sleep -Milliseconds 50}
Run $Source $npm @('exec','--','tauri','build','--bundles','nsis','--config',$mergedRel) 'ROOT'
New-Item -ItemType File -Path $release|Out-Null;if(!$guard.WaitForExit(120000)){Stop-Process -Id $guard.Id;throw 'native input guard did not finish'};if($guard.ExitCode-ne 0){throw 'native input guard rejected the packaging window'}
$guardEnd=(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ');$Diary.Add([ordered]@{cwd='ROOT';argv=@('aph-native-recorder.exe','guard-list','ROOT','INPUT-LIST','input','GUARDED','READY','RELEASE');started_utc=$guardStart;ended_utc=$guardEnd;exit_code=0})
$after=Join-Path $Evidence 'after.json'; Run $Source $recorder @('inventory-list',$Source,$list,'input',$after) 'ROOT'
if((Hash $guarded)-cne (Hash $after)){throw 'complete packager input inventory changed during packaging'}
$installer=(Get-ChildItem (Join-Path $Source 'src-tauri\target\release\bundle\nsis') -Filter '*-setup.exe' -File); if($installer.Count-ne 1){throw 'expected exactly one NSIS installer'}
$signature=(Get-AuthenticodeSignature $installer.FullName).Status.ToString(); if($signature-cne 'NotSigned'){throw 'installer is not NotSigned'}
$extract=Join-Path $BuildRoot 'installer-payload'; New-Item -ItemType Directory $extract|Out-Null
Run $Source $SevenZipPath @('x','-y',('-o'+$extract),$installer.FullName) 'ROOT'
$payloadRecord=Join-Path $Evidence 'payload.json'; Run $Source $recorder @('inventory',$extract,'installer-payload',$payloadRecord) 'ROOT'
$payload=Get-Content -Raw $payloadRecord|ConvertFrom-Json; $payloadExe=@($payload.rows|Where-Object {$_.logical_path-eq 'lantern.exe'}); if($payloadExe.Count-ne 1){throw 'extracted payload must contain exactly one lantern.exe'}
$x=Hash (Join-Path $Source 'src-tauri\target\release\lantern.exe'); if($payloadExe[0].sha256-cne $x){throw 'extracted lantern.exe does not equal X'}
Run $Source $node @('scripts/windows-final-build/reconcile-payload.mjs',$mergedRel,$guarded,$payloadRecord,$x) 'ROOT'
$mcpb=Join-Path $Source 'mcpb-dist\lantern-windows.mcpb'; $embedded=Join-Path $Source 'src-tauri\resources\mcpb\lantern-windows.mcpb'; if((Hash $mcpb)-cne(Hash $embedded)){throw 'embedded and companion MCPB differ'}
$git=(Get-Command git.exe).Source;$rustc=(Get-Command rustc.exe).Source;$cmake=(Get-Command cmake.exe).Source;$clang=(Get-Command clang.exe).Source;$protoc=(Get-Command protoc.exe).Source
$tauriExe=Join-Path $Source 'node_modules\@tauri-apps\cli\tauri.exe';if(!(Test-Path $tauriExe)){throw 'pinned Tauri executable missing'}
$nsis=(Get-Command makensis.exe -ErrorAction SilentlyContinue).Source;if(!$nsis){$nsis=(Get-ChildItem (Join-Path $env:LOCALAPPDATA 'tauri') -Filter makensis.exe -File -Recurse|Select-Object -First 1).FullName};if(!$nsis){throw 'NSIS executable missing after package'}
$tools=@((Tool 'git' $git @('--version')),(Tool 'node' $node @('--version')),(Tool 'npm' $npm @('--version')),(Tool 'rustc' $rustc @('--version')),(Tool 'cargo' $cargo @('--version')),(Tool 'tauri' $tauriExe @('--version')),(Tool 'msvc' $csc @('/version')),(Tool 'cmake' $cmake @('--version')),(Tool 'clang' $clang @('--version')),(Tool 'protoc' $protoc @('--version')),(Tool 'nsis' $nsis @('/VERSION')),(Tool 'sevenzip' $SevenZipPath @()),(Tool 'recorder' $recorder @()))
$base=Join-Path $Source 'src-tauri\tauri.conf.json';$override=Join-Path $Source 'src-tauri\tauri.control-day-unsigned.conf.json'
$inputPaths=Get-Content $list; $meta=[ordered]@{
  build_id=$BuildId;commit=$ApprovedCommit;tree=$ApprovedTree;server_archive_sha256=$ServerArchiveSha256;legion_archive_sha256=$received
  fresh_root=[ordered]@{token='C:\APH-Final-Builds\{build_id}';volume_serial=$emptyObject.root_identity.volume_serial;directory_file_id=$emptyObject.root_identity.file_id;creation_event='created-previously-absent';initial_inventory=@()}
  toolchain=$tools;commands=$Diary;gmail_client_id_present=[bool]$env:LANTERN_GMAIL_CLIENT_ID;gmail_client_secret_present=[bool]$env:LANTERN_GMAIL_CLIENT_SECRET
  effective_config=[ordered]@{base_sha256=(Hash $base);unsigned_override_sha256=(Hash $override);merged_sha256=(Hash $merged)}
  packager_inputs=$inputPaths
  installer_observation=[ordered]@{installer_h=(Hash $installer.FullName);installer_bytes=$installer.Length;signature_status=$signature;verified_uncompressed_payload_bytes=[long](($payload.rows|Measure-Object bytes -Sum).Sum);inspection_tool=[ordered]@{name='sevenzip';version=$tools[3].version;executable_sha256=$tools[3].executable_sha256};extracted_payload=$payload.rows;lantern_exe_sha256=$x}
  companions=@([ordered]@{logical_path='mcpb-dist/lantern-windows.mcpb';bytes=(Get-Item $mcpb).Length;sha256=(Hash $mcpb);classification='byte-identical-embedded-companion'})
}
$metaPath=Join-Path $Evidence 'meta.json';[IO.File]::WriteAllText($metaPath,($meta|ConvertTo-Json -Depth 20 -Compress),[Text.UTF8Encoding]::new($false))
$fragment=Join-Path $Evidence 'capsule-fragment.json';Run $Source $node @('scripts/windows-final-build/assemble-capsule.mjs',$metaPath,$guarded,$after,(Join-Path $Evidence 'tracked-manifest.json'),$fragment) 'ROOT'
$capsule=Join-Path $BuildRoot 'build-capsule.json';Run $Source $node @('scripts/windows-final-build/finalize-capsule.mjs',$fragment,$capsule) 'ROOT'
Write-Output "Capsule ready: $capsule"
