# Keepance Launch Readiness — 2026-05-28

> **Purpose:** Systematic record of where things stand, what's left, and who does what.
> Scored by area. Updated after each major work session.
>
> **Last updated:** End of 2026-05-28 overnight session. All build-phase work complete.
> Remaining blockers are on Jameson's side (LemonSqueezy, advisor recruitment, citations).

---

## Overall: ~75% launch-ready

The product, copy, templates, and marketing content are all done. What's left is:
1. Jameson updates LemonSqueezy pricing and wires checkout URLs into landing pages
2. Jameson recruits legal and tax advisors to review the template packs
3. Jameson verifies the Heppner citation before it appears in marketing
4. Deploy

---

## Area-by-area scorecard

| Area | Status | Score |
|---|---|---|
| Product (app itself) | Fully functional. v1.5 live on Windows, macOS RC. All profession packs wired in. | ✅ 95% |
| CI / signed builds | Win (Azure), Mac (Apple Developer ID), Linux all building cleanly. | ✅ 90% |
| Infrastructure | Cloudflare tunnel, Caddy, license validator, form handler all live. | ✅ 95% |
| Codebase branding | All Projelli → Keepance renames complete. Zero stale references in live code. | ✅ 100% |
| In-app copy (strings) | All founder/startup/MRR strings purged. Locale files (en/de/es) updated. | ✅ 100% |
| ICP + positioning | Locked 2026-05-27. POSITIONING.md written. All docs updated. | ✅ 100% |
| Sample workspace | Replaced with solo law practice examples (Okafor Law, PLLC). | ✅ 100% |
| First-run profession picker | Built into FirstRunWizard — 4 cards, localStorage persistence. | ✅ 100% |
| Legal Practice pack (v2.1) | 7 draft templates built, wired into registry. Attorney review pending. | 🟡 80% |
| Tax Practice pack (v2.2) | 7 draft templates built, wired into registry. CPA/EA review pending. | 🟡 80% |
| Consulting Practice pack (v2.3) | 5 draft templates built, wired into registry. No advisor gating. | ✅ 95% |
| Vertical landing pages | All three built: /legal-practice/, /tax-practice/, /consulting-practice/ | 🟡 80% |
| Homepage | Rewritten for confidential-client-work ICP. New pricing section. | 🟡 80% |
| Blog posts | 9 posts rewritten for attorney/CPA/consultant audience. | ✅ 100% |
| Press kit + docs | Updated for new ICP, new pricing, new profession framing. | ✅ 100% |
| Sitemap | Updated with all 3 vertical pages. | ✅ 100% |
| Pricing | Architecture decided. **Not yet live in LemonSqueezy. CTA links are placeholders.** | 🟡 40% |
| Advisor recruitment | 0 of 2 advisors recruited. Outreach emails ready to send. | ❌ 10% |
| Citation verification | Heppner **VERIFIED** (No. 1:25-cr-00503-JSR, S.D.N.Y. Feb. 17, 2026). ABA Op 512 confirmed. §7216 framing updated: civil §6713 leads, criminal §7216 reinforcing. Safeguards Rule added to tax page. EU absolute-novelty framing pending patent attorney review. | 🟢 85% |
| Channel outreach | Marketing content all drafted. **Jameson has not sent anything yet.** | 🟡 20% |
| Website deployed | **LIVE.** Deployed 2026-05-28. All three vertical pages live. Old Projelli files deleted. CF cache purged. CTA buttons `href="#"` until PIVOT-11 done. | 🟢 90% |

---

## What Jameson must do next (in priority order)

### 1. Send advisor outreach emails — TODAY

Two separate emails, both ready to copy-paste:

**Attorney advisor (general practice + ideally IP):**
`docs/marketing/campaigns/2026-legal-launch/ADVISOR_OUTREACH_ATTORNEY.md`

Where to find candidates:
- Your existing network — anyone who went to law school or practices now
- Umbrex network (umbrex.com) — some attorneys moonlight there
- LinkedIn: search "solo attorney" or "small firm attorney" with active posting history
- r/LawFirm: active posters who comment helpfully are good cold DM candidates

**CPA/EA advisor:**
`docs/marketing/campaigns/2026-tax-q4/ADVISOR_OUTREACH_CPA.md`

Where to find candidates:
- r/taxpros active posters
- NAEA member directory (naea.org)
- LinkedIn: search "enrolled agent" or "CPA solo practice"

What you need from them: one hour of their time to read 7 templates and say "this is credible" or "here's what's wrong." In exchange: credit in the app + early free access.

---

### 2. Update LemonSqueezy pricing — 20-minute browser task

Log into LemonSqueezy dashboard for store `keepance` (ID `340394`):

1. **Retire** the $29 Founder's Launch product (archive it — 0 sales, no refund obligation)
2. **Verify** the $49 Personal product is correctly configured (BYOK only, no profession pack)
3. **Create** Professional at $129 one-time (Personal + one profession pack of buyer's choice)
4. **Create** Practice at $399 one-time (up to 5 seats, all packs, email support)
5. **Charter pricing** option: $89 for first 100 Professional buyers per pack (set up as a discount code or variant)

After creating the products, grab the LemonSqueezy checkout URLs and paste them into:
- `website/legal-practice/index.html` (search for `href="#"` on the Professional CTA button)
- `website/tax-practice/index.html` (same)
- `website/consulting-practice/index.html` (same)

---

### ~~3. Verify the Heppner citation~~ ✅ DONE

**Verified:** *United States v. Heppner*, No. 1:25-cr-00503-JSR (S.D.N.Y. Feb. 17, 2026), Dkt. No. 27 (Rakoff, J.) is a real case. Consumer Claude use without attorney direction — no privilege protection. Favorable dicta for counsel-directed workflows.

All CRITICAL unverified warnings have been removed from campaign docs. The legal landing page now references the case with proper Kovel-theory framing. The one remaining human check: have your attorney advisor read the specific marketing language and confirm it accurately characterizes the dicta vs. the holding.

---

### 4. Add Plausible conversion goals — 5-minute browser task

Log into `analytics.jamesondaines.com`, navigate to Keepance site goals, and add:

- `/legal-practice/` → goal: `Legal Practice Page Visit`
- `/tax-practice/` → goal: `Tax Practice Page Visit`
- `/consulting-practice/` → goal: `Consulting Practice Page Visit`
- Any outbound click on the Professional CTA button on those pages → goal: `Professional Checkout Click`

---

### 5. Deploy the website — after items 2-3 are done

```bash
cd ~/keepance
bash infra/deploy.sh
```

This rsync's `website/` to `/var/www/keepance.com/` and purges the Cloudflare cache.

Do not deploy before items 2-3 are done — the landing pages have `href="#"` placeholders on the CTAs and the Heppner question affects what can go live.

---

### 6. Send the first channel email / post — after advisor is recruited (item 1)

Once you have one attorney advisor, the first outreach move is:

**Option A (fastest):** Send the Lawyerist guest post pitch. One email, no approval needed.
`docs/marketing/campaigns/2026-legal-launch/LAWYERIST_GUEST_POST_PITCH.md`

**Option B (builds community):** Post to r/LawFirm.
`docs/marketing/campaigns/2026-legal-launch/REDDIT_LAWFIRM_POST.md`

Do both. They're not competing.

---

### 7. ABA TECHSHOW speaker submission — September 2026

**Not urgent today.** Window opens in September. The abstract is written:
`docs/marketing/campaigns/2026-legal-launch/ABA_TECHSHOW_PITCH.md`

Requires a bar-active co-presenter. Recruit from the advisor pool once item 1 is done.

---

## What Claude can still build (no gating needed)

- Above the Law pitch — **done** at `docs/marketing/campaigns/2026-legal-launch/ABOVE_THE_LAW_PITCH.md`
- Bob Ambrogi (LawSites) pitch — not yet written, lower priority than Lawyerist
- Template pre-installation logic (PIVOT-16): wire `getOnboardingProfession()` to pre-populate the workspace with the relevant pack's templates — blocked by advisor reviews first (templates must be production-ready before pre-installing for real users)

---

## What's already done (foundation + overnight build)

**Infrastructure:**
- Product: fully functional, v1.5 live on Windows, macOS RC
- CI: Win/Mac/Linux signed builds automated on git tag
- Cloudflare tunnel, Caddy, license validator live
- LemonSqueezy: store approved, payments live (old pricing — needs update per item 2)
- Code signing: Azure (Windows) + Apple Developer ID (Mac) both live
- Legal docs: Privacy, Terms, EULA live at keepance.com/legal/
- Email: support@keepance.com live (Brevo + CF routing + DKIM)

**App (built overnight):**
- Legal Practice pack: 7 templates wired into app — `src/modules/workflow/templates/legal/`
- Tax Practice pack: 7 templates wired into app — `src/modules/workflow/templates/tax/`
- Consulting Practice pack: 5 templates wired into app — `src/modules/workflow/templates/consulting/`
- First-run profession picker step in `FirstRunWizard.tsx`
- In-app copy: all founder/startup strings purged from components, locale files, general templates
- Sample workspace: replaced with Okafor Law, PLLC examples
- TypeScript: zero errors

**Website (built overnight — ready to deploy after items 2-3):**
- `/legal-practice/index.html` — attorney-focused landing page
- `/tax-practice/index.html` — tax practitioner landing page
- `/consulting-practice/index.html` — consultant landing page
- Homepage: rewritten for confidential-client-work ICP, new pricing section
- Blog: 9 posts rewritten for attorney/CPA/consultant audience
- Press kit, FAQ, getting-started: all rewritten for new ICP
- Sitemap: updated with all 3 vertical URLs

**Strategy + docs (built overnight):**
- `docs/strategy/POSITIONING.md` — canonical positioning reference
- `CHANGELOG.md` — comprehensive entry for all v2.1 changes
- `BACKLOG.md` — PIVOT-08 through 15 marked done, 16-18 added
- `KEEPANCE_BUSINESS_PLAN.md` — 2026-05-28 board record added

**Marketing campaigns (all content ready for Jameson to execute):**
- Legal: advisor outreach, ABA TECHSHOW abstract, Lawyerist pitch + full article draft, Above the Law pitch, IPWatchdog pitch, r/LawFirm post
- Tax: CPA/EA outreach, NAEA/AICPA pitch, r/taxpros post
- Consulting: consultant outreach, Umbrex pitch, Tom Critchlow pitch, Lenny's newsletter pitch, r/consulting post

---

## Milestone targets

| Milestone | Target | Blocked by |
|---|---|---|
| Attorney advisor recruited | ASAP | Jameson sends outreach |
| CPA/EA advisor recruited | ASAP | Jameson sends outreach |
| Heppner citation verified | ASAP | Jameson checks CourtListener |
| LemonSqueezy pricing updated | ASAP | Jameson, browser task |
| Website deployed | After above 4 | `infra/deploy.sh` |
| Legal Practice pack reviewed | After advisor recruited | Advisor reads 7 templates |
| v2.1 shipped with Legal pack | After advisor review | Git tag + CI |
| First legal-channel outreach | After v2.1 | Lawyerist pitch email |
| Tax Practice pack reviewed | Q3 2026 | CPA/EA advisor |
| v2.2 shipped with Tax pack | Q4 2026 | Advisor review done |
| Q4 2026 tax campaign | Oct–Jan 2027 | v2.2 shipped |
| Consulting pack outreach | Parallel with tax | Umbrex + Lenny pitches |

---

*Last updated: 2026-05-28 (end of overnight build session) by Claude*
