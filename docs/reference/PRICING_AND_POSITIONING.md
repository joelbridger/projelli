# Keepance Pricing & Positioning, Canonical Spec

**Status:** Source of truth as of 2026-05-29. Supersedes any pricing language elsewhere.
**Owner:** Jameson Daines.
**Scope:** Authoritative reference for every price, tier, promo, and positioning line in marketing copy, the app, the store (LemonSqueezy), Schema.org, and the business plan. If any other file disagrees with this one, this file wins and the other file is a bug.

---

## 1. The model in one paragraph

Keepance is a local-first, BYOK desktop AI workspace for confidential client work (attorneys, CPAs, independent consultants). Sold as a **one-time purchase with a perpetual license**, no subscription. There is a **30-day free trial** (full app, no credit card) in place of a permanent free tier. The permanent free tier and the old "Lifetime $99" tier are **retired** and must never appear in copy again.

## 2. Tiers (canonical)

| Tier | Price | Seats | Packs | One-line positioning |
|---|---|---|---|---|
| **Personal** | **$49 one-time** | 1 | None (bring your own templates) | "A private AI workspace you own." General confidential work. |
| **Professional** | **$129 one-time** | 1 | One profession pack (Legal / Tax / Consulting) | "Your profession, done for you." **This is the tier we sell.** |
| **Practice** | **$399 one-time** | Up to 5 | All three packs | "For the small firm." Multi-seat + every pack. |

**Every tier includes:** full editor, file tree, Markdown, wiki-links, backlinks, version history, audit log, all four AI providers (Claude / OpenAI / Gemini / Ollama, BYOK), whiteboard, audio + transcription, research/citations, multi-model comparison, semantic search (LanceDB, PDFs included), local Piper read-aloud, sandboxed plugin runtime, MCP server, unlimited workspaces.

**The only thing separating Personal from Professional is the profession pack.** Deliberate. See section 5.

## 3. Charter offer (launch promo, canonical)

- **Professional at $89 instead of $129**, for the **first 100 buyers of each profession pack**.
- Capped at 100 per pack. When a pack's cap fills, that pack reverts to $129.
- Replaces the **retired** "$29 Founder's Launch lifetime" promo (0 sales, no obligation).
- Framing: "Founding-practitioner pricing. Reserve the $89 founding price." Always honest that, pre-checkout, this is a reservation via the email list.

## 4. Trial / license / refund (canonical wording)

> 30-day free trial, no credit card. One-time purchase, perpetual license. Updates and security patches included for the life of the product. New profession packs sold separately. 14-day refund after purchase.

## 5. Positioning: why Personal is a "starter," not a discount Professional

Personal and Professional run the **same app**; the only differentiator is the profession pack. Left unframed, Personal looks like "Professional minus $80," which cannibalizes the tier we want to sell. The fix is **positioning, not feature-crippling**:

- **Personal = "general use, bring your own templates."** The honest entry point for the buyer who just wants a private AI workspace and was never going to pay for a pack.
- **Professional = "your profession, done for you."** The Legal/Tax/Consulting pack runs the structured AI interview and produces the actual document.

A solo attorney isn't comparing feature lists; they're deciding whether to write their own engagement-letter scaffolding (Personal) or have the Legal pack produce it (Professional). The ICP self-selects into Professional.

**We do NOT gate AI providers or core features to force the upgrade.** That punishes the wrong buyers and reads as petty. The pack is the line. Standing rule for both copy and the app's entitlement logic.

## 6. Canonical copy snippets (reuse verbatim)

**Price recap (one line):**
> Personal $49 (general use, bring your own templates), Professional $129 (adds your profession's practice pack), Practice $399 (up to 5 seats, all packs). One-time purchase, no subscription.

**CTA (current pre-checkout state):**
> Download free for 30 days, no credit card. [Download free for 30 days -> /#pricing]

**Charter line:**
> Founding offer: the first 100 buyers of each practice pack get Professional at $89 instead of $129. Reserve the founding price while checkout opens.

**3-year cost anchor (comparison pages):** Professional $129 + BYOK ~$60-180/yr = **$309-669 over 3 years**; typical (~$120/yr BYOK) ~ **$489**. Always anchor cost comparisons on Professional $129, never on the $49 Personal floor.

## 7. Heppner (use verbatim if AI-privilege is referenced)

> A February 2026 S.D.N.Y. ruling (United States v. Heppner) found that consumer AI use without attorney direction offers no privilege protection.

## 8. FORBIDDEN strings (never in user-facing copy)

`$99 Lifetime`, `Lifetime`, `$29`, `Founder's Launch`, `Pro $49` / `Pro is $49`, `free tier`, `free forever`, `free download`, `free to download`, `pay once (or zero)`, any permanent-free-tier implication. (Competitor facts like "Obsidian is free" or "Rewind $480 lifetime" are allowed.)

## 9. Voice rules (bound to all copy)

- **No em dashes** in user-facing prose. Commas, periods, or parentheses. (Internal docs/code comments exempt, but prefer to avoid.)
- No "It's not X, it's Y" antithesis. No "leverage / delve / seamless / transform / empower / elevate / unlock / streamline / robust / cutting-edge."
- See `~/.claude/.../feedback_no_em_dashes.md`, `reference_ai_writing_tells.md`, and CLAUDE.md voice rules.

## 10. System sources that must match this spec (status 2026-05-29)

| System | State | Action needed |
|---|---|---|
| `website/index.html` pricing cards | Correct ($49/$129/$399, $89 charter); Personal card differentiated | none |
| `website/{legal,tax,consulting}/index.html` | Correct; buy buttons commented out | Restore buy buttons at checkout go-live |
| `website/vs/*.html` | Done (10 pages, sharpened recap) | none |
| LemonSqueezy products | Professional + Practice variants exist (IDs below); checkout not public | Create/confirm Personal $49 + $89 charter; go live |
| Schema.org (homepage) | Offers Personal 49 / Professional 129 / Practice 399 | Verify stays in sync |
| App license entitlement | Unknown whether pack is gated to Professional | Gate ONLY the pack to Professional+; do not gate providers/core |

**Known LemonSqueezy variant IDs (from commented buy buttons):**
- Professional ($129): `33cd497b-bffd-404c-910e-f8dd1f4453bd`
- Practice ($399): `9a5a7f48-0ffe-448a-a1af-889af99a0f47`
- Personal ($49): not yet found in code, confirm/create.
