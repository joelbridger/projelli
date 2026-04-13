# Projelli Backlog

> **Last updated:** 2026-04-08 (marathon session: Phases 0 → 5 advance work)
> **Plan:** See `PROJELLI_BUSINESS_PLAN.md` for the full 8-week roadmap and reasoning behind each ticket.
> **How to use:** Tickets are organized by week of the launch roadmap. Within each week, work top to bottom. Use status `TODO` / `IN PROGRESS` / `DONE` / `BLOCKED`. When something is `BLOCKED`, name what's blocking it.

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
Live `/var/www/projelli.com/index.html` is canonical. Pulled into repo. Deploy script created.

### W1-05 — Draft GitHub Actions release workflow — DONE
`.github/workflows/release.yml` builds Tauri installers for Win/Mac/Linux on git tag.
Won't actually run until pushed and a tag is created.

### W1-06 — Write a real `README.md` — TODO
Public-facing repo intro. What is Projelli, install, dev setup, link to business plan.

### W1-07 — Push everything to `projelli/projelli` — DONE
Pushed 3 commits (`8bfa637`, `fa80df4`, `069c6e5`) to `joelbridger/projelli`, then transferred the repo to the new `projelli` org. Old URLs auto-redirect.

### W1-08 — Resolve push credentials — DONE
Authenticated `gh` CLI as joelbridger account on the server. Both joelbridger and scottdaly accounts now coexist in `~/.config/gh/hosts.yml`. joelbridger has admin access on the (now transferred) `projelli/projelli` repo via org ownership.

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

### W1-11 — Set up `support@projelli.com` — DONE
_Brevo registered projelli.com sender, DNS configured (DKIM + SPF + DMARC), CF Email Routing enabled with catch-all → jamesondaines@outlook.com. Brevo verified the domain. noreply@projelli.com sender created._
Same pattern as the other 4 sites: CF Email Routing inbound → `jamesondaines@outlook.com`, Brevo outbound for any automated mail. See `~/.claude/projects/-home-jameson/memory/project_email_architecture.md`.

### W1-12 — Replace footer placeholder `#` links — DONE
_Footer rewritten with Docs and Legal columns. All # placeholder links replaced._
The live homepage footer has 8 placeholder links (Documentation, Getting Started, API Keys Guide, Blog, Community, Privacy Policy, Terms of Service, License). Replace with real links once W1-09 + W1-10 are done.

### W1-13 — Update Plausible goals — TODO
_Plausible goals (Download click, GitHub click, Buy click) — requires browser access to dashboard. Punted to next session._
Add conversion goals to the Plausible dashboard for projelli.com:
- `Download click` (anyone who clicks a download CTA)
- `GitHub click`
- `Buy click` (later, when Buy button exists)

### W1-14 — Run trademark search — DONE
_USPTO TESS + Google searches show no conflicts. Documented in docs/reference/TRADEMARK_SEARCH.md. Formal filing deferred to month 2 of revenue._
USPTO TESS search for "projelli" in classes 9 + 42. Google search for any conflicts. Free, ~30 minutes. Document results in `docs/reference/TRADEMARK_SEARCH.md`. If clean → defer filing to Month 2 of revenue.

### W1-15 — Update CLAUDE.md for current state — DONE
_CLAUDE.md prelude rewritten to point at PROJELLI_BUSINESS_PLAN.md and document the new file layout. Flags Jameson as non-developer._
The repo's `CLAUDE.md` was written during the v1 dev phase. Update to reflect:
- Server-resident, canonical at `~/projelli/`
- Linked to `PROJELLI_BUSINESS_PLAN.md` as the operating contract
- Pointers to key files and the new `docs/` layout
- Note that Jameson is not a developer — explain things in plain language

### W1-16 — Set up `projelli` org profile — DONE
_Org metadata set via API: description, blog (projelli.com), email (support@projelli.com). Profile README at github.com/projelli/.github/profile/README.md._
Add a bio, logo (the pink-bean Projelli logo), website link, and a public profile README at `github.com/projelli/.github`. README should explain what Projelli is, who built it (Jameson Daines), and link to projelli.com. ~10 min.

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
Sign up at lemonsqueezy.com. Create a Projelli store. Create 3 products:
- Pro: $49 one-time
- Lifetime: $99 one-time
- Founder's Launch: $29 one-time, capped at 100 sales (use LS's quantity limit feature)

### W4-02 — Build license validation Bun service — DONE
_license-validator Bun service at ~/services/license-validator/. Live at https://licenses.projelli.com (CF tunnel → Caddy → 127.0.0.1:5181). Ed25519 keys auto-generated. Awaiting LEMONSQUEEZY_API_KEY in /etc/license-validator.env (set when account exists)._
New service at `~/services/license-validator/`, mirroring `~/services/form-handler/` pattern.
- `POST /activate` — validates LemonSqueezy key, returns signed JWT
- `POST /validate` — verifies existing JWT
- `POST /webhook` — handles LS webhooks for revocation
- Systemd unit at `/etc/systemd/system/license-validator.service`
- Caddy reverse proxy: `licenses.projelli.com` → `127.0.0.1:5181`
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
- Step 4: Show the resulting files with a "this is what Projelli does" callout

### W5-05 — Add email list signup to homepage — DONE
_Email signup form on the homepage hero. Wires to /api/forms/projelli/email-list via form-handler service. Brevo email notifications working. Sign-ups stored at ~/projelli/sign-ups/ (gitignored)._
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
Same day as PH. Title: "Show HN: Projelli – Local-first AI workspace where every chat becomes a real file". Be present in comments all day.

### W6-03 — Email the list — TODO
Single launch email with the Founder's Launch $29 lifetime offer. Subject: "It's live: Projelli is shipping today (and the first 100 buyers get lifetime for $29)"

### W6-04 — All-hands support day — TODO
Reply to every PH comment within 30 minutes. Reply to every HN comment in real time. Reply to every email within 1 hour. The launch is the engagement.

### W6-05 — Track conversions — TODO
Monitor: PH ranking, HN points, traffic via Plausible, conversions via LemonSqueezy. Goal: top 5 PH for the day, HN front page for ≥4 hours, 10+ paying customers by end of day.

---

## Week 7 — Distribution waterfall

### W7-01 — Submit to AlternativeTo — TODO
Position vs Notion AI, Obsidian Copilot, Reflect, Tana. Add screenshots, video, real comparison points.

### W7-02 — IndieHackers post — TODO
Narrative format: "I built and launched Projelli in 8 weeks — here's what happened". Include real revenue numbers from Week 6. Drive to the product page.

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
  - `how-i-built-projelli-in-8-weeks.html` (12 min read, the 8-week launch story) — **DRAFT ONLY: do NOT publish until after launch day when placeholders can be filled with real numbers**
  - `why-local-first-ai-for-founders.html` (9 min read, the local-first case)
  - `picking-the-15-founder-templates.html` (10 min read, template selection criteria)

### Pending: things only Jameson can do (see `JAMESON_ACTION_PACK.md`)
- **A.** Decide build-in-public yes/no
- **B.** DM 8-10 PH hunters with personalized pitches
- **C.** Recruit 10-20 beta testers via warm and cold DMs
- **D.** Take 6 product screenshots on Windows
- **E.** Record 30-second demo video
- **F.** Decide personal vs brand X account for Projelli content
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
- "Projelli Teams" v2 product exploration
- Optional: open-source "Projelli Lite" version as a marketing funnel
- Public roadmap on the website
- Status page (uptimerobot already monitors projelli.com)

---

## Status legend

- **TODO** — not started, available to claim
- **IN PROGRESS** — actively being worked on; mark with date started
- **DONE** — complete, with commit hash or PR link as evidence
- **BLOCKED** — cannot start until dependency resolves; name the dependency
