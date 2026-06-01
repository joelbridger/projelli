# Keepance Backlog
*(formerly Keepance — renamed 2026-05-27)*

---

> **CURRENT STATE (2026-06-01): read `docs/operations/SESSION_HANDOFF_2026-06-01.md` first.**
> **v2.1.1 is LIVE** (signed Windows installer + Windows auto-update restored; the Azure free-trial -> Pay-As-You-Go
> upgrade fixed the signing 403). **All 4 LemonSqueezy products are created + published** with checkout URLs.
> Revenue loop NOT closed yet: license-server tier mapping (#2) is **code-complete + unit-tested (staged, not
> yet live — goes live on the next restart once Jameson provides the LS creds)**; remaining is the site
> subscription pricing + checkout wiring (#3, deploy-gated), and on Jameson the LemonSqueezy API key/webhook
> secret + the Founding 100-seat cap. Advisors + bio still open. The handoff doc has the exact next steps.

---

## Pivot — 2026-05-27

### PIVOT-01 — Name and domain — DONE
Renamed product to Keepance. keepance.com registered. keepance.so registered (defensive).

### PIVOT-02 — Business plan locked — DONE
KEEPANCE_BUSINESS_PLAN.md updated with 2026-05-27 board entry locking name, positioning, ICP, pricing, template strategy.

### PIVOT-03 — Pre-pivot codebase snapshot — DONE
Git tag `pre-pivot-indie-founder-2026-05-27` on commit `5117b64`. Archive at `~/keepance-backups/keepance-indie-founder-complete-2026-05-27.tar.gz` (446 MB).

### PIVOT-04 — keepance.com site live — DONE
Production site deployed to `/var/www/keepance.com/`. Caddy config updated: keepance.com served, keepance.com → keepance.com (301 permanent). Source at `~/keepance/website-keepance/`. Deploy script: `~/keepance/infra/deploy-keepance.sh`.

### PIVOT-05 — Legal advisor outreach — TODO (Jameson sends)
Outreach templates ready at `docs/marketing/campaigns/2026-legal-launch/ADVISOR_OUTREACH_ATTORNEY.md` (warm + cold versions). Patent attorney outreach at `ADVISOR_OUTREACH_PATENT_ATTORNEY.md`. Site is live. Send now.

### PIVOT-06 — Old marketing arsenal archived — DONE (2026-05-27)
Moved to `docs/marketing/archive/2026-indie-founder-positioning/`. New campaign folders created: `docs/marketing/campaigns/2026-legal-launch/`, `2026-tax-q4/`, `2026-consulting/`.

### PIVOT-07 — App internals renamed (Tauri / package.json) — TODO
Update `tauri.conf.json` (productName, identifier), `package.json` (name), about screen, window title bar, installer names. Requires new code-signed build. Non-urgent — user-visible strings are clean; this is installer/system-level naming.
Note: grep confirmed no `projelli` references remain in `package.json` or `src-tauri/`. Remaining work is likely in `tauri.conf.json` fields (productName, identifier) and installer bundle name — low urgency, affects system-level install path and About screen only.

### PIVOT-08 — Legal Practice pack templates (v2.1) — DONE (drafts complete 2026-05-28)
7 draft templates at `src/modules/workflow/templates/legal/`. All marked `@draft` pending advisor review.
Wired into `allWorkflows` registry. Blocked from production deploy by: PIVOT-05 (advisor recruited + review).
7 templates: Deposition Contradiction Finder, Evidence Gap Analyzer, Case Timeline Builder, Privilege Log Drafter, Discovery Document Triage, Patent Disclosure Draft, Client Intake Synthesizer.

### PIVOT-08b — keepance.com/legal-practice/ landing page — DONE (2026-05-28)
`website/legal-practice/index.html` complete. ABA Opinion 512 cited. Heppner citation VERIFIED and added (2026-05-28): *United States v. Heppner*, No. 1:25-cr-00503-JSR (S.D.N.Y. Feb. 17, 2026), with Kovel-theory framing.
Deploy gate: PIVOT-11 (LemonSqueezy pricing). Citation gate cleared.

### PIVOT-09 — Tax Practice pack templates (v2.2) — DONE (drafts complete 2026-05-28)
7 draft templates at `src/modules/workflow/templates/tax/`. All marked `@draft` pending advisor review.
Wired into `allWorkflows` registry. Landing page at `website/tax-practice/index.html`.
Blocked from production deploy by: CPA/EA advisor recruited + §7216 framing reviewed (PIVOT-12).
7 templates: Engagement Letter Builder, Pre-Review Checklist, §7216 Consent Template, Tax Research Memo, Client Document Inventory, Audit Defense File Builder, Quarterly Estimate Reminder.
Outreach ready at `docs/marketing/campaigns/2026-tax-q4/ADVISOR_OUTREACH_CPA.md`.

### PIVOT-10 — Consulting Practice pack templates (v2.3) — DONE (drafts complete 2026-05-28)
5 draft templates at `src/modules/workflow/templates/consulting/`. No statutory claims; consultant read recommended.
Wired into `allWorkflows` registry. Landing page at `website/consulting-practice/index.html`.
5 templates: Client Discovery Synthesizer, Confidential Research Memo, Stakeholder Map Generator, NDA-Safe Slide Outliner, Engagement Retrospective Builder.
Campaign folder at `docs/marketing/campaigns/2026-consulting/`.

### PIVOT-11 — LemonSqueezy products — DONE (2026-05-31, store #340394)
Created + published under the ratified subscription model (supersedes the old all-one-time line):
**Personal $49 one-time**, **Professional $149/yr subscription**, **Professional (Founding) $99/yr subscription**,
**Practice $499 one-time**. Checkout URLs captured in `docs/operations/SESSION_HANDOFF_2026-05-31.md`.
REMAINING: (a) set the Founding **100-seat inventory cap** on its variant before that URL goes live; (b) Jameson
provides the **API key + webhook secret** for the license-validator; (c) wire the 4 URLs into the site (#3, deploy-gated).
Store also hosts Guesslet Pro, so the validator must filter to Keepance products.

### PIVOT-12 — Citation verification — PARTIALLY DONE (2026-05-28)
- [x] **Heppner** — VERIFIED: *United States v. Heppner*, No. 1:25-cr-00503-JSR (S.D.N.Y. Feb. 17, 2026). All campaign docs and landing pages updated. Cleared for marketing copy.
- [x] **ABA Formal Opinion 512** — Confirmed real. Framing corrected: removed "specifically designed to satisfy" overclaim; replaced with accurate language about removing Keepance from the data path.
- [x] **§7216 / §6713 framing** — Updated across all copy: civil §6713 (strict liability, $250/disclosure, no intent) now leads; criminal §7216 is reinforcing context. Cleared without advisor needed for this framing.
- [x] **Circular 230 §§10.35-10.37** — Stale "covered opinions" parenthetical corrected. Current names: §10.35 = Competence, §10.36 = Procedures, §10.37 = Written Advice (post T.D. 9668, 2014).
- [ ] **EU absolute-novelty framing** — Still requires patent attorney review before Patent Disclosure Draft template ships. Blocked: PIVOT-05 (patent attorney advisor).
- [ ] **Attorney advisor gut-check on Heppner marketing language** — One bar-active read to confirm our specific framing accurately characterizes dicta vs. holding. Blocked: PIVOT-05.

### PIVOT-13 — In-app copy fully profession-neutral — DONE (2026-05-28)
All user-facing founder strings removed: components, locale files (en/de/es), workflow template prompts, onboarding wizard, sample workspace files. General templates (WeeklyReview, BoardMeeting, FinancialModel, etc.) rewritten with professional-practice placeholder text.

### PIVOT-14 — ABA TECHSHOW speaker submission — TODO (September 2026)
Submission template ready at `docs/marketing/campaigns/2026-legal-launch/ABA_TECHSHOW_PITCH.md`. Requires: (1) attorney co-presenter recruited (PIVOT-05). Heppner citation gate cleared (PIVOT-12). Submission window opens ~September 2026.

### PIVOT-15 — First-run profession picker — DONE (2026-05-28)
Profession step added to `FirstRunWizard.tsx` between welcome and workspace. Four cards: Legal, Tax, Consulting, Other. Selection stored in `localStorage` as `keepance_profession`. Helper `getOnboardingProfession()` exported for template pre-installation logic.

### PIVOT-16 — Template pre-installation from profession picker — TODO
Wire `getOnboardingProfession()` into workspace initialization: when a user selects a profession during onboarding, pre-populate their `.keepance/templates/` folder with the relevant pack's template shortcuts. Blocked by: PIVOT-08/09/10 advisor reviews (templates must be production-ready before pre-installing).

### PIVOT-17 — Deploy updated website — DONE (2026-05-28)
Deployed via `~/keepance/infra/deploy.sh --skip-demo`. All three vertical landing pages live. Old Projelli blog/nav files deleted. Cloudflare cache purged. Permission fix applied: `sudo find /var/www/keepance.com -type d -exec chmod g+w {} \;` (was root-owned 755; now group-writable for future sudo-free deploys).
Note: CTA buttons on vertical pages are still `href="#"` — live but non-functional until PIVOT-11 (LemonSqueezy) is done.

### PIVOT-18 — Above the Law pitch — DONE (2026-05-28)
`docs/marketing/campaigns/2026-legal-launch/ABOVE_THE_LAW_PITCH.md` — editorial pitch to Kathryn Rubino/Joe Patrice + sponsored content option. Ready to send after Legal pack ships.

### PIVOT-19 — Bob Ambrogi (LawSites) pitch — DONE (2026-05-28)
`docs/marketing/campaigns/2026-legal-launch/BOB_AMBROGI_LAWSITES_PITCH.md` — cold email (~175 words) + extended product review brief (~300 words). Send after Legal pack ships and v2.1 is tagged. Bob Ambrogi is the highest-credibility solo/small-firm legal tech journalist; a LawSites mention is worth more than most paid placements.

### PIVOT-20 — Template pre-installation research action plan — DONE (2026-05-28)
`docs/strategy/RESEARCH_ACTION_PLAN.md` written. Three AI research reports ingested; plan produced covering template redesigns, marketing copy corrections, and the minimal human-verification list (5 items).

---

> **🚀 LAUNCH STATUS (2026-04-27):** v1.6.0 is the first commercial release.
> Public, signed, notarized, license-activated, end-to-end paid loop verified
> on a real LemonSqueezy purchase. See
> `docs/operations/SESSION_2026-04-27_v1.6.0_SHIPPED.md` for the full launch
> session record and the rc.5 → rc.17 → v1.6.0 fix arc.
>
> **Last updated:** 2026-04-27 (post-launch).
> **Plan:** See `KEEPANCE_BUSINESS_PLAN.md` for the full 8-week roadmap and reasoning behind each ticket.
> **How to use:** Tickets are organized by week of the launch roadmap. Within each week, work top to bottom. Use status `TODO` / `IN PROGRESS` / `DONE` / `BLOCKED`. When something is `BLOCKED`, name what's blocking it.
>
> **What's next post-launch:** marketing push (PH/HN/IH per `docs/marketing/`),
> beta tester outreach (`docs/marketing/action-packs/BETA_TESTER_CANDIDATES.md`),
> demo videos (in progress), CF cache purge automation, UX-42 (Windows
> updater-sign in CI), v1.7 (Linux as a supported platform).

---

## Week 1 — Phase 0 + Phase 1 jump-start (2026-04-08 → 2026-04-15)

### W1-01 — Add `.gitattributes` for line endings — DONE
Stop CRLF noise from polluting future diffs. Single normalization commit.
**Done in commit `8bfa637`.**

### W1-02 — Commit local source improvements (tab persistence + open-in-explorer) — DONE
5 files of real uncommitted work that needed to be committed before they got lost.
**Done in commit `fa80df4`.**

### W1-03 — Reorganize root .md files into `docs/` subdirs — DONE
Mirror jameworld layout: `docs/reference/`, `docs/operations/`, `docs/quality/`, `docs/archive/`.
**Done — root reduced from 13 .md files to 3 (CHANGELOG, CLAUDE, BUSINESS_PLAN).**

### W1-04 — Sync `website/index.html` with live + create `infra/deploy.sh` — DONE
Live `/var/www/keepance.com/index.html` is canonical. Pulled into repo. Deploy script created.

### W1-05 — Draft GitHub Actions release workflow — DONE
`.github/workflows/release.yml` builds Tauri installers for Win/Mac/Linux on git tag.
Won't actually run until pushed and a tag is created.

### W1-06 — Write a real `README.md` — TODO
Public-facing repo intro. What is Keepance, install, dev setup, link to business plan.

### W1-07 — Push everything to `keepance/keepance` — DONE
Pushed 3 commits (`8bfa637`, `fa80df4`, `069c6e5`) to `joelbridger/keepance`, then transferred the repo to the new `keepance` org. Old URLs auto-redirect.

### W1-08 — Resolve push credentials — DONE
Authenticated `gh` CLI as joelbridger account on the server. Both joelbridger and scottdaly accounts now coexist in `~/.config/gh/hosts.yml`. joelbridger has admin access on the (now transferred) `keepance/keepance` repo via org ownership.

### W1-09 — Write minimum-viable legal docs — DONE
_Privacy, Terms, EULA written and live at /legal/{privacy,terms,eula}.html. Customized for local-first BYOK paid software, US (Texas) jurisdiction, 14-day refund._
Privacy Policy, Terms of Service, EULA. Templates from TermsFeed or Iubenda (~$30/yr) are fine for v1. Customize for: local-first BYOK, no data collection, no PII storage, US jurisdiction.
- Output: `website/legal/privacy.html`, `website/legal/terms.html`, `website/legal/eula.html`
- Wire into footer links on landing page

### W1-10 — Write Getting Started doc + API Keys Guide + FAQ — DONE
_Getting Started, API Keys Guide, FAQ written and live at /docs/{getting-started,api-keys,faq}.html._
Three separate Markdown pages served from the live site.
- `website/docs/getting-started.html` — install, first workspace, first AI chat
- `website/docs/api-keys.html` — how to get a Claude/OpenAI/Gemini key, where to paste, how it's stored
- `website/docs/faq.html` — common questions, privacy, billing, refund policy

### W1-11 — Set up `support@keepance.com` — DONE
_Brevo registered keepance.com sender, DNS configured (DKIM + SPF + DMARC), CF Email Routing enabled with catch-all → jamesondaines@outlook.com. Brevo verified the domain. noreply@keepance.com sender created._
Same pattern as the other 4 sites: CF Email Routing inbound → `jamesondaines@outlook.com`, Brevo outbound for any automated mail. See `~/.claude/projects/-home-jameson/memory/project_email_architecture.md`.

### W1-12 — Replace footer placeholder `#` links — DONE
_Footer rewritten with Docs and Legal columns. All # placeholder links replaced._
The live homepage footer has 8 placeholder links (Documentation, Getting Started, API Keys Guide, Blog, Community, Privacy Policy, Terms of Service, License). Replace with real links once W1-09 + W1-10 are done.

### W1-13 — Update Plausible goals — TODO
_Plausible goals (Download click, GitHub click, Buy click) — requires browser access to dashboard. Punted to next session._
Add conversion goals to the Plausible dashboard for keepance.com:
- `Download click` (anyone who clicks a download CTA)
- `GitHub click`
- `Buy click` (later, when Buy button exists)

### W1-14 — Run trademark search — DONE
_USPTO TESS + Google searches show no conflicts. Documented in docs/reference/TRADEMARK_SEARCH.md. Formal filing deferred to month 2 of revenue._
USPTO TESS search for "keepance" in classes 9 + 42. Google search for any conflicts. Free, ~30 minutes. Document results in `docs/reference/TRADEMARK_SEARCH.md`. If clean → defer filing to Month 2 of revenue.

### W1-15 — Update CLAUDE.md for current state — DONE
_CLAUDE.md prelude rewritten to point at KEEPANCE_BUSINESS_PLAN.md and document the new file layout. Flags Jameson as non-developer._
The repo's `CLAUDE.md` was written during the v1 dev phase. Update to reflect:
- Server-resident, canonical at `~/keepance/`
- Linked to `KEEPANCE_BUSINESS_PLAN.md` as the operating contract
- Pointers to key files and the new `docs/` layout
- Note that Jameson is not a developer — explain things in plain language

### W1-16 — Set up `keepance` org profile — DONE
_Org metadata set via API: description, blog (keepance.com), email (support@keepance.com). Profile README at github.com/keepance/.github/profile/README.md._
Add a bio, logo (the pink-bean Keepance logo), website link, and a public profile README at `github.com/keepance/.github`. README should explain what Keepance is, who built it (Jameson Daines), and link to keepance.com. ~10 min.

---

## Week 2 — Cross-platform CI

### W2-01 — Test the GitHub Actions workflow — TODO
Push a `v1.0.1-test` tag. Watch the workflow run for all 4 platforms. Fix anything broken. Delete the test tag and release after verification.

### W2-02 — Procure Windows code signing — TODO (Jameson action required)
Try Azure Trusted Signing first (~$10/mo). If ineligible, use SSL.com OV cert (~$160/yr). Document the choice in `docs/operations/CODE_SIGNING.md`.

### W2-03 — Wire Windows signing into the workflow — TODO
Once W2-02 cert is in hand, base64-encode the .pfx (or set up Azure signing differently) and add the secrets to GitHub Actions. Update the workflow to actually sign the .exe.

### W2-04 — Begin Apple Developer enrollment — TODO (Jameson action required)
Apply at developer.apple.com/programs ($99/yr). 5-7 day approval window. Start in Week 2 so it's ready for Week 3.

### W2-05 — Build and release v1.0.1 with all the uncommitted fixes — TODO
First release using the new CI pipeline. Should include: tab persistence, open-in-explorer fix, signed Windows .exe. Mac/Linux can be unsigned for this release.

---

## Week 3 — macOS notarization + template gap

### W3-01 — Wait for Apple Developer approval — TODO
External dependency on Apple, no action while waiting.

### W3-02 — Set up macOS signing certificates — TODO
Once approved, create a Developer ID Application certificate, export as .p12, base64-encode, add to GitHub Secrets. Generate an app-specific password for notarization.

### W3-03 — Wire macOS notarization into the workflow — TODO
Update `.github/workflows/release.yml` to sign + notarize the .dmg. Test on a real Mac (borrow one if needed).

### W3-04 — Build the 3 missing templates — DONE
_Built InvestorUpdate, BoardMeetingPrep, FirstHirePlaybook in src/modules/workflow/templates/. Registered in src/modules/workflow/index.ts. TypeScript clean._
Add to `src/modules/workflow/templates/`:
- `InvestorUpdate.ts` — monthly recurring update doc structure
- `BoardMeetingPrep.ts` — agenda, metrics review, decisions queue
- `FirstHirePlaybook.ts` — JD, interview rubric, scorecard, onboarding plan
- Update template registry in `WorkflowEngine.ts` to include them

### W3-05 — Update homepage template gallery — DONE
_Homepage template gallery rewritten to list the real 15 founder workflows. Deployed to live site._
Replace the fake "D&D / hobby / gaming" templates with the real 15 founder-focused ones. Update copy to reflect founder positioning.

### W3-06 — Release v1.1.0 (cross-platform signed builds + 15 real templates) — TODO

---

## Week 4 — Monetization

### W4-01 — Set up LemonSqueezy account + product — TODO (Jameson action required)
Sign up at lemonsqueezy.com. Create a Keepance store. Create 3 products:
- Pro: $49 one-time
- Lifetime: $99 one-time
- Founder's Launch: $29 one-time, capped at 100 sales (use LS's quantity limit feature)

### W4-02 — Build license validation Bun service — DONE
_license-validator Bun service at ~/services/license-validator/. Live at https://licenses.keepance.com (CF tunnel → Caddy → 127.0.0.1:5181). Ed25519 keys auto-generated. Awaiting LEMONSQUEEZY_API_KEY in /etc/license-validator.env (set when account exists)._
New service at `~/services/license-validator/`, mirroring `~/services/form-handler/` pattern.
- `POST /activate` — validates LemonSqueezy key, returns signed JWT
- `POST /validate` — verifies existing JWT
- `POST /webhook` — handles LS webhooks for revocation
- Systemd unit at `/etc/systemd/system/license-validator.service`
- Caddy reverse proxy: `licenses.keepance.com` → `127.0.0.1:5181`
- Cloudflare DNS + tunnel ingress

### W4-03 — Generate Ed25519 signing keys — DONE
_Ed25519 keypair generated on first service start. Private key at ~/services/license-validator/keys/ed25519-private.pem (chmod 600). Public key at ed25519-public.pem._
Private key on the server (chmod 600), public key embedded in the Tauri app for offline JWT validation.

### W4-04 — Build in-app activation flow — DONE
_useLicense hook (src/hooks/useLicense.ts) handles activate/validate/deactivate. LicenseSettings component (src/components/settings/LicenseSettings.tsx) is the UI. Cannot test end-to-end until LemonSqueezy is set up._
- New settings screen: "License" section
- "Activate License" button → input → call `/activate` → store JWT in keychain
- "Deactivate" button → clear local JWT
- Show current tier in the settings header

### W4-05 — Build tier-gating logic — DONE
_tierHasFeature() helper in src/hooks/useLicense.ts. Free vs Pro vs Lifetime feature gates defined. Wiring into individual components is left for incremental work as those features get touched._
Helper hook `useTier()` returns `'free' | 'pro' | 'lifetime'`. Gate features:
- Free: 1 AI provider (Claude), 3 templates, 1 workspace
- Pro: 3 providers, 15 templates, unlimited workspaces, whiteboard, audio, research/citations, multi-model comparison
- Lifetime: same as Pro + early access flag

### W4-06 — Update homepage Pricing section — TODO
Replace disabled "Coming Soon" Pro button with real LemonSqueezy checkout link. Add Lifetime card. Add Founder's Launch banner ("First 100 buyers — $29 lifetime").

### W4-07 — Test the full money flow end-to-end — TODO
Buy → email → activate → unlock → restart app → still unlocked. Use LemonSqueezy test mode.

### W4-08 — Release v1.2.0 with monetization — TODO

---

## Week 5 — Polish + launch assets

### W5-01 — Build the 30-second demo video — DONE
_JS state-machine animated demo in website/index.html hero. 30-second loop: type prompt → AI streams → file appears → editor switches. Respects prefers-reduced-motion._
Auto-playing loop. Same React animation pattern as `~/behaviorux/site/`. Show: type question → AI streams response → real files appear in workspace → click to edit. Save as MP4 + WebM. Embed on landing page hero. See `~/.claude/projects/-home-jameson/memory/reference_web_animation_patterns.md`.

### W5-02 — Take 6 high-quality screenshots — TODO
1. Workspace overview with file tree + editor
2. AI chat in action (mid-stream)
3. File tree with wiki-links highlighted
4. Version history view
5. Multi-model comparison
6. Settings / license screen
Save to `website/images/screens/`. Replace mockup section on landing page.

### W5-03 — Add Sentry/GlitchTip crash reporting — TODO
Self-hosted GlitchTip preferred (free, on the home server). Add the SDK to the Tauri app. Privacy: only collect crash stack traces, no user content.

### W5-04 — Build first-run onboarding wizard — DONE
_FirstRunWizard component in src/components/onboarding/FirstRunWizard.tsx. 4-step flow (Welcome → Workspace → API Key → Demo) with skip option._
When the app opens with no workspace, show a wizard:
- Step 1: Pick a starter workspace location
- Step 2: Paste a Claude API key (with a "skip for now" link)
- Step 3: Run the New Business Kickoff workflow on a sample idea
- Step 4: Show the resulting files with a "this is what Keepance does" callout

### W5-05 — Add email list signup to homepage — DONE
_Email signup form on the homepage hero. Wires to /api/forms/keepance/email-list via form-handler service. Brevo email notifications working. Sign-ups stored at ~/keepance/sign-ups/ (gitignored)._
Use Brevo or Listmonk. Capture name + email. One-tap unsubscribe. Privacy-respecting.

### W5-06 — Soft launch on X founder Twitter — TODO
Single thread teasing the hard launch. Demo video + 3-line story. Drive to email list signup.

### W5-07 — Recruit 20 beta testers — TODO
Wheel Health network, friends, IndieHackers DMs. Gift them a free Lifetime license in exchange for honest feedback before the hard launch.

---

## Week 6 — HARD LAUNCH

### W6-01 — Coordinate Product Hunt launch — TODO
Tuesday or Wednesday morning PT. Find an established PH user to "hunt" us (better algorithm signal). Prep: tagline, gallery, demo video, first comment, FAQ in comments.

### W6-02 — Show HN post — TODO
Same day as PH. Title: "Show HN: Keepance – Local-first AI workspace where every chat becomes a real file". Be present in comments all day.

### W6-03 — Email the list — TODO
Single launch email with the Founder's Launch $29 lifetime offer. Subject: "It's live: Keepance is shipping today (and the first 100 buyers get lifetime for $29)"

### W6-04 — All-hands support day — TODO
Reply to every PH comment within 30 minutes. Reply to every HN comment in real time. Reply to every email within 1 hour. The launch is the engagement.

### W6-05 — Track conversions — TODO
Monitor: PH ranking, HN points, traffic via Plausible, conversions via LemonSqueezy. Goal: top 5 PH for the day, HN front page for ≥4 hours, 10+ paying customers by end of day.

---

## Week 7 — Distribution waterfall

### W7-01 — Submit to AlternativeTo — TODO
Position vs Notion AI, Obsidian Copilot, Reflect, Tana. Add screenshots, video, real comparison points.

### W7-02 — IndieHackers post — TODO
Narrative format: "I built and launched Keepance in 8 weeks — here's what happened". Include real revenue numbers from Week 6. Drive to the product page.

### W7-03 — Reddit launches — TODO
Posts to: r/SideProject (Sunday Show & Tell), r/Entrepreneur, r/ChatGPTPro, r/LocalLLaMA, r/SaaS. Each post tailored to the subreddit.

### W7-04 — Newsletter outreach — TODO
Cold-email the editors of: BetaList, MicroSaaS, StarterStory, Indie Hackers Daily, Refind, MakerNews. Pitch: "we just launched, here's the story, can you feature us?"

### W7-05 — Follow up with launch buyers for testimonials — TODO
Email everyone who bought in Week 6. Offer $10 Amazon card for a 60-second video testimonial. Use testimonials in marketing.

---

## Week 8 — Iterate

### W8-01 — Conversion funnel analysis — TODO
Plausible goals + LemonSqueezy data. Where did people drop off? Landing → download → activation → purchase. Identify the worst step and fix it.

### W8-02 — Landing page A/B testing — TODO
Test the hero copy + CTA. Use Plausible goals to measure. Run at least 2 variants for 1 week each.

### W8-03 — First retrospective — TODO
What worked? What didn't? What's the highest-leverage thing for Month 2? Update the business plan with learnings.

### W8-04 — Plan v1.3 from real user requests — TODO
Don't build features Claude or Jameson assume people want. Build what actual buyers asked for in Week 6-8 emails and PH/HN comments.

### W8-05 — Set up the content engine — TODO
One blog post per week on `/blog`. 1500 words. SEO-keyword-targeted ("local-first AI workspace", "BYOK AI tools", "founder workflow templates", etc.).

---

## Marketing assets — produced 2026-04-09 by parallel session

A second Claude session ran in parallel with the engineering work and produced the full marketing surface area for the launch. **All of these are DRAFTS that need Jameson voice review before going public.**

### Strategy + reference (in `docs/`)
- **W1-17** Competitive analysis matrix — `docs/reference/COMPETITIVE_LANDSCAPE.md` — DONE
- **W6-06** Product Hunt launch package — `docs/features/PRODUCT_HUNT_LAUNCH.md` — DONE (title variants, maker comment, 12 FAQ replies, hunter pitch DM, day-of timeline)
- **W6-07** Show HN launch package — `docs/features/SHOW_HN_LAUNCH.md` — DONE (HN-format title, technical/honest body, 15 FAQ replies, submit timing)
- **W7-08** IndieHackers narrative post — `docs/features/INDIE_HACKERS_LAUNCH.md` — DONE ("8 weeks to first paying customer" format)
- **W4-09** Email sequences — `docs/features/EMAIL_SEQUENCES.md` — DONE (10 emails: welcome, teaser, launch, post-purchase, day-1, week-1, month-1, refund, re-engagement)
- **W7-09** Newsletter outreach plan — `docs/features/NEWSLETTER_OUTREACH.md` — DONE (15+ targets, cold pitch template, follow-up template)
- **W1-18** Marketing playbook index — `docs/features/MARKETING_PLAYBOOK.md` — DONE (ties all marketing docs together)
- **W1-19** Action pack for Jameson — `docs/features/JAMESON_ACTION_PACK.md` — DONE (pre-staged drafts for the 8 things only Jameson can do)

### Web pages (in `website/`)
- **W5-08** Press kit web page — `website/press-kit/index.html` — DONE (logo files, screenshot slots, founder bio, fact sheet, brand colors)
- **W7-10** Blog directory + 3 posts — `website/blog/` — DONE
  - `how-i-built-keepance-in-8-weeks.html` (12 min read, the 8-week launch story) — **DRAFT ONLY: do NOT publish until after launch day when placeholders can be filled with real numbers**
  - `why-local-first-ai-for-founders.html` (9 min read, the local-first case)
  - `picking-the-15-founder-templates.html` (10 min read, template selection criteria)

### Pending: things only Jameson can do (see `JAMESON_ACTION_PACK.md`)
- **A.** Decide build-in-public yes/no
- **B.** DM 8-10 PH hunters with personalized pitches
- **C.** Recruit 10-20 beta testers via warm and cold DMs
- **D.** Take 6 product screenshots on Windows
- **E.** Record 30-second demo video
- **F.** Decide personal vs brand X account for Keepance content
- **G.** Set up 3 Plausible conversion goals (5 min, browser only)
- **H.** Post 5 build-in-public tweets to start the launch ramp

### Pending: dependent on Jameson actions
- Add `Download click`, `GitHub click`, `Buy click` event triggers to homepage JS (after G)
- Generate beta tester license keys via LemonSqueezy + save to CSV (after C)
- Compress demo video to MP4 + GIF + upload to YouTube unlisted (after E)
- Add nav links to `/blog` and `/press-kit` in homepage header + footer (anytime; small change)
- Schedule launch day timing once hunter is confirmed (after B)

---

## Backlog (post-launch, prioritized later)

- Linux builds (AppImage + .deb + Flatpak)
- Auto-updater via Tauri's built-in updater (requires signed builds + update manifest)
- USPTO trademark filing ($350-$700) — once revenue clears $1K/mo
- LLC or sole proprietorship registration ($50-$200) — once revenue clears $1K/mo
- Content marketing engine (weekly blog posts, SEO targeting)
- Affiliate program via LemonSqueezy
- "Keepance Teams" v2 product exploration
- Optional: open-source "Keepance Lite" version as a marketing funnel
- Public roadmap on the website
- Status page (uptimerobot already monitors keepance.com)

---

## Status legend

- **TODO** — not started, available to claim
- **IN PROGRESS** — actively being worked on; mark with date started
- **DONE** — complete, with commit hash or PR link as evidence
- **BLOCKED** — cannot start until dependency resolves; name the dependency
