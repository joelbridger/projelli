**Audience:** the Claude Code instance building Keepance. **Goal:** re-aim Keepance from law firms (organizing unit = a legal *matter*) to financial advisors (organizing unit = a *client / household*) as fast and safely as possible, across product, website, messaging, copy, value proposition, pricing, and positioning. This brief is built from a full read of the codebase (`~/keepance`, branch `keepance-3.0`), the website (`~/keepance-wt-website`), the strategy/ops docs, an independent Codex code audit, and fresh market/competitor research.

## 0. The headline — read this first

**This is a continuation of the existing roadmap, not a rebuild or a U-turn.** Three facts dominate everything below:

1. **The advisor product is already ~70% designed-in.** Keepance already has: an `advisor` profession value wired through much of the code; a shipped **7-template Advisor Practice Pack** (Reg BI, Reg S-P, Client Financial-Plan Summary, Annual-Review Packet, Meeting-Prep/Suitability, Books-&-Records, Confidential-Data Inventory); a well-built `/financial-advisors/` website page; a deep advisor regulatory research doc (`docs/strategy/VERTICAL_FINANCIAL_ADVISORS_2026-06.md`); a label helper (`useEntityLabel.ts`) that *already* maps `advisor → "client"`; and a **Client Map** feature deliberately architected as "unit-agnostic" with **"household" named as the planned advisor unit** ("the same model at different zoom"). Journey Beyond Wealth (the design partner) is already named in the docs.

2. **The engine is domain-generic and should be reused wholesale.** The hard parts — local-first file storage, the RAG/citation engine, the encrypted vault, the in-house `.docx` engine, live co-editing, SSO/seats, email connectors — are not legal-specific. The re-aim does **not** touch them.

3. **The single most important engineering directive (from the Codex audit): DO NOT rename `matter` / `matter_id` in storage, RAG, or the backend.** That identifier is the **security isolation key** — the Rust RAG layer hard-filters retrieval by `matter_id` so one client's data can never leak into another's chat. A deep internal rename would ripple through privacy boundaries, citation verification, firm sync, MCP permissions, and on-disk saved data (`keepance:matters`), creating many chances for data-leak bugs. **Instead: keep `matter` internally; add a user-facing "Client / Household" label facade.** Re-aim the *experience*, not the *engine*.

The genuinely hard problem remains what it has always been: **distribution.** Keepance has ~zero traction (0 paying customers, ~225 site visitors in 10 weeks). The re-aim removes the biggest distribution blocker — there is now a warm, real design partner and a validated pain signal in financial advice (vs. an unvalidated law ICP) — but the build work below is the easy 30%; hand-selling the first 10 advisors is the 70%.

---

## 1. Where Keepance stands today

**Product (deep, mature, mostly built, latest unshipped).** A local-first desktop app: **Tauri 2** (Rust core `keepance_lib`) wrapping **React 18 + TypeScript + Vite 6** (Zustand, shadcn/Radix/Tailwind, TipTap for Word-native editing, CodeMirror for plain text). Documents live as real files in a user-chosen workspace folder (no cloud content DB). On top: a **RAG layer** (LanceDB 0.21, local `e5-small` 384-dim embeddings via fastembed-rs, tesseract OCR, chunks encrypted at rest, tagged by `matter_id`) that answers questions with **verifiable citations**; an **encrypted vault** (in-house `keepance-vault` crate, AES-256-GCM, BIP39 recovery, firm escrow); an **in-house OOXML engine** (`keepance-docx`) with tracked changes + AI redline; **live multi-user `.docx` co-editing** (Yjs CRDT over an end-to-end-encrypted relay); **email connectors** (M365/Graph, Gmail, IMAP); a **Firm tier** (org/seats/roles, OIDC SSO, Ed25519 seat tokens, ECDH-P256 device keys, ethical walls by key-denial); BYOK AI (Claude/OpenAI/Gemini/local Ollama) where calls go straight from the user's machine to the provider. Backend is **Bun + SQLite/Postgres** at `api.keepance.com` that **never sees plaintext content or keys**. Distributed as signed installers (Win/macOS/Linux) with auto-update.

**Commercial reality: ~zero traction.** The 2026-06-17 evaluation read server ground truth: **0 paying customers, 0 real activations, empty firm DB, ~225 unique visitors in 10 weeks, ~5 "Buy" clicks, 0 sales.** The binding constraint is **distribution**, not engineering. Compounding it: a trust/proof gap (no references, no entity beyond sole proprietor, no DPA/SOC 2) and some self-contradicting public copy.

**The repositioning already underway.** In June 2026 Keepance was repositioned from "private AI search for professionals" to **"private AI that actually knows your clients,"** embodied by the **Client Map** (a living, source-linked, auto-built profile per client). Client Map v1 is **built, merged, gate-green, Codex-reviewed as ship-ready — but not deployed** (no build cut; that is Jameson's explicit call). Crucially, its spec **explicitly anticipates the advisor pivot**: "For lawyers the unit is the 'matter'; for advisors it is the 'household.'"

**Pricing (exact, `src/config/pricing.ts`):** Solo `$39/mo` = **$468/yr**; Professional `$79/mo` = **$948/yr** (featured); Firm `$129/seat/mo` = **$1,548/seat/yr**, 3-seat minimum. 30-day no-card trial. A "FOUNDING" 30%-off-for-life code is promoted. BYOK inference is the customer's own ~$5–15/mo (or $0 with local Ollama), never marked up.

**Constraints / landmines (these gate how fast a re-aim ships):**
- **No autonomous deploy** — Keepance is commercial; no build cut or production deploy without Jameson's explicit go. Last *published* build is **v3.3.0**; everything since (wedge, Client Map v1) is in source, unshipped.
- **Windows build gotcha** — the Tauri Windows build breaks on a Unix-only prebuild step; only real Windows CI catches it; a signed build runs ~60–90 min. Real-OS smoke testing is the AI's job (Legion Windows laptop on Tailscale).
- **Core-app rule: no shortcuts** — the product itself must be robust + correct (TDD + Codex review), not quick-patched.
- **Honesty guardrails (some test-enforced)** — never claim "compliant/guaranteed"; state the local-only vs BYOK-cloud distinction precisely; advisor regulatory claims must pass a securities-compliance review before going on a page (live SEC "AI-washing" enforcement risk). No em dashes in user-facing strings.
- **Memory-tight server** — one Rust/cargo compile at a time; don't run cargo + full vitest together.

---

## 2. The target user: financial advisors

**Who:** solo and small RIAs / independent advisors (the segment with real software budgets — $6–12k/yr/advisor — and where the warm access exists). Wealth management, financial planning, CFP-style practices.

**Their day (time allocation):** ~20% in client meetings, **~45% behind-the-scenes (analysis + meeting prep + plan development)**, ~35% business development/admin. Most of the value Keepance can add is in that 45% prep/analysis block and the post-meeting admin.

**The client-meeting lifecycle** (Keepance's natural surface):
- **Before:** pull together everything known about the client/household — prior meetings, goals, accounts, life events, open items — to prepare. (This is exactly the **Client Map** + matter-at-a-glance.)
- **During:** take notes. (Keepance is *not* a meeting recorder — see §3; this is deliberately out of its lane.)
- **After:** summarize, draft follow-up emails/letters, log to the CRM, create tasks, and **document the basis for recommendations** (Reg BI/suitability) for the file.

**The tech stack they live in (Keepance must complement, not replace):**
- **CRM = the compliance hub:** Redtail (market-share leader), Wealthbox (fastest-growing, cleanest UX), Salesforce Financial Services Cloud. This is where comms/notes/tasks are logged and supervised.
- **Financial planning:** eMoney (deepest cash-flow modeling + best client portal), MoneyGuidePro (goal-based, "Play Zone"), RightCapital.
- **Portfolio/performance:** Orion, Black Diamond, Tamarac; risk: Nitrogen/Riskalyze.
- **Custodians:** Schwab, Fidelity, Pershing.

**Data advisors handle:** nonpublic personal information (NPI), account statements, financial plans, meeting notes, client correspondence, KYC/suitability profiles, estate documents, beneficiary info. All confidential, all "household-scoped."

**Their compliance frame (this replaces the legal "privilege" frame):**
- **Reg S-P (amended 2024; small-RIA safeguards deadline passed June 3, 2026):** advisers must safeguard NPI and **oversee every vendor that touches client data.** ← **Keepance's local-first, no-vendor-server, BYOK architecture is a direct answer to vendor-oversight** (there is no Keepance server in the data path). This is the single strongest positioning lever.
- **Books-and-records (17 CFR 275.204-2):** retain records (incl. AI-generated material, prompts/outputs) for 5 years; first 2 readily accessible. ← Keepance's local files + audit log map onto this.
- **Reg BI / suitability:** document the *basis* for each recommendation and how it serves the client's best interest. ← a natural Keepance drafting/at-a-glance output.
- **Marketing Rule + "AI-washing" enforcement:** the SEC is actively penalizing overstated AI claims. ← reinforces the honesty guardrail; never say "compliant/guaranteed."
- Advisors carry **E&O** (errors & omissions) insurance, not "malpractice"; their compliance owner is a **CCO**.

---

## 3. Competition & positioning

**The field is hot and well-funded, but it is a different category from Keepance.** The advisor-AI leaders — **Jump (~$80M raised, claims ~1 in 10 US advisors), Zocks (~$45M, privacy-first, "no recordings ever," fills CRM fields/intake forms/meeting-prep docs), Zeplyn (E2EE, recording-free, PII protection)**, plus Mili and CogniCor — have rebranded as **"agentic operating systems" that sit above the CRM and automate meeting admin.** Jump + Zocks alone have raised >$170M.

**The gap Keepance fills (and how to position against them):**
- They are **cloud, integration-heavy, meeting-capture-centric.** Keepance is **local-first, document/email-context-centric, and a Word-native drafting surface.** Keepance is **not** a meeting notetaker — and should not try to become one. It is **the private place all of a client's context lives and answers you back**, complementary to (not competing with) a Jump/Zocks notetaker.
- **Defensible wedge:** true local-first / no-vendor-server (the cleanest Reg S-P vendor-oversight story) + BYOK + the **depth of the Client Map** (the whole relationship, not just the last meeting) + verifiable citations. Caveat to stay honest: "privacy" is now contested (Zocks/Zeplyn also claim privacy-first), so lead with **local-first + the client-intelligence depth**, not "we're private" alone.
- **Honest positioning ratio:** pitch ~70% outcome ("walk into every meeting already knowing the household; draft the follow-up and the Reg BI note in minutes"), ~30% architecture ("and it never leaves your machine"). The brand's radical-honesty voice (every comparison page admits where a competitor is the better choice) should be preserved.

---

## 4. The legal → advisor mapping

### 4a. The core strategy: a label facade, not a rename
Keep the internal model. Surface a new vocabulary. Codex's audit confirms `useEntityLabel.ts` **already** maps `advisor → "client"`; extend that pattern everywhere user-visible. Internally, `Matter` stays `Matter` and `matter_id` stays the isolation key. A "household" is simply one `Matter` (one confidentiality boundary) whose `client` field holds the household and whose folders/mail hold its documents and correspondence.

### 4b. Terminology map (user-facing only)
| Legal (today) | Advisor (target) |
|---|---|
| Matter | **Client** / **Household** |
| Matter Manager | **Client Records** / **Client Manager** |
| `client` field | the household / primary contact |
| Privileged matter / "attorney-client / work-product" | **Sensitive client mode / network lockdown**; confidentiality = **Reg S-P–safeguarded NPI** |
| Ethical wall | **Information barrier / client-access restriction** |
| Opposing counsel, court, discovery, deposition, testimony, transcript | *(no analog — drop/hide)* |
| Malpractice carrier | **E&O carrier** |
| Engagement letter (ABA 512) | **Advisory agreement / Form ADV / Reg BI disclosure** |
| "Associate" (workflows) | advisor-appropriate name (e.g. "Assistant"); de-emphasize legal "associate" framing |
| Bar counsel | **CCO / compliance counsel** |

### 4c. Domain-model changes (minimal for v1)
- **Keep** `Matter {id, name, client, folderPaths, mailFolderPaths, ...}` and the Rust `chunks.matter_id` hard filter **unchanged**.
- **Add** `advisor` to the backend/shared `ProfessionPack` enum (currently `legal | tax | consulting`) — `backend/src/contract.ts`, `backend/src/lib/types.ts`, `src/platform/firm/contract.ts` — and stop defaulting LemonSqueezy firm provisioning to `["legal"]` (`backend/src/routes/webhooks.ts`).
- **Later (Phase 2, optional):** add display-only household fields (`householdName`, `primaryContact`, `members[]`, `externalClientId`, `clientStatus`) as additive fields — **never rename existing keys** (`keepance:matters` etc.); add compatibility, don't migrate-destructively.
- **Privilege → sensitivity:** short-term relabel the UI; medium-term, if desired, introduce a generic sensitivity classification. **Do this as an isolated workstream** because it touches both TypeScript and Rust RAG validation (`PRIVILEGE_*` constants, non-null `privilege` chunk column).

### 4d. Client Map → advisor (the centerpiece)
Structurally unchanged (sections + items + sources + Context Completeness + Guided Interview + approve-first). What changes: the **generator prompts and section search terms** (`src/platform/clientMap/generator.ts:49,60`) currently say *"private legal assistant"* and search for *judges / opposing counsel / hearings / court dates* — **rewrite to advisor content**: household members & key people, goals & priorities, accounts/assets/liabilities (high level), risk tolerance, life events, prior advice given, open items, upcoming reviews, next actions. Section titles ("the story so far / key people / where things stand / what's coming / next actions") are already neutral and can stay.

---

## 5. The reuse / relabel / change / drop master table

| Area (path) | Verdict |
|---|---|
| Tauri/React shell, FS backends, editors, file tree, search, audit log | **Reuse as-is** |
| RAG (LanceDB + e5 + OCR + encrypted chunks, `commands/rag/`) incl. `matter_id` hard filter | **Reuse as-is — do not rename `matter_id`** |
| Encrypted vault (`keepance-vault`, BIP39, escrow) | **Reuse as-is** |
| `.docx` engine + tracked changes + clean-copy (`keepance-docx`) | **Reuse as-is** |
| Live co-editing CRDT + E2EE relay | **Reuse as-is** |
| Firm tier: org/seats/roles, SSO/OIDC, device keys, key-wrap | **Reuse as-is** (relabel "ethical wall" → "information barrier") |
| `Matter` entity + mail-folder mapping | **Reuse as-is**, surface as "Client/Household" via facade |
| Email connectors (M365/Gmail/IMAP) | **Reuse as-is** |
| `advisor` profession value, `useEntityLabel` (advisor→client), `prioritizeByProfession`, Advisor Practice Pack (7 templates, `templates/advisors/`) | **Reuse — already advisor-ready** |
| Client Map structure | **Reuse; rewrite prompts + section queries** (`generator.ts`) |
| Matter-at-a-glance (`matterAtAGlance.ts`) | **Reuse; reword prompt** ("legal assistant/attorney" → advisor) |
| `professionStore` default `'legal'`; `isLawExperience()` gating; `FirstRunWizard` (hides advisor) | **Relabel/retarget** — default to advisor, surface advisor onboarding |
| Pricing `audience` strings + legal feature bullets (`config/pricing.ts`) | **Relabel** — attorney/litigator → advisor/RIA |
| Locale `matter.*`, "ethical walls/lawfirm", "first lawyers" (`locales/en.json` + es/de) | **Relabel** — neutralize to client/household + advisor terms |
| Global Word AI-redline prompt "legal editing associate" (`documents/docx/redline.ts`) | **Relabel** — profession-neutral / advisor-aware (affects *every* .docx AI edit) |
| Privilege/work-product system (TS + Rust + backend labels) | **Isolated change** — relabel now; redesign to generic sensitivity later |
| Contradiction-across-testimony pipeline (`workflows/engine/legalAnalysis.ts`, `serializeContradictionsDocx`, `transcript` source type, "Tr. line:col") | **Drop/hide for advisors** (no analog) |
| 19 legal templates (`templates/legal/`: depositions, discovery, Bluebook, SOL calendar, ABA-512 engagement letter, etc.) | **Drop/hide for advisors**; feature the advisor pack instead |
| Sample matter "Garcia v. Meridian" + legal demo Q&A + legal sample `.md` (`samples/sampleMatterDemo.ts`, `matterStore.ts:57`) | **Build advisor replacement** (household/portfolio sample + demo answers + starter questions) |
| Backend `ProfessionPack` (no `advisor`); LemonSqueezy default `["legal"]` (`webhooks.ts`) | **Schema/config change** — add `advisor` |
| Website: `/legal/`, press-kit "law practice" one-liner, `/vs/cocounsel`, `/vs/clio-duo`, Heppner/ABA blog, legal-malpractice one-pager | **Demote/retire from the advisor funnel** |
| Website: `/financial-advisors/`, `/one-pagers/advisor-cco-reg-sp`, `reg-s-p-changed-your-ai-vendor-list` blog, `/vs/jump` | **Promote to front-and-center — already advisor-correct** |
| Brand palette/type/logo/OG cards | **Reuse as-is** (only swap the attorney hero photography + legal example microcopy) |

---

## 6. Surface-by-surface re-aim plan

**6a. Product.** Flip `professionStore` default to `advisor`; surface advisor as the lead (or only) onboarding choice (`FirstRunWizard`); replace `isLawExperience()` gating logic with advisor-first gating; extend `useEntityLabel`/facade so all visible "matter" → "client/household"; rewrite Client Map + at-a-glance + global redline prompts to advisor-neutral; feature the Advisor Practice Pack and hide the legal pack + contradiction pipeline for advisors; build an advisor sample workspace + demo answers + starter questions; add `advisor` to backend packs. **Do not rename internal `matter`/`matter_id` or storage keys.**

**6b. Website (`~/keepance-wt-website`).** The homepage hero ("Secure client intelligence for high-trust work") is already vertical-neutral and can stay. Make **Advisors the lead vertical**: reorder nav (Advisors first, or advisors-only), swap the attorney hero photography (`keepance-attorney*.png`) and legal example microcopy, repoint the "Where Keepance fits" comparison row from "Legal research AI" to "Planning software / CRM AI (eMoney, MoneyGuidePro, Jump)." Promote `/financial-advisors/`, the Reg S-P blog post, the advisor one-pager, and `/vs/jump`. Demote/retire `/legal/`, `/vs/cocounsel`, `/vs/clio-duo`, the Heppner/ABA blog, and the legal-malpractice one-pager from the advisor funnel (keep them reachable but off the main path). **Fix the press-kit one-liner** — change "the private intelligence layer for a **law practice**" (it appears verbatim in the 1-line/1-para/long-form journalists copy) to an advisor-first or profession-neutral line.

**6c. Messaging / value proposition.** Collapse the two competing positionings (the neutral homepage line vs. the press-kit "law practice" line) onto one advisor-first statement. Recommended spine: *"The private client-intelligence layer for a financial-advisory practice — every household's full context, on your own machine, answering you with cited facts."* Keep the radical-honesty voice and the "70% outcome / 30% architecture" balance.

**6d. Pricing.** Tiers and prices stay; relabel the `audience` strings (single attorney → single advisor; small-firm litigator → small RIA/advisory team; "5–50 attorneys" → "advisory firms"); make the **Advisor Practice Pack** the included pack; fix the homepage-vs-vertical inconsistency ("all practice packs" vs "one practice pack").

**6e. Compliance / trust.** Lead with the **Reg S-P vendor-oversight** story (local-first = no vendor in the data path). Reuse the existing advisor Reg S-P one-pager (forwardable to a CCO). Keep books-and-records retention messaging. Maintain honesty guardrails (no "compliant/guaranteed"; the advisor regulatory page must pass a securities-compliance review before publish). Address the standing trust gap (entity, E&O, "no SOC 2 / no signed DPA" stated honestly) as part of distribution, not the build.

---

## 7. Risks & mitigations (from the Codex audit)

1. **Deep `matter`→`client` rename too early (highest risk).** It touches privacy boundaries, RAG filters, citation checks, firm sync, MCP permissions, and saved data → data-leak bugs. **Mitigation: facade only; never rename the internal identifier or storage keys.**
2. **Local data migration.** Renaming `keepance:matters`-style keys would orphan users' data. **Mitigation: additive compatibility fields, no destructive migration.**
3. **RAG security regression.** Retrieval is safe *because* Rust hard-filters by `matter_id`. **Mitigation: any new "client" layer must preserve that filter; add a test asserting cross-client isolation.**
4. **Legal prompts leaking into advisor answers.** Client Map/at-a-glance/redline prompts currently say "legal assistant" and search for court terms. **Mitigation: rewrite all profession-coupled prompts before any advisor demo or screenshot.**
5. **Partial advisor support.** `advisor` exists in some code but not onboarding, samples, backend packs, or demo answers. **Mitigation: the workstreams below close every gap; track with a checklist.**
6. **"Privilege" language.** Advisors have NPI/Reg S-P/suitability, not attorney-client privilege. **Mitigation: relabel now; isolate any deeper sensitivity-model change (Rust + TS) into its own workstream.**
7. **Windows release validation.** Even text/UI/schema work ships in a desktop app where keychain, vault, mail, WebView2, and signing differ from browser dev. **Mitigation: real-Windows smoke before any build cut; remember the ~60–90 min signed-build path and the no-autonomous-deploy gate.**

---

## 8. Parallel workstreams + ship plan

Eight largely-independent streams (dependencies noted). They are sized for parallel agents; pair build-heavy streams with Codex review per the core-app no-shortcuts rule.

| # | Workstream | Scope | Depends on |
|---|---|---|---|
| **WS1** | **Domain facade** | Keep `Matter`/`matter_id`; expose a "Client/Household" label layer via selectors/helpers (extend `useEntityLabel`). Establishes the vocabulary. | none (foundational) |
| **WS2** | **Onboarding + sample data** | Default profession = advisor; advisor as lead onboarding choice; build advisor sample workspace, demo answers, starter questions (replace "Garcia v. Meridian"). | none (align names w/ WS1) |
| **WS3** | **UI relabel pass** | Replace visible "matter" across nav, manager dialogs, email filing, search scopes, Client Map, settings, `locales/*.json`. | WS1 vocabulary |
| **WS4** | **Client Map advisor rewrite** | Rewrite generator prompts + section queries to household/planning/goals/risk/reviews/next-actions; reword at-a-glance + global redline prompts. | none (align w/ WS1) |
| **WS5** | **Advisor workflow positioning** | Make the Advisor Practice Pack first-class (featured workflow, category order, names, outputs, empty states); hide legal pack + contradiction pipeline for advisors. | none |
| **WS6** | **Backend packs + entitlements** | Add `advisor` to `ProfessionPack` (shared + backend), provisioning (`webhooks.ts` default), update backend tests/contracts. | pricing/pack decision |
| **WS7** | **Privacy/sensitivity language** | Relabel "privileged" UI now; optionally introduce generic sensitivity values later (touches Rust/RAG validation — keep isolated). | none (isolated) |
| **WS8** | **Public site + pricing pivot** | Advisor-first nav/hero/imagery; promote advisor pages; demote legal pages; fix press-kit one-liner; relabel pricing audience; update marketing/board docs. Regulatory copy gated on securities review. | positioning decision |

**Dependency graph:** WS1 is the only true prerequisite (feeds WS3). WS2, WS4, WS5, WS6, WS7, WS8 can all start immediately and run in parallel. WS8 (website) is fully decoupled from the product code and can be a separate track entirely.

**Recommended 2-phase ship plan (Codex):**
- **Phase 1 — advisor-facing pivot with NO deep internal renames:** default to advisor; show Clients/Households via the facade; fix samples + demo; rewrite Client Map/at-a-glance/redline prompts; feature advisor workflows; add backend `advisor` pack; update pricing + site copy. This gets a shippable advisor product fast while keeping the privacy model stable.
- **Phase 2 — clean internals later:** optional route aliases / `ClientRecord` types, richer additive household fields, generic sensitivity model replacing legal "privilege," and (only if a launch customer needs it) connectors (Redtail/Wealthbox/custodians/planning tools — defer otherwise).

**Gate:** nothing publishes without (a) real-Windows smoke, (b) a securities-compliance review of any regulatory page, and (c) Jameson's explicit go for the signed build / deploy.

---

## 9. Concrete first moves for the builder (file-path checklist)

1. **WS1 facade:** extend `src/platform/hooks/useEntityLabel.ts` (already maps advisor→"client") into the single source of truth for the unit label; route nav/manager/Client Map/search UI through it.
2. **WS2 default + onboarding:** flip default in `src/platform/profile/professionStore.ts` (`'legal'` → `'advisor'`); surface advisor in `src/features/onboarding/FirstRunWizard.tsx` (currently hides it); build advisor sample in `src/platform/matter/samples/sampleMatterDemo.ts` + `matterStore.ts:57` (replace "Garcia v. Meridian").
3. **WS4 prompts:** rewrite `src/platform/clientMap/generator.ts:49,60` (legal search terms + "legal assistant" prompt); reword `matterAtAGlance.ts` and the global `src/features/documents/docx/redline.ts` "legal editing associate" prompt.
4. **WS5 templates:** feature `src/features/workflows/engine/templates/advisors/`; gate out `templates/legal/` + `workflows/engine/legalAnalysis.ts` for advisors in `WorkflowPanel.tsx`/`AssociateHome.tsx`.
5. **WS6 backend:** add `advisor` to `ProfessionPack` in `backend/src/contract.ts`, `backend/src/lib/types.ts`, `src/platform/firm/contract.ts`; fix default in `backend/src/routes/webhooks.ts`.
6. **WS3/WS8 copy:** sweep `src/locales/{en,es,de}.json` (`matter.*`, "ethical walls", "first lawyers"); relabel `src/config/pricing.ts` audience strings; advisor-first the website in `~/keepance-wt-website` (nav order, hero imagery, press-kit one-liner, promote/demote pages).
7. **Add a test** asserting RAG cross-client isolation still holds after the facade (guards Risk #3).

---

## 10. Open decisions for Jameson

1. **Multi-vertical or advisor-only?** The site is currently multi-vertical (attorneys/advisors/CPAs/consultants). Recommend going **advisor-first and near-exclusive** for focus (you only need ~100 advisor customers), while leaving legal/tax pages reachable but off the main funnel. Confirm you want to fully lead with advisors rather than keep equal verticals.
2. **"Household" vs "Client" as the primary noun.** Recommend **"Client"** as the everyday label with "household" available where a client is a family unit. Your call on the dominant word.
3. **Meeting notes — in or out of scope?** Recommend **out** (stay the context/drafting layer, complementary to Jump/Zocks) for v1. Confirm.
4. **Privilege relabel depth for Phase 1** — relabel-only now (recommended) vs. build the generic sensitivity model immediately.
5. **Connectors (Redtail/Wealthbox/custodians)** — recommend **defer** unless the first design-partner advisor needs one to say yes.
