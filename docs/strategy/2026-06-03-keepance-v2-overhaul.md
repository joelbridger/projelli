# Keepance V2 Overhaul Proposal

> **For Jameson:** this is a proposal to read and approve, not code to run. It is written in plain language with the technical detail tucked into clearly marked *Implementation notes* so a future engineer (or a Claude session) can execute it. Nothing here ships until you give the word.

> **For agentic workers:** this is a program-level proposal spanning multiple independent subsystems. Per the `superpowers:writing-plans` scope check, each workstream below becomes its own bite-sized, test-driven execution plan under `docs/superpowers/plans/YYYY-MM-DD-<workstream>.md` at the time it is greenlit. Do not execute directly from this document; generate the per-workstream plan first.

**Goal:** Close the gap between who Keepance is *for* (sophisticated, non-technical professionals bound by confidentiality) and how Keepance currently *feels* (a developer-grade tool), so that a named reviewer can land on the site, install the app, reach real value, and produce a real deliverable without hitting a wall.

**Source of findings:** [Vertical Persona Audit, 2026-06-03](./2026-06-03-vertical-persona-audit.md). Every fix in this proposal traces back to a numbered finding there; the [traceability matrix](#appendix-traceability-matrix) at the end proves full coverage.

**The one-line strategy:** *Finish translating the product you already have into the language your customer actually speaks.* The audit confirmed that most complaints are communication gaps and unsurfaced capability, not missing capability. That makes this overhaul unusually high-leverage for its size.

---

## Decisions locked (2026-06-03)

Jameson reviewed the audit and made three calls that govern everything below. They supersede the "Resolved strategic decisions" notes later in this document.

1. **BYOK stays. No managed key, ever.** Onboarding friction is solved inside BYOK (Workstream B), never by holding keys. The privacy wedge is non-negotiable.
2. **Build the advisor pack.** Advisors are a serious vertical in their own right, not a fast-follow. The Advisor Practice Pack is now a committed build (Workstream H, Advisors), grounded in Regulation S-P (the amended safeguards and breach-notification rules) and fiduciary confidentiality duties, matching the depth of the legal and tax packs.
3. **Nothing goes to market until the entire overhaul is done to a "perfect" bar.** No reviewer outreach, no cold drafts, no launch of any kind until every workstream here is complete and verified. This document is the definition of done. Reviewer-draft approval is paused until then, and is not to be raised again as a priority until the work is finished.

**Context that sharpens the bar:** Keepance has zero users today. There is no installed base to protect and no migration risk, so we have full freedom to change anything. It also means every future user is a first-time user, so the website and the first-run experience have to be right for everyone, not just forgiving early adopters. "Advisors can use the core app today" is therefore not a real position: nobody is using it, and without the pack it is not a complete advisor solution. That is why we are building the pack.

---

## Guiding principles for V2

1. **Lower the floor before raising the ceiling.** A non-technical solo professional must reach first value without knowing what Markdown or an API key is. Onboarding and output come before new features.
2. **Surface before you build.** Where a capability already exists in the code (DOCX/PPTX export, cost tracking, the rich demo, opt-in telemetry), wire it up and show it off before building anything new.
3. **Protect the core promise above all.** This is a confidentiality product. Any change that touches where client data can go (especially the AI context) is held to the highest bar, and the promise is never weakened for convenience.
4. **Honesty compounds trust; hedging erodes it.** Every claim is precise and verifiable. We would rather under-claim and over-deliver, because the buyer is a trained skeptic with a malpractice license on the line.
5. **Respect the founding principles.** BYOK forever, local-first, no cloud sync, user approves all AI actions, auditable. These are in `CLAUDE.md` and are not on the table. Onboarding friction gets solved *within* BYOK, never by holding keys.

---

## How to read the workstreams

Each workstream has: the **problem** (in the persona's words), the **root cause**, the specific **fixes**, the **affected files**, and three quick ratings.

- **Impact:** High / Medium / Low (effect on trial-to-activation, activation-to-purchase, or trust).
- **Effort:** S / M / L (relative build size; no time estimates per house style).
- **Autonomy:** who is needed. `auto` = I build and commit it without asking. `deploy-gate` = built autonomously, but going live needs your explicit go (standing rule for commercial Keepance). `Jameson` = needs a fact or decision only you have. `advisor` = needs the bar-active attorney or CPA/EA reviewer. `board` = a strategic decision to make together.

---

## Workstream A: First impression and marketing-site truth

**Problem.** "Developer tool, not for me" (every persona, within seconds). The screenshots show raw Markdown, templates are never named, the advisor story contradicts itself, and the single best feature for the most paranoid buyers (local models) is invisible.

**Root cause.** The site shows the editor's code view and describes capability abstractly, while the actual rendered output and the concrete template list sit one layer down, unseen.

**Fixes.**
1. Replace every marketing screenshot with the **rendered Preview view**, not the raw-Markdown code view. This is the highest-ratio fix on the entire site.
2. Add a **profession-specific hero** per landing page: the attorney sees a privilege log or case timeline rendered cleanly; the CPA sees a tax research memo; the consultant sees a client-discovery synthesis or a slide outline.
3. **Name the templates** on each landing page, with a one-line description each (Legal, Tax, Consulting). People will not buy a "pack" they cannot see.
4. **Reconcile the advisors story** into one honest message: advisors can use the core local-first app today; the advisor template pack is on the roadmap. Fix the homepage block that says "in the works" so it matches the real, checkout-wired `/financial-advisors/` page, and frame the pack as forthcoming rather than implied-present.
5. **Surface the local-model path** prominently on the legal page (and a dedicated short explainer): "For absolute confidentiality, run a local model and nothing leaves your machine at all," with a link to a setup guide (see Workstream H for the patent angle and the Ollama guide itself).
6. **Tighten the patent novelty claim** to the precise mechanism (see Workstream H, fix 3) wherever it appears on the site.
7. Add a **per-vertical "sample output" gallery**: two or three rendered example documents the visitor can actually look at before downloading.

**Affected files.** `website/index.html`, `website/legal/index.html`, `website/tax/index.html`, `website/consulting/index.html`, `website/financial-advisors/index.html`, the redirect stubs `website/{legal,tax,consulting}-practice/index.html`, shared assets in `website/styles/` and `website/scripts/keepance-nav.v4.js`. New rendered screenshots and sample-output images go in `website/` image assets.

*Implementation note: rendered screenshots can be captured from the app's Preview mode or the browser demo. The sample-output gallery can reuse the demo's seeded documents rendered to PDF or PNG.*

**Impact:** High. **Effort:** M (mostly content and assets). **Autonomy:** `auto` to build, `deploy-gate` to publish. Founder-bio claims that appear on these pages are `Jameson` (see Workstream E, fix 2).

---

## Workstream B: Onboarding and the API-key wall

**Problem.** "I do not know what an API key is, and nothing tells me" (every persona). For the tax pro, this single wall ends the trial. This is the number-one drop-off in the entire funnel.

**Root cause.** The onboarding wizard already asks the profession, offers a workspace folder, and walks through getting an Anthropic key with a console link, but it presumes the user knows what an API key *is*, offers no way to confirm the key works, and does not connect the profession choice to anything the user then sees.

**Fixes.**
1. Add a plain-English **"What is an API key (and why Keepance works this way)"** step and a matching short website page: a key is like a password that lets your computer talk directly to the AI company, which is exactly what keeps your work off our servers. Two sentences, no jargon, framed as a privacy feature rather than a technical chore.
2. Add a **"Test this key"** button that makes one tiny real call and returns a green check or a plain-English error ("that key looks incomplete," "that key was rejected by Anthropic"). Removing the "did I do this right?" anxiety is most of the battle.
3. Set **cost expectations during setup**: a one-line "most solo users spend roughly $5 to $15 a month in AI costs, billed by Anthropic, not us," linking to the cost explainer (Workstream F).
4. **Wire the profession choice to the experience**: after the user picks Legal / Tax / Consulting, load the matching templates and a matching sample document, so the first thing they see is *their* work, not a generic file. (The profession is already stored; it just is not connected yet.)
5. Ship **profession-specific sample files** to replace the three generic ones, so an attorney's first workspace looks like an attorney's, a CPA's like a CPA's.
6. **Fix the tour's developer-speak.** The feature tour currently says "back up with git." Replace with plain backup guidance (Workstream E, fix 5). Add one "try this now" interactive moment so the tour teaches the core loop (ask, get an artifact, edit it), not just points at buttons.
7. Add a **tax-seasonality-aware re-engagement**: if onboarding stalls at the API-key step, the optional email follow-up offers a two-minute "finish setting up" guide. (Outreach timing for tax pros is a GTM note, not code: evaluate in the off-season.)

**Affected files.** `src/components/onboarding/FirstRunWizard.tsx`, `src/components/onboarding/ApiKeyWizard.tsx`, `src/components/onboarding/ApiKeySetupCard.tsx`, `src/onboarding/samples/index.ts` (and new profession-specific sample files), `src/hooks/useOnboarding.ts`, `src/components/onboarding/FeatureTour.tsx`, `src/components/onboarding/featureTourSteps.ts`, `src/components/settings/ApiKeySettings.tsx` (add the same "Test key" affordance), provider classes for the validation ping (`src/modules/models/ClaudeProvider.ts`, `OpenAIProvider.ts`, `GeminiProvider.ts`), and the profession-to-template wiring in `src/modules/workflow/index.ts` / `src/types/workflow.ts`. Website explainer page under `website/`.

**Impact:** High (this is the top funnel leak). **Effort:** M. **Autonomy:** `auto` to build, `deploy-gate` to release the app.

---

## Workstream C: The deliverable pipeline (output that fits real work)

**Problem.** "Outputs are Markdown; my work product is Word, PDF, and PowerPoint" (attorney, CPA, consultant). Without this, Keepance is a scratchpad, not a tool that fits any professional output pipeline. This is existential.

**Root cause.** The export *capability* already exists (Word and PowerPoint utilities, plus a Markdown-to-PowerPoint converter), but the editor exposes only a single "Download" button that saves the file in its current format, and there is no in-app PDF export. The gap is surfacing plus one real build (PDF).

**Fixes.**
1. Replace the single Download button with an **"Export as" menu**: Markdown, Word (.docx), PDF, and (where relevant) PowerPoint (.pptx). Wire the existing `docx-io` and `pptx-io` utilities to it.
2. **Add in-app PDF export.** This is the one genuine build. (Tauri can shell to a bundled renderer; the browser build can use a client-side HTML-to-PDF path. Decide per platform in the execution plan.)
3. **Profession-aware output formatting**: a privilege log exports as a clean table, a tax research memo in standard memo format, a consulting deliverable as titled slides. The formatting lives with each template's output spec.
4. Add **"Copy as formatted"** (rich text to clipboard) for the common case of pasting a section straight into Word or an email.
5. Add a simple **letterhead / firm-name header** option so exported documents look like the firm's, not Keepance's.

**Affected files.** `src/components/editor/FormattingToolbar.tsx` (the export menu), `src/utils/docx-io.ts`, `src/utils/pptx-io.ts`, `src/utils/saveFile.ts`, a new PDF export utility, and per-template output formatting in `src/modules/workflow/templates/`. Tauri side: `src-tauri/src/commands/` if a native renderer is used.

**Impact:** High (removes the "scratchpad ceiling"). **Effort:** M (mostly wiring; PDF is the real work). **Autonomy:** `auto` to build, `deploy-gate` to release.

---

## Workstream D: Confidentiality integrity (client-data separation)

**Problem.** "How do I keep Client A and Client B separated so the AI never sees both?" (consultant, and implicitly every persona). This is the exact failure mode the buyer is paying to avoid, and right now it can happen silently.

**Root cause.** The AI context includes every file open in the editor tabs, and the workspace-search command can pull from the entire workspace, with no folder or matter scoping and no warning when files from different clients are combined.

**Fixes.**
1. Add a **visible "what the AI can see" indicator** in the chat: a small, always-present list of exactly which files are in context for this message. Transparency alone prevents most accidents and reinforces the core promise on every single use.
2. Add **matter/client scoping**: let the user bind a chat to a folder (a matter) so the AI context is limited to that folder by default, and workspace search stays inside it.
3. Add a **cross-boundary warning**: if a chat's context would include files from two different top-level client folders, show a clear confirmation ("This chat can see files from both Client A and Client B. Continue?").
4. **Document the data model** plainly, on the site and in-app: one client per top-level folder, scoping on by default, here is how isolation works. This turns a hidden risk into a stated safeguard and a selling point.

**Affected files.** `src/stores/aiChatStore.ts`, `src/components/ai/AIChatViewer.tsx`, `src/utils/ai-file-context.ts` (context assembly and the open-files block), plus settings for default scoping in `src/stores/settingsStore.ts`. Website: a short "How Keepance keeps clients separated" section on the legal/consulting pages.

**Impact:** High (it is the integrity of the core promise). **Effort:** M to L (needs careful design and tests). **Autonomy:** `auto` to build, `deploy-gate` to release. This is high-stakes; the execution plan gets extra test coverage and a review checkpoint.

---

## Workstream E: Trust and social proof

**Problem.** Trained skeptics, asked to extend deep trust, find zero testimonials, an unverified founder bio, hedge words ("no telemetry by default"), buried disclaimers, no backup answer, and no longevity story.

**Root cause.** The trust layer was written like marketing copy rather than like evidence for a skeptic.

**Fixes.**
1. **Reviewer testimonials flywheel.** This is the direct payoff of the current outreach: the moment one named reviewer says yes, capture a short, attributed quote (name, firm, role) and place it on the matching vertical page. One real attorney testimonial outweighs every citation. *(Depends on the reviewer-approval work that is your standing number-one priority.)*
2. **Verify the founder bio.** "Eight years at Samsung, AstraZeneca, Tesla, University College London" is live and unverified; a reviewer will Google it before replying. Confirm and adjust the copy to match exactly. `Jameson` input required, and this should land before reviewer outreach scales.
3. **De-hedge the telemetry copy.** Reality is opt-in with nothing collected until enabled, which is stronger than the current phrasing. Replace "no telemetry by default" with a plain, unhedged statement of the opt-in posture. This converts a liability into an asset.
4. **Fix disclaimer placement.** Lead each compliance section with the "verify with your bar counsel / tax advisor" caveat, then give the specifics, so the caveat is actually read.
5. **Add a backup story.** One honest paragraph on the site and a plain in-app line: "Your Keepance files are ordinary files in a folder you chose. Back them up the way you back up everything else (Time Machine, OneDrive, an external drive)." Remove "back up with git" from the tour.
6. **Add per-vertical case studies** as reviewers and early users accumulate (longer than a testimonial, a real before/after).
7. **Expand the "see exactly where your data goes" page** (it exists on the legal page) into a standalone architecture-transparency page a security-conscious buyer can forward to their IT or their managing partner.
8. **Add a longevity line.** One honest sentence on the business model and commitment, to answer "will this exist in eighteen months."

**Affected files.** Website copy across `website/index.html` and the vertical pages; press kit at `website/press-kit/`; a new or expanded data-architecture page; the in-app tour copy in `featureTourSteps.ts`; privacy copy alignment with `src/components/settings/PrivacySettings.tsx`.

**Impact:** High (trust is the product). **Effort:** S to M (mostly copy; testimonials gated on people). **Autonomy:** mostly `auto`/`deploy-gate`; founder bio is `Jameson`; testimonials are `Jameson` plus the reviewers.

---

## Workstream F: Cost transparency

**Problem.** "$149/yr looked like the whole bill; then a provider invoice showed up" (every persona). Hidden cost reads as betrayal for a trust product.

**Root cause.** BYOK means real per-use cost that the pricing page never mentions, and the in-app cost chip only shows today's total.

**Fixes.**
1. Add a **true-cost line to the pricing page**: "Plus your AI provider costs, typically $5 to $15/month for moderate use," linking to a short explainer that shows a couple of concrete examples ("a 200-page discovery summary costs about X").
2. Add a **cost estimate before a big run**: when a workflow or large chat is about to make an expensive call, show an estimated cost first.
3. Add a **simple monthly spend view and an optional budget alert** ("you have spent $20 this month") building on the existing tracking, which today only exposes the current day.

**Affected files.** Website pricing section in `website/index.html` and the vertical pages; a new cost-explainer page under `website/`; in-app `src/stores/aiChatStore.ts` (extend beyond the daily bucket), `src/components/ai/ChatCostChip.tsx`, `src/components/settings/LicenseSettings.tsx` (or a small usage view).

**Impact:** Medium to High (prevents bill-shock churn and protects trust). **Effort:** S to M. **Autonomy:** `auto` to build, `deploy-gate` to release.

---

## Workstream G: Research reliability (anti-hallucination for legal and tax)

**Problem.** "If a research memo hallucinates a case or an IRC section and I rely on it, that is my license" (attorney, CPA). This is the central trust question for the two most regulated verticals, and the product is silent on it.

**Root cause.** Research and memo outputs read as authoritative prose with no visible sourcing, confidence signaling, or "verify before relying" framing.

**Fixes.**
1. **Cite to authority, visibly.** Research and memo templates should surface their sources (the document and page for workspace material; named authority for general legal/tax claims) and clearly mark anything the model asserts without a source.
2. **Confidence signaling.** Distinguish "grounded in your documents" from "general knowledge that must be verified."
3. **"Verify before relying" UX.** A standing, non-dismissable reminder on research outputs in the regulated verticals, with the disclaimer placement fix from Workstream E.
4. **Advisor-set standards.** The bar-active attorney and the CPA/EA reviewer define what "acceptable sourcing" means for their pack before it ships. This is already a gate in the business plan; make it a hard prerequisite for the research templates specifically.

**Affected files.** `src/modules/workflow/templates/legal/` and `tax/` (especially `TaxResearchMemo.ts`, the research and discovery templates), the research/source-card modules (`src/modules/research/`), and the AI context/citation assembly in `src/utils/ai-file-context.ts`.

**Impact:** High (liability protection; unlocks the regulated verticals' trust). **Effort:** M. **Autonomy:** `auto` to build; `advisor` required to set and sign off standards before release.

---

## Workstream H: Template depth and per-vertical gaps

**Problem.** Each vertical sees gaps or padding: the attorney's pack is litigation-only; the patent claim is overstated and the local path is missing; the tax pack has a trivial template and no tax samples; the consultant cannot see the templates or get a deck out.

**Fixes, by vertical.**

*Legal.*
1. Add transactional, estate-planning, family-law, and real-estate templates so the pack matches the bread-and-butter of solo practice, not only litigation.
2. Improve the Client Intake Synthesizer's conflict step: either integrate the check into a usable workflow or clearly frame the search-string output as a starting point with the manual step named, so it does not look half-finished.
3. Add optional Bluebook-style citation help for legal writing.

*Patent.*
1. Replace the catastrophic novelty claim with the precise mechanism (cloud transmission and absolute-novelty exposure), everywhere it appears.
2. Ship the **local-model setup guide** (Ollama), linked from the patent and legal pages: this is the feature that wins the vertical outright.
3. Define the Patent Disclosure Draft's output mapping to USPTO/EPO structure (field, background, summary, detailed description) so it slots toward a filing.

*Tax.*
1. Replace or upgrade the trivial Quarterly Estimate Reminder; reposition the §7216 Consent Template as optional, acknowledging that most users generate consents from their PMS.
2. Add high-frequency real workflows: notice-response drafting (CP2000-style) and a representation/engagement flow.
3. Ship **tax-specific sample content** and a rendered tax-memo example for the site.

*Consulting.*
1. Surface the consulting templates by name on the site (Workstream A) and make their outputs deck-ready (Workstream C).
2. Add an engagement-scoping / statement-of-work template (the first artifact of every engagement).
3. Add multi-client guidance tied to the scoping safeguards in Workstream D.

*Advisors (committed build).*
1. Fix the contradictory messaging immediately (Workstream A, fix 4): until the pack ships, the site states plainly that the advisor pack is forthcoming and does not imply it exists.
2. Build the Advisor Practice Pack to the depth of the legal and tax packs, grounded in Regulation S-P (the amended safeguards rule and the breach-notification requirement) and fiduciary confidentiality duties. Likely templates: client financial-plan summary, meeting-prep and suitability notes, an annual-review packet, and a confidential client-data inventory. Final template list set with an advisor reviewer.

**Affected files.** `src/modules/workflow/templates/{legal,tax,consulting}/` and a new `advisors/` folder when greenlit; the category union in `src/types/workflow.ts`; the registry in `src/modules/workflow/index.ts`; sample content under `src/onboarding/samples/`; the Ollama guide under `website/` and in-app help.

**Impact:** High (depth per vertical, and the advisor vertical now has a real pack). **Effort:** L (phased). **Autonomy:** `auto` to build; `advisor` for any statutory-claim or research template, including final sign-off on the advisor pack's regulatory framing.

---

## Workstream I: Demo experience (try before download)

**Problem.** The (genuinely good) browser demo is legal-only, so a CPA or consultant who clicks "try it" sees someone else's work, and the desktop app has no equivalent rich sample.

**Root cause.** One hard-coded legal sample workspace serves all visitors.

**Fixes.**
1. Make the demo **profession-aware**: load the matching vertical's sample based on the page the visitor came from (a CPA from the tax page gets a tax matter; a consultant gets a client engagement).
2. Bring **rich sample parity to the desktop** first-run, tied to the profession picker (Workstream B), so the installed app also opens to a realistic, profession-matched example.
3. Keep and extend the **guided "magic moment"** (the pre-saved chat that shows the AI doing something impressive) for each vertical.

**Affected files.** `src/web-demo/WebDemoSeeder.ts`, `src/web-demo/sample-workspace.json` (split into per-vertical samples), `src/web-demo/main.tsx`, demo entry routing, and the shared profession-sample source used by both the demo and onboarding (Workstream B, fix 5).

**Impact:** Medium to High (lets each vertical see itself succeed before committing). **Effort:** M. **Autonomy:** `auto` to build, `deploy-gate` to publish.

---

## Workstream J: Pricing, packaging, and support clarity

**Problem.** The cost model, seat economics for small firms, support expectations, and the Personal-vs-Professional-vs-Practice value distinction are all unclear, and "founding pricing" raises a longevity worry.

**Fixes.**
1. **True-cost disclosure** (shared with Workstream F).
2. **Clarify seat economics** for small firms (the patent four-attorney case): explain when Practice (five seats) is the right call and how review-by-a-colleague works.
3. **State the support model** per tier in plain terms, including what a solo Professional user gets, because "who do I call" matters for a confidential-data tool.
4. **Sharpen the tier value story**: Personal (own it, one-time) vs Professional (a maintained, kept-current profession pack) vs Practice (seats and all packs). Make the "why annual" reason (packs stay current as the law changes) explicit and concrete.
5. Any actual change to prices, tiers, or the founding offer is `board` and is not made here; this workstream is clarity of the existing model unless we decide otherwise together.

**Affected files.** Website pricing section and vertical pages; press kit; possibly `src/components/settings/LicenseSettings.tsx` copy.

**Impact:** Medium. **Effort:** S. **Autonomy:** `auto`/`deploy-gate` for clarity copy; `board` for any pricing change.

---

## Workstream K: "How it fits your stack" positioning

**Problem.** Every persona already runs a system of record (Clio, Drake, PowerPoint, a CRM) and the site never says whether Keepance replaces or complements it, which reads as "two of everything."

**Fixes.**
1. Add a **"How Keepance fits your existing tools"** page and a short per-vertical block: it complements Clio/Drake/Office, it does not replace them; here is the round trip (bring a document in, work on it privately, export it back).
2. Lean on the existing **import support** (Word, PowerPoint, Excel, PDF in) plus the new export menu (Workstream C) to make the round trip concrete and credible.
3. Frame Keepance explicitly as **"the private place your AI work happens,"** sitting beside the system of record rather than competing with it.

**Affected files.** A new page under `website/`; per-vertical blocks on the landing pages; references to the import utilities (`docx-io`, `pptx-io`, `spreadsheet-io`) for the round-trip claim.

**Impact:** Medium. **Effort:** S. **Autonomy:** `auto`/`deploy-gate`.

---

## Phased roadmap

Per the locked decisions, the entire overhaul ships before any outreach, so these phases are a dependency-and-value build order, not a release schedule. Phase 0 front-loads the cheap, high-trust, high-leverage fixes (mostly communication, plus the two existential surfacing fixes) so the most visible problems fall first; Phases 1 and 2 carry the deeper builds. Everything must be complete and verified before we go to market.

### Phase 0: foundational and high-trust, build first (cheap, mostly communication)
| Fix | Workstream | Impact | Effort |
|---|---|---|---|
| Rendered Preview screenshots everywhere | A | High | M |
| Name templates on landing pages; reconcile advisors story; surface local model | A | High | S |
| Verify founder bio and align copy | E | High | S (needs Jameson) |
| De-hedge telemetry; fix disclaimer placement; backup story; longevity line | E | High | S |
| True-cost line on pricing page + explainer | F | High | S |
| "What is an API key" explainer + "Test key" button | B | High | M |
| Surface DOCX export in the editor + add one-click PDF | C | High | M |
| "What the AI can see" context indicator + cross-client warning | D | High | M |

### Phase 1: the deeper builds that convert trials to paid
| Fix | Workstream | Impact | Effort |
|---|---|---|---|
| Full export menu (Word/PDF/PPTX) + profession-formatted output | C | High | M |
| Wire profession choice to templates + profession-specific samples | B | High | M |
| Matter/client scoping for AI context | D | High | M-L |
| Profession-aware demo + desktop rich-sample parity | I | High | M |
| Cost estimate-before-run + monthly spend view | F | Medium | M |
| Tour teaches the core loop; remove developer-speak | B | Medium | S |

### Phase 2: depth, regulated-vertical reliability, packaging
| Fix | Workstream | Impact | Effort |
|---|---|---|---|
| Research citation + confidence + verify framing (advisor-gated) | G | High | M |
| Legal pack breadth (transactional/estate/family/RE); conflict-check fix | H | High | L |
| Tax pack upgrades + tax samples; patent novelty + Ollama guide + IDF output | H | Medium-High | L |
| Consulting templates surfaced + deck output + SOW template | H | Medium | M |
| Pricing/packaging/support clarity | J | Medium | S |
| "How it fits your stack" positioning | K | Medium | S |
| Advisor Practice Pack (committed) | H | High | L |

---

## Dependencies and sequencing notes

- **Profession-specific samples** (B5) feed both onboarding and the demo (I), so build the shared sample source once.
- **Export** (C) underpins the deliverable promise in A (sample-output gallery), K (round-trip claim), and the consulting deck story (H).
- **Data-separation** (D) should ship its visible indicator in Phase 0 even if full scoping lands in Phase 1, because a reviewer testing the app will open multiple files immediately.
- **Testimonials** (E1) and the **advisor pack** (H) are gated on people, not code; everything else can proceed in parallel.
- **Research reliability** (G) must clear advisor sign-off before the research templates ship, per the business plan's existing advisor gate.

---

## Success metrics

How we will know V2 worked. Most of these are already trackable via the existing Plausible funnel and the app's opt-in lifecycle telemetry; a couple need a small addition.

- **Download-to-launch:** share of downloads that reach first app launch.
- **Launch-to-first-AI-call:** share that gets past the API-key wall (the headline Phase 0/1 metric).
- **First-AI-call-to-first-export:** share that produces a real deliverable (the headline Workstream C metric).
- **Demo-to-download:** existing demo funnel conversion, segmented by vertical once the demo is profession-aware.
- **Trial-to-paid:** existing license telemetry.
- **Qualitative:** reviewer reactions captured during outreach (the richest signal we have right now).

---

## Autonomy and escalation

| Category | Who | Examples |
|---|---|---|
| Build and commit | `auto` | All website copy/assets, app features, template work, demo, onboarding, export, scoping |
| Going live | `deploy-gate` | Any website deploy or app release needs your explicit go (standing rule for commercial Keepance) |
| Facts only you have | `Jameson` | Founder-bio verification; any personal-contact warm intros |
| Expert sign-off | `advisor` | Statutory-claim templates; research-reliability standards before the legal/tax research templates ship |
| Strategic decisions | `board` | Any pricing/tier/founding-offer change (managed-key and advisor-pack questions already decided, see Decisions locked) |

Per your standing preferences, execution of any greenlit workstream defaults to **subagent-driven development** (the recommended mode) without asking you to choose, and I will not deploy or release commercially without your explicit go.

---

## Resolved strategic decisions

All three open questions were decided by Jameson on 2026-06-03 (see [Decisions locked](#decisions-locked-2026-06-03)):

1. **Managed key:** No. BYOK stays; onboarding is fixed inside BYOK (Workstream B).
2. **Advisor pack:** Build it (committed; Workstream H, Advisors).
3. **Sequencing:** The entire overhaul ships before any outreach. The phases below are a dependency-and-value order for the build, not a partial-release schedule.

---

## Appendix: traceability matrix

Every audit finding maps to a workstream, proving full coverage. (Audit cross-cutting numbers in brackets refer to the [audit's cross-cutting list](./2026-06-03-vertical-persona-audit.md#cross-cutting-issues-all-verticals).)

| Audit finding | Workstream |
|---|---|
| Raw-Markdown screenshots [2] | A |
| Templates not named on site | A |
| Advisors story contradicts itself [8] | A, H |
| Local-model path buried [12] | A, H |
| Patent novelty claim overstated | A, H |
| API-key wall [1] | B |
| "What is an API key" missing | B |
| No key validation | B |
| Profession choice not wired | B |
| Generic (not profession) samples | B, I |
| Tour says "back up with git" / breadth-only | B, E |
| Tax seasonality onboarding | B |
| Output is Markdown only [10] | C |
| No Word/PDF/PPTX export surfaced | C |
| No profession-formatted output | C |
| Client-data separation risk [13] | D |
| Multi-client isolation unexplained | D |
| Zero social proof [5] | E |
| Founder bio unverified | E |
| "No telemetry by default" hedge [6] | E |
| Disclaimer placement | E |
| No backup story [7] | E |
| No longevity story [15] | E |
| Hidden true cost [3] | F, J |
| Research hallucination risk [11] | G |
| "Simplifies all three" overclaim (tax) | G, H |
| Legal pack litigation-only | H |
| Conflict-check half-finished | H |
| Tax trivial template / §7216 overlap | H |
| Patent output-to-filing mapping | H |
| Consulting templates invisible | A, H |
| Consulting deck output | C, H |
| No sample output before commitment [4] | A, I |
| Demo is legal-only | I |
| No "fits your stack" positioning [9] | K |
| Seat economics unclear | J |
| Support expectations unclear [14] | J |
| Pricing tier value unclear | J |

No audit finding is unaddressed.
