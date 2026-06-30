# Website Version B — "Advisor Dial-In" (what changed, and why)

**Created:** 2026-06-25
**Purpose:** Save the dial-in homepage as a named **Version B**, an alternative to **Version A** (the current live site), so both can be compared and feedback gathered over the coming weeks before deciding which to keep.
**Built from:** the website-vs-research gap analysis in [`./website-dial-in-recommendations.md`](./website-dial-in-recommendations.md) (and its independent Codex cross-check). Every change below traces to a specific Kitces-research finding.

---

## The two versions at a glance

| | **Version A (current / control)** | **Version B (advisor dial-in)** |
|---|---|---|
| What it is | The site live today | The same site with the research-backed sharpening |
| Git branch | `marketing/website-repositioning` | `website/advisor-dial-in` |
| Git tag (frozen snapshot) | `website-version-a-2026-06-25` | `website-version-b-2026-06-25` |
| Where to view | **https://keepance.com** (live, public) | **http://100.68.20.52:8897/** (private preview, Tailscale) |
| Deployed to real visitors? | Yes | **No** (separate worktree, not deployed) |
| Worktree on disk | `~/keepance-wt-website/` | `~/keepance-wt-dialin/` |

> Both are frozen as git tags, so either can be rebuilt or rolled back exactly. Version A is unchanged and still serving every real visitor; nothing in Version B is public.

---

## Why Version B exists

The gap analysis compared the live site against the full Kitces advisor-tech research. The site's advisor *pages* were already strong, but the **homepage** led with a category statement ("Secure client intelligence for high-trust work") rather than the market's strongest emotional truth ("I don't want another tool"), and it still carried a few leftover law-firm examples. Version B closes those gaps. The thesis it expresses, in one line:

> Advisor Prep Hero should sound less like "a private AI app" and more like **the private, cited answer layer that makes the advisor's existing stack usable** — and the homepage should prove that with one concrete demo.

---

## What changed in Version B (change by change)

### 1. Objection-led hero
- **What:** New hero — eyebrow "For financial advisors"; headline **"You already pay for a dozen tools. Advisor Prep Hero isn't a thirteenth."**; subhead naming the real stack (plans, tax docs, statements, email, files) + "citations you can click," "runs on your machine," "you decide," "switch away from nothing"; primary CTA **"Try it free on one client"**; microcopy "Point it at one client folder and change nothing else." (Old hero: "Secure client intelligence for high-trust work" + a generic "private AI workspace" subhead.)
- **Why:** The #1 finding is **tech bloat** — advisors run ~12 tools, satisfaction is falling, and "another tool" is the default objection. Leading with the objection (not the category) meets that head-on. The "one client, change nothing" framing answers **switching inertia** (advisors resist migration; they only adopt for something clearly superior). Naming the tools leans into **integration**, the #1 driver of tech-stack satisfaction.

### 2. New "See it work" proof demo (Annual Review Prep)
- **What:** A dedicated section showing Advisor Prep Hero answering *"What changed for the Smiths since our last annual review, and what should I bring up?"* It shows the real sources it reads across (RightCapital, Holistiplan, Schwab, Outlook, OneDrive, Jump, with their logos), then a cited breakdown — **What changed / Needs your review / Missing or stale** — including a "**No support found … flagged, not guessed**" line, and three drafts (Review agenda, Follow-up email, Reg BI note). Footnote: "Advisor Prep Hero drafts and cites; you review, edit, and decide. It never contacts your clients."
- **Why:** This is the single highest-leverage change. It embodies every research point at once: **document review** (the #1 real AI use among advisors today), **back-office prep** (where advisors want AI, not client service), the **trust gap** (a source on every line + a refusal to guess), **integration** (one answer across scattered tools), and **demo-led buying** (advisors buy off a demo they can share with a peer). It is also peer-shareable.

### 3. Replaced leftover law-firm examples with advisor ones
- **What:** The "Ask about anything" demo changed from a "delivery delay / contractual window" question to *"What did we decide about the Smiths' 529 plans, and where is it in writing?"*. The "Draft with context" demo changed from a **Mutual_NDA.docx** redline to a **Smith_Annual_Review.docx** redline (retirement-date change pulled from the plan export). The hero image file `keepance-attorney-clients.png` was renamed to `keepance-advisor-clients.png`.
- **Why:** These were holdovers from the law-firm era and quietly undercut the advisor re-aim. Advisor-specific, concrete scenarios resonate; generic/legal ones force the reader to translate.

### 4. Citations framed as the answer to a fear (+ "it says so when it can't find support")
- **What:** Added a feature bullet: "If it can't find support, it says so. It never guesses," and the demo dramatizes a refusal to guess.
- **Why:** The research's gating barrier is trust — "one wrong AI answer can lose a client or trigger a lawsuit." A visible refusal to guess turns citations from a feature into a safety mechanism, which is exactly what advisors reward.

### 5. "You stay in control" / never client-facing
- **What:** The hero now says it "proposes while you decide," and the demo footnote states "Advisor Prep Hero never contacts your clients."
- **Why:** Advisors want AI to *expedite* (57%) not *automate* (28%), and the one place a majority want AI to stay out of is **client service**. Saying this out loud turns a research-backed preference into a selling point.

### 6. Competitor teaser
- **What:** A line near the "Where Advisor Prep Hero fits" graphic: "Wondering how this is different from Microsoft Copilot, your CRM's new AI, or your meeting note-taker? Each is smart inside its own walls. Advisor Prep Hero is for the facts that live between them." It links to `/how-keepance-fits/`.
- **Why:** The cross-source AI layer is now a funded race (Jump, Orion, Advisor360, Copilot). Advisors will ask "doesn't X already do this?"; the teaser answers it and routes them to the full comparison.

### 7. Peer-proof testimonial block — **PLACEHOLDER (needs a real quote)**
- **What:** A testimonial section before pricing, with a clearly-marked placeholder ("[Advisor name], [Firm name]", plus a visible note to replace before going live). **No fake quote was invented.**
- **Why:** Advisors buy via **peers** (43%) and trust peer proof. This is the slot for a real design-partner quote (e.g., your wife's firm). **This is the one piece only you can finish.**

---

## What did NOT change
- The `/how-keepance-fits/` and `/fits-your-stack/` pages, the security page, pricing, the Advisor Practice Pack, the Client Map section, and the "Where Advisor Prep Hero fits" radial graphic are all carried over unchanged (they were already research-aligned). Version B is a **homepage-focused** sharpening, not a rebuild.

## Open items before Version B could go live
1. Replace the **placeholder testimonial** with a real, approved advisor quote.
2. (Optional, off-site) Pursue a **Kitces AdvisorTech map/directory listing** — a place advisors actually research; not a website change.

---

## How to preview and compare
- **Version A (live):** https://keepance.com
- **Version B (preview):** http://100.68.20.52:8897/ — served durably from `~/keepance-wt-dialin/website/`. Browse the homepage top to bottom; `/how-keepance-fits/` and `/fits-your-stack/` work too.
- The preview is on the Tailnet (reachable by Jameson). For **external** advisor feedback, Version B needs a public URL — see "Going public for feedback" below.

## Going public for feedback (decision pending)
A clean public Version B URL (so outside advisors can see it without being on the Tailnet) needs a subdomain such as `b.keepance.com`, which requires a **DNS record only Jameson can add** (domain/DNS is on his action list). Once that exists, Version B can be deployed there durably alongside the live Version A. Alternatives: keep it Tailscale-only (Jameson reviews + screen-shares), or run a true split-traffic A/B test on the live site (bigger lift; not set up).

## How to promote Version B to live (if chosen)
`website/advisor-dial-in` was branched cleanly from the live branch, so promoting is a merge:
```
cd ~/keepance-wt-website
git merge website/advisor-dial-in
bash infra/deploy.sh --skip-demo
```
To roll back to Version A exactly: `git checkout website-version-a-2026-06-25` (or redeploy that tag).

---

## Change log / provenance
- Source analysis: `website-dial-in-recommendations.md` (+ `codex-website-vs-research-gap.md`).
- Build: branch `website/advisor-dial-in`, commit message "feat(site): advisor dial-in (review worktree, NOT deployed)".
- Snapshots: tags `website-version-a-2026-06-25`, `website-version-b-2026-06-25`.
