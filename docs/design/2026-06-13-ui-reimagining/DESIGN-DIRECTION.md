# Keepance UI Reimagining — Design Direction (Phase 2 / Gate 2)

**Date:** 2026-06-13 · **Status:** Gate 2 review artifact · **Prototype:** live on `feature/ui-reimagining`
**View it:** run the dev server and open **`/?reimagined`** (Tailscale: `http://100.68.20.52:5173/?reimagined`). The production app is untouched at `/`.

Everything here traces to the Phase 1 capstone (`docs/research/2026-06-13-ui-reimagining/UX-RESEARCH-AND-PRINCIPLES.md`). The prototype is a navigable, real-stack design over mock litigation data (`src/reimagined/`), built to validate the direction before any production wiring.

---

## 1. Aesthetic direction — brand-matched to keepance.com

The app wears the website's brand so the two read as one product: navy + bone + white with the signature pink→blue gradient, the Satoshi typeface, and the Keepance keep-mark. Calm, dense, professional, where verifiable facts *look* verifiable.

- **Navy is the spine.** The left rail is the website's navy (`#0A2540`) carrying the keep-mark + Satoshi wordmark, a signature gradient edge rule, and the faint hero glows; matters hang off it.
- **Bone + white surfaces.** The canvas is the website's bone (`#F5F5F0`); documents and answers sit on it as white pages. Clean and flat, like the site.
- **The gradient is the accent.** The pink→blue gradient (`#FF3CE8 → #5DC6FF`) marks primary actions (exactly as keepance.com uses its CTA) and the brand sparkle; navy carries most of the UI.
- **Monospace is the record.** Citations, matter numbers, locators, and audit timestamps are monospace, so the evidentiary parts read as evidence. Simulated document content stays in a serif so a letter reads like a real .docx.

**Type:** **Satoshi** (the keepance.com typeface, via Fontshare) for all UI · a monospace stack for the record · a document serif only inside the simulated letter.

**Color:** navy `#0A2540` · bone `#F5F5F0` · white · gradient `#FF3CE8 → #5DC6FF` · accent blue `#5DC6FF` · trust states green/ochre/teal. Pulled directly from `website/index.html` `:root` and the keep-mark from `website/favicon.svg`.

---

## 2. Design system & accessibility

Built **on the existing stack** (Tailwind v4 tokens + shadcn primitives), scoped under `.kp-app` so nothing leaks to production. In Phase 3 these tokens become the real `src/styles/globals.css` `@theme`.

**WCAG AA fixes baked in** (the four failures Stream C found are resolved by the palette):

| Pair (text on paper unless noted) | Old | New | AA |
|---|---|---|---|
| Muted/secondary text (`ink-2 #4E4B42`) | 4.34:1 ✗ | ~7.3:1 | ✓ |
| Caution/amber → ochre (`#855413`) | 2.15:1 ✗ | ~5.4:1 | ✓ |
| Destructive/red (`#A82A20`) | 3.76:1 ✗ | ~6.0:1 | ✓ |
| Primary ink (`#1B1A16`) | — | ~14:1 | ✓ |
| Local green (`#185C41`) · Assured (`#1C4C68`) · Navy | — | 6–13:1 | ✓ |

Control/input borders target ≥3:1 (1.4.11); decorative hairlines are intentionally lighter. The egress indicator carries `role="status"` + an `aria-label`; the Data Map dialog has `role="dialog"`, `aria-modal`, `aria-labelledby`, and Escape-to-close (fixing the `FirstRunWizard` gap Stream C flagged). Phase 3 runs a full contrast + keyboard + focus audit before merge.

---

## 3. The screens (each maps to a research finding)

| Screen | What it demonstrates | Research |
|---|---|---|
| **Matters home** | Matter-as-spine; a Clio-grade matters table (serif title, mono number, status pills). The app leads with Matters. | F-122; B (Clio/iManage) |
| **The Trust Bar** (every screen) | The hero. Always-visible matter scope + a legible 3-state egress indicator ("On your machine · Nothing leaves"). | A+C convergence; F-120 |
| **Ask** (the wedge) | One unified surface; a cited answer with inline mono citation chips → click any chip → the exact source passage on the right, "Verified." Never an uncited answer. | Job 1; F-117; B (Copilot/Harvey) |
| **The litigation associate** | "Find where the witness contradicts himself." Numbered candidates, each cited on **both sides** (deposition vs prior statement), a "you verify, you decide" banner, Export to Word. | Job 2; propose-don't-decide |
| **Document editor** | A demand letter on **letterhead**; tracked changes attributed to **Diane Marchetti** (never "Keepance AI"); accept/reject + Reviewing pane; AI redline inserts "under your name." | Job 3; B (Word/Spellbook) |
| **Trust Map** | Per-document, plain-English data handling. Printable, client-shareable. | Non-negotiable 3; the Data Map |
| **Your defense file** | The audit trail framed as protective, not surveillance; mono timestamps; export for a privilege log. | Audit-as-defense framing |
| **Data Map dialog** | The one-sentence "where your data goes," reachable from the Trust Bar on any screen. | Non-negotiable 3 |

**Vocabulary throughout:** matter, client, deposition, privilege, redline, engagement letter, your defense file. No "workspace," "API key," "Markdown," "whiteboard," or em-dashes. **Research and Whiteboard do not exist** in this experience.

---

## 4. What is deliberately not in this prototype yet
- **First-run / onboarding** (the matter-first, attorney-language rewrite of `FirstRunWizard`, keeping the strong Data Map step). Designed in principle; built in Phase 3 since setup-friction is the highest-stakes screen and is rebuilt last on a stable system.
- **Real data + stores.** The prototype is mock-driven. Phase 3 wires the new shell to the real Zustand stores / backend, removes the founder surfaces for real, and runs the global copy/vocabulary sweep.
- **The cited-Ask demo dependency:** the end-to-end "cited answer over your own files" can only be *proven* once the embedder model is bundled (a backend item) — sequenced before the Phase 4 demo. Copy won't over-claim until then.

---

## 5. How Phase 3 uses this
Promote `profession` to reactive state (legal default) → adopt these tokens as the real design system → rebuild the shell + screens against real data → unify Search+AI into this Ask → elevate the existing strong components (Matters, Data Map, DocxEditor, audit) into the new language → remove founder surfaces → global copy sweep → onboarding last. Then Phase 4 verification (persona re-test, WCAG AA, full suite, before/after board).
