# Keepance Site Redesign — Gap Analysis & Execution Plan
**Date:** 2026-05-28  
**Author:** Claude (CEO session)  
**Status:** Execution in progress

---

## Background

On 2026-05-27 to 2026-05-28, two parallel tracks of website work were done:

- **Track A (overnight build session):** The old Projelli-branded `website/` was overhauled for the new ICP (attorneys, CPAs, consultants). Three vertical landing pages were built (`/legal-practice/`, `/tax-practice/`, `/consulting-practice/`), blog posts were rewritten, and deep legal/tax authority content was added.
- **Track B (separate session):** A complete visual redesign was done in `website-keepance/` — dark navy (`#0A2540`), blue/pink gradient (`#FF3CE8` / `#5DC6FF`), Satoshi typeface, new logo, self-contained HTML with inline CSS. This resulted in two files: `index.html` and `logoideas.html`.

Track A was deployed to the live site. Track B was not — it lived in `website-keepance/` untouched by the deploy script. This session identified the discrepancy, restored Track B's design as the canonical homepage, and this document records the gap analysis + execution plan.

---

## What the New Design Does Better (do not revert)

| Element | Assessment |
|---|---|
| Dark navy + blue/pink palette | Premium, professional, appropriate for legal/tax/consulting |
| Satoshi typeface (fontshare) | More polished than old Inter/system stack |
| Feature rows with inline mockups | Finder mockup, RAG query, cost comparison — more persuasive than old feature grid |
| "Who it's for" profession cards | Cleaner ICP focus than old homepage |
| Pricing on dark navy background | Dramatic and premium |
| Charter pricing note in hero | In the right place — near email signup |
| Legal disclaimer section | Appropriate, well-worded, below pricing |
| Self-contained HTML | No dependency on keepance-nav.v2.js or external CSS — more portable |

---

## Gap Analysis: Old Site → New Site

### Tier 1 — Functional Blockers

| # | Gap | Impact | Fix |
|---|---|---|---|
| 1 | All pricing CTAs are `href="#"` | Zero revenue path | Wire LemonSqueezy URLs |
| 2 | No OS-aware download | Download friction | Add navigator.platform detection |
| 3 | Vertical landing pages use old design | Brand inconsistency for search/referral traffic | Rebuild all three in new design system |

### Tier 2 — High-Value Content

| # | Gap | Impact | Fix |
|---|---|---|---|
| 4 | Heppner citation missing from attorney card | Sharpest legal marketing hook unused | Add to attorney card + legal landing page |
| 5 | Tax card leads §7216 criminal, should lead §6713 civil | Weaker hook — civil strict-liability is scarier | Update card copy |
| 6 | FTC Safeguards Rule / WISP missing | Missed urgency hook for tax practitioners | Add to tax card + tax landing page |
| 7 | EU absolute-novelty rule missing | Patent attorney sub-niche hook unused | Add to attorney card |

### Tier 3 — Polish

| # | Gap | Impact | Fix |
|---|---|---|---|
| 8 | No blog link in nav/footer | 9 SEO posts unreachable | Add to footer |
| 9 | No press kit link | Journalists/bloggers hit dead end | Add to footer |
| 10 | No "Built by" section | Trust gap for solo product | Add minimal founder section above footer |

---

## What Was NOT Carried Over (intentional)

| Item | Reason |
|---|---|
| Hero animation (vanilla JS state machine) | New feature-row mockups are more persuasive; complexity not worth it |
| Founder-era template pages (`/founder-workflow-templates/`, 15 detail pages) | Wrong ICP — retired |
| `/ai-for-indie-founders/` | Wrong ICP |
| Platform download dropdown accordion | New OS-detection approach is cleaner |
| `keepance-preview.html` | Unclear purpose; not linked; safe to leave unlinked |
| SEO satellite pages (`/byok-ai/`, `/local-first-ai-workspace/`, etc.) | Old design — lower-priority restyle; still live for SEO, not linked prominently |

---

## Execution Checklist

- [ ] Task 1: Document analysis (this file)
- [ ] Task 2: Add Built by Jameson section
- [ ] Task 3: Wire LemonSqueezy CTAs
- [ ] Task 4: Add blog + press-kit footer links
- [ ] Task 5: OS-aware download logic
- [ ] Task 6: Heppner + EU novelty in attorney card
- [ ] Task 10: Fix tax card (§6713 lead, Safeguards Rule)
- [ ] Task 7: Rebuild legal-practice landing page
- [ ] Task 11: Rebuild tax-practice landing page
- [ ] Task 8: Rebuild consulting-practice landing page
- [ ] Task 9: Sync + deploy

---

## Key Design Tokens (new site)

```css
--obsidian: #1A1C20;
--navy: #0A2540;
--navy-mid: #12345A;
--grad-pink: #FF3CE8;
--grad-blue: #5DC6FF;
--bone: #F5F5F0;
--bone-dark: #EEEEE8;
--white: #FFFFFF;
```

Font: `Satoshi` via `https://api.fontshare.com/v2/css?f[]=satoshi@800,700,400&display=swap`

---

*Last updated: 2026-05-28 (execution session) by Claude*
