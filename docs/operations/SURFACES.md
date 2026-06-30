# Advisor Prep Hero surfaces — "one app, web demo = it, video last" (organizing principle)

There is ONE product codebase (`src/` React + `src-tauri/` Rust). Everything users or prospects see is a build/view of that one codebase. Keep this straight so work never diverges again.

## The surfaces
| Surface | What it is | How it's built | Source |
|---|---|---|---|
| **Desktop app** (Windows/Mac/Linux) | the installed product | `npm run tauri:build` | `src/` (+ `src-tauri/`) |
| **Web demo** (keepance.com/try) | the SAME app, browser build, in "demo mode" (seeded sample data + a demo AI proxy) so a prospect can click around without installing | `npm run build:web-demo` (`vite.config.web-demo.ts`, entry `src/web-demo/main.tsx`) | `src/` |
| **Demo video** (.mp4) | a recorded screen-capture walkthrough — a MARKETING ARTIFACT, not the live app | `npm run demo:video` (`marketing-demo/`) | downstream recording |

## The rule
1. **`src/` is the single source of truth.** ALL design + feature changes go there → they flow to BOTH the desktop app and the web demo automatically. Never build a feature "just for the demo" as a separate thing.
2. **The web demo IS "the demo"** advisors try — the real app in demo mode. Make it real end-to-end; **no fake / "prop" screens.**
3. **The demo VIDEO is generated LAST**, recorded from the polished web demo. Don't maintain it in parallel — re-cut it from the app when the app is ready.
4. Flow: **build the app → web demo + desktop inherit it → record the video at the end.**

*Established 2026-06-29 by Jameson, after a video/real-app divergence (the video had stitched-in "prop" screens that didn't match the real app — that's the failure mode to avoid).*
