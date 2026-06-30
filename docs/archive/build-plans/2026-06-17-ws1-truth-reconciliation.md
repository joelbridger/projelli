# WS1 — Truth & Trust Reconciliation: Implementation Plan

> **For agentic workers:** execute task-by-task; each task ends green. The **single-source-of-truth guard (Task 1) is the executable spec** — it fails listing every contradiction, and every later task drives it toward green. Reconcile to the canonical truth below, never the other way around.
>
> **Parent:** `docs/strategy/2026-06-17-keepance-master-plan.md` (WS1). **Branch:** `ws1-truth-reconciliation`. **Inventory of every contradiction (file:line):** the WS1 inventory section below + the master plan. **No production deploy without Jameson's explicit go** — this plan ends at "verified green on the branch," not "shipped."

## ✅ STATUS (2026-06-17) — executed on branch `ws1-truth-reconciliation` (4 commits; typecheck 0, vitest 270 files/3137 passed, guard green)

**DONE + verified:**
- Single-source-of-truth guard (`tests/unit/truth-reconciliation.guard.test.ts`) — green.
- In-app credibility: false SOC2/DPA Firm-tier claim → honest roadmap framing; removed "Whiteboard" license string fixed (en/de/es + hashes).
- Pricing reconciled on ALL 32 live website pages + README (retired one-time/old prices → canonical subscription; Personal→Solo, Practice→Firm). Updated the existing `website-content-lint` $129 assertion for the new Firm monthly rate.
- Homepage assurance honesty; README rewritten for v3.2.0; CLAUDE.md contradictions fixed.
- Removed-feature claims (plugin/community marketplace, stale "28 built in") dropped from /vs/ + press-kit comparison; built-in count standardized to "50+".
- Unpublished campaign drafts flagged (`campaigns/PRICING_NOTICE.md`).

**DEFERRED (flagged — needs its own pass, not a find-replace):**
- `website/press-kit/index.html` — a dated v2.0 press release (line 213: "Last updated 2026-05-04 (v2.0 release)") describing the removed plugin marketplace, "day-one plugins", "Pay once", and "Markdown file". Reporter-facing; needs a dedicated 3.0 press-kit refresh.
- Unpublished campaign-draft narratives (old one-time-pricing story) — marketing rewrite, paused per the evaluation.

**NOT deployed** — branch awaits Jameson's review (esp. the assurance wording) + explicit deploy go.

---

**Goal:** Make every live, buyer-facing surface state the same truth about price, version, template count, and trust/assurance status, and add a guard so it can't silently drift again.

**Architecture:** `src/config/pricing.ts` is the canonical pricing source. A new vitest guard scans the live-claim surfaces (website non-blog HTML, README, in-app strings) for forbidden retired patterns + required canonical values. Fix in-app first (highest trust), then website, then docs.

**Tech stack:** TypeScript, vitest, plain HTML (website/), Markdown (README/docs).

## Global Constraints — THE CANONICAL TRUTH (copy verbatim into every fix)

- **Pricing (per-seat ANNUAL subscriptions; source `src/config/pricing.ts`):**
  - **Solo** — $468/yr ($39/mo annual; $49/mo monthly). Wire code `personal`.
  - **Professional** — $948/yr ($79/mo annual; $99/mo monthly). Wire code `professional`.
  - **Firm** — $1,548/seat/yr ($129/mo annual; $159/mo monthly), min 3 seats. Wire code `practice`.
  - **Founding rate** — 30% off, locked for the life of the subscription.
  - **RETIRED (must not appear on any live surface):** one-time `$49 / $129 / $399`, or `$49 one-time / $149/yr / $499/yr`, or founding `$99/yr`; tier names **Personal / Practice** in a pricing context (now **Solo / Firm**).
- **Version:** v3.2.0.
- **Template counts (registry `src/features/workflows/engine/index.ts` `allWorkflows`):** total built-in **51** (Legal **19**, Tax **13**, Consulting **9**, Advisor **7**, + 3 standalone). Lawyers see the 19 legal (filtered `WorkflowPanel.tsx:159`). On vertical pages use the **pack** count; for a general "built-in" claim use **51** (or "50+"). Wrong claims live today: 15, 18, 28.
- **Trust/assurance REALITY:** NO SOC 2, NO signed DPA, NO formed entity (sole proprietor). Honest posture already live on `website/security/index.html` ("we do not hold any active SOC 2 report… we cannot satisfy that requirement today"). Every other surface must match that honesty — never claim SOC 2 / signed DPA / trust center as *delivered*.
- **Voice rules** (`feedback_marketing_copy_voice`, `feedback_no_em_dashes`): first-person singular, contractions, no em dashes in public copy, no "leverage/seamless/transform."
- **Locked:** do not touch wire codes (`personal/professional/practice`), localStorage keys, or the i18n key STRUCTURE beyond the two renames named below.

---

### Task 1: The single-source-of-truth guard (TDD — write it first; it will fail)

**Files:** Create `tests/unit/truth-reconciliation.guard.test.ts`.

**Interfaces:** Consumes `PRICING_TIERS` / `displayName` from `src/config/pricing.ts`. Produces nothing (a guard).

- [ ] **Step 1 — Write the guard test.** It (a) reads canonical annual prices from `pricing.ts`; (b) defines `LIVE_SURFACES` = all `website/**/*.html` EXCEPT `website/blog/**`, `website/changelog/**`, `website/archive/**`, plus `README.md`; (c) defines `RETIRED_PATTERNS` = [`/\$49\s*(one-time|once)/i`, `/\$149\s*\/\s*yr/i`, `/\$499\s*\/\s*yr/i`, `/\$129\s*one-time/i`, `/\$399\s*one-time/i`, `/founding[^.]{0,40}\$99\/yr/i`]; (d) asserts NO live surface matches any retired pattern; (e) asserts the in-app `src/config/pricing.ts` features array contains no bare "SOC 2 readiness"/"signed DPA"/"trust center" delivered-claim (regex on the file text); (f) asserts `README.md` contains the canonical `$468` and NOT `$49 one-time`. Each failure must print the offending file + match so it doubles as the worklist.

```ts
// tests/unit/truth-reconciliation.guard.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { PRICING_TIERS } from '../../src/config/pricing';

const ROOT = path.resolve(__dirname, '../..');
const RETIRED = [
  /\$49\s*(one-time|once)/i, /\$149\s*\/\s*yr/i, /\$499\s*\/\s*yr/i,
  /\$129\s*one-time/i, /\$399\s*one-time/i, /founding[^.]{0,40}\$99\s*\/\s*yr/i,
];
function htmlFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) {
      if (/(^|\/)(blog|changelog|archive)$/.test(p)) continue; // historical — left by design
      htmlFiles(p, acc);
    } else if (e.endsWith('.html')) acc.push(p);
  }
  return acc;
}
describe('WS1 truth guard: no retired pricing on live surfaces', () => {
  const surfaces = [...htmlFiles(path.join(ROOT, 'website')), path.join(ROOT, 'README.md')];
  it('canonical Solo price is 468 (sanity on the source of truth)', () => {
    expect(PRICING_TIERS.find((t) => t.code === 'personal')?.annualPerYear).toBe(468);
  });
  it('no live surface shows retired pricing', () => {
    const hits: string[] = [];
    for (const f of surfaces) {
      const txt = readFileSync(f, 'utf8');
      for (const re of RETIRED) if (re.test(txt)) hits.push(`${path.relative(ROOT, f)} :: ${re}`);
    }
    expect(hits, `\nRetired pricing still live:\n${hits.join('\n')}\n`).toEqual([]);
  });
  it('in-app pricing.ts makes no delivered SOC2/DPA/trust-center claim', () => {
    const txt = readFileSync(path.join(ROOT, 'src/config/pricing.ts'), 'utf8');
    expect(/SOC 2 readiness|signed DPA|trust center/i.test(txt)).toBe(false);
  });
  it('README shows canonical subscription pricing', () => {
    const txt = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    expect(txt).toMatch(/\$468/);
    expect(/\$49\s*(one-time|once)/i.test(txt)).toBe(false);
  });
});
```

- [ ] **Step 2 — Run it; confirm it FAILS** listing the contradictions. `npx vitest run tests/unit/truth-reconciliation.guard.test.ts`. Expected: FAIL (the worklist). **Commit** the guard.

### Task 2: In-app credibility fixes (highest-trust surface) — central, careful
**Files:** `src/config/pricing.ts:125`, `src/locales/en.json:159` & `:164`.
- [ ] Replace the false delivered claim. `pricing.ts:125` `'The assurance package: DPA, trust center, SOC 2 readiness'` → **`'Open, inspectable architecture you can verify (independent SOC 2 and a signed DPA are on our roadmap, not yet in place)'`** (true as a checkmark + honest, matches `/security`). Keep line 124 "The assured zero-retention option" (it's real).
- [ ] `en.json:164` `'…and the assurance package (Firm)'` → `'…and assured zero-retention routing (Firm)'`.
- [ ] `en.json:159` `"whiteboard-audio-research": "Whiteboard, audio recording, research citations"` → key `"audio-research": "Audio recording and research citations"`; update the consumer `src/features/settings/LicenseSettings.tsx:173` to `unlocks.audio-research`.
- [ ] `npm run typecheck` (0) + `npx vitest run` (green, incl. the guard's pricing.ts assertion now passing). Commit.
> ⚠️ The exact assurance wording is buyer-facing — flag it in the completion report for Jameson's sign-off before deploy.

### Task 3: Homepage assurance honesty
**Files:** `website/index.html:500` (a "signed DPA" claim), `:621` (the "assurance package" Firm list).
- [ ] `:500` reword so no *signed DPA* is claimed as existing (e.g. "a zero-retention option, with a signed DPA on our roadmap for firm risk review"). `:621` mirror the Task 2 wording. Commit.

### Task 4: The 13 `/vs/` pages — pricing + tier names (DELEGATE, batched)
**Files:** all `website/vs/*.html` (chatgpt, gamma, notion, tana, copilot, reflect, clio-duo, cursor-for-writing, mem-ai, jump, heyday, cocounsel, logseq, obsidian, claude-projects, intuit-assist, index) — per the inventory file:line table.
- [ ] For each: replace every retired price (`$49 one-time`, `$149/yr`, `$499/yr`, founding `$99/yr`) with canonical Solo $468 / Professional $948 / Firm $1,548; rename **Personal→Solo**, **Practice→Firm** in pricing contexts; fix `cocounsel.html` `<meta>` + `reflect.html` JSON-LD too. Delegate in 2-3 batches to subagents; **verify centrally** (re-grep each file for retired patterns = none). Commit per batch.

### Task 5: Vertical landing pages + vs hub
**Files:** `website/legal/index.html`, `website/tax/index.html`, `website/consulting/index.html`, `website/financial-advisors/index.html`, `website/vs/index.html` — pricing cards + schema `"price"` + CTAs + tier names per inventory. Plus `website/legal/index.html:660` template count **18→19**. Delegate; verify; commit.

### Task 6: Press kit
**Files:** `website/press-kit/comparison-matrix.html:536-537`, `website/press-kit/index.html:237,282` — canonical pricing + Solo/Professional/Firm. Commit.

### Task 7: Remaining template-count claims
**Files:** `website/vs/notion.html:110` (28→51 or reframe to "19 legal"), `website/roadmap/index.html:332,443,651` (15→correct), `website/changelog/index.html:344` (28 — add an "(as of <release>)" dateline rather than rewrite; it's a changelog entry). Commit.

### Task 8: README rewrite (eng-review #2)
**Files:** `README.md`.
- [ ] Rewrite Status (v3.2.0, all four platforms signed + auto-update), Pricing (canonical subscription), product description (Word-native law-practice intelligence layer, not "Markdown editor with wiki-links/backlinks"), stack (OOXML+TipTap primary; CodeMirror for plain-text utility; Vite 6), and repoint the architecture link from `docs/reference/ARCHITECTURE.md` (stale "Business OS") to `./ARCHITECTURE.md`. Commit.

### Task 9: CLAUDE.md contradictions (eng-review #3) — dev-facing
**Files:** `CLAUDE.md`.
- [ ] Delete the "sql.js WASM" troubleshooting block; remove the 3 phantom `test:unit/integration/security` script lines; fix the autosave line refs (point to `src/app/lifecycle/useAutosave.ts` + `StatusBar.tsx:342`); condense the dead Key-Files/Directory tables to a pointer to `ARCHITECTURE.md`; correct CodeMirror/Mermaid "legacy" labels + the `@/modules` alias example. Commit.

### Task 10: Unpublished campaign drafts (fix-before-activation; not live)
**Files:** `docs/marketing/campaigns/**/{SHOW_HN,REDDIT_*}.md` carrying `$49/$129 one-time`.
- [ ] Update the prices to canonical so they're safe to activate; these aren't live, so low-priority but cheap. Commit.

### Task 11: Verify green + stop
- [ ] `npx vitest run tests/unit/truth-reconciliation.guard.test.ts` → **PASS** (no retired pricing, no false in-app claim, README canonical).
- [ ] `npm run typecheck` (0) + `npx vitest run` (full, still 3133+/green) + `npm run build` (exit 0).
- [ ] **STOP.** Report to Jameson: what changed, the assurance wording for sign-off, and request explicit go to deploy (website via `infra/deploy.sh`; the in-app strings ride the next desktop release). Do NOT deploy.

## Self-review checks
- Spec coverage: in-app claims ✓, all live website pricing ✓, tier names ✓, template counts ✓, assurance ✓, README ✓, CLAUDE.md ✓, campaign drafts ✓, the guard ✓. Historical/blog surfaces intentionally excluded (guard skips blog/changelog/archive).
- The guard is the backstop: if any retired pattern remains anywhere live, Task 11 fails.
