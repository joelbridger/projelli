# Advisor Prep Hero UI Reimagining — UX Research & Principles (Capstone)

**Date:** 2026-06-13 · **Phase:** 1 (Deep UX Research) · **Status:** the Gate 1 review artifact — design begins only after sign-off
**This is the synthesis** of the four research streams. It is the single reference every Phase 2 design and Phase 3 build decision must trace back to.

| Stream | Deliverable | One-line |
|---|---|---|
| A — Attorney corpus → UI requirements | `01-ux-brief.md` | Diane's jobs, journeys, vocabulary, and the five non-negotiables as UI acceptance tests |
| B — Competitive/reference UI teardowns | `02-competitive-teardowns.md` | The conventions she already knows (Outlook/Word/Acrobat/Clio/DMS + Harvey/CoCounsel/Spellbook/Copilot) |
| C — Heuristic + accessibility audit | `03-heuristic-accessibility-audit.md` | Where the current UI violates Nielsen + WCAG AA (4 hard contrast fails; the trust signal is buried) |
| E — IA / mental-model synthesis | *(this doc, §3)* | The recommended matter-centric IA (a hypothesis the Phase 2 prototype validates) |

---

## 1. The through-line (what all four streams agree on)

Advisor Prep Hero must stop being a *general local-AI workspace with law features bolted on* and become a **matter-centric, cited-answer-first, trust-on-screen** application that an attorney experiences as a native extension of Outlook + Word + Clio — so the software disappears.

Three findings are **independently confirmed by two or more streams** (high confidence):

1. **The wedge is "find anything, privately, with a citation I can click."** Stream A ranks it the #1 pain (~150 billable hrs/yr lost; *"that's my Tuesday"*); Stream B shows the citation interaction is the gold-standard pattern (Copilot/Harvey/Perplexity); the current AI chat shows page numbers as plain text (F-117). → **Unify Search + AI into one "Ask" where every answer is one-click verifiable.**
2. **The trust signal must be a hero element, not a status-bar detail.** Stream A: the egress indicator was *the single most emotionally powerful moment in the entire persona study* ("two years of anxiety dissolved in one green bar"). Stream C: the status bar buries that exact signal among **9 indicators in a 24px strip** attorneys rightly ignore — so it's invisible when it matters most. → **Elevate egress/matter-scope/confidentiality to a primary, always-visible, accessible surface.**
3. **Matter is the spine.** Stream A: matters buried in the chat header is a P1 failure (F-122). Stream B: Clio/iManage/NetDocuments all model matter-first. → **Lead the whole app with Matters; everything hangs off a matter.**

---

## 2. Design principles (the north stars)

These are firm (well-grounded across streams). The *IA* in §3 is a hypothesis to validate; these principles are not.

1. **Matter is the spine.** The app is organized the way a practice is. No "general documents" front door above matters.
2. **The cited answer is the hero.** One unified "Ask." Every answer over client data carries a one-click citation that opens the exact passage. *An uncited answer must never appear* (the Avianca trap). Reuse the existing `AIChatViewer` citation engine; the work is unify + verify + elevate, not build-from-scratch.
3. **Trust is a primary, always-visible element.** Egress (where this prompt goes), matter scope (which client), and confidentiality mode are persistent, legible, and accessible — never buried. This is the brand, not a settings panel.
4. **Reuse the conventions they already know.** Borrow directly: matter-as-spine left rail (Clio), three-panel nav/list/detail (Outlook), Word tracked-changes (Review pane), DMS document profiles, numbered-citation hover→click (Copilot). Novelty in navigation is a tax.
5. **Propose, don't decide.** The AI is a tireless first-year associate that flags for verification, never an oracle. Every finding carries a persistent "you verify, you decide" frame and a one-click "verify" to the source.
6. **Honest claims only.** Always pair "the one slice we handle" with "what's still on you." Never overclaim ("nothing leaves" when the provider sees the prompt; "ABA 512 compliant"). No website claim for a feature that isn't shipped.
7. **Speak law, purge jargon.** Use matter/client/privilege/discovery/deposition/redline/engagement letter/firm. Purge workspace/Markdown/API key/whiteboard/brainstorm/founder/competitor and any personal name. **No em-dashes.** First-person, concrete nouns.
8. **Word-native deliverables.** Every output is a real `.docx` (on letterhead), tracked changes appear as standard Word changes **under the attorney's name**, accept/reject per-change and bulk. The attorney never sees Markdown.
9. **Zero setup friction before first value.** Never the word "API key." No configuration screen gates the first useful result. "Set this up later" works at every step.
10. **Beautiful means professional and accessible.** Light theme, document-grade density (Outlook/Clio-dense, not airy), restrained color, calm motion — and **WCAG 2.1 AA by construction** (the current UI has 4 hard contrast failures to fix at the token level).

---

## 3. Recommended Information Architecture (Stream E — a hypothesis for the Phase 2 prototype to validate)

> Framed as a hypothesis, per "research is king." The Phase 2 prototype tests it with the persona before any production wiring. The three IA questions it must answer are at the end of this section.

### The app shell
- **A persistent Trust Bar** (the elevated egress/scope/confidentiality element — principle 3), always visible, accessible (`role="status"`, labeled), with three legible egress states (Local-only / Direct-to-provider / Assured). This is the redesign's answer to the A+C convergence; it is *not* the old 9-item status strip.
- **A left rail** leading with Matters.

### Top-level navigation (left rail)
| Item | Purpose | Replaces / note |
|---|---|---|
| **Matters** | The spine + default landing. Clio-style list/dashboard: status (Open/Pending/Closed), recent, + New Matter. | Elevates Matters from mid-list to the anchor |
| **Ask** | The unified cited answer surface (full-text + AI fused). Scope selector: all matters or one. The hero. | **Merges** today's separate Search + AI Assistant |
| **Documents** | Cross-matter document view (conflict-check, cross-matter research). | Reframes "Files" |
| **Your defense file** | The audit trail, framed as protective. | Renames "AI Audit" |
| **Settings** (+ Data Map / Trust entry) | Trust surfaces reachable from a permanent labeled entry (Data Map is printable). | — |
| *(Proof surface)* | A first-class "attorneys using Advisor Prep Hero" home (may start empty) — Stream A's proof-moat insight. | New |
| **— removed —** | **Research** (founder SourceCards) and **Whiteboard** are absent from the law experience. | Per the reimagining |

### Within a matter (header: Matter name · Client · Matter # · Status · Responsible attorney · confidentiality mode)
- **Overview** — dashboard tiles (client-question feed, indexed docs, open drafts, recent activity).
- **Ask** (scoped to this matter) — the wedge, cited, click-through to source.
- **Documents** — three-panel (folder tree · table with Name/Type/Date/Author/Analyzed/Privilege columns · preview); quick search + metadata filters.
- **Email** — imported mail, searchable, per-message privilege tagging.
- **Associate** (the litigation associate) — named actions in her words ("find where the witness contradicts himself," "spot the issues," "build a timeline") → tabular cited findings → `.docx`. Replaces the generic "Workflows."
- **Drafts** — managed `.docx` with tracked-changes status; "Open in Word."
- **Trust Map** — per-document data handling (storage · AI processing · last accessed · access log · privilege). No competitor surfaces this in-session; it is Advisor Prep Hero's UI moat.

**The three IA questions the prototype must answer:** (1) Does leading with Matters + a unified Ask match how she navigates, or does she look for "Search" / "Email" as top-level items? (2) Is the matter sub-nav (Overview/Ask/Documents/Email/Associate/Drafts/Trust Map) the right set and order? (3) Is the elevated Trust Bar legible and reassuring without being noisy?

---

## 4. Key interaction patterns (reuse what she knows — Stream B)

- **The unified Ask + citation.** Plain-English question → prose answer with **numbered superscript citations**; **hover → glance card** (source name + matter + excerpt); **click → side-by-side source panel** with the exact passage highlighted + document metadata + "open full document"; a **"Verified" state after click**. Citations stay visible (not hover-only). Full-text hits and AI answers coexist in one surface.
- **The litigation associate (Review).** Pick a named action → **sortable/filterable table**, rows = documents, columns = findings, a **Citations column** with the exact source sentence on both sides of a contradiction; a "Verify" button opens both passages side by side; output is a `.docx` in the matter folder; exportable to `.xlsx`. Persistent "propose, don't decide" frame.
- **Word redline.** AI edits as **standard Word tracked changes, attributed to the attorney's name**, per-change + bulk accept/reject, Reviewing-pane model. Never a separate diff view; never "Advisor Prep Hero AI" as the author of record.
- **The Trust Bar (hero).** Three always-visible states with plain-English copy; Direct mode must positively say "Going to [provider], directly from your device" (fixes F-120's silence); `role="status"` + label for assistive tech (fixes C's gap).
- **First-run.** Profession defaults to legal; "Connect your AI account" (never "API key") with the training-opt-out guidance; the Data Map step (a confirmed strength) kept; "set this up later" everywhere.

---

## 5. Content & voice (Stream A §3)

**Use:** matter · client · privilege / work product · discovery · deposition · redline / tracked changes · engagement letter · firm / solo · litigation.
**Purge:** workspace · Markdown · API key · whiteboard · brainstorm · founder · "Jameson"/any personal name · competitor · "business kickoff" · marketing-speak (transform/unlock/leverage/seamless/empower/delve) · developer notation (`docs/ research/` with trailing slashes).
**Rules:** first-person singular, contractions, concrete nouns, uneven sentence length, **no em-dashes**, honest "here's what's still on you" framing.

---

## 6. Visual & accessibility foundation (Stream C)

**Light theme only**, professional document-grade density, navy `#0A2540` primary retained; design system authored in the Tailwind v4 `@theme` block in `src/styles/globals.css` (the SSOT) + `src/components/ui/*` — extend, never replace the stack.

**Four hard WCAG AA failures to fix at the token level (these block "beautiful"):**
| Token / use | Ratio | Needs | Fix site |
|---|---|---|---|
| `--color-border` on white (every input/card/divider, via the global `*` rule) | **1.23:1** | ≥3:1 (1.4.11) | `globals.css` border token |
| `text-amber-500` on white (dirty dot, "Modified", sparkles) | **2.15:1** | ≥4.5:1 | → `amber-700` / chip pattern |
| `text-destructive` on white (errors, delete labels) | **3.76:1** | ≥4.5:1 | darken destructive token |
| `muted-foreground` on `muted` (sidebar headers, status text @12px) | **4.34:1** | ≥4.5:1 | darken muted-foreground token |

**Also:** redesign the status bar from a 9-item 24px strip into a structured 3-5 item tray (move trust state out of the noise floor → the Trust Bar); give `FirstRunWizard` proper `role="dialog"` + focus trap + `aria-labelledby`; `aria-pressed` on profession cards; restore visible focus rings (remove `focus:outline-none` on the tabpanel); icon-only buttons get accessible names; collapsed sidebar items keep a `title`/label.

---

## 7. Prioritized must-fix ledger (merged A + C, severity-ranked)

| # | Issue | Sev | Surface |
|---|---|---|---|
| 1 | Uncited AI answers (page numbers as plain text) — F-117 | P0 | Unified Ask |
| 2 | Silent mock/degraded AI shown as "Complete" — F-106 | P0 | Associate / workflow output |
| 3 | Trust signal buried in a 9-item status strip (egress invisible when it matters) | P0 | App shell → Trust Bar |
| 4 | Systemic border contrast 1.23:1 (+ amber/destructive/muted fails) | P0 (a11y) | Design tokens |
| 5 | Matters reachable only inside the chat — F-122 | P1 | Top-level nav |
| 6 | "API key" + setup friction at first run — F-105 | P1 | First-run |
| 7 | Direct-mode egress silence — F-120 | P1 | Trust Bar |
| 8 | FirstRunWizard not a real dialog (no focus trap) | P1 (a11y) | First-run |
| 9 | "Jameson"/personal name in trust copy — F-119 | P1 | Copy sweep |
| 10 | Markdown/ALL-CAPS.md filenames — F-112/F-102; "workspace" everywhere | P2 | Copy + scaffolding |

---

## 8. What the redesign must NOT miss

- **Egress → hero.** Treat the trust indicator as a primary element, not a status detail (the study's most powerful moment).
- **A proof surface.** A first-class "attorneys using Advisor Prep Hero" home, even empty — adoption is 80-90% peer-proof; this moat hasn't started.
- **The wedge demo is gated on a backend dependency.** The cited-answer-over-your-own-files promise can't be *demonstrated* until the e5-small embedder is bundled (the index populates on first run). UI proceeds, but copy must not claim "every answer is verifiable" until it is provable. Sequence the embedder bundling before the Phase 4 wedge demo.
- **Never regress** F-106 (silent mock), F-112 (Markdown filenames), F-119 (personal name), the egress comprehension probe, or the Data Map.
- **Propose-don't-decide and verify affordances** on every AI finding — non-negotiable for this audience.

---

## 9. Open questions for the prototype (Phase 2)
1. The three IA questions in §3 (matter-first + unified Ask; the matter sub-nav set; the Trust Bar's legibility).
2. Does "Ask" as one fused surface read as clearer than separate Search + Assistant, or does she still want a pure keyword "Search"?
3. Is the elevated Trust Bar reassuring, or does always-on egress copy become wallpaper she stops seeing?

---

*Foundation docs: `01-ux-brief.md`, `02-competitive-teardowns.md`, `03-heuristic-accessibility-audit.md`. Where a design choice conflicts with this synthesis, this governs unless new participant evidence overrides it.*
