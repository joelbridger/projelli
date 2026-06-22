# Website Repositioning — Design Spec

**Date:** 2026-06-22
**Status:** Approved by Jameson 2026-06-22 (key decisions made via interview; see below).
**Owner:** Marketing / website session. Branch `marketing/website-repositioning` (worktree `~/keepance-wt-website`, off `keepance-3.0`).
**Scope:** The keepance.com website only. NOT the product app (a parallel session owns that) and NOT onboarding.
**Companion brief for the product session:** `docs/superpowers/specs/2026-06-18-bottoms-up-wedge/00-START-HERE-situation-and-two-missions.md`.

---

## 1. Why we're doing this

Two pieces of new feedback reshape how Keepance should present itself:

1. **Brand (from Jameson's product partner):** move from "private AI search for professionals" to **"private AI that actually knows your clients."** The deeper promise is understanding the people behind the paperwork, not just finding files. The named future product object is the **Client Map**.
2. **Go-to-market (from VC Sam Andersen, Element Ventures, 2026-06-18):** a **bottoms-up wedge** so an individual can download and safely use Keepance on their own, then become the path into a firm sale. Already approved and being built by the product session.

A third reason is hygiene. An audit of the live site (2026-06-22) found it is **split-brain**: the homepage and press kit use the new "law practice / Word-native" story, but most other pages still use the old "local-first AI workspace / Markdown" story, sell "Markdown files" as a benefit (while the homepage says you never see Markdown), and carry stale claims (e.g. "no team collaboration", "no SSO") that the shipped Firm tier now contradicts. This repositioning is the moment to make the whole site sound like one company.

## 2. Decisions locked (via interview, 2026-06-22)

| Decision | Choice |
|---|---|
| Client Map: build or just market? | **Vision-led.** Anchor every live promise to what ships today; present the Client Map as a clearly-labeled "coming" direction; commit to actually building it (a separate product project, Mission 2 of the product session). |
| Lead audience | **Broad: high-trust professionals** (lawyers, financial advisors, accountants, consultants) AND the individuals inside bigger firms (bottoms-up). |
| Homepage hero | **Brand leads** ("knows your clients"). The bottoms-up "start on your own, no IT ticket" becomes the primary button + a dedicated section, not the headline. |
| Trial length (copy) | 30 days. Copy says "free trial, no card, no account"; do not hardcode the number where the app reads it from config. |
| "No IT ticket" tone | Punchy line, immediately qualified by the honest framing, so it never reads as "sneak it past your firm." |

## 3. The message system (every page draws from this)

- **Category line** (page titles, eyebrows): *Private client intelligence for high-trust professionals.*
- **Hero headline:** *Private AI that actually knows your clients.*
- **Sticky contrast** (repeat across the site): *Most AI knows the world. Keepance knows your clients.*
- **Honest adoption line** (never separated from any "start now" message): *Start on your own today. Get it firm-approved when you're ready for client work.*
- **Trust proof:** stays on your computer · every answer has a citation you can open · you bring your own AI key so I never see your data · you can always see where data goes.

**Hard copy rules (inherited, non-negotiable):**
- Never say "compliant" / "guaranteed compliant" / "fully compliant" or imply Keepance makes a user compliant. Keepance handles data safety; the firm and the professional own policy.
- House voice: first-person singular where the founder speaks, contractions, concrete nouns, uneven sentence length. **No em dashes.** None of the AI tells (no "leverage / seamless / transform / empower / elevate / unlock"), no "It's not X, it's Y", no italic sentence-end fragments.
- Anything labeled future (Client Map and its sub-features) must read unmistakably as "coming," never as available today.

## 4. The new homepage (locked copy + section order)

Order: **hero → contrast → proof (today) → start-on-your-own → trust → Client Map vision → who it's for → pricing → final CTA.**

**4.1 Hero**
- Eyebrow: `Private client intelligence for high-trust professionals`
- H1: `Private AI that actually knows your clients.`
- Subhead: `Keepance securely searches every file and email you have, and answers with a citation you can open and check. Your client's name never gets pasted into a chatbot you don't control. It all stays on your computer.`
- Primary CTA button: `Start your free trial` with microcopy under it: `No card, no account.`
- Secondary CTA: `See how private it is`
- Honest qualifier directly under the CTAs: `Start on your own today. Get it firm-approved when you're ready for client work.`

**4.2 Contrast (the "people, not facts" moment)**
- Headline: `Most AI knows the world. Keepance knows your clients.`
- Body: `A chatbot can answer trivia about anything and knows nothing about the people you serve. Keepance is the other way around. It reads your own files and emails and gets to know each client, so the answers are about your work, not the whole internet.`

**4.3 What it does today (four proof blocks, all true now)**
1. `Cited answers across everything you have` — `Ask a question, get an answer with a clickable citation, drawn from your own documents and email. Open the source and check it yourself.`
2. `One client never bleeds into another` — `Keepance keeps each client and matter walled off. What it knows about one can't show up in an answer about another.`
3. `Real Word documents` — `Draft and redline in actual Word files with tracked changes. No copy-paste, no reformatting, nothing to clean up afterward.`
4. `Private by design` — `Everything stays on your computer. You bring your own AI key, so I never see your data and never charge you for the AI.`

**4.4 Start on your own (the bottoms-up motion; folds the approved copy deck)**
- Headline: `Start on your own. No IT ticket required.`
- Body: `Download Keepance and try it on your own work today. In Local-only mode, nothing leaves your computer. When you're ready to use it for client matters at a firm, one click creates a plain-English security overview you can hand to your IT or general counsel to get it approved.`
- Honest framing block: `Start on your own today. Get it firm-approved when you're ready for client work. Keepance is built so the private option is the default, and so you have a clear, honest answer when your firm asks where the data goes.`

**4.5 The whole truth, told first (trust)**
- Headline: `The whole truth, told first.`
- Body: `You can always see exactly where your data goes. A live indicator shows whether an answer stayed on your machine or used a cloud model you chose. A printable Data Map lists where everything lives. And I tell you plainly what Keepance doesn't have yet, instead of hiding it.`

**4.6 Client Map vision (clearly labeled COMING)**
- Eyebrow: `On the roadmap`
- Headline: `Coming soon: a living Client Map for every client.`
- Body: `Today Keepance answers questions about your files. Next it will turn each client, matter, or household into a living picture: the people, the history, the goals, the risks, and the open questions. A Context Completeness view will show what you know, what you're assuming, and what you still need to ask. A Guided Client Interview will walk you through the questions that turn a folder of documents into a full picture. And you'll be able to teach Keepance your firm's way of working, so it applies your standards to every client.`
- Visual treatment must make "coming" obvious (badge, muted style, or a "what's next" framing). No CTA implying it's usable today.

**4.7 Who it's for (cards to the vertical pages)**
- `For lawyers` (matters; ABA Op 512; privilege) · `For financial advisors` (households; Reg S-P) · `For accountants and tax pros` (returns; IRC §7216) · `For consultants` (client NDAs). Each links to its reframed vertical page.

**4.8 Pricing + final CTA** — keep existing Solo / Professional / Firm tiers and prices from the live page; reframe the trial as "free trial, no card, no account." Final CTA repeats `Start your free trial`.

## 5. Audience strategy

Homepage speaks to all high-trust professionals at once, using audience-neutral words that fit every vertical ("clients", "practice", "firm"). Depth lives in the four vertical pages, each reframed under "knows your clients": **lawyers → "matter"**, **advisors → "household"**, **accountants → "return / engagement"**, **consultants → "engagement / client"**. The bottoms-up "start on your own" angle and the firm security pack appear on every vertical page, tuned to that audience's regulator (ABA Op 512, Reg S-P, IRC §7216, NDAs).

## 6. Site-wide reconciliation — waves (highest visibility first)

- **Wave 1 — Homepage + message system.** Section 4 above. The big one.
- **Wave 2 — The four vertical pages** (`legal/`, `financial-advisors/`, `tax/`, `consulting/`). Reframe under "knows your clients", fix the "Markdown as a benefit" contradiction, add the start-on-your-own + security-pack angle, use the right unit word per vertical.
- **Wave 3 — The ~16 `/vs/` competitor pages + hub.** Update to the new positioning and category line; remove the old "local-first AI workspace for attorneys, CPAs, and consultants" tagline; keep the honest "where the other tool is better" sections (they build trust).
- **Wave 4 — Trust, security, roadmap, one-pagers.** Fix stale claims (`security/` says "no SSO" and "5 seats on one machine"; `roadmap/` lists "no real-time collaboration" as permanent) to match the shipped Firm tier (SSO/OIDC, E2EE co-editing, 3 to 50 seats). Connect to the new one-click firm security pack the product session is building.
- **Wave 5 — Blog + SEO pages.** Retire/redirect the leftover "for founders / indie-hackers" content that conflicts with the audience. Reconcile `markdown-for-ai/` and similar with "you never see Markdown." Add 1 to 2 new posts on the new positioning (e.g. "Most AI knows the world. The tools worth using know your client." and "Why we made the private option the default.").

Each wave: produce per-page copy to the voice rules, edit the static HTML in place, keep internal links consistent, then a Codex honesty/voice pass before it's considered done.

## 7. Coordination with the product session

- Product session owns the app (the bottoms-up wedge Phases 1 to 4 + the in-app trial, then Mission 2 the Client Map). It is told to **skip the website task** and not touch `website/`.
- This session owns the entire website AND the final wording of in-app customer-facing strings (a later copy-harmonization pass), so voice and positioning stay consistent across web and app.
- Nothing about the Client Map is claimed as live; the site markets it as "coming," matching the product session's real build.

## 8. Quality gates

- Self-review every page against the voice rules + the "never say compliant" rule + "future features clearly labeled."
- **Codex independent review** (different model, different blind spots) on the new homepage copy and each wave: honesty vs the real product, voice/AI-tells, no em dashes, the ethical guardrail. Integrate after verifying.
- Visual check of each rebuilt page in a browser before calling it done.
- Cross-link integrity: no page still points to retired taglines or contradicts another page.

## 9. Deploy boundary

Keepance is a commercial product. Build everything on this branch and show Jameson. **Do not deploy to keepance.com without his explicit go.** When approved, merge to `keepance-3.0` and run `infra/deploy.sh` (rsync `website/` to `/var/www/keepance.com` + Cloudflare cache purge).

## 10. Success criteria

- The whole site tells one story: "private AI that actually knows your clients," for high-trust professionals, that you can start on your own.
- Every live promise is true today; the Client Map is clearly "coming."
- No page sells Markdown as a benefit; no page claims features we no longer lack or lack features we now ship.
- No "compliant" claim anywhere; no em dashes; no AI tells; honest framing on every "start now" message.
- Jameson reviews and approves before any deploy.

## 11. Open / handed-off

- The actual Client Map feature is a separate product build (product session, Mission 2). The website only markets it as coming.
- In-app customer-facing string harmonization is a later task for this session.
