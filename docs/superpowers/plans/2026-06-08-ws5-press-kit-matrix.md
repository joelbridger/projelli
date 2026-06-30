# WS5 Plan: Press-kit / Reviewer Comparison Matrix

**Date:** 2026-06-08
**Workstream:** 5 of 6 (from the competitive-activation master handoff)
**Source doc:** `docs/strategy/2026-06-06-vertical-competitive-landscape.md`
**Handoff:** `docs/strategy/2026-06-08-competitive-activation-master-handoff.md` §WS5

---

## Goal

A single honest "Advisor Prep Hero vs the field" matrix showing how Advisor Prep Hero compares across the four professional verticals and nine named incumbents. Two deliverables:

1. `website/press-kit/comparison-matrix.html` — public press-kit page, deploy-gated
2. `docs/marketing/campaigns/2026-06-reviewer-program/comparison-matrix.md` — condensed reviewer-kit copy

---

## Incumbents covered (9)

| Incumbent | Vertical(s) |
|---|---|
| Clio Duo | Legal |
| CoCounsel (TR) | Legal |
| Intuit Assist | Tax |
| Blue J | Tax |
| Microsoft 365 Copilot | Consulting, cross-vertical |
| Gamma | Consulting |
| Jump | Advisor |
| Zocks | Advisor |
| ChatGPT (consumer tier) | Cross-vertical (the default baseline) |

---

## Matrix structure

One master table. Rows = dimensions/features. Columns = Advisor Prep Hero + 9 incumbents.

**Advisor Prep Hero's wedge columns to show:**
- Local/zero-egress option (with Ollama)
- Own your files (Markdown on disk, portable)
- Profession templates (legal, tax, consulting, advisor)
- Email: local import, search, RAG (coming)
- Price

**Honesty columns — where incumbents win:**
- Proprietary research database (case law / tax authority)
- Practice-management integrations (Clio, Drake, eMoney)
- Meeting-notes + CRM sync
- Deck polish / branded output
- SOC 2 / signed DPA

---

## Guardrails

- No em dashes. No AI-tell vocabulary.
- Advisor Prep Hero price = $49 one-time / $149/yr / $499/yr (never "$499 one-time").
- Competitor pricing = approximate bands + "approximate, as of 2026; verify with vendor" note + outbound link.
- "Nothing leaves your machine" claims scoped to local model only, in the same sentence.
- Every incumbent gets a "where they win" indicator.
- Use "built with input from" not "reviewed by."
- Print-friendly CSS via @media print.
- Shared nav (keepance-nav.v4.js + keepance-nav.v2.css) + kp-footer + canonical tag.
- Light theme (matches press-kit/index.html variables).
- As-of-2026 dated.

---

## Files to write

1. `website/press-kit/comparison-matrix.html`
2. `docs/marketing/campaigns/2026-06-reviewer-program/comparison-matrix.md`

---

## Self-check

- `grep -lP '\x{2014}|&mdash;' website/press-kit/comparison-matrix.html` → empty
- `grep -niE 'leverage|seamless|empower|unlock|transform your|elevate|delve|tapestry|499 one-time' website/press-kit/comparison-matrix.html` → empty
- Canonical tag present: `https://keepance.com/press-kit/comparison-matrix`
- `@media print` block in `<style>` reducing noise for printing
