# Legion M2/M3 Windows evidence — `51ee5bab`

## Verdict

- **M2: PARTIAL.** The fresh chooser, Hendricks selection, Meetings shell, meeting list, and real seeded row/detail all passed. The privacy/send proof then stopped at the first honest blocker: the **Send to team** drawer remained on **Saving** in local-only mode, and **Review send** did not advance. No message was sent. Reload, normal close/reopen, and persistence were therefore not tested.
- **M3: NOT RUN.** The lane stopped before M3 because M2 did not finish. No CRM or task proposal was approved or written.
- **Package: PARTIAL for unsigned development drive only.** Compile and NSIS packaging produced fresh, hashable artifacts. Release remains **FAIL** because the updater signing key was absent after packaging. No key was invented and no second build was started.

## Exact identity

| Item | Receipt |
| --- | --- |
| Canonical app revision | `51ee5bab5348497ccb6879e0c79e4fd0f10e52bc` |
| Git tree | `3c1fb6af5b3817193a49a857185845aff9246bb4` |
| Source archive | `D:\LanternM2Sources\lantern-51ee5bab.tar` |
| Source archive SHA-256 | `98F97040F7361E699CBD4DA8F064EEB21993018D27221444E0F8C526D11713F2` |
| Fresh source folder | `C:\Lantern-M2-M3-51ee5bab\source` |
| Driven executable | `C:\Lantern-M2-M3-51ee5bab\package\lantern.exe` |
| Executable SHA-256 | `23A723F90D156929C2AF97888464B0ED4DBDFAC7A3455FCD4DFE090C7177774B` |
| Installer | `C:\Lantern-M2-M3-51ee5bab\package\Advisor Prep Hero_3.3.5_x64-setup.exe` |
| Installer SHA-256 | `D53993A7DFAFD3E5570997BC7D5C7699AA70238C6A5A1C4508DA6DF7D9D08D01` |
| Fresh workspace | `C:\Lantern-M2-M3-51ee5bab\workspace\Hendricks` |
| Fresh WebView profile | `C:\Lantern-M2-M3-51ee5bab\profile\WebView2` |
| Fresh roaming profile | `C:\Lantern-M2-M3-51ee5bab\profile\RoamingAppData\com.lantern.app` |

The exact running process was verified as the packaged executable above. The app was launched through the logged-in desktop with the OS-level input helper; it was not launched with an SSH `Start-Process` command.

## One grouped build receipt

- Preflight after closing the prior app: 0 Cargo/Rust compiler processes and 0 Lantern processes; about 20.66 GB RAM available, 16.95 GB free on C, and 688.68 GB free on D.
- Dependencies installed with `npm ci --ignore-scripts`: 18.29 seconds (`01:17:13.9108299Z` to `01:17:32.1987835Z`).
- Piper and llama sidecars were staged by their pinned fetch scripts, and the pinned hashes passed.
- `sccache` 0.16.0 used `D:\Lantern-sccache-cache` with a 25 GiB limit. This was a cold compiler cache: 11 requests, 2 executed, 0 hits, 2 Rust misses, 9 non-cacheable calls, 2 compilations, 2 MiB stored, and 0 cache errors/failures.
- The existing Cargo target `D:\Lantern-M2-Targets\afcdae55-from-073556ba-partial` was reused and preserved.
- The single build marker was written at `2026-07-23T01:23:51.9901265Z`. The fresh installer was written at `01:32:50.127Z` and the fresh executable at `01:32:50.479Z`, about 8 minutes 58.5 seconds later.
- Fresh artifacts: executable 215,606,784 bytes; NSIS installer 172,344,644 bytes. The staged package contains 399 files and 533,134,892 bytes.
- Post-build headroom: 20,620,861,440 RAM bytes available, 15,891,562,496 bytes free on C, and 688,427,474,944 bytes free on D.
- The build launcher first exited before the one-build marker, Cargo process, cache change, log content, or artifact change. That was a launcher correction, not a build invocation. The corrected interactive scheduled task produced the one build recorded above. No second build ran.
- `TAURI_SIGNING_PRIVATE_KEY` was absent from process, user, and machine scope. The native task returned failure after the fresh executable and NSIS installer existed. This is recorded as the known post-package signing failure, not as a successful release.

Build flags were `VITE_FLAG_SELECTION_AUTHORITY_BOOT_GATE=true`, `VITE_FLAG_MEETINGS_SHELL_V1=true`, `VITE_FLAG_SHARED_CLIENT_BAR=true`, and `VITE_FLAG_V1_SHELL_FRAME=true`.

## Driven M2 sequence

1. Fresh onboarding and exact native folder selection: **PASS**.
2. Client chooser selected **The Hendricks Household**: **PASS**.
3. Meetings shell opened and filtered to Hendricks: **PASS**.
4. Real meeting list loaded: **PASS**.
5. Seeded **Hendricks annual review** row detail stayed open: **PASS**.
6. Summary content rendered: **PASS**.
7. Client-visible send review / private-content exclusion proof: **BLOCKED**. The drawer showed recipient item choices but remained on **Saving**. Local-only mode also reported that email sending was off. The review screen never opened, so private-note exclusion was not claimed.
8. Reload and normal close/reopen persistence: **NOT RUN after blocker**.

The real production UI did not expose a separate private-note visibility chooser in this driven path. No fixture or workspace data was changed to manufacture one.

## Next smallest blocker

Find why the recipient selection state in **Send to team** never settles while the app is in local-only mode. It must become either a saved state that can open the review screen, or an explicit blocked/error state. Then rerun the short M2 privacy/reload/reopen check from a fresh profile. Do not begin M3 until that M2 check passes.

See [GALLERY.md](GALLERY.md) for the screenshot sequence and [receipt.json](receipt.json) for the machine-readable receipt.
