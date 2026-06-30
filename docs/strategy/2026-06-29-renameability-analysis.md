# Making Advisor Prep Hero cleanly + easily renameable — analysis, recommendation & rename plan

> **Date:** 2026-06-29 · **Status:** research + plan (READ-ONLY analysis — nothing renamed yet) ·
> **Author:** worker session (coordinator-driven) · **For:** Jameson (founder)
>
> **One-line ask:** "Advisor Prep Hero" is wired into a lot of the code. What's the cleanest way to make
> the *whole* codebase renameable — including the parts the branding system deliberately walls
> off — and what's the plan to actually do the rename to the new brand?
>
> **The fact that changes everything:** Advisor Prep Hero is **pre-launch — zero outside users, nothing
> shipped to anyone.** The usual reason you *can't* rename the deep "locked" identifiers (it
> breaks existing users' installs, saved keys, on-disk data, auto-update, subscriptions) is
> **moot right now.** There is nobody to break. That window is the whole opportunity.

---

## 0. TL;DR (read this if you read nothing else)

- **There are two different layers of "Advisor Prep Hero" in the code, and they're in completely
  different shape.**
  - **The brand layer** (the name/colours/logo/taglines users *see*) is already solved: one
    file (`brand/brand.config.json`) + one command (`npm run brand:sync`) drives it everywhere.
    A future name change here is a 5-minute job. ✅
  - **The plumbing layer** (the machine names: the app's ID to the operating system, the names
    it stores secrets under, the folder it saves data in, the web addresses, the build/release
    names) is the *opposite* of solved. Those names are **hardcoded, copy-pasted, and scattered
    across ~100 spots** in both the Rust and the TypeScript. There is **no single place** that
    owns them today. That's the real renameability problem.
- **Because we're pre-launch, the right move is a one-time deep rename NOW, and to do it in a way
  that makes every *future* rebrand trivial.** Specifically: **don't bake any brand name into the
  plumbing at all.** Give the plumbing a **neutral, permanent internal codename** (chosen once,
  while it's free), centralize all of it into a single source of truth (the same trick the brand
  layer already uses), and let the *visible* brand float on top. After that, the 2nd, 3rd, 4th
  rebrand each touch **one file** and never disturb the plumbing again.
- **The one decision only you can make** is whether the deep machine names should *match* the
  brand (tidy, but every future rename becomes a migration again) or be a **neutral codename**
  that never changes (slightly less tidy under the hood, but every future rename stays trivial
  forever). **My recommendation: neutral codename.** Detail in §5.
- **When:** this is a *last* step. A deep rename touches almost every file, so it must run on a
  **clean tree, in one dedicated branch, AFTER all the in-flight feature branches land**
  (ask-smart-agent, demo-recs, connector-access, onboarding-journey, plus the branding long-tail
  pass). Doing it earlier guarantees painful merge collisions. Detail in §6.

---

## 1. Complete code inventory

Method: `ripgrep` for `keepance` (all casings) across the repo, excluding `node_modules`,
`target`, `dist`, `.git`. Headline counts:

| Scope | Files | Match lines |
|---|---:|---:|
| **Whole repo** (excl. build artifacts) | **1,211** | **10,471** |
| `src/` (frontend) | 289 | 1,226 |
| `src-tauri/` (Rust backend) | 108 | 783 |
| `backend/` (firm relay) | 17 | 126 |
| `website/` (marketing) | 97 | 2,186 |
| `scripts/` | 96 | 469 |
| `infra/` | 20 | 115 |
| `tests/` | 184 | 716 |
| `.github/` (CI) | 3 | 51 |
| `docs/` | 363 | 4,143 |
| **Non-doc *code* files** (src + src-tauri/src + backend/src + scripts + infra + website + .github) | **580** | — |

Most of `docs/` (4,143 lines) is prose and is irrelevant to the rename *mechanism* — it's
historical record. The work that matters lives in the ~580 code files. Below, those are sorted
into the four categories the task asked for.

### (a) User-facing strings — ALREADY covered by `brand:sync` ✅ (don't re-litigate)

The branding system (shipped on `keepance-3.0`) already owns the visible brand:

- **Source of truth:** `brand/brand.config.json` → `name`, `tagline`, `descriptions`, `colors`,
  `messaging`, `urls`, plus `assets/`.
- **Generated, do-not-hand-edit:** `src/config/brand.ts` (the typed `BRAND` object the app reads
  everywhere it names itself), the `@brand:colors` block in `src/styles/globals.css`, and
  `website/styles/brand.css`.
- **Name swap across the marketing site + email templates:** `npm run brand:sync -- --rename --apply`.
- **Drift guard:** `npm run brand:check` (part of `npm run gate`) fails if the generated files go
  stale vs. the config.

**Coverage is good and I'm not reopening it.** The known, documented *gaps* in this layer are the
long tail of hand-written in-app copy (workflow templates, help text), a few inline-SVG gradient
stops on web pages, two shadcn `hsl()` color tokens (`--color-primary` / `--color-ring`, ×2 for
light/dark), and the social PNG cards — all listed in `HOW-TO-REBRAND.md` and slated for the
"branding long-tail pass." None of those block a rename; they're polish, and they're tracked.

> **Note for the coordinator:** the new brand assets the task referenced
> (`brand/assets/AdvisorPrepHeroLogo.svg`, `brand/assets/APHColorScheme.svg`) are **NOT present in
> this checkout** (`keepance-3.0` / `kp-coord`). `brand/assets/` still holds the *Advisor Prep Hero* assets
> (favicon.svg, logo.svg, wordmark.svg, icon-source.png, og-image.png). The new assets are
> presumably on a different branch/worktree or not yet committed here. This doesn't affect the
> analysis (it's name-agnostic), but the new assets must be dropped in with the **same filenames**
> before `brand:sync` runs. Flag to Jameson.

### (b) LOCKED identifiers — the real work (each with location + risk)

These are what `brand:sync` deliberately refuses to touch, listed in `brand.config.json` →
`lockedIdentifiers`. Each is "load-bearing": changing it on a *shipped* app breaks something for
existing users. **Pre-launch, that risk is ~zero — there are no existing users.** Here's every one,
where it actually lives, and the specific footgun.

| # | Identifier | Where it's defined / used | Rename-risk (post-launch) — **moot pre-launch** |
|---|---|---|---|
| 1 | **Tauri bundle id** `com.keepance.app` | `src-tauri/tauri.conf.json:5` (`identifier`). Re-used as the **default keychain service** at `src-tauri/src/commands/keychain.rs:16` and `commands/setup_progress/mod.rs:450`. | The OS app identity. Tauri derives the **app-data directory** *and* keychain access from it. Changing it silently **orphans all saved data + secrets** (no auto-migration — confirmed by Tauri docs). |
| 2 | **Updater signing key + endpoint** | `tauri.conf.json:93` (`pubkey`, a minisign Ed25519 key) and `:94–95` (`endpoint` → `github.com/keepance/keepance/releases/latest/download/latest.json`). | Auto-update verifies new releases against this exact pubkey. Lose/replace the **private** key and you can't push updates to the installed base. Pre-launch: no installed base → **regenerate the keypair freely.** |
| 3 | **Cargo package / lib / binary names** | `src-tauri/Cargo.toml`: package `name = "keepance"` (:11), `default-run = "keepance"` (:21), `[lib] name = "keepance_lib"` (:24), extra bins `keepance-mcp` (:33) + `prefetch_model` (:41); workspace members `crates/keepance-docx`, `crates/keepance-vault` (:8). Consumed at `src-tauri/src/main.rs:6` (`keepance_lib::run()`) and by the externalBin wiring in `release.yml:180`. | Internal build identity. Renaming compiles fine but every cross-reference (lib name, `default-run`, externalBin path) must move together or the release pipeline breaks. |
| 4 | **npm package name** | `package.json:2` (`"name": "keepance"`); local plugin dep `eslint-plugin-keepance-i18n` (`package.json:125`, wired in `eslint.config.js:9,31,48`); the firm backend is separately `keepance-firm-backend` (`backend/package.json:2`). | Low real risk (not published to npm), but the local-file plugin name + its 3 eslint references must move together. npm has a known workspace-symlink bug if old & new names co-exist — rename cleanly, don't leave both. |
| 5 | **OS-keychain service names** `keepance-*` / `com.keepance.*` | **Scattered across 28 const/format sites.** Central denylist: `commands/keychain.rs:16–61` (covers `com.keepance.app`, `com.keepance.vault.`, `keepance-audit-enc`, `keepance-mail-enc`, `keepance-vectors-enc`, `keepance-mail-ms/imap/gmail`, `keepance-docs-ms`, `keepance-onedrive-`, `keepance-crm-`). Plus per-connector consts: `calendly/store.rs:7`, `calendly/commands.rs:15`, `addepar/commands.rs:16`, `zocks/store.rs:7`, `vault/mod.rs:42` (`format!("com.keepance.vault.{id}")`), `crm/provider.rs:58` (`format!("keepance-crm-{}", id)`). | Each string is the literal key under which a secret/token is stored. Change it and the app **can't find the secret it saved** — silent orphan. **The big footgun:** because these are copy-pasted in 28 places, a partial rename is worse than none. |
| 6 | **On-disk data dir** `.keepance/` + `.keepance-vault.json` | **19 files.** e.g. `mcp_bin/access.rs:7` (`SCOPE_STATE_REL_PATH`), `mcp_bin/main.rs`, `mcp_bin/tools.rs`, connector stores `jotform/store.rs:67`, `docusign/store.rs:76`, `onedrive/store.rs:67`, `calendly/store.rs:59`, and the vault metadata file across `vault/mod.rs` (many lines). | Where the app writes per-workspace data (connector DBs, vault metadata, MCP scope). Hardcoded literal in 19 spots. Change it and the app looks in the wrong folder → **data appears lost.** |
| 7 | **Storage-key / event prefix** `keepance:` | **53 frontend files.** e.g. `matterStore.ts:268–270` (`keepance:matters`, `keepance:matter-ui-snapshots`, `keepance:matter-at-a-glance`), `editorStore.ts:237` (`keepance:tabOverflow`), and a whole family of `keepance:*` **CustomEvent** names wired in `app/lifecycle/useGlobalEventBus.ts:175–179`. | The prefix on every `localStorage` key and in-app event. Pure literal, no constant. Pre-launch nobody has saved state, so a clean swap loses nothing. |
| 8 | **License / firm API hosts** `*.keepance.com` | `src/platform/firm/firmConfig.ts:14` (`PROD_FIRM_API_BASE = https://api.keepance.com`), `src/platform/settings/schema.ts`, `backend/src/lib/config.ts:160` (`licenses.keepance.com`), `:165` (`api.keepance.com`), the **CSP allowlist** in `tauri.conf.json:32`, plus `infra/` deploy configs and `scripts/`. | These track the **domain you own**. They only change when DNS does — a founder/ops step, not a code step. Centralize so it's one edit when the domain moves. |
| 9 | **License tier codes** `personal` / `professional` / `practice` | `src/config/pricing.ts:30,76,97,116` + `backend/src/contract.ts`. | **These are NOT brand strings** — they're stable payment *wire codes* (the human sees "Solo/Professional/Firm"). **They do not need to change for a brand rename at all.** Listed here only because `brand:check` locks them; leave them alone. |
| 10 | **GitHub repo + payment store + signing resources** | GitHub `keepance/keepance` (used by the updater endpoint #2 and all over `release.yml`: `:395, :628, :639`). LemonSqueezy store `projelli` (`brand.config.json` + `scripts/`). CI signing resource *names* (comments in `release.yml`): Azure `keepance-github-actions` (:34), `keepance-signing` (:37), `keepance-public-trust` (:38); Apple identity "Jameson Daines (7HCXDCS279)" (:27,30). | Mostly **external accounts**, renamed in their dashboards (founder/ops), not in code. GitHub keeps redirects for renamed repos *indefinitely* for clone/fetch/push **and release assets** — but **NOT for GitHub Actions** hosted by the repo, and a new repo created at the old name kills the redirect. So: safe to rename the repo, but update the updater endpoint explicitly. |

**Counts that tell the story:** 28 keychain-service sites · 19 data-dir sites · 53 storage-prefix
files. **None of these reads from a shared constant.** That scatter *is* the renameability debt.

**Highest-risk spots (where a careless rename silently corrupts):** #5 (keychain — partial rename
orphans secrets), #6 (data dir — partial rename hides data), #1 (bundle id — drives both #5-default
and #6 on some platforms). These are exactly the three that are *cheap to get right pre-launch* and
*expensive forever after.*

### (c) Internal code symbols literally named `keepance` (≠ the `matter` facade)

- **Rust crate/lib/binary symbols:** `keepance_lib`, `keepance-docx`, `keepance-vault`,
  `keepance-mcp` (the build identity in #3 above). No source *module directories* under
  `src-tauri/src/` are named `keepance` (the crate name is the only Rust namespace token).
- **The eslint plugin:** `eslint-plugin-keepance-i18n` (#4).
- These are internal-only — users never see them — which is *exactly why they're good candidates
  to become a neutral codename* rather than tracking the brand (see §5).

> ⚠️ **Do NOT confuse this with the `matter` / `Matter` / `matter_id` facade.** That internal
> engine name is **also** locked, but for a **completely different reason** — it's the wire/type
> name for client-scoping isolation, deliberately kept stable while the *user-facing* word is
> "client/household." **`matter` is not the brand and is never renamed in any rebrand.** It's
> orthogonal to this whole exercise. Mentioned only so nobody "helpfully" renames it.

### (d) Build / config / CI / infra

- **`src-tauri/tauri.conf.json`** — `productName` (:3), `identifier` (:5), `publisher` (:54),
  `copyright` (:55), `longDescription` (:53), CSP connect-src host allowlist (:32), updater
  `pubkey`+`endpoint` (:93–95). *(`productName`/`publisher`/`copyright`/description are
  brand-facing and should be brand-driven; `identifier`/updater are plumbing.)*
- **`src-tauri/Cargo.toml`** + the two member crate manifests — names per #3.
- **`package.json`** (name + local plugin) + **`backend/package.json`** (`keepance-firm-backend`).
- **`.github/workflows/`** — `release.yml` (repo refs, signing resource names, externalBin paths,
  release title `"Advisor Prep Hero $tag"`), `ci.yml` (branch name `keepance-3.0`).
- **`infra/`** — `deploy.sh`, the systemd unit `backend/deploy/keepance-backend.service`,
  `projelli-demo-proxy.service`, Caddy/cloudflared snippets, community-repo seed manifests.
- **`scripts/`** — `brand-sync.mjs` (the `lockedIdentifiers` *assertions* — these must be updated
  to the new values or `brand:check` will fail after the rename), plus deploy/telemetry/sample
  scripts referencing hosts.

---

## 2. Online research — best practices & stack-specific mechanics

### General rename / rebrand engineering

- **Single source of truth + abstraction is the whole game.** Every credible source says the same
  thing: don't scatter brand values; funnel them through one abstraction (design tokens for
  colour, a constants module for identifiers) so a change "ripples through" from one edit. The
  brand layer here already does this for colour/name; the plumbing layer doesn't — that's the fix.
  ([kluster.ai](https://www.kluster.ai/blog/code-refactoring-techniques),
  [Medium: Rebranding the Code](https://medium.com/@hgbzzrbvg/rebranding-the-code-challenges-for-developers-when-updating-a-design-system-a3e2631ce528),
  [docuwriter design-system architecture](https://www.docuwriter.ai/posts/design-system-architecture))
- **Branching:** for a large rebrand, do it on **one dedicated feature branch** so all the churn is
  isolated and reviewable in one place — matches the "do it last, one branch" plan in §6.
  ([fiveable refactoring best practices](https://fiveable.me/lists/code-refactoring-best-practices))

### Stack-specific mechanics & footguns

**Tauri 2 — app identity.**
[Tauri docs](https://v2.tauri.app/develop/configuration-files/) confirm `app_data_dir` resolves to
`${dataDir}/${bundleIdentifier}`, so **changing `identifier` moves the data directory and there is
NO automatic migration** — existing data is simply orphaned. The same identifier is the default
keychain service here. **Pre-launch this is free; post-launch it's a migration project.** Practical
rule: pick the identifier once and treat it as permanent. ([Tauri issue #2431](https://github.com/tauri-apps/tauri/issues/2431),
[Tauri config docs](https://v2.tauri.app/develop/configuration-files/))

**Tauri 2 — updater key + endpoint.** The updater verifies releases against the configured minisign
`pubkey`; there is **no built-in key rotation** (open feature request
[#7585](https://github.com/tauri-apps/tauri/issues/7585)). If you lose the **private** key you
can't update the installed base. **Pre-launch:** generate a **fresh keypair** for the new identity
and store the private key safely — there's no base to strand. Point `endpoint` at the new repo's
`latest.json`. ([Tauri updater plugin](https://v2.tauri.app/plugin/updater/))

**Rust crate / binary / lib rename.** Use `[package].name`, `[lib].name`, and `[[bin]].name` in
`Cargo.toml`; binary names can differ from the package name. Mind the hyphen↔underscore rule (a
crate `foo-bar` imports as `foo_bar`) — that's why the lib is `keepance_lib`. Tools like
`cargo-rename` can do the workspace-wide rewrite atomically, but the rename here is small enough to
do by hand + `cargo build` to catch every reference.
([egghead: rename cargo binary](https://egghead.io/lessons/rust-rename-the-default-cargo-binary-to-be-different-than-the-package-name),
[cargo-rename](https://github.com/ekkolon/cargo-rename))

**npm package rename.** Straightforward (`name` in `package.json`), but the
[npm workspace symlink bug](https://github.com/npm/cli/issues/8519) bites if the **old and new
names co-exist** as local workspace packages — so rename the local `eslint-plugin-keepance-i18n`
cleanly (folder + `name` + the 3 `eslint.config.js` refs) rather than aliasing.
([npm package.json docs](https://docs.npmjs.com/files/package.json/))

**GitHub repo rename.** GitHub keeps redirects **indefinitely** for `clone/fetch/push` *and release
assets* — so the updater endpoint would even survive a rename via redirect. **Two caveats:**
(1) GitHub does **not** redirect *Actions* hosted by a renamed repo; (2) creating a *new* repo at
the old name **breaks** the redirect. Best practice: rename, then **explicitly update** every
hardcoded `keepance/keepance` reference (updater endpoint, `release.yml`) rather than relying on
redirects. ([GitHub: renaming a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository),
[community #22669](https://github.com/orgs/community/discussions/22669))

**OS keychain service rename.** A new service name means the OS sees a **different app identity** for
secrets — old entries are **orphaned, not migrated**
([MS Q&A](https://learn.microsoft.com/en-us/answers/questions/2110008/cant-save-credentials-in-macos-version-of-windows),
[Apple Communities](https://discussions.apple.com/thread/254792006)). Pre-launch there are no
secrets to strand. The durable fix is to **derive every keychain service from one namespace
constant** so they always move together (today they don't — 28 separate literals).

---

## 3. Candidate approaches (brainstormed)

| | Approach | What it is | Effort | Risk | Reversible? | Serves *future* rebrands? |
|---|---|---|---|---|---|---|
| **(i)** | **Extend the brand-config layer to also drive identifiers** | Add the bundle id / keychain namespace / data dir / storage prefix / hosts to `brand.config.json` and have `brand:sync` generate them into the code (like it does for `BRAND`). | Medium | Medium — `brand:sync` would now be able to write load-bearing values; needs strong guards so a casual colour tweak can't silently move the data dir. | Yes | **Partly.** Makes them *one-edit*, but if they track the *brand name* every future rebrand still moves the data dir/keychain → a migration each time. |
| **(ii)** | **One-time scripted/codemod global hard-rename** (pre-launch) | A big find-and-replace (smart codemod) that flips every `keepance` token to the new brand, once. | Low–Medium (one push) | Medium — easy to miss a casing or a `format!("keepance-…")`; partial rename of #5/#6 silently corrupts. | Hard once shipped | **No.** It just trades "Advisor Prep Hero" for "AdvisorPrep" everywhere; the *next* rebrand is the same hard project again. Doesn't fix the scatter. |
| **(iii)** | **Neutral internal codename + brand only at the edges** | Give the plumbing a **brand-free, permanent codename** (one namespace). Centralize it into a single constants module (TS + Rust). The *visible* brand stays in `brand.config` and floats on top. | Medium–High (the centralization refactor is the cost) | Low *after* it's done — and the refactor is mechanical + test-guarded. | n/a (it's the stable base) | **Yes — fully.** Future rebrands touch only the brand layer; the plumbing never moves again → **no migration, ever.** |
| **(iv)** | **Hybrid: (iii) for plumbing + (i) for the brand-facing build fields** | Plumbing → neutral, centralized, permanent (iii). Brand-*facing* build fields that users legitimately see (`productName`, window title, installer name, publisher, copyright) → driven by `brand.config` (i). | Medium–High | Low | n/a | **Yes — best of both.** Visible brand fully tracks the config; invisible plumbing is permanent. |

---

## 4. The key strategic insight

The "locked identifiers" are locked **for one reason only: changing them hurts *existing users*.**
That reason is what makes a rename hard. So the *real* goal of "make it renameable" is not "make it
easy to change the plumbing" — it's **"make it so a future rename never needs to touch the plumbing
at all."**

That reframes the whole question. You don't want the bundle id / keychain / data dir to *track the
brand* (then every rebrand re-breaks them). You want them **brand-free and permanent**, set **once,
now, while it's free**, and never moved again. The brand becomes a thin, swappable skin over a
stable core — which is exactly how mature software handles this (internal codenames that outlive
many marketing names).

---

## 5. Recommendation

**Do approach (iv): a one-time pre-launch deep rename that simultaneously (a) gives the plumbing a
neutral, permanent codename and (b) centralizes it into a single source of truth — while the visible
brand keeps living in `brand.config.json`.**

Concretely:

1. **Pick a neutral, permanent internal identity — once, now.** This is the load-bearing core that
   **never changes again** across any number of future rebrands:
   - **Bundle identifier:** a brand-free reverse-DNS under a holding identity, e.g. something like
     `com.<holdco>.app` (a name you're happy to keep forever, *not* a product brand). This drives
     the app's OS identity, the default keychain service, and (via Tauri) the data dir.
   - **Keychain namespace:** one prefix constant (e.g. derived from the bundle id) that **all 28**
     service strings build from — so they can never drift apart again.
   - **Data dir:** one constant (e.g. `.<codename>/`) that **all 19** sites read from.
   - **Storage/event prefix:** one constant (e.g. `<codename>:`) that **all 53** frontend sites
     import.
   - **Cargo/npm/lib/bin names + eslint plugin:** rename to the neutral codename.
   - **Updater:** fresh minisign keypair + endpoint on the new (final) GitHub repo.
2. **Centralize all of it into a single source of truth — the durable win.** Introduce **one
   identity module per language**, generated/owned the same way `brand.ts` is:
   - TS: an `appIdentity.ts` (storage prefix, event prefix, hosts) that the 53 files import.
   - Rust: an `app_identity.rs` / build constant (keychain namespace, data-dir name, bundle id)
     that the 28 + 19 sites read.
   - Wire these so they're **checked by `brand:check`** (extend the existing drift guard) — then
     they can't silently rot, and a future rename of the *visible* brand provably doesn't touch them.
3. **Let the *visible* brand keep floating on `brand.config.json`.** The fields users actually see
   — `productName`, window title, installer/app name, `publisher`, `copyright`, descriptions —
   become brand-driven (some already are via `BRAND`; wire the few in `tauri.conf.json` that
   aren't). A future rebrand = edit `brand.config.json`, drop new assets, `npm run brand:sync`,
   redraw the wordmark. **The plumbing doesn't move.**

**What to rename now vs. keep neutral going forward — the crisp version:**

- **Rename to the NEW brand now:** everything users see (handled by `brand:sync`) + the GitHub repo,
  the LemonSqueezy store, the domain, and the CI signing-resource *names* (cosmetic/ops).
- **Set to a NEUTRAL codename now, then freeze forever:** bundle identifier, keychain namespace,
  data-dir name, storage/event prefix, cargo/npm/lib/bin names, updater keypair. These never track
  a brand again.
- **Never touch (orthogonal):** the `matter`/`matter_id` engine facade; the license tier codes
  (`personal`/`professional`/`practice`).

**Why this and not the simpler "just hard-rename to AdvisorPrep everywhere" (approach ii):**
hard-renaming the plumbing to "advisorprep" *feels* clean but re-arms the exact same trap — the
moment you launch, your bundle id / keychain / data dir are tied to a brand, and rebrand #2 becomes
a user-data migration. The neutral-codename route spends the free pre-launch window to buy
**permanent** trivial rebrands. Jameson has said he expects several more rebrands — that's precisely
the case where this pays off.

> **COORDINATOR / Jameson — the one decision to confirm before execution:**
> **Should the deep machine names (bundle id, keychain, data folder) be a NEUTRAL permanent codename
> (recommended), or MATCH the new brand "AdvisorPrep"?**
> - *Neutral codename* → every future rebrand stays a 5-minute job, forever; downside: a power user
>   inspecting the app sees a bundle id / data folder that isn't literally "AdvisorPrep."
> - *Match the brand* → tidier under the hood today; downside: the *next* rebrand (post-launch)
>   becomes a real user-data migration again.
> My recommendation is **neutral codename.** If you'd rather it match the brand, the plan below is
> the same minus the "neutral" choice (just substitute the brand for the codename).
> (Also: confirm the exact new name + casing, and drop the new `brand/assets/*` in with the existing
> filenames — see §1a note.)

---

## 6. The sequenced rename plan

**WHEN — this is critical.** A deep rename touches ~580 code files and almost every config. It will
**collide violently** with any open feature branch. So it is the **LAST step of the current push**:

- **Land first (must all be merged to a clean `keepance-3.0` tip):** `feat/ask-smart-agent`,
  `feat/demo-recs`, `feat/connector-access`, `feat/onboarding-journey`, and the standby **branding
  long-tail pass** (`feat/branding-system` follow-up).
- **Then, on a clean tree, in ONE dedicated branch** (e.g. `chore/neutralize-identity-and-rebrand`),
  do the rename. Nothing else rides this branch.

**Phased execution (each phase ends green before the next):**

| Phase | What | How to verify it worked |
|---|---|---|
| **0. Decide** | Confirm new brand name+casing; confirm neutral-codename vs brand-match (the §5 decision); confirm the permanent bundle id + codename strings; drop new `brand/assets/*` in (same filenames). | Decision recorded; assets present. |
| **1. Centralize (no value change yet)** | Introduce `appIdentity.ts` (TS) + `app_identity.rs` (Rust). Refactor the **53** storage/event sites, **28** keychain sites, **19** data-dir sites to read from them — *still emitting the current `keepance` values*. Pure refactor. | `npm run gate` green (typecheck + vitest + eslint + cargo tests); app still launches; behaviour identical. This proves the centralization is correct **before** any value flips. |
| **2. Flip the values** | Change the constants to the neutral codename (plumbing) + run `brand:sync --rename --apply` for the visible brand. Update `brand.config.json → lockedIdentifiers` **and** the `brand-sync.mjs` assertions to the new values. | `npm run brand:check` passes against the **new** locked values (proves no stale literal escaped). `npm run gate` green. |
| **3. Build identity** | `tauri.conf.json` (`identifier`, `productName`, `publisher`, `copyright`, CSP hosts, updater endpoint + **new pubkey**), `Cargo.toml` (package/lib/bin + `default-run` + members), `package.json` + local eslint plugin (folder + name + 3 refs), `backend/package.json`. | `cargo build` + `npm run build` succeed; `keepance-mcp`→new bin name resolves in the externalBin path. |
| **4. CI / infra** | `.github/workflows/*` (repo refs, release title, externalBin paths, `ci.yml` branch), `infra/` units + deploy scripts, signing-resource names. | A **dry/draft** tagged release build on the renamed repo signs + uploads under the new names (Win via Azure, Mac via Apple) without error. |
| **5. Live smoke (real OS — the AI's job)** | Bring the **Legion Windows laptop** to this code; install + drive the signed app. Repeat the Mac M1 spot-check. | **Keychain:** app writes+reads a secret under the **new** service namespace (and the old `keepance-*` names are absent). **Data dir:** app creates `~/.<newcodename>/`, not `.keepance/`. **Updater:** a `latest.json` signed with the new key verifies and the app sees the update. App launches clean **3× in a row** on Windows. |
| **6. External / ops (founder + ops)** | Rename the **GitHub repo**; rename the **LemonSqueezy store**; point **DNS** for the new domain (hosts in `firmConfig.ts`/`backend` follow); rename Azure/Apple signing resources in their dashboards. | New repo URL + updater endpoint resolve; checkout links work; `api.<newdomain>` + `licenses.<newdomain>` answer; signed build still notarizes. |

**Per-layer verification, summarized (the "prove it" checklist):**

- **Build:** `npm run build` + `cargo build` clean; `npm run gate` green.
- **Static no-leak check:** `rg -i keepance src src-tauri/src backend/src` returns **only**
  intentional history (e.g. a migration shim, if any) — ideally zero in live code.
- **Brand drift:** `npm run brand:check` passes against the new locked identifiers.
- **Keychain:** live write+read under the new namespace; old names absent (Legion + Mac).
- **Data dir:** new `~/.<codename>/` created; nothing under `.keepance/`.
- **Updater:** signature verifies against the new pubkey; endpoint resolves on the renamed repo.
- **CI/signing:** a tagged build signs (Azure + Apple) and uploads under the new repo/resources.
- **Live app:** launches 3× clean on Windows; Mac spot-check passes.

**Landmines to brief whoever executes:**

- Partial rename of the **keychain (#5)** or **data dir (#6)** silently corrupts — Phase 1's
  centralization is what guarantees they all move together. Don't skip it.
- `brand:check` will **fail the moment the locked identifiers change** unless you *also* update the
  config's `lockedIdentifiers` block and the `brand-sync.mjs` assertions (Phase 2). Expected, not a
  bug.
- The updater needs a **new private key stored safely** — losing it later means no updates.
- GitHub Actions are **not** covered by repo-rename redirects — update every `keepance/keepance`
  ref explicitly (Phase 4), don't lean on redirects.
- Generate a **fresh** og-image/wordmark for the new name (designer) — those are images, not text.

---

## 7. Independent Codex pass

*(Folded in below — read-only `gpt-5.5` review of "best way to make this codebase cleanly
renameable, pre-launch." Agreements / differences vs. the recommendation above are noted.)*

**Verdict: Codex independently reached the same recommendation** — and reached it strongly. Its
one insistence is *exactly* my Phase 1: **add the single-source identity layer FIRST, then
hard-rename through it** — otherwise "this rebrand pays down today's debt while creating the same
debt under a new name." Full agreement on the architecture, the pre-launch timing, the
neutral-vs-brand split, leaving `matter`/tier-codes alone, and the "do it last, one freeze branch"
sequencing.

**Where Codex sharpened the picture (net-new — folds into §1b and §5):**

- **A whole extra identifier category I under-counted: the OS-level app-data/cache dir.** Beyond the
  per-workspace `.keepance/` folder, the app also writes to `dirs::data_dir().join("keepance")` for
  things like the **local model, reranker, TTS voice, and logs**. That's a *second* data path tied
  to the name — must be centralized + renamed too, and verified separately (confirm those dirs no
  longer write under `keepance`).
- **More scattered keychain namespaces:** `src/platform/firm/firmKeychain.ts` and
  `deviceKeys.ts` use `com.keepance.user.*`, `com.keepance.matter.*`, `com.keepance.device.*` (firm
  / device / per-matter key slots). These join the 28 Rust sites in §1b#5 — all must derive from the
  one namespace constant. *(Note: the `matter` inside `com.keepance.matter.*` is the engine word, not
  the brand — only the `com.keepance` part rebrands.)*
- **Crypto / data-format labels are a special case — make them NEUTRAL + VERSIONED, never branded.**
  Codex flags strings like `workspace-path-token-v1` (crypto domain labels). Once data is written
  with them they become *data-format* identifiers — so they should be brand-free, version-tagged
  constants, **not** the new brand name (and not even the neutral codename if they'd ever need to
  outlive it). This refines §5: distinguish *runtime identity* (neutral codename, fine) from
  *data-format labels* (neutral + versioned, frozen by data, not by brand).
- **Also rename:** `scripts/build-mcpb.mjs` (hardcoded artifact names) and regenerate **both
  lockfiles** (`package-lock.json` + `src-tauri/Cargo.lock`) after the crate/package renames.
- **In-house crates could go neutral too:** `keepance-docx` / `keepance-vault` → e.g.
  `workspace-docx` / `workspace-vault` — consistent with the neutral-codename recommendation.

**Codex's concrete naming for the centralization** (matches my §5, adopt it): a
`brand/identity.config.json` (or a `runtimeIdentity` block beside `lockedIdentifiers`) that
generates `src/config/identity.ts` (TS) + `src-tauri/src/identity.rs` (Rust) + patches the files
that can't import a constant (`package.json`, `Cargo.toml`, `tauri.conf.json`, `.github/workflows/*`,
backend env/deploy), exposed as **`npm run identity:sync` / `identity:check`** wired into the gate
right next to `brand:check`.

**Codex's extra verification depth (adopt into Phase 5):** on the **backend**, run
`bun run typecheck && bun test` and check `/healthz`, `/.well-known/seat-pubkey`, the SSO callback
URL, and WebSocket URL generation under the new hosts; on **data paths**, after the rename create a
fresh workspace, index a file, import mock mail/connector data, create facts + an MCP scope, and
confirm the *new* hidden metadata dir exists while `.keepance` does not, plus confirm Tauri's
`app_data_dir` output reflects the new bundle identifier.

> **Net:** two independent engineers (this analysis + Codex `gpt-5.5`) converged on the same answer:
> **hard-rename now while it's free, but build the identity single-source-of-truth first and give the
> plumbing a neutral, permanent name** — so this is the *last* deep rename Advisor Prep Hero/AdvisorPrep ever
> needs, not the first of many.
