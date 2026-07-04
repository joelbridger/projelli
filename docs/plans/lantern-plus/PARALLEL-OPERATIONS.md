# Parallel Operations — running Lantern (main line) and Lantern-Plus side by side

*2026-07-02, Fable. The binding rules for operating two coordinator fleets on one
product without collision. Canonical copy lives here; a pointer lives in
`~/keepance-coordination/PARALLEL-EFFORTS.md` (the shared bulletin both
coordinators read/write).*

## The two efforts

| | **MAIN LINE ("Lantern standalone")** | **LANTERN-PLUS (this program)** |
|---|---|---|
| Coordinator | Existing Fable coordinator in tmux (currently: final Windows bench test) | New Opus 4.8 coordinator in tmux (start: NEXT-SESSION-BOOTSTRAP.md) |
| Folder | `~/keepance` + `kp-*` worktrees | `~/lantern-plus` (+ `~/lp-*` worktrees if needed, created from THIS clone) |
| Branches | `keepance-3.0` + its feature branches | `lantern-plus` + `lp/*` |
| Mission | Ship/demo the standalone version; hardening; bugfixes; rebrand | Build Waves 0–4 per the wave plans |
| Releases | YES — tags + CI from `keepance-3.0` (with Jameson's go) | **NEVER** — no tags, no deploys, ever |

**Hard wall:** neither coordinator touches the other's folder or pushes to the
other's branches. Same GitHub repo (`lanternplatform/lantern`) — different branches
is the entire isolation model, and it's enough.

## Drift management — the one-way valve

1. **Main → Plus, regularly (the downstream merge).** The Lantern-Plus coordinator
   runs `git fetch origin && git merge origin/keepance-3.0` into `lantern-plus`:
   (a) **before Wave 0 starts** (main has moved since the fork point — absorb the
   bench-test fixes first), (b) **after every wave merges**, and (c) **whenever the
   bulletin announces a main-line release tag**. Serialize it (never during an
   in-flight wave merge), resolve conflicts in favor of main for everything outside
   the program's new modules, and run `npm run gate` after every merge — a downstream
   merge that breaks the gate gets fixed immediately, not parked.
2. **Plus → Main, exactly once.** Nothing merges back until Jameson says the parity
   features ship. Then: one integration PR from `lantern-plus` into `keepance-3.0`,
   gated by full gate + Codex adversarial review + the full user-test playbook +
   a Windows bench smoke. Because of the regular downstream merges, this final
   merge stays small — that's the whole point of the valve.
3. **Anchor refresh rule.** The wave plans cite file/line anchors true at the fork
   point. After each downstream merge, the Plus coordinator spot-checks the anchors
   of the CURRENT wave only (symbols are stable; find by symbol, per repo convention)
   and notes corrections in the wave's execution log. Never "fix" future waves' 
   anchors speculatively.
4. **The rebrand is the one known chunky merge.** If/when the main line executes the
   Advisor-Prep-Hero/Lantern rename (folders, identifiers, copy), that downstream
   merge will be large. Coordinate timing via the bulletin: ideally it lands between
   Plus waves, and the Plus coordinator takes a dedicated merge-only session for it.

## Scope walls (who builds what)

- **Main line must NOT build** anything in the program's lane: meetings/capture,
  calendar connectors, CRM write-back, agenda/brief automation, diarization,
  retention/redaction, Book view, cross-client Ask. If a main-line need touches that
  lane, it goes on the bulletin for the Plus coordinator instead.
- **Lantern-Plus must NOT do** core hardening, release work, website/marketing, or
  bugfixes to existing features (report them on the bulletin for main). Exception:
  a bug that blocks a wave task may be fixed minimally on `lp/*` and flagged on the
  bulletin so main can cherry-pick.
- Disputes: whoever's mission it is owns it; ties go to the bulletin and, if genuine,
  to Jameson.

## Shared-resource rules (the box)

1. **The Legion Windows bench is exclusive-use.** Reserve it in the bulletin
   ("LEGION: main — release smoke, until done"). **Main line has priority until the
   standalone release ships.** Plus needs it rarely before Wave 3 (the WASAPI
   loopback spike is the first real need) — schedule around main.
2. **Rust compiles: separate target directories — now PER LANE (upgraded 2026-07-03,
   Jameson's direction, after lock-contention made three lanes take turns).**
   Lantern-Plus runs one `CARGO_TARGET_DIR` per concurrent Rust lane, seeded warm by
   rsync from the previous shared cache (deps artifacts are workspace-path-independent;
   `debug/incremental` is deliberately NOT copied — it's the corruption-prone piece):
   `~/.cargo-target-lp-w1` (calendar lane), `~/.cargo-target-lp-w2` (CRM lane),
   `~/.cargo-target-lp-gate` (coordinator merge gates in `~/lantern-plus`),
   `~/.cargo-target-lantern-plus` (legacy shared — w0 finishes on it, then it's deleted).
   Consequences: (a) the old "one cargo at a time within the effort" rule is REPLACED by
   "one cargo per LANE, lanes compile concurrently" — CPU is governed by `jobs = 6` in
   `~/.cargo/config.toml` + memq; (b) cross-worktree incremental corruption is
   structurally gone (one source lineage per cache); (c) merge gates never race worker
   builds; (d) DISK is the new watched resource (~45G per warm cache) — the Plus
   coordinator runs a <25G disk alarm, deletes a lane's cache when the lane closes, and
   never lets a new lane seed while disk <80G free. Main line unaffected (their dirs are
   separate); FYI posted on the bulletin.
3. **Ports:** main keeps 5173 (and its existing allocations); Plus uses 5273 (dev)
   and 5299 (prototype server). New ports go in the bulletin.
4. **Memory governance:** both fleets obey the existing memq admission queue and
   user-slice caps. Codex fan-out is network-bound — parallelize freely, except
   cargo-compiling jobs (one per effort, given separate target dirs).
5. **M1 Mac bench:** same reservation rule as the Legion.

## Communication — the bulletin

`~/keepance-coordination/PARALLEL-EFFORTS.md` — append-only, both coordinators
read it at session start and write one-liners on: releases tagged, downstream
merges completed (with sha), Legion reservations/releases, scope-wall flags,
cross-effort bug reports. No prose essays; it's a ledger, not a diary. Jameson-level
questions still go through notify-jameson, never assumed.

## Sequencing recommendation

> **Currency note (2026-07-04):** the sequencing below describes how the program
> was kicked off on 2026-07-02. All five waves are now merged and the program is
> feature-complete against Jump (see `docs/PRODUCT-JOURNEY.md`) — steps 2-4 have
> already happened. Kept as a historical record; current work is tracked in
> `~/lantern-plus/coordination/`.

1. **Now:** main line finishes its bench test + standalone release undisturbed.
   Nothing about starting Lantern-Plus needs to wait for that — Waves 0–2 are
   TS/unit-heavy, browser-verifiable, and need no Legion time.
2. **Start Lantern-Plus immediately** with the bootstrap prompt. First actions are
   ordered in it: downstream merge → baseline gate → Wave 0.
3. **During the build:** Jameson fires the discovery-interview campaign (staged in
   `~/keepance/docs/marketing/campaigns/2026-06-advisor-first-users/`) so Phase 2
   validation data accumulates while code is written.
4. **Wave 3 start** is the moment to check the Legion calendar (loopback spike) and
   whether the rebrand merge has landed.
5. **Final integration** happens only on Jameson's ship-it, after the standalone
   version has been demoing/selling on its own — the two products converge exactly
   once, deliberately.

## Failure modes this design prevents (why each rule exists)

- Two fleets editing one checkout → **separate folders, hard wall**.
- New features breaking the demo/release version mid-sales-push → **one-way valve;
  Plus never releases**.
- A monster merge at the end → **regular downstream merges keep the delta small**.
- Two cargo builds deadlocking/aborting each other → **separate target dirs**.
- Both fleets driving the one Windows laptop at once → **bulletin reservation,
  main has priority**.
- Plans going stale against a moving main line → **anchor-refresh rule, current
  wave only**.
- The rebrand landing mid-wave and shredding a feature branch → **bulletin-timed,
  dedicated merge session**.
- Silent scope collision (both building calendar sync) → **scope walls + bulletin**.
