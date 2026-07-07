# UI Iteration System

**The point in one line:** change the look of the app fast and safely, over and
over, without re-testing everything by hand each time.

The UI will go through many rounds of change (like the logo and branding did).
Without a system, every round means a slow, full manual re-check. This foundation
makes each round cost **minutes of robot checking**, not a night of manual work —
while refusing to hand out a false "all good."

It has four parts. Each part is a machine check, so future rounds stay honest on
their own.

---

## The four parts

### 1. Permanent handles — `handle-guard.mjs`
Tests and the robot grab on-screen things (buttons, inputs) by a hidden, stable
name called a **handle** (`data-testid`). Handles don't move when the look
changes, so a re-paint never breaks the tests.

- The guard keeps a **baseline list** of every handle in the app
  (`handles.baseline.json`, currently ~1,384 of them).
- If a handle disappears (deleted or renamed) it **fails the build** — unless you
  wrote down that you meant to, in `handles.migrations.json`.
- Adding new handles is always free.

```bash
node scripts/ui-system/handle-guard.mjs                 # check (also in the gate)
node scripts/ui-system/handle-guard.mjs --update-baseline
node scripts/ui-system/handle-guard.mjs --list
```

The **robot** (part 4) adds the deeper checks the review demanded: a handle must
be **unique, visible, enabled, and attached to the real control** — not just a
string that still exists somewhere. It also proves the main screens can scroll
when their content is taller than the window.

### 2. Paint file — `token-guard.mjs`
All colours/spacing/type live in one place: the design tokens in
`src/styles/globals.css` (and `brand/brand.config.json`). A "reskin" should touch
**only** that paint layer.

- The guard freezes today's hard-coded colours as a **baseline**
  (`tokens.baseline.json`) and **fails the build on any NEW hard-coded colour**
  in component code. Old debt is frozen, not grown; you're never asked to fix it
  all by hand.

```bash
node scripts/ui-system/token-guard.mjs                  # check (also in the gate)
node scripts/ui-system/token-guard.mjs --update-baseline
node scripts/ui-system/token-guard.mjs --list
```

### 3. Tiered gates — `classify-tier.mjs` + `gate-tier.mjs`
Match the re-testing to the size of the change. It reads the **actual changed
code**, not just file names (a "paint" CSS edit can secretly break behaviour; a
"UI" file can secretly change logic).

- **Tier P-safe** — token/asset/copy value swaps only. Gate: typecheck + brand
  sync + token guard + handle guard + i18n completeness + a visual smoke.
- **Tier S** — UI markup changed (or behaviour-adjacent CSS like
  `display`/`z-index`/`pointer-events`/`:focus`/`@media`/animation); handles
  preserved. Gate: the P-safe checks + scoped component tests + the full robot.
- **Tier B** — behaviour touched (platform / stores / services / Rust, **or** a
  UI file whose changed lines touch hooks, async, state, event-handler logic,
  storage, provider selection, or Tauri invokes). Gate: the full serial gate +
  real-Windows on the Legion. Not a cheap round.

```bash
node scripts/ui-system/classify-tier.mjs                # classify the current diff
node scripts/ui-system/classify-tier.mjs --base origin/lantern-plus
node scripts/ui-system/gate-tier.mjs P                  # run the matching gate
```

**Rule (from the review): a coordinator may RAISE the tier, never lower it
without a written exception.**

### 4. Robot rehearsal — `rehearsal.mjs`
Walks the **DEMO-V1 six-step path** against the app running **locally in a real
browser** (the `build:web-demo` bundle), gripping handles — never copy or layout.
It gives a green/amber/red verdict **plus a screenshot per step**, in minutes.
It also drops a temporary tall invisible spacer into each main screen and proves
there is a real vertical scroll region that reaches the bottom.

```bash
node scripts/ui-system/rehearsal.mjs                    # build + serve + drive (headless)
REHEARSAL_URL=http://localhost:4173/try/ node scripts/ui-system/rehearsal.mjs   # attach to a running preview
REHEARSAL_HEADED=1 node scripts/ui-system/rehearsal.mjs # watch it
REHEARSAL_VISUAL_ONLY=1 node scripts/ui-system/rehearsal.mjs   # boot + handle integrity + overflow (the P-safe smoke)
```

Artifacts land in `.rehearsal/` (screenshots + `summary.json`).

**Honest scope — machine-local is not the Legion.** Five of the six steps have
actions that only work in the desktop app (on-device Local AI, connector sign-in,
live import progress, Teams recording, transcription). So the local robot:

| Step | Local verdict | Why |
|---|---|---|
| Boot + Client Map | 🟢 real | app mounts, handles resolve, no overflow |
| Main screen scrollability | 🟢 real | Client Map, All Clients, Ask, Workflows, Documents, Email, Settings, Privacy Center, and Meetings list are checked; meeting detail tabs are checked when a saved meeting exists |
| 1 Connect AI | 🟡 reduced | cloud AI pre-set; BYOK present; on-device AI is desktop-only |
| 2 Connect Data | 🟡 reduced | data surfaces reachable; live sign-in is desktop-only |
| 3 Import progress | ⚪ needs bench | no live import exists in a browser |
| 4 Ask (cited) | 🟡 reduced | composer + retrieval + citation chip verified; full answer completion is the live robot's job |
| 5 Record meeting | ⚪ needs bench | Teams capture is native |
| 6 Search transcript | ⚪ needs bench | needs a native transcript first |

The **handle guard (part 1) still protects every step's handles in source**, even
the ones this local run can't drive. The **full live six-step run is the
Legion/desktop robot** (`scripts/robot/`), which is the *slow, live-drift* robot;
this rehearsal is the *fast, deterministic UI* robot. Never let the slow one block
the fast loop.

---

## How the review's requirements are met

The adversarial review (`coordination/reports/uisystem-adversarial-review.md`) is
binding. Status:

- **P0 — paint can hide behaviour risk** → DONE. `classify-tier.mjs` content-scans
  CSS; any behaviour-adjacent property/selector/`@media`/animation escalates
  P-safe → S.
- **P0 — path-based tiering misclassifies feature files** → DONE. The classifier
  scans changed CODE; a UI file that changes hooks/async/state/handlers/invokes is
  Tier B.
- **P0 — handles drift while tests pass** → DONE. The robot's handle-integrity
  check requires unique + visible + enabled + real-control, not string existence.
- **P1 — robot misses visual bugs** → PARTIAL. Cheap geometric checks (no
  horizontal overflow at desktop + narrow width, key controls in-viewport) are
  in. **Deferred:** pixel screenshot-diff against a blessed baseline (needs a
  baseline-blessing workflow) — a good next increment.
- **P1 — 15-minute promise is fragile** → DONE by design. Fast deterministic UI
  robot (this) vs slow live-drift robot (`scripts/robot/`) are separate; the fast
  one has no live dependencies.
- **P1 — copy-only isn't safe** → PARTIAL. The P-safe gate runs i18n completeness
  + a narrow-width overflow smoke. **Deferred:** per-control copy-overflow
  assertions on every connector/button label.
- **P2 — accessibility not enforced** → DEFERRED. Contrast/axe gating on the demo
  screens is a planned next increment (the token guard already prevents ad-hoc
  colours, which is the upstream cause). Flagged here so it isn't mistaken for
  done.

## Standing cadence (from the review)
- After every ~5 cheap UI rounds: one full real-Windows verification on the Legion.
- After every ~20 rounds: refresh the handle baseline, token baseline, and (once
  added) screenshot baselines before more cheap rounds.

## Adding/removing a handle intentionally
1. Add the new handle at the call site (kebab-case, role-based; see
   `ARCHITECTURE.md` → "Permanent handle (`data-testid`) naming").
2. If you REMOVED or RENAMED one, add an entry to `handles.migrations.json`
   (`{ "removed": "...", "replacement": "..."|null, "reason": "...", "date": "..." }`).
3. Run `node scripts/ui-system/handle-guard.mjs --update-baseline`.
