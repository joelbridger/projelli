- Runtime libraries are copied beside the helper program, because native loaders look next to the executable first.

Diarization already has the scripts:

- `npm run fetch-diarize-models` calls [scripts/fetch-diarize-models.sh](/home/jameson/lantern-plus/scripts/fetch-diarize-models.sh:1), downloading:
  - `segmentation.onnx` from the pyannote archive, about 6.6 MB compressed.
  - `embedding.onnx`, about 38.4 MB.
- `npm run build-diarize-sidecar` calls [scripts/build-diarize-sidecar.sh](/home/jameson/lantern-plus/scripts/build-diarize-sidecar.sh:1), building `lantern-diarize` and copying Sherpa/ONNX runtime libraries beside it.
- The script explicitly says this is **not** an `externalBin`; it relies on the existing `binaries/**/*` and `resources/**/*` resource globs in [tauri.conf.json](/home/jameson/lantern-plus/src-tauri/tauri.conf.json:78).

**3. Described Diff**
No functional `tauri.conf.json` change is needed. Do **not** add `lantern-diarize` to `externalBin` unless the script is also changed to produce target-triple names. Current resource globs already cover it.

Recommended `release.yml` change:

```diff
# Mac/Linux: in "Fetch local sidecars (Mac/Linux)", after Piper + llama
  FETCH_PIPER_VOICE=1 TARGET_TRIPLE="$TARGET" bash scripts/fetch-piper-sidecar.sh
  TARGET_TRIPLE="$TARGET" bash scripts/fetch-llama-sidecar.sh
+ bash scripts/fetch-diarize-models.sh
+ TARGET_TRIPLE="$TARGET" bash scripts/build-diarize-sidecar.sh
+ test -s src-tauri/binaries/lantern-diarize
+ test -s src-tauri/resources/diarize/segmentation.onnx
+ test -s src-tauri/resources/diarize/embedding.onnx
  ls -la src-tauri/binaries/
```

```diff
# Windows: in "Fetch local sidecars (Windows)", after Piper + llama
  FETCH_PIPER_VOICE=1 TARGET_TRIPLE=x86_64-pc-windows-msvc bash scripts/fetch-piper-sidecar.sh
  TARGET_TRIPLE=x86_64-pc-windows-msvc bash scripts/fetch-llama-sidecar.sh
+ bash scripts/fetch-diarize-models.sh
+ OS=Windows_NT TARGET_TRIPLE=x86_64-pc-windows-msvc bash scripts/build-diarize-sidecar.sh
+ test -s src-tauri/binaries/lantern-diarize.exe
+ test -s src-tauri/resources/diarize/segmentation.onnx
+ test -s src-tauri/resources/diarize/embedding.onnx
  ls -la src-tauri/binaries/
```

Also recommended hardening:

```diff
# Linux deps
- protobuf-compiler ... libasound2-dev
+ protobuf-compiler ... libasound2-dev clang libclang-dev

# Windows deps
- choco install protoc -y --no-progress
+ choco install protoc llvm -y --no-progress
+ echo "LIBCLANG_PATH=C:\Program Files\LLVM\bin" >> $env:GITHUB_ENV
```

Reason: `sherpa-rs-sys` uses `bindgen`, which often needs `libclang`.

**4. Risks, Ranked**
1. **High: Windows DLLs beside the EXE.**  
   If `sherpa-onnx-c-api.dll` or `onnxruntime.dll` is missing from `binaries/`, `lantern-diarize.exe` will launch and immediately fail. Add explicit checks after staging. Consider signing staged `src-tauri/binaries/*.exe` and `*.dll` before Tauri packages them, because signing only the installer does not sign the files inside it.

2. **High: macOS notarization.**  
   Apple rejects apps with unsigned native code inside. The existing macOS signing step signs every Mach-O file in `src-tauri/binaries` before bundling, so diarization is covered **if** it is built before [that step](/home/jameson/lantern-plus/.github/workflows/release.yml:293). Keep it that way.

3. **Medium-high: CI toolchain for Sherpa.**  
   The sidecar is a separate Rust crate and may need LLVM/libclang. Add Linux/Windows install steps above to avoid flaky build failures.

4. **Medium: model download size/reliability.**  
   Download-at-build is the right approach. Do not use Git LFS here. The files are ignored in [src-tauri/.gitignore](/home/jameson/lantern-plus/src-tauri/.gitignore:16), and the script verifies SHA256 checksums.

5. **Medium: macOS Intel cross-build.**  
   The script supports `TARGET_TRIPLE`, so the Intel build should stage an x86_64 `lantern-diarize`. Verify with `file src-tauri/binaries/lantern-diarize` inside the x86 job.

**5. Verification Without Real Release**
Use a build-only branch/job or local builds; do not push a release tag.

Minimum checks:

```bash
bash scripts/fetch-diarize-models.sh
TARGET_TRIPLE=x86_64-unknown-linux-gnu bash scripts/build-diarize-sidecar.sh
find src-tauri/binaries src-tauri/resources/diarize -maxdepth 2 -type f
```

Then build a local bundle and inspect it:

- Linux: `npm run tauri build`, then `dpkg-deb -c src-tauri/target/release/bundle/deb/*.deb | grep -E 'lantern-diarize|diarize|sherpa|onnxruntime'`
- macOS: build `.app`, then inspect `Contents/Resources/binaries` and `Contents/Resources/resources/diarize`; run `codesign --verify --deep --strict`.
- Windows: build NSIS, extract/list with `7z l *setup.exe | findstr /i "lantern-diarize diarize sherpa onnxruntime"` or install silently into a temp folder and inspect `resources`.

Final smoke test before trusting it: run the staged `lantern-diarize` against a tiny 16 kHz mono WAV using the two staged model paths. That proves the helper can actually load its native libraries and model files.
tokens used
215,939
**Finding**
The release workflow already has the right general pattern: stage helper programs before Tauri builds the installer. But it only stages Piper and llama today. The new `lantern-diarize` helper and its two model files are generated by scripts, but `.github/workflows/release.yml` never calls those scripts, so released installers will not have speaker separation.

I stayed read-only. No files were changed.

**1. Files That Must Ship**
For every platform, the installer must contain:

| Platform | Must be in installed app resources |
|---|---|
| Windows x64 | `binaries/lantern-diarize.exe`, `binaries/sherpa-onnx-c-api.dll`, `binaries/onnxruntime.dll` or any matching `*onnxruntime*.dll`, plus `resources/diarize/segmentation.onnx`, `resources/diarize/embedding.onnx` |
| macOS Apple Silicon | `binaries/lantern-diarize`, `binaries/libsherpa-onnx-c-api.dylib`, `binaries/libonnxruntime.dylib`, plus both `.onnx` models |
| macOS Intel | same as macOS Apple Silicon, but built with `TARGET_TRIPLE=x86_64-apple-darwin` |
| Linux x64 | `binaries/lantern-diarize`, `binaries/libsherpa-onnx-c-api.so`, `binaries/libonnxruntime.so`, plus both `.onnx` models |

The app looks for exactly this layout in [diarize/mod.rs](/home/jameson/lantern-plus/src-tauri/src/commands/diarize/mod.rs:239): `resource_dir/binaries/lantern-diarize` and `resource_dir/resources/diarize/{segmentation.onnx,embedding.onnx}`.

**2. Existing Pattern To Copy**
Current bundled sidecars:

- Piper and llama are staged in [release.yml](/home/jameson/lantern-plus/.github/workflows/release.yml:219) before Tauri builds.
- They are listed as `externalBin` in [tauri.conf.json](/home/jameson/lantern-plus/src-tauri/tauri.conf.json:83), so Tauri checks that their platform-specific files exist.
- Runtime libraries are copied beside the helper program, because native loaders look next to the executable first.

Diarization already has the scripts:

- `npm run fetch-diarize-models` calls [scripts/fetch-diarize-models.sh](/home/jameson/lantern-plus/scripts/fetch-diarize-models.sh:1), downloading:
  - `segmentation.onnx` from the pyannote archive, about 6.6 MB compressed.
  - `embedding.onnx`, about 38.4 MB.
- `npm run build-diarize-sidecar` calls [scripts/build-diarize-sidecar.sh](/home/jameson/lantern-plus/scripts/build-diarize-sidecar.sh:1), building `lantern-diarize` and copying Sherpa/ONNX runtime libraries beside it.
- The script explicitly says this is **not** an `externalBin`; it relies on the existing `binaries/**/*` and `resources/**/*` resource globs in [tauri.conf.json](/home/jameson/lantern-plus/src-tauri/tauri.conf.json:78).

**3. Described Diff**
No functional `tauri.conf.json` change is needed. Do **not** add `lantern-diarize` to `externalBin` unless the script is also changed to produce target-triple names. Current resource globs already cover it.

Recommended `release.yml` change:

```diff
# Mac/Linux: in "Fetch local sidecars (Mac/Linux)", after Piper + llama
  FETCH_PIPER_VOICE=1 TARGET_TRIPLE="$TARGET" bash scripts/fetch-piper-sidecar.sh
  TARGET_TRIPLE="$TARGET" bash scripts/fetch-llama-sidecar.sh
+ bash scripts/fetch-diarize-models.sh
+ TARGET_TRIPLE="$TARGET" bash scripts/build-diarize-sidecar.sh
+ test -s src-tauri/binaries/lantern-diarize
+ test -s src-tauri/resources/diarize/segmentation.onnx
+ test -s src-tauri/resources/diarize/embedding.onnx
  ls -la src-tauri/binaries/
```

```diff
# Windows: in "Fetch local sidecars (Windows)", after Piper + llama
  FETCH_PIPER_VOICE=1 TARGET_TRIPLE=x86_64-pc-windows-msvc bash scripts/fetch-piper-sidecar.sh
  TARGET_TRIPLE=x86_64-pc-windows-msvc bash scripts/fetch-llama-sidecar.sh
+ bash scripts/fetch-diarize-models.sh
+ OS=Windows_NT TARGET_TRIPLE=x86_64-pc-windows-msvc bash scripts/build-diarize-sidecar.sh
+ test -s src-tauri/binaries/lantern-diarize.exe
+ test -s src-tauri/resources/diarize/segmentation.onnx
+ test -s src-tauri/resources/diarize/embedding.onnx
  ls -la src-tauri/binaries/
```

Also recommended hardening:

```diff
# Linux deps
- protobuf-compiler ... libasound2-dev
+ protobuf-compiler ... libasound2-dev clang libclang-dev

# Windows deps
- choco install protoc -y --no-progress
+ choco install protoc llvm -y --no-progress
+ echo "LIBCLANG_PATH=C:\Program Files\LLVM\bin" >> $env:GITHUB_ENV
```

Reason: `sherpa-rs-sys` uses `bindgen`, which often needs `libclang`.

**4. Risks, Ranked**
1. **High: Windows DLLs beside the EXE.**  
   If `sherpa-onnx-c-api.dll` or `onnxruntime.dll` is missing from `binaries/`, `lantern-diarize.exe` will launch and immediately fail. Add explicit checks after staging. Consider signing staged `src-tauri/binaries/*.exe` and `*.dll` before Tauri packages them, because signing only the installer does not sign the files inside it.

2. **High: macOS notarization.**  
   Apple rejects apps with unsigned native code inside. The existing macOS signing step signs every Mach-O file in `src-tauri/binaries` before bundling, so diarization is covered **if** it is built before [that step](/home/jameson/lantern-plus/.github/workflows/release.yml:293). Keep it that way.

3. **Medium-high: CI toolchain for Sherpa.**  
   The sidecar is a separate Rust crate and may need LLVM/libclang. Add Linux/Windows install steps above to avoid flaky build failures.

4. **Medium: model download size/reliability.**  
   Download-at-build is the right approach. Do not use Git LFS here. The files are ignored in [src-tauri/.gitignore](/home/jameson/lantern-plus/src-tauri/.gitignore:16), and the script verifies SHA256 checksums.

5. **Medium: macOS Intel cross-build.**  
   The script supports `TARGET_TRIPLE`, so the Intel build should stage an x86_64 `lantern-diarize`. Verify with `file src-tauri/binaries/lantern-diarize` inside the x86 job.

**5. Verification Without Real Release**
Use a build-only branch/job or local builds; do not push a release tag.

Minimum checks:

```bash
bash scripts/fetch-diarize-models.sh
TARGET_TRIPLE=x86_64-unknown-linux-gnu bash scripts/build-diarize-sidecar.sh
find src-tauri/binaries src-tauri/resources/diarize -maxdepth 2 -type f
```

Then build a local bundle and inspect it:

- Linux: `npm run tauri build`, then `dpkg-deb -c src-tauri/target/release/bundle/deb/*.deb | grep -E 'lantern-diarize|diarize|sherpa|onnxruntime'`
- macOS: build `.app`, then inspect `Contents/Resources/binaries` and `Contents/Resources/resources/diarize`; run `codesign --verify --deep --strict`.
- Windows: build NSIS, extract/list with `7z l *setup.exe | findstr /i "lantern-diarize diarize sherpa onnxruntime"` or install silently into a temp folder and inspect `resources`.

Final smoke test before trusting it: run the staged `lantern-diarize` against a tiny 16 kHz mono WAV using the two staged model paths. That proves the helper can actually load its native libraries and model files.
(saved from codex read-only investigation 2026-07-04)
