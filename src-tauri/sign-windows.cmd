@echo off
REM Tauri signCommand wrapper for Azure Artifact Signing on Windows.
REM
REM Tauri invokes this script with the path to a built .exe or .msi as %1.
REM We invoke AzureSignTool with credentials from env vars (set by the
REM GitHub Actions workflow).
REM
REM The cmd file is used (rather than putting AzureSignTool directly in
REM tauri.conf.json's signCommand) because Tauri runs signCommand via
REM std::process::Command without shell expansion, so %VAR% references
REM in tauri.conf.json don't get substituted.
REM
REM This script runs INSIDE cmd.exe, where %VAR% expansion works.

AzureSignTool sign ^
  -kvu %AZURE_TRUSTED_SIGNING_ENDPOINT% ^
  -kvc %AZURE_TRUSTED_SIGNING_CERT_PROFILE% ^
  -kvi %AZURE_CLIENT_ID% ^
  -kvs %AZURE_CLIENT_SECRET% ^
  -kvt %AZURE_TENANT_ID% ^
  -tr http://timestamp.acs.microsoft.com ^
  -td sha256 ^
  -fd sha256 ^
  -du https://projelli.com ^
  %1
