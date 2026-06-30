# Competitive Build Handoff (for the Advisor Prep Hero build instance)

**Date:** 2026-06-06
**From:** the strategy instance (competitive-landscape work). **To:** the Claude Code instance that builds Advisor Prep Hero.
**Read first:** [2026-06-06 Vertical Competitive Landscape](./2026-06-06-vertical-competitive-landscape.md) (the analysis + Section 8.5 "Activation"). Also relevant: the [2026-06-04 four-vertical review](./2026-06-04-independent-four-vertical-review.md), because several items here overlap with it (fold together, don't duplicate).

**What this is:** a build-ready spec, with the actual page copy drafted, for turning the competitive landscape into website assets. The hard part (accurate, honest, on-voice comparative copy) is done below. Your job is to implement it into the site, consistent with existing conventions.

**Coordination:** the strategy instance is **not** touching `website/`. All `website/` edits for this work are yours, so we don't race the repo.

---

## Guardrails (read before writing a single line of copy)

These are non-negotiable because this is **public, comparative copy about named competitors**, and Advisor Prep Hero's whole brand is honesty.

1. **Accuracy and fairness.** Every claim must be factual and defensible. Represent each competitor fairly: their privacy posture is "cloud SaaS with a contractual no-training policy," not "they steal your data." Always include a genuine "where they win / when to pick them instead" section on every comparison. This is on-brand and legally safer (comparative advertising).
2. **The local-vs-cloud precision (most important).** Only a **local model** means "nothing leaves your machine." With a **cloud BYOK key**, the prompt goes straight to the AI provider (Advisor Prep Hero never sees it, but the provider does). Never write copy that implies a cloud key equals zero egress. This was the #1 overclaim flagged in the 2026-06-04 review. Reserve absolutes ("nothing leaves," "no third-party disclosure," "honors a no-AI-upload clause") for the local-model path, and say so in the same sentence.
3. **US v. Heppner framing.** Real, leading, cautionary case: Judge Rakoff, S.D.N.Y., opinion Feb 17 2026 (defendant convicted May 7 2026), consumer Claude use without attorney direction defeated privilege. Cite it as an important cautionary ruling, **not** settled black-letter law (later courts are diverging to a fact-specific approach). Link a credible source (e.g., the Harvard Law Review note or a major firm alert). Always pair with "informational, not legal advice; verify with your bar counsel."
4. **Pricing.** For **Advisor Prep Hero's own price**, reuse the canonical pricing strip / source of truth (the homepage `#pricing` values and the existing `.vs-pricing` component). Do **not** hardcode. **Open inconsistency to resolve first:** `website/vs/index.html` shows "Practice $499 once" while the homepage moved Practice to yearly; confirm the real model against `#pricing` and the EULA and make every surface consistent before adding new pages. For **competitor pricing**, present approximate bands with an "approximate, as of 2026, check vendor for current" footnote and link out; never state a hard competitor price that could be stale.
5. **Voice.** No em dashes (ever). First-person singular where natural, contractions, concrete nouns. No AI tells (no "leverage / seamless / transform / unlock / empower / elevate," no "it's not X, it's Y"). Match the existing site voice.
6. **Design.** Light theme only (matches the site and Jameson's standing preference). Satoshi font. Reuse the existing `/vs/` page styles, the shared nav (`/scripts/keepance-nav.v4.js`, `/styles/keepance-nav.v2.css`), and the `kp-footer` block. New pages must look like the current `/vs/` pages.
7. **Deploy.** Build everything, then get Jameson's eyes before it goes live. Even though routine deploy is autonomized, public comparative claims about named competitors warrant one human look. Treat all of this as **deploy-gate**.
8. **Don't duplicate the 2026-06-04 plan.** The "lead with local model" messaging and the gatekeeper one-pagers also appear there. Fold them together into one coherent set of edits; don't create conflicting copy.

---

## Build item 1 (highest priority): per-vertical comparison section on each landing page

Add a section titled **"How Advisor Prep Hero compares to the AI you already have"** to each of `/legal/`, `/tax/`, `/consulting/`, `/financial-advisors/`, placed after the templates/pack section and before the final CTA. Render the tables in the site's style (a simple, legible comparison table; a check/dash or short text per cell). Below is the drafted copy for each. The matrices use plain language cells on purpose.

### 1A. Legal (`/legal/`)

**Intro:** If you're a lawyer weighing AI, you've usually got three options in front of you: the AI now built into Clio, a dedicated research platform like CoCounsel, or pasting into ChatGPT. Here's the honest comparison, including where those tools beat Advisor Prep Hero.

| | Advisor Prep Hero | Clio Duo | CoCounsel | ChatGPT (free/Plus) |
|---|---|---|---|---|
| Runs fully on your machine (nothing leaves) | Yes, with a local model | No | No | No |
| Your files stay on your own computer | Yes | No (Clio's cloud) | No (vendor cloud) | No (vendor cloud) |
| Built for legal work | Yes, 10+ practice templates | Basic | Yes, deep | No |
| Case-law research with citation checking | No (keep Westlaw/Lexis) | No | Yes | No |
| Knows your matters, billing, deadlines | No (sits beside Clio) | Yes | Partly | No |
| Typical cost | $149/yr + your own AI usage | ~$50-60/mo on top of Clio | Premium, per-seat | $0-20/mo |

**Where the others are the better choice (honest):** CoCounsel is the right tool if you need citation-verified case-law research; Advisor Prep Hero doesn't do that, and you should keep your Westlaw or Lexis subscription. Clio Duo is the better fit if you mainly want AI that already knows your matters and billing. Advisor Prep Hero is the private place your confidential drafting and analysis happen, beside those tools, not instead of them.

**Why a lawyer adds Advisor Prep Hero anyway:** in *US v. Heppner* (S.D.N.Y., Feb 2026), a federal court held that running your work through consumer cloud AI, without your direction as counsel, can cost you privilege. Every option above keeps a copy of your work on a vendor's servers. With Advisor Prep Hero on a local model, nothing leaves your machine at all. (Informational, not legal advice; verify with your bar counsel.)

### 1B. Tax (`/tax/`)

**Intro:** Most tax pros have one of three AI options: whatever's bundled in your tax software (Intuit Assist if you're on Lacerte or ProConnect; nothing, if you're on Drake), a research platform like Blue J, or pasting into ChatGPT. Here's the honest comparison.

| | Advisor Prep Hero | Intuit Assist (bundled) | Blue J | ChatGPT (free/Plus) |
|---|---|---|---|---|
| Runs fully on your machine (nothing leaves) | Yes, with a local model | No | No | No |
| Client return data stays on your computer | Yes | No (Intuit's cloud) | No (vendor cloud) | No (vendor cloud) |
| Tax templates (IRS notices, §7216 consent, WISP, research memo) | Yes | Planning only | Research only | No |
| Primary-authority tax research | No (verify model output) | No | Yes | No |
| Works with Drake and any tax software | Yes | No (Intuit only) | No | n/a |
| Typical cost | $149/yr + your own AI usage | Bundled (Intuit only) | Premium, per-user/yr | $0-20/mo |

**Where the others are the better choice (honest):** Blue J is the right tool for citation-grounded tax research; Advisor Prep Hero has no primary-authority database. If you're on Lacerte or ProConnect and just want advisory planning from a return, Intuit Assist is already included. Advisor Prep Hero is for the drafting, notice responses, and confidential analysis those tools don't cover, and it's the only one of the four that works if you're on Drake.

**Why a preparer adds Advisor Prep Hero:** a cloud key still sends your client's return information to a third party, which is exactly what IRC §7216 governs. Run a local model in Advisor Prep Hero and nothing leaves your machine, so there's no third-party disclosure to consent around. (Informational, not tax or legal advice; verify with your own advisor.)

### 1C. Consulting (`/consulting/`)

**Intro:** As an independent consultant, your AI options are usually ChatGPT or Claude, Microsoft Copilot if you're on 365, and a tool like Gamma for decks. Here's the honest comparison, including where they beat Advisor Prep Hero.

| | Advisor Prep Hero | Microsoft 365 Copilot | Gamma | ChatGPT Plus |
|---|---|---|---|---|
| Runs fully on your machine (nothing leaves) | Yes, with a local model | No | No | No |
| Honors a strict "no AI upload" NDA clause | Yes, with a local model | No | No | No |
| Keeps each client's work separated | Yes (per-client folders) | No | No | No |
| Turns work into a finished, designed deck | Outline plus basic export | Yes, real slides | Best-in-class | No |
| Your files stay on your own computer | Yes | No | No | No |
| Typical cost | $149/yr + your own AI usage | ~$18-30/mo | ~$9-18/mo | ~$20/mo |

**Where the others are the better choice (honest):** Gamma and Copilot make a polished deck far better than Advisor Prep Hero does today. If your only job is a beautiful deck fast, use them. The honest play: do your client-discovery synthesis, your confidential research, and your slide outline in Advisor Prep Hero, where the work stays private, then build the final visual deck in Gamma or PowerPoint.

**Why it matters:** ChatGPT Plus and Claude Pro train on your conversations by default, and even the enterprise tiers and Copilot still send your client's material to a vendor's cloud. If your NDA says no uploading work product to AI services, only a local model honors that literally. Advisor Prep Hero is the one that can.

### 1D. Financial advisors (`/financial-advisors/`)

**Intro:** Most advisors are looking at the AI meeting-notes tools (Jump, Zocks), the AI now bundled into eMoney or MoneyGuidePro, or ad-hoc ChatGPT. Here's the honest comparison.

| | Advisor Prep Hero | Jump | eMoney AI (bundled) | ChatGPT (free/Plus) |
|---|---|---|---|---|
| Runs fully on your machine (nothing leaves) | Yes, with a local model | No | No | No |
| Client data stays on your own computer | Yes | No (vendor cloud) | No (Envestnet cloud) | No (vendor cloud) |
| An AI vendor you must vet under Reg S-P | None, with a local model | Yes | Yes | Yes |
| Records meetings and syncs notes to your CRM | No | Yes | No | No |
| Built for confidential drafting and analysis | Yes | Partly | Planning only | Generic |
| Typical cost | $149/yr + your own AI usage | ~$75-175/advisor/mo | Bundled | $0-20/mo |

**Where the others are the better choice (honest):** Jump and Zocks are purpose-built for meeting notes and CRM sync, and that's not what Advisor Prep Hero does. If automating post-meeting admin is your main need, buy one of them. Advisor Prep Hero is for the private drafting and analysis of your most sensitive client work, and for the firm whose compliance officer doesn't want any AI vendor receiving client data at all.

**Why the timing matters:** the SEC's Reg S-P amendments now require you to vet and monitor every vendor that touches client data, and the smaller-firm deadline passed in June 2026. With Advisor Prep Hero on a local model, there's no AI vendor in the data path to vet, because nothing leaves your machine. (Informational, not compliance advice; verify with your compliance counsel.)

*Footnote for all four tables: "Competitor pricing and features are approximate, as of 2026; check each vendor for current details." Advisor Prep Hero pricing must come from the canonical pricing source, not be hardcoded here.*

---

## Build item 2: a comparison hub + per-incumbent pages under /vs/

### 2A. Add a section to `website/vs/index.html`

After the existing card grid, add a new section:

**Heading:** Already using a tool built for your profession?
**Lead:** The comparisons above are the general-purpose and notes tools. If you're weighing Advisor Prep Hero against the AI built for lawyers, tax pros, or advisors, start here. Each page is honest about where the other tool is better.

Cards (same `.vs-card` style), in priority order:
- **Advisor Prep Hero vs Clio Duo** — "Clio's built-in AI knows your matters and billing. Advisor Prep Hero is the private, local-capable workspace for the confidential drafting it doesn't touch." → `/vs/clio-duo`
- **Advisor Prep Hero vs CoCounsel** — "CoCounsel is Westlaw-grounded research at a premium price. Advisor Prep Hero is the $149/yr private workspace beside it, not a research database." → `/vs/cocounsel`
- **Advisor Prep Hero vs Jump** — "Jump owns advisor meeting notes. Advisor Prep Hero is the zero-vendor, local-capable workspace for your most sensitive client work." → `/vs/jump`
- **Advisor Prep Hero vs Intuit Assist** — "Intuit's AI is bundled and planning-only, and only if you're on Lacerte/ProConnect. Advisor Prep Hero works with Drake and keeps return data on your machine." → `/vs/intuit-assist`
- **Advisor Prep Hero vs Gamma** — "Gamma makes the deck. Advisor Prep Hero does the private thinking before the deck. Many consultants use both." → `/vs/gamma`
- **Advisor Prep Hero vs Microsoft 365 Copilot** — "Copilot is great inside Office, in Microsoft's cloud. Advisor Prep Hero is the local-first option for work that can't go to anyone's cloud." → `/vs/copilot`

Also update the page `<title>`/meta to include the profession tools, and add a footer/nav consideration if appropriate (follow existing conventions).

### 2B. Per-incumbent page template (fully drafted: `/vs/clio-duo`)

Build each per-incumbent page on this template (this one is complete; reuse the structure for the others, drawing content from the landscape doc and the backlog table in 2C). Use the existing `/vs/` page layout, the dark-navy `.vs-pricing` strip (from the canonical pricing source), shared nav + `kp-footer`.

> **Title:** Advisor Prep Hero vs Clio Duo: a private, local alternative for confidential legal work
> **Meta description:** Clio Duo is the AI inside Clio. Advisor Prep Hero is the local-first workspace where your confidential drafting and analysis never leave your machine. An honest comparison.
>
> **H1:** Advisor Prep Hero vs Clio Duo
>
> **Intro:** If you run your practice on Clio, you already have Clio Duo, its built-in AI, a click away. So why would you add Advisor Prep Hero? The short answer: they do different jobs. Clio Duo is AI that knows your matters, your billing, and your deadlines, in Clio's cloud. Advisor Prep Hero is the private, local-capable workspace for the confidential drafting and analysis you'd rather not run through any vendor's servers. Here's the honest comparison.
>
> **What Clio Duo is genuinely good at:** It's already in your workflow, with zero setup. It knows your matter and client context. It drafts correspondence, summarizes documents, and extracts deadlines, and it's an inexpensive add-on to a subscription you already pay for. For day-to-day practice-management AI, it's a sensible default, and Advisor Prep Hero doesn't try to replace it.
>
> **Where Advisor Prep Hero is different:** Clio Duo, like every cloud AI, keeps a copy of what you give it on a vendor's servers under a contractual promise not to misuse it. Advisor Prep Hero keeps your files as Markdown on your own machine, and with a local model it sends nothing anywhere at all. Your API key (if you use a cloud model) lives in your OS keychain, and your prompts go straight from your machine to the AI provider you chose, never through Advisor Prep Hero. Advisor Prep Hero also ships 10+ legal practice templates (privilege log, deposition contradiction finder, evidence-gap analysis, client intake and conflicts, patent disclosure, transactional and estate summaries) that go deeper on the legal work itself than a general practice-management assistant.
>
> **Comparison table:** (same six rows as the Legal table in 1A.)
>
> **When to pick Clio Duo instead:** You want one tool, you want AI that already knows your matters and billing, and your confidentiality bar is met by a cloud vendor's contractual promise. That's a perfectly reasonable choice, and for a lot of firms it's the right one.
>
> **When Advisor Prep Hero is the better fit:** You handle work where a vendor holding a copy is the thing you're trying to avoid, you want a local-model option so nothing leaves your machine, or you want your files to stay yours, in plain Markdown, no matter what happens to any vendor. Advisor Prep Hero is $149/yr plus your own AI usage, and it sits beside Clio, not instead of it.
>
> **The legal context:** In *US v. Heppner* (S.D.N.Y., Feb 2026), a federal court held that running your work through consumer cloud AI without attorney direction can cost you privilege. A local model is the cleanest answer to that risk. (Informational, not legal advice.)
>
> **Pricing strip + CTA:** reuse the canonical `.vs-pricing` strip; CTA to the 30-day trial and `/legal/`.

### 2C. Backlog: the remaining per-incumbent pages

Build these on the same template. Content points are in the landscape doc; key honest beats below. Priority order top to bottom.

| URL | Page | Where they genuinely win (lead with this honestly) | Advisor Prep Hero's wedge | Regulatory hook |
|---|---|---|---|---|
| `/vs/jump` | Advisor Prep Hero vs Jump | Purpose-built advisor meeting notes + CRM sync; 27k advisors; SOC 2 + HIPAA | Zero Reg S-P vendor surface with a local model; own-your-files; not a meeting tool, a private workspace | Reg S-P (June 2026 deadline) |
| `/vs/cocounsel` | Advisor Prep Hero vs CoCounsel | Westlaw-grounded, citation-checked research; brand | $149/yr vs premium; local zero-egress; beside Westlaw, not a research DB | Heppner |
| `/vs/intuit-assist` | Advisor Prep Hero vs Intuit Assist | Bundled free in Lacerte/ProConnect; pulls from the return | Works with Drake (and any software); return data stays local; notices/§7216/WISP templates | §7216 / Safeguards |
| `/vs/gamma` | Advisor Prep Hero vs Gamma | Best-in-class designed decks, fast | Local model honors no-AI-upload clauses; per-client isolation; "do the thinking here, finish the deck there" | NDA AI clauses |
| `/vs/copilot` | Advisor Prep Hero vs Microsoft 365 Copilot | In Office; tenant-isolated; no-training | Cloud vs local; own-your-files; honest that Copilot is convenient but still cloud | cross-vertical (cite the relevant one per reader) |
| `/vs/blue-j` (optional) | Advisor Prep Hero vs Blue J | Real primary-authority tax research + confidence scoring | $149/yr vs premium; local; drafting + notices Blue J doesn't do | §7216 |
| `/vs/zocks` (optional) | Advisor Prep Hero vs Zocks | "No-recording" advisor notes; Smarsh/Global Relay archiving | Still cloud (notes leave the machine); Advisor Prep Hero local = nothing leaves | Reg S-P |
| `/vs/lexis-protege` (optional) | Advisor Prep Hero vs Lexis+ Protégé | Shepard's citation verification; cloud BYOK encryption | Cloud even with BYOK encryption vs truly local; price; own-files | Heppner |

Note for `/vs/copilot`: Copilot shows up in all four verticals, so write it cross-vertical and let the reader map it to their world.

---

## Build item 3: lead with the local-model wedge (messaging, folds into the 2026-06-04 plan)

This overlaps the 2026-06-04 review's "fix the cloud-key overclaims" and "lead with local Ollama" items. Do them once, together:
- On the homepage and each vertical hero, make the **local-model, zero-egress** story the lead differentiator (it's the one thing no competitor in any vertical offers), with the honest cloud-vs-local distinction from Guardrail 2.
- Add a short, prominent path to `/local-model-setup/` from the homepage and vertical pages ("Run it fully offline, nothing leaves your machine"), especially for the most privacy-sensitive readers (advisors, patent).
- Make sure the "sits beside your [Clio/Drake/eMoney/PowerPoint]" framing is consistent with `/fits-your-stack/`.

---

## Build item 4: gatekeeper one-pagers (folds into the 2026-06-04 plan, now with competitive ammo)

The one-pager family (legal → malpractice carrier; consulting → client/GC data-handling; advisor → CCO Reg S-P; tax → §7216/Safeguards) was recommended in the 2026-06-04 review and is reinforced here. When you build them, add the competitive angle: "unlike the cloud AI tools in your field, Advisor Prep Hero can run a local model where client data never leaves your machine." These can be simple branded, downloadable one-page PDFs/HTML under `website/one-pagers/` (the 06-04 work referenced that path).

---

## Definition of done

- Per-vertical comparison sections live on all four landing pages, in the site's light-theme style, each with a real "where they win / when to pick them" section.
- `/vs/` hub updated with the profession-tools section; per-incumbent pages built (at least Clio Duo, CoCounsel, Jump, Intuit Assist, Gamma, Copilot), each on the template, each honest about the competitor's strengths.
- No em dashes anywhere; voice matches the site; no AI tells.
- Local-vs-cloud precision correct everywhere (no "nothing leaves" claims attached to the cloud-key path).
- Heppner cited correctly and sourced, with the "informational, not legal advice" caveat; same caveat pattern for §7216 and Reg S-P.
- Advisor Prep Hero pricing pulled from the canonical source (not hardcoded); the Practice "one-time vs yearly" inconsistency resolved and consistent across homepage, `/vs/`, and the EULA; competitor pricing shown as approximate bands with the as-of-2026 footnote and outbound links.
- `npm run` content-lint (or the site lint) passes; nav and `kp-footer` present on new pages; canonical/OG meta set.
- Nothing deployed to keepance.com until Jameson reviews the competitive claims and gives the go.

---

## Not a build (captured so it isn't lost)

- **SOC 2 (Type II) + a standard DPA** is the single biggest trust-signal gap for the regulated verticals (RIA and multi-lawyer-firm vendor approval blocks on it). This is a Jameson/board decision (spend + process), not a build. Flagged in the landscape doc, Section 8.
- **Competitor-watch + quarterly refresh** (Elephas, Lexis+ BYOK, any incumbent shipping a genuine local/zero-egress mode). Worth a standing scheduled routine; pricing and features in this space move fast.
