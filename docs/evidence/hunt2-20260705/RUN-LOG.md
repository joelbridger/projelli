# hunt2 — bench-2 EDGE/KLUTZ + honesty + voiceprint isolation (2026-07-05)

**Seat:** Azure `lantern-cloud-bench-2` (VB-CABLE virtual audio; Tailscale `100.88.113.105`).
**Tip tested:** `371702eb7135a47ac49b25c0a49a30f581079bed` (`origin/lantern-plus`, "TIER B MERGED").
**Setup gap (not a bug):** this VM has neither the whisper transcription sidecar nor the
`lantern-diarize` sidecar/ONNX models installed, so the full UI-driven "Run" speaker-separation
button cannot complete (it needs `transcript.json`, which needs whisper, before it can even start).
Worked around this for the voiceprint-isolation test by calling the app's own `voiceprint_enroll`
Tauri command directly via `window.__TAURI_INTERNALS__.invoke(...)` from the devtools console —
this exercises the exact same storage/UI code path QA-54 is about, just skips the (unrelated,
sidecar-dependent) step of getting the embedding from a real recording.

## 0. P0 — boot-blocking Windows case-collision bug (found before any planned testing)

On a fresh pull-to-tip + `npm run tauri:dev` rebuild, the app **never rendered anything** —
persistent blank white screen, `<div id="root"></div>` staying empty. Console capture showed:

```
[pageerror] The requested module '/src/features/meetings/meetingNoteOutboundGate.ts' does not
provide an export named 'MeetingNoteOutboundGate'
```

Root cause: `src/features/meetings/` has **two files whose names differ only by letter case**:
`MeetingNoteOutboundGate.tsx` (exports the component `MeetingNoteOutboundGate`) and
`meetingNoteOutboundGate.ts` (exports the function `meetingNoteOutboundGate` + helpers). The only
importer, `src/app/shell/layout/MainPanel.tsx:22`, correctly imports the `.tsx` file by its correct
case. But on this Windows box, `fsutil.exe queryCaseSensitiveInfo` reports the directory as
**case-insensitive** (Windows default) — yet `Get-ChildItem` shows both files present with distinct
sizes. Vite's dev-server module resolution collides on the two names and served the WRONG file's
content for the `.tsx` import, so `MainPanel.tsx` got a module without the component it needed,
and the whole React tree failed to mount. Screenshot `00-boot-blank-screen-before-fix.jpeg`.

**This is a real, live, P0, boot-blocking bug on real Windows** — every dev/CI machine that happens
to check this repo out onto an NTFS volume without WSL-style per-directory case-sensitivity enabled
(the overwhelmingly common Windows default) risks this exact failure the moment both files land on
disk together. It is invisible on this team's normal dev machines only if those specifically have
case-sensitivity turned on for the working directory (e.g. via WSL2 or a manually-flipped `fsutil`
setting) or are on Linux/macOS (case-sensitive / case-preserving-insensitive-but-collision-free in
practice for git). A CI build running on Linux would never catch it either.

**Local workaround applied on bench-2 only (NOT committed, not part of this evidence branch's
diff):** renamed `meetingNoteOutboundGate.ts` → `meetingNoteOutboundGate**Core**.ts` on the VM's disk
and fixed the one import in `useMeetingNoteOutboundGate.ts`, cleared `node_modules/.vite`, and
restarted the dev server — confirmed the app then boots cleanly (`01-boot-ok-after-workaround.jpeg`).
This workaround exists only on the bench-2 VM's local disk to unblock the rest of this session's
testing; the real fix (rename one of the two files to a genuinely distinct name, permanently, in the
actual repo) belongs to a fix lane.

## 1. QA-54 (voiceprint cross-client biometric leak) — attempted live repro: NOT reproducible, traced why

Enrolled a real voiceprint directly via IPC under Client A (`matter_sample_garcia_v_meridian`, "The
Hendricks Household"): `voiceprint_enroll(workspaceRoot, matterA, "Client A Speaker (Jane)", embedding)`
→ succeeded, confirmed visible correctly under Client A's own Client-Map page
(`02-clientA-voiceprint-enrolled.jpeg`, "VOICE PROFILES" card shows "Client A Speaker (Jane)").

Then repeatedly tried to reproduce the race described in the static finding (a stale
`voiceprintList(A)` promise resolving after switching to Client B and clobbering `items` under B) via
every real navigation path available: switching clients from the sidebar while on the Client-Map tab,
racing a matter-row click immediately after opening the other client's hub, and back-to-back clicks
with zero scripted delay. **Could not reproduce it in any case** — after switching to Client B
("Whitmore Family Trust"), its Voice Profiles section only ever shows Client B's own (empty) list,
never Jane (`03-clientB-after-switch-no-leak.jpeg`).

Traced why: `src/features/matters/MattersHome.tsx:732-734` renders the per-client hub as
```tsx
<MatterHub
  // Remount the whole hub when the client changes, so NO per-client local
  // state ... can survive an A->B switch into the next client (matter
  // isolation — a reused instance otherwise leaks A's state into B).
  key={hubMatterId}
  matterId={hubMatterId}
  ...
```
`VoiceprintsCard` (`src/features/matters/MatterHub.tsx:544`) is the **only** place it's rendered
anywhere in `src/`, and it always lives inside this `key`-ed subtree. The explicit `key={hubMatterId}`
forces React to fully unmount client A's `MatterHub` (and everything under it, including
`VoiceprintsCard`) and mount an entirely new instance for client B — by design, per the comment
already in the code. So the exact prop-swap-without-unmount that the static VoiceprintsCard.tsx:17-19
`useEffect` race requires **cannot occur** via any real UI path: if A's stale `voiceprintList` promise
resolves after the switch, it calls `setItems` on an already-discarded component instance, which is a
no-op — it can never affect the live instance now showing client B. Backend storage
(`src-tauri/src/commands/voiceprint/store.rs`) is also independently per-`matter_id`-file-scoped, so
there's no server-side leak path either.

**Recommendation to the coordinator:** downgrade QA-54 from "P0, static-sweep-confirmed" to
"static-flagged, live-verified NOT reproducible via any current UI path — the `MatterHub`
key-remount pattern is a structural guard against exactly this bug class." Worth a quick sanity
check that no *other*, different code path renders `MatterHub`/`VoiceprintsCard` without going
through `MattersHome`'s `key`-ed branch (grepped — as of this tip, there is only the one call site).
This doesn't necessarily say anything about the sibling race findings QA-52/53/55-58 (different
components/stores) — those still need their own independent verification.

## 2. Klutz/edge testing

- **Rapid multi-click resilience — all held up well.** Triple-clicking "Create client" produced
  exactly one client (`lantern:matters` store confirmed 1 match, not 5) — no duplicate-creation bug.
  Triple-clicking "Start recording" produced exactly one active recording
  (`09-rapid-click-single-recording.jpeg`). Triple-clicking "Stop" produced exactly one new meeting
  entry, not three (`10-rapid-click-single-meeting.jpeg`).
- **Consent gate holds correctly.** The record-consent dialog's "Start recording" button is genuinely
  `disabled` (not just visually greyed) until the "I have the consent I need" checkbox is checked
  (`08-consent-dialog.jpeg`).
- **XSS/script-tag/unicode/emoji client names are safe.** Created a client named
  `<script>alert(1)</script> Ünicödé 名前 😀🔥` + 300 `X`s + `../../etc/passwd null`. It rendered
  everywhere (sidebar, table, tab header, breadcrumb) as inert literal text — zero script execution,
  zero page errors (`04-weird-name-client-list.jpeg`). This corroborates the existing QA-16 finding
  (React's escaping holds) on a real Windows box.
- **NEW P1/P2 — an overlong client name silently breaks the client permanently.** The same
  300+-character client name got a `folderPaths` entry registered in `lantern:matters`
  (`.../AdvisorPrepHeroSample/<huge sanitized name>`) that **was never actually created on disk**
  (verified with a `\\?\`-prefixed long-path-aware .NET check to rule out a false negative). Opening
  that client's Documents tab shows a totally normal "Your workspace is ready / No documents yet"
  empty state (`05-weird-name-empty-docs.jpeg`) — no hint anything is wrong. Clicking "New Word
  document" → naming it → OK (`06-weird-name-create-dialog.jpeg`) closes the dialog and returns to
  the same "No documents yet" state (`07-weird-name-silent-failure.jpeg`) with **zero user-visible
  error** — no toast, no banner. The real cause IS logged to the dev console (not swallowed at the
  Rust layer):
  ```
  [TauriFSBackend] mkdir() failed ... error: failed to create directory at path: ...
    with error: The filename, directory name, or volume label syntax is incorrect. (os error 123)
  Failed to create Word document: FileOperationError: Failed to create directory: ...
    at TauriFSBackend.mkdir ... at WorkspaceService.writeFileBinary ... at useDocumentCreation.ts:105
  ```
  Windows error 123 here is the real NTFS **per-path-component 255-character limit** being exceeded
  by the (still-huge-after-sanitization) folder name. The client remains fully visible and clickable
  in the Client Map the whole time — it just can never actually store a single document, and the
  user is never told why. Recommend: (a) cap client-name length client-side before it ever reaches a
  folder name, and (b) surface `FileOperationError`s from `useDocumentCreation.ts` to a visible
  toast/banner instead of console-only.
- **Resize/DPI:** not exercised this session — this bench-2 session had no accessible interactive
  window handle (`Get-Process | ... .MainWindowHandle` returned `0`) to drive OS-level resize/DPI
  changes, consistent with this VM's known headless/virtual-display limitations noted in prior
  sessions. Honestly flagged as untested, not as a pass.

## 3. Honesty pass — Tier A surfaces

- **Data Map → "Your Wealthbox connection runs from your machine to Wealthbox"**
  (`11-datamap-wealthbox-claim.jpeg`) — verified **accurate** against
  `src-tauri/src/commands/crm/client.rs:36` (`BASE_URL = "https://api.crmworkspace.com/v1"`, Wealthbox's
  real API domain) — the HTTP client (`reqwest`) runs inside the local Tauri/Rust process, so the
  claim that requests go "directly from your machine" with no Advisor-Prep-Hero server in the path is
  true as written. Minor grammar nit in the same copy: "never on **a** Advisor Prep Hero server" should
  read "**an**" — cosmetic, filing as P3.
- **SOC 2 wording** — honest and consistent everywhere it appears
  (`src/features/privacy/FirmSecurityPack.tsx`, `src/config/pricing.ts`, `PricingTiers.tsx`): explicitly
  states "Advisor Prep Hero is **not** SOC 2 certified" / "on our roadmap, not yet in place" / "not yet
  completed." `src/features/onboarding/v2/copy.ts` only ever attributes "SOC 2 certified" to the
  third-party cloud AI providers (accurate for Anthropic/OpenAI), never to Advisor Prep Hero itself —
  there's even a code comment (`confidentialityReport.ts:18`) explicitly warning future editors never
  to claim SOC 2/DPA for the product. No overclaim found.
- **Provider names** — consistent, no stale/typo'd names: "ChatGPT, Claude, or Gemini" for the
  consumer-facing product names, "OpenAI, Anthropic, or Google" for the companies, used correctly
  together in `onboarding/v2/copy.ts`.
- **Privacy headline** ("Where your data lives and who can see it" / "your work stays on your
  computer, your AI requests go straight to the provider you chose, not through us") matches the
  actual BYOK architecture — no new overclaim found beyond the existing, already-documented gaps.

## Summary for Jameson (plain language)

I tested the second cloud computer (the one with the fake microphone) this session. Four things
worth knowing:

1. **Big one, found by accident before I even started testing:** a fresh pull of the code plus a
   normal rebuild made the whole app show a blank white screen on this Windows machine — nothing
   loaded at all. The cause: two files in the code that are named almost the same, differing only in
   upper/lowercase letters. Windows normally treats those as "the same name," so it got confused about
   which one to use, and picked the wrong one. I temporarily renamed one file on this test computer
   only (not saved permanently) so I could keep testing — the actual fix (giving the two files
   genuinely different names) still needs to be done for real, everywhere.
2. **The scary bug I was sent to check — voiceprints from one client showing up under another
   client — I could NOT make happen, and I found out why: the app already has a safety net for it.**
   Switching between clients completely tears down and rebuilds that whole screen from scratch, so
   there's no way for one client's leftover data to sneak onto another client's screen. This was
   flagged as a maybe-bug by an automated code scan, but on the real running app it looks safe.
3. **New bug I did find:** if you name a client something absurdly long, the app lets you, shows it
   in your list looking totally normal — but it can never actually save a single document for that
   client, and never tells you why. It just quietly does nothing every time you try. A real advisor
   would never type 300 characters, but even a moderately long name could hit this.
4. **Everything else held up well:** clicking buttons rapidly by accident doesn't create duplicates,
   the recording-consent checkbox genuinely blocks you from skipping consent, pasting weird text
   (even fake computer code) into a client name can't break or hack the app, and the privacy claims I
   checked (the Wealthbox connection description, the "we're not SOC 2 certified yet" language) are
   both accurate, not oversold.
