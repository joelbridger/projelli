# Keepance Master Plan — From Build to Traction (2026-06-17)

> **What this is.** A single integrated plan that fuses two independent reviews that landed on the same day:
> 1. **The engineering review** (`docs/operations/2026-06-17-reorg-fresh-eyes-review.md`) — a fresh-eyes audit of the just-finished feature-first reorg.
> 2. **The strategic evaluation** (a separate session, via the Venture OS tool): `docs/strategy/2026-06-17-build-session-handoff-and-product-recommendations.md` + its two cited companion memos (`…-keepance-evaluation-path-to-traction.md`, `…-email-search-standalone-viability.md`).
>
> **The headline.** These two reviews, done independently, **agree on the single most important thing**: Keepance's first job is not more features — it is *being trustworthy and being found*. The engineering review's #1 finding (public claims contradict each other) **is** the strategic evaluation's #1 recommendation (§5.1, "reconcile every claim — highest-ROI task you have"). This plan makes that convergence the spine.
>
> **One decision gates everything below — and it is Jameson's to make (see §1).**

---

## 1. The decision gate (board-level — confirm before executing)

The strategic evaluation's central claim, backed by hard server-side data, is:

> **The product is mature; the business has ~zero traction. The binding constraint is distribution + trust, not engineering.** (0 real license activations, empty firm DB, 225 site visitors in 10 weeks ~all direct, 17 downloads of v3.2.0, 0 sales — verified server-side.)

Its recommendation is a **reorientation**: stop building net-new vision/firm/connector features; redirect build effort to *trust-as-a-surface + hallucination-hardening + finishing the email wedge*; fix the public-claim contradictions first; and hand-sell the first ~10 customers in one niche.

**This conflicts with the standing mandate** (`feedback_keepance_autonomous_vision`: "complete the 3.0 vision autonomously, take every recommendation"). Both cannot be the default. The evaluation explicitly flags this as **the one place to check in with Jameson**, and per the operating rules (escalate board-level strategy; never deploy without an explicit go) so do I.

**My recommendation was:** adopt the reorientation with a disciplined scope (reorient toward the traction-unblocking workstreams; pause net-new vision/firm/connector scope; keep only the engineering work that removes a trust blocker, protects a customer, or sharpens the wedge).

### ✅ DECISION (Jameson, 2026-06-17)
> **Complete the current vision FIRST; run the ENTIRE reorientation program AFTER it.** Lead niche when the reorientation begins: **litigation solo/small-firm.** The autonomous-vision mandate stays in force for now; the reorientation (WS1–WS6 + the GTM track) is **queued, not cancelled** — it runs as one block once the vision is complete.

**The state wrinkle this surfaces (per `docs/operations/2026-06-13-CURRENT-STATE.md`):** the vision is **already built and shipped as v3.2.0** (Waves 1–4 deployed 2026-06-12). The *only* remaining vision item is **VG-9 connectors (Clio/iManage/NetDocuments/Office add-ins), which are externally gated on vendor sandbox access** (Jameson's identity/signatures + the vendors' humans) — not buildable code right now, and exactly what the evaluation independently says to defer. So in practice "after the vision" means **"after the vendor-gated connectors land,"** which is outside our control. **This needs a bridging decision (see §8): start the reorientation now since there's no buildable vision work left, or hold it until connectors actually land.**

Nothing below ships to production without the explicit per-release go that already governs this repo.

---

## 2. The synthesis: where the two reviews converge and diverge

| Theme | Engineering review found | Strategic eval recommends | Verdict in this plan |
|---|---|---|---|
| **Claims contradict each other** | README 2 versions behind (pricing $49 one-time vs $468/yr); license screen still sells removed "Whiteboard"; CLAUDE.md self-contradicts | §5.1 Firm tier sells "DPA, trust center, SOC 2 readiness" (`pricing.ts:125`) it doesn't have; pricing/version/template-count drift; **enforce single source of truth** | **WS1 — top priority in BOTH. The spine of this plan.** |
| **Trust must be visible** | (n/a) | §5.2 confidentiality center + one-click "Confidentiality Report" artifact | **WS2** |
| **Hallucination is the malpractice risk** | (n/a) | §5.3 double down on cited recall; mark uncited claims; verify-against-source | **WS3** |
| **Email is the wedge** | (noted MarkdownPreview/mermaid residue near the editor) | §5.4 finish + foreground email; cross-provider; Phase 2 chat-over-mail with prompt-injection envelopes | **WS4** |
| **Adoption friction** | (n/a) | §5.5 turnkey/zero-config; §5.6 BYOK-frontier default | **WS5** |
| **No learning loop / stale pricing model** | (n/a) | §5.7 opt-in design-partner diagnostics; §5.8 solo-first pricing + rebuild financial model | **WS6** |
| **Engineering debt the reorg surfaced** | 163 silent-failure async ops; test suite has no type-safety net; `any`-ref breaks the React compiler in 8 places; architecture/dead-code/hygiene items | §6 "the reorg is refactoring, not customer value — finish and stop"; stop net-new building | **WS7 (bounded to customer-protection) + WS8 (defer the rest, explicitly)** |
| **Firm / connectors / vision** | reorg is done & sound; firm layer untouched | §6 STOP deepening firm tier + Wave 5 connectors until solo customers exist | **WS8 — parked** |

**The honest divergence:** my review, read on its own, would have me clean up ~15 engineering items. The strategic lens **demotes most of them**. That is the right call, and this plan applies it: the only engineering work that survives the reorientation is what protects a customer or unblocks the wedge. The rest is parked in WS8 with a one-line reason each — not abandoned, just not now.

---

## 3. The unified workstreams (prioritized)

Each workstream below names its source findings, concrete scope (with verified file paths), and the detailed implementation plan it should spawn (in `docs/superpowers/plans/`) once greenlit. **No production deploy without an explicit go.**

### WS1 — Truth & Trust Reconciliation `P0` · smallest effort, highest ROI in both reviews
**Why:** to a lawyer, inconsistency reads as unreliability — and Keepance sells trust. Every contradictory surface is bleeding the one thing the product is supposed to have. This is the rare task where "clean up the docs" and "make the product sellable" are the *same work*.

**Scope — one single-source-of-truth pass across every surface:**
- **In-app, buyer-facing (P0a):** `src/config/pricing.ts:125` Firm tier sells *"The assurance package: DPA, trust center, SOC 2 readiness"* — verified contradiction against `website/vs/jump.html`, `website/vs/cocounsel.html`, `website/security/index.html`, `website/vs/clio-duo.html`, `website/press-kit/comparison-matrix.html`, which all admit these don't exist yet. **Fix: relabel as explicit roadmap ("planned," not delivered) or remove.** (Eng review P0 #1 + Eval §5.1.)
- **In-app, buyer-facing (P0a):** the license-unlocks list shows removed **"Whiteboard"** to paying users — `src/features/settings/LicenseSettings.tsx:173` → `src/locales/en.json:159`. **Fix: reword + rename key.** (Eng review #1.)
- **Public website + README (P0b):** `README.md` is two major versions behind — pricing `$49/$129/$399 one-time` vs canonical `$468/$948/$1,548 per-seat/yr` (`pricing.ts`), "v1.5 latest" vs v3.2.0, "Markdown editor with wiki-links/backlinks" (removed) vs Word-native, links to a stale `docs/reference/ARCHITECTURE.md` ("# Business OS"). **Fix: rewrite for v3.2.0.** (Eng review #2.)
- **Template counts / version numbers (P0b):** the attorney-UX research already flagged 15-vs-18-vs-28 template-count drift and perpetual-vs-annual licensing drift across public docs (Eval §5.1). **Fix: reconcile to the real counts/values.**
- **Dev-facing (P0c, cheap):** `CLAUDE.md` self-contradictions (NO-sql.js vs a sql.js troubleshooting block; three documented test scripts that don't exist; ~31 dead paths; autosave line refs past end of file). **Fix: condense to point at `ARCHITECTURE.md`; delete the dead blocks.** (Eng review #3.)
- **The durable fix (P0d):** add a **single-source-of-truth guard** — a check (lint/test/CI) that asserts every price/tier/assurance/version/template-count surface reads from `pricing.ts` (and a small set of canonical constants), so this can't silently drift again. (Eval §5.1 "enforce single source of truth.") This is the highest-leverage *engineering* item in the whole plan because it makes the reconciliation permanent.

**Spawns:** `docs/superpowers/plans/2026-06-1X-truth-reconciliation.md`. **This is the no-regret workstream — valuable under any strategic choice; recommend starting it regardless of the §1 decision.**

### WS2 — Trust as a visible product surface `P0`
**Why:** the strongest ethics lines (Florida Bar Op. 24-1 = no client-consent burden; *U.S. v. Heppner* = no privilege waiver) are currently talking points. Turn them into something a prospect screenshots and a lawyer keeps in the client file. (Eval §5.2.)
**Scope:** elevate the existing egress indicator + printable Data Map into (a) an unmistakable in-app **"Where your data is" confidentiality center**, and (b) a **one-click "Confidentiality Report"** artifact ("this matter's AI ran locally / under your own key; nothing was disclosed to a third party"). No cloud competitor can credibly produce (b).
**Spawns:** `docs/superpowers/plans/2026-06-1X-confidentiality-surface.md`.

### WS3 — Hallucination hardening `P0`
**Why:** a confidently-wrong answer is a sanction risk (Mata v. Avianca); 17-33% legal-AI hallucination is the live malpractice fear. The product's defensibility hinges on never quietly hallucinating. (Eval §5.3.)
**Scope:** build on the existing "every answer cited" instinct — make citation-clicking frictionless; make **uncited / low-confidence assertions visually distinct** ("unverified" treatment); add a lightweight "verify against source" affordance.
**Spawns:** `docs/superpowers/plans/2026-06-1X-citation-hardening.md`.

### WS4 — Finish & foreground the email wedge `P1`
**Why:** broken Outlook search is the highest-frequency shared pain; the standalone-viability memo independently concluded the engine's only defensible home is exactly this (privacy-bound professional search). It is the daily-use beachhead. (Eval §5.4, §7.)
**Scope:** make "import your Outlook/Gmail/IMAP and actually find anything, with a citation" a **first-run, time-to-value moment**; lean into **cross-provider search** (one index over Gmail + Outlook + IMAP — no incumbent offers this); when Phase 2 "chat over mail" is built, **prompt-injection envelopes are non-negotiable** (email is attacker-controlled; Superhuman's zero-click exfiltration is the cautionary tale) and revisit the flagged residual (mail-index Tauri event passes a decrypted body to the renderer — document/limit the trust boundary).
**Spawns:** `docs/superpowers/plans/2026-06-1X-email-wedge-ttv.md` (uses existing `docs/strategy/2026-06-06-email-*.md`).

### WS5 — Turnkey setup & honest model strategy `P1`
**Why:** "local-first" invites the "IT burden" and "DIY is less secure" objections; and "nothing leaves the machine" is only literally true in local-model mode, which underperforms on legal work. (Eval §5.5, §5.6.)
**Scope:** one-click install → first value, hardened security defaults, zero config homework; make the **BYOK-direct frontier path the recommended default** (frontier quality + data only to the user's own provider, no Keepance server), and present local-model mode honestly as the "maximum-paranoia, accept-the-quality-tradeoff" option — never imply local-model is the main experience if it underperforms.
**Spawns:** `docs/superpowers/plans/2026-06-1X-turnkey-and-byok-default.md`.

### WS6 — Learning loop & pricing reality `P2`
**Why:** there is currently zero feedback loop (no telemetry by design — keep that), and the financial model is fiction (models retired one-time pricing). (Eval §5.7, §5.8.)
**Scope:** an **explicitly opt-in, user-visible design-partner diagnostic mode** so the first lawyers' real usage is learnable without breaking the no-telemetry promise; lead the pricing presentation **solo-first** (de-emphasize, don't remove, Firm until its claims are honest per WS1); **rebuild the financial model** around actual per-seat subscription pricing with a real CAC/LTV frame.
**Spawns:** `docs/superpowers/plans/2026-06-1X-design-partner-diagnostics.md` + a financial-model rebuild (Jameson + `~/financial/`).

### WS7 — Engineering health, bounded to customer-protection `P1` (scoped) 
**Why:** the strategic eval says stop refactoring — and I agree for *most* of my review. But two items aren't "clean code," they're "don't lose a lawyer's work / don't ship a bug to your first 10 customers," which is a trust issue. Keep only these:
- **The 163 silent-failure async operations** (47 floating + 116 misused promises; eng review #4). In a local-first app whose core promise is "never lose your work," a file-save or audit-write that fails silently is the worst possible bug for the first customers. **Triage the file-write / audit / save paths specifically** (not the ~600 style-only lint findings). Wire `lint` in as a non-blocking CI report, then ratchet.
- **The test suite's missing type-safety net** (eng review #5b) + **the `any`-typed `workspaceServiceRef`** that breaks the React compiler in 8 places (eng review #5). One typing change + a `tsconfig.test.json` closes a real bug-hiding gap behind the behavior-preserving claim the reorg leans on.
- **"Finish and stop" the reorg** (Eval §6): the genuinely cheap, safe, zero-risk closeouts only — dead `toggle-backlinks` shortcut, the orphan `platform/tools/filesystem.ts`, exec-bit chmod, branch/worktree hygiene (set default branch / prune 13 worktrees), lazy-load mermaid (#11). Batch into one cleanup commit; **do not** open new structural refactors.
**Spawns:** `docs/superpowers/plans/2026-06-1X-customer-safety-hardening.md`.

### WS8 — Explicitly parked (do NOT build now)
Each parked with its reason, so "not now" is a decision, not a gap:
- **Firm-tier depth** (more multi-user/SSO/vault/co-editing) — Eval §6: premature with zero solo customers + no assurance package.
- **Wave 5 connectors** (Clio / iManage / NetDocuments / Office add-ins) — vendor-gated, out of your control, not needed for the first 10. Keep the vendor *applications* warm (Jameson's), write no speculative integration code.
- **Net-new "vision" features** — Eval §3, gated on the §1 decision.
- **The rest of my engineering review** (the architecture refinements: guard-test relative-import gap, matterStore type cycle, `settings→email` relocation, single-importer platform folders, test-file naming drift, i18n orphan cleanup, stale comments) — this is precisely the "refactoring, not customer value" the eval says to stop. Park until there's slack; revisit post-traction. (Full list preserved in the engineering review doc, P2-P3.)

---

## 4. The GTM track (Jameson-led; product serves it)

"Address everything" includes the non-engineering half. The eval's path-to-traction is hand-sold, not self-serve. Product work above should *serve* this motion; these steps are Jameson's (I support with assets/automation where useful):

1. **Niche + one job-to-be-done — DECIDED: litigation solo/small-firm.** Job-to-be-done: "find any email/doc across a matter, with a citation you can click." Build WS2-WS4's demo around exactly that one job. (The **CPA / IRC §7216** angle is held in reserve as the §6 kill-criterion pivot, not run in parallel.)
2. **Manufacture credibility** — pitch Bob Ambrogi/LawSites + Lawyerist; apply to **ABA TECHSHOW Startup Alley** (free); legal podcasts; a bar CLE; own the empty "private by architecture, not by promise" lane.
3. **Recruit 3-5 design-partner lawyers** (free pilots → testimonials → the references firms require). WS6's diagnostics serve this.
4. **Founder-led 10-20 min demos on the prospect's own matter** — sell ~70% outcome, ~30% architecture; anchor on Florida 24-1 + Heppner; pre-empt the four objections (quality→BYOK-frontier, IT→turnkey, DIY-less-secure→hardened defaults + SOC 2 roadmap, no-cert→verifiability). WS2-WS5 make this land.
5. **Be listed where they verify** — free profiles on Clio App Directory, Capterra, G2, Software Advice. Defer paid PPC.
6. **Rebuild the financial model** (WS6) around real pricing + a real CAC sense from steps 2-4.

---

## 5. Sequencing (per the 2026-06-17 decision: vision first, then the reorientation as one block)

- **Phase 0 — Complete the current vision (NOW, per decision).** Status: the vision is **shipped as v3.2.0**; the only open vision wave is **VG-9 connectors, vendor-gated** (`docs/strategy/2026-06-10-vision-gap-closure-plan.md`, `docs/operations/2026-06-10-vendor-access-track.md`). There is **no substantial buildable vision code left for the build session** — VG-9 unblocks only when Jameson's vendor relationships (Clio dev-partnership, iManage discovery call, NetDocuments, MS Partner Center) grant sandbox access. So Phase 0 is mostly **waiting on vendors + Jameson-owned proof-moat/spot-check items**, not engineering. ⇒ see the **§8 bridging decision.**
- **Phase 1 — Truth & Trust Reconciliation:** WS1 — the no-regret block; the natural first move the moment the reorientation starts (and the one piece arguably worth pulling into Phase 0 — see §8).
- **Phase 2 — The trust product:** WS2 + WS3 — demo-able trust surface + hallucination hardening, built around the **litigation solo/small-firm** niche.
- **Phase 3 — The wedge:** WS4 + WS5 — email time-to-value + turnkey/BYOK-frontier default.
- **Phase 4 — Learn & price:** WS6 — design-partner diagnostics + rebuilt financial model, feeding the GTM loop (§4).
- **Continuous (within the reorientation):** WS7 customer-safety items fold in as each surface is hardened.
- **Parked:** WS8 — revisit only post-traction or on explicit instruction.

## 6. The kill-criterion (the eval insists on one; don't leave it implicit)

Commit to a **fixed window of disciplined hand-selling to the chosen ICP** (Jameson sets the window). **If it yields no paying customers and no design-partner testimonials, the thesis "litigators will pay for local-first" is likely wrong** → the live options are to pivot the wedge (CPA/§7216) or accept Keepance as a solo/lifestyle product. Define the window + the bar explicitly so "keep building" can't be the escape hatch.

## 7. What changes vs. the current operating contract

- `KEEPANCE_BUSINESS_PLAN.md` is the operating contract **but its financial model is stale** (retired one-time pricing, $10K-MRR target, no CAC/LTV). WS6 rebuilds it; until then, don't steer by it.
- `feedback_keepance_autonomous_vision` ("complete the vision, take every recommendation") **stays in force** per the 2026-06-17 decision — the reorientation is queued *after* the vision, not in place of it. (When the reorientation block begins, that mandate is then read as "take every *traction-unblocking* recommendation" for its duration.)
- The "no production deploy without explicit go" rule is **unchanged and still binding** for every workstream here.

## 8. The bridging decision (open — created by the 2026-06-17 decision meeting reality)

The decision is "vision first, reorientation after." But the vision is already shipped and its only remaining piece (VG-9 connectors) is vendor-gated and unbuildable now. So there is a gap to resolve — **what does the build session do between now and "connectors land"?** Three honest options:

- **(A) Recommended — start the reorientation now.** Since there is no buildable vision work left (connectors wait on vendors, which the evaluation says to defer anyway), treat the vision as complete-enough and begin Phase 1 (WS1 truth reconciliation) now. This honors "vision first" (it *is* done) without idling on a vendor dependency we don't control.
- **(B) Pull only WS1 forward; otherwise hold.** Do just the no-regret truth/credibility reconciliation now (it includes a **live customer-facing bug** — the removed "Whiteboard" shown to paying users — and the **false SOC 2/DPA Firm-tier claim**, both actively bleeding trust), and hold WS2–WS6 until connectors land.
- **(C) Strict hold.** Wait for VG-9 connectors to fully land before any reorientation work. Risk: indefinite (vendor-paced), build session idle, and the two live credibility defects in WS1 persist in production meanwhile.

**My recommendation: (A), or at minimum (B).** Pure-(C) leaves a known customer-facing bug and a self-contradicting paid-tier claim live for an unbounded, vendor-dependent stretch.

## 9. Board-level decisions

- ✅ **Reorientation timing** (§1) — **DECIDED:** complete the current vision first, then run the entire reorientation as one block.
- ✅ **Lead niche** (§4.1) — **DECIDED:** litigation solo/small-firm.
- ⏳ **The bridging decision** (§8) — **OPEN:** given the vision is already shipped and only vendor-gated connectors remain, does the build session start the reorientation now (A), pull only WS1 forward (B), or strict-hold (C)? *(Recommend A or B.)*
- ⏳ **The kill-criterion window** (§6) — **OPEN, for when the GTM motion starts:** how long a disciplined sell-first window to the litigation ICP before re-deciding (pivot to CPA/§7216 vs accept lifestyle scale)?

---

## Source documents
- Engineering review: `docs/operations/2026-06-17-reorg-fresh-eyes-review.md`
- Strategic handoff + product recs: `docs/strategy/2026-06-17-build-session-handoff-and-product-recommendations.md`
- Full evaluation: `docs/strategy/2026-06-17-keepance-evaluation-path-to-traction.md`
- Email-as-product viability: `docs/strategy/2026-06-17-email-search-standalone-viability.md`
- Trust-contradiction evidence (verified): `src/config/pricing.ts:125`, `website/vs/`, `website/security/`, `website/press-kit/comparison-matrix.html`

*Compiled 2026-06-17 by the Keepance build session (Claude, Opus 4.8). The engineering findings are verified against artifacts; the strategic findings are the separate evaluation's, integrated here under the reorientation lens. This master plan needs Jameson's §9 decisions before execution; each workstream then spawns its own detailed implementation plan in `docs/superpowers/plans/`.*
