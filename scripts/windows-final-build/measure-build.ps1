[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$BuildRoot,
  [Parameter(Mandatory=$true)][string]$SevenZipPath,
  [Parameter(Mandatory=$true)][string]$RecorderPath,
  [Parameter(Mandatory=$true)][string]$CscPath
)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$evidence=Join-Path $BuildRoot '.aph-provenance';$source=Join-Path $BuildRoot 'source'
$out=Join-Path $evidence 'observed.json';if(Test-Path -LiteralPath $out){throw 'measurement receipt already exists'}
if((Split-Path $SevenZipPath -Leaf) -notmatch '^(7z|7za)\.exe$'){throw 'Seven Zip executable name is invalid'}
function Hash([string]$Path){(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
function Tool([string]$Name,[string]$Exe,[string[]]$VersionArgs){
  if(!(Test-Path -LiteralPath $Exe -PathType Leaf)){throw "tool missing: $Name"}
  $version=((& $Exe @VersionArgs 2>&1|Out-String).Trim()-replace '[^\x20-\x7e]',' ')
  [ordered]@{name=$Name;version=$version;executable_sha256=(Hash $Exe)}
}
$node=(Get-Command node.exe).Source;$npm=(Get-Command npm.cmd).Source;$git=(Get-Command git.exe).Source
$rustc=(Get-Command rustc.exe).Source;$cargo=(Get-Command cargo.exe).Source;$cmake=(Get-Command cmake.exe).Source
$clang=(Get-Command clang.exe).Source;$protoc=(Get-Command protoc.exe).Source
$tauri=Join-Path $source 'node_modules\@tauri-apps\cli\tauri.exe'
$nsis=(Get-Command makensis.exe -ErrorAction SilentlyContinue).Source
if(!$nsis){$nsis=(Get-ChildItem (Join-Path $env:LOCALAPPDATA 'tauri') -Filter makensis.exe -File -Recurse|Select-Object -First 1).FullName}
if(!$nsis){throw 'NSIS executable missing after package'}
$tools=@(
  (Tool 'git' $git @('--version')),(Tool 'node' $node @('--version')),(Tool 'npm' $npm @('--version')),
  (Tool 'rustc' $rustc @('--version')),(Tool 'cargo' $cargo @('--version')),(Tool 'tauri' $tauri @('--version')),
  (Tool 'msvc' $CscPath @('/version')),(Tool 'cmake' $cmake @('--version')),(Tool 'clang' $clang @('--version')),
  (Tool 'protoc' $protoc @('--version')),(Tool 'nsis' $nsis @('/VERSION')),(Tool 'sevenzip' $SevenZipPath @('i')),
  (Tool 'recorder' $RecorderPath @('--version'))
)
if(($tools|Where-Object {$_.name -eq 'sevenzip'}).version -notmatch '7-Zip'){throw 'Seven Zip version output is invalid'}
$installer=@(Get-ChildItem (Join-Path $source 'src-tauri\target\release\bundle\nsis') -Filter '*-setup.exe' -File)
if($installer.Count -ne 1){throw 'expected exactly one NSIS installer'}
$signature=(Get-AuthenticodeSignature -LiteralPath $installer[0].FullName).Status.ToString()
if($signature -cne 'NotSigned'){throw 'installer is not NotSigned'}
$record=[ordered]@{
  schema=1;toolchain=$tools;signature_status=$signature
  gmail_client_id_present=[bool]$env:LANTERN_GMAIL_CLIENT_ID
  gmail_client_secret_present=[bool]$env:LANTERN_GMAIL_CLIENT_SECRET
}
[IO.File]::WriteAllText($out,($record|ConvertTo-Json -Depth 8 -Compress),[Text.UTF8Encoding]::new($false))
