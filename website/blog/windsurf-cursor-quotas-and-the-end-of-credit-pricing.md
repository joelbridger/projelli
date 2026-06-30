---
title: "Windsurf killed credits in March, Cursor moved to dollar-budget API usage. The AI subscription model is finishing its second pivot in 18 months."
description: "Two of the most popular AI coding tools changed their pricing structures in March and April 2026. The pattern is the same: more layers between you and the actual cost. A read on what's happening and what attorneys, CPAs, and consultants should do about it."
date: 2026-05-07
author: Jameson Daines
tags: [AI Tooling, Pricing, BYOK]
category: opinion
---

In March, [Windsurf killed its credit system](https://windsurf.com/blog/windsurf-pricing-plans) and replaced it with daily and weekly quotas. Pro went from $15 a month to $20. The Max plan came in at $200 a month. Existing subscribers were grandfathered at the old prices, for now.

In April, [Cursor 3 launched](https://cursor.com/changelog/0-50) with a refreshed UI and an extended pricing structure. Pro at $20 still, Pro+ at $60, Ultra at $200, with each plan including a fixed dollar amount of "API usage credits" ($20 for Pro, $70 for Pro+, $400 for Ultra) on top of the subscription.

I've been watching this market shift for two years now while building [Advisor Prep Hero](https://keepance.com), and I want to talk about what these two pricing moves mean, why they're happening at the same time, and what an attorney, CPA, or independent consultant should actually do about it. This is a follow-on to my earlier piece on [the hidden tokenizer tax](https://keepance.com/blog/claude-opus-47-tokenizer-cost-what-professionals-need-to-know). Some of the same dynamics. New evidence.

## What actually changed

Windsurf's old credit model worked like a debit account. You bought credits monthly, you spent them per request, you knew exactly how much each request cost in credits. You could roll over unused credits, you could buy add-on packs, you could budget. The credit price varied by model (Claude Opus cost more credits than Claude Haiku, GPT-4o cost more credits than 3.5), but the unit economics were transparent. [User reception of the change was not warm](https://efficienist.com/windsurf-abandons-flexible-credit-system-for-strict-quotas-sparking-user-backlash/).

The new quota model works like a phone plan. You get X requests per day and Y per week, and when you hit the limit you wait. You don't see the dollar cost of each request. You don't have a ledger. You have a meter that fills up and empties and that's it.

Cursor went the other direction. Their old model was request-based (a fixed number of premium-model requests per month, with overflow at known rates). The new model gives you a dollar budget of API usage on top of a subscription, and tracks token consumption against that dollar budget. So the user sees actual dollar usage. Closer to BYOK in spirit, even though the user isn't bringing their own key.

These are opposite moves. Windsurf moved further from cost transparency. Cursor moved closer to it. But the cause is the same: the underlying inference cost is too volatile to absorb on a fixed margin.

## Why this is happening now

Three forces, all accelerating:

**Tokenizer changes are real and unannounced.** I wrote [a whole piece on this](https://keepance.com/blog/claude-opus-47-tokenizer-cost-what-professionals-need-to-know) when Anthropic shipped Opus 4.7 with up to 35% more tokens for the same input under the same headline price. If you're a vendor on a fixed margin, an event like that eats your quarter without warning. You either pass the cost through to users (Windsurf's quota tighten) or you make the user own the cost (Cursor's dollar budget).

**Premium-tier convergence at $200.** [Claude Code Max, Cursor Ultra, and Windsurf Max are all $200/month](https://www.nxcode.io/resources/news/ai-coding-tools-pricing-comparison-2026). This is not a coincidence. $200 is roughly the price floor at which the vendor can credibly absorb heavy frontier-model usage from a single power user without losing money on every interaction. The convergence tells you the marginal cost of inference for a heavy user is around $150 to $200 a month at current model prices and that the vendor margin is thin.

**The mid-tier is a war zone.** Pro tiers cluster between $15 and $25. Pro+ tiers cluster between $40 and $70. The vendors are moving these prices around quarterly. Heavy Pro users hit rate limits in days. The Pro tier exists, in many cases, to capture the user upstream of the Pro+ tier and migrate them upmarket.

If you're paying $20 a month for an AI tool, you should expect your effective usage to drop relative to the same $20 a month a year ago. The price is flat. The product is getting smaller. This is the rate-limit version of the tokenizer tax.

## The user-facing consequence

The thing I keep noticing on Hacker News and on professional forums is that users are increasingly running **multiple subscriptions at the same time** as a hedge. ChatGPT Plus + Claude Pro + one or two specialty tools. That's $60 to $100 a month, and people are paying it because each tool has different rate limits and different model strengths and different breaks per day. A heavy user can credibly justify 3 or 4 subscriptions running concurrently.

This is what a poorly priced market looks like. The user is paying multiple vendors a flat fee to capture the slim window when each one isn't rate-limited. The aggregate cost is high. The aggregate value is unstable. Any individual subscription is worth less month-over-month as the rate limits tighten.

For attorneys and CPAs, there's a sharper version of this problem. When you're running multiple AI subscriptions to hedge against rate limits, you're also routing client work through multiple vendors' cloud infrastructure. Each subscription is another party in the data chain. Each one has its own privacy policy, data retention practices, and breach risk surface. [ABA Formal Opinion 512 (2024)](https://www.americanbar.org/content/dam/aba/administrative/professional_responsibility/aba-formal-op-512.pdf) requires attorneys to understand what cloud AI services do with client data. IRC §7216 makes unauthorized disclosure of tax return information a criminal matter. Running client work through four different subscription tools to manage rate limits is not a data architecture you can easily explain to bar counsel or an IRS auditor.

## The BYOK answer, in 2026 specifics

I built [Advisor Prep Hero](https://keepance.com) on a BYOK model. You bring your own [Anthropic key](https://console.anthropic.com), [OpenAI key](https://platform.openai.com/), or [Google AI key](https://aistudio.google.com/), and the requests go directly to the provider on your account. Advisor Prep Hero doesn't see them. Advisor Prep Hero doesn't take a margin on them. The pricing is transparent on the provider's invoice at the end of the month.

For professionals, this does two things at once. First, the cost transparency: you pay exactly what the provider charges, with no subscription markup. Second, the data chain: client information goes from your machine to Anthropic or OpenAI directly. No intermediary. No additional party in the chain. That's a data architecture you can describe clearly and defend professionally.

In 2026, the BYOK model is materially better than it was in 2024 for one specific reason: the providers' direct prices have fallen meaningfully and the API consoles have gotten genuinely usable. [Anthropic's pricing](https://www.anthropic.com/api) is published and stable. The [console at console.anthropic.com](https://console.anthropic.com) gives you per-day, per-model usage breakdowns. You can set monthly spend limits. You can rotate keys. Same for [OpenAI's platform](https://platform.openai.com/). You can get Sonnet-class quality for $3 in input tokens per million in 2026, and the actual unit economics for a heavy individual user are more like $15 to $40 a month, not $200.

The trade-off is that BYOK is more setup work than a one-click subscription. You go to the provider's console, you get a key, you load $20, you paste the key into your tool. It's a 5-minute job. But it requires the user to have their own billing relationship with a model provider, and most subscription tools deliberately make that harder, because the friction is what keeps you paying their flat fee instead of going direct.

## What I'd actually do, in concrete moves

If you're a professional paying for AI tools right now, here's the playbook I'd run:

**Audit your current spend.** Add up everything across ChatGPT Plus, Claude Pro, any specialty AI tools you're using. If the total is over $60 a month for one person, you're past the point where BYOK is going to be cheaper for any serious professional workflow.

**Open an Anthropic and an OpenAI account with $10 in each.** Two console accounts, $20 total. You now have direct billing relationships with the two primary frontier-model providers. You can use them with any BYOK tool.

**Pick one workflow to migrate first.** Not everything at once. One workflow. For most attorneys, that's memo drafting. For most CPAs, it's tax position analysis. Move it to Advisor Prep Hero on BYOK and see what the actual monthly cost looks like against what you were paying the subscription tool. The numbers are usually illuminating.

**Pick the workflow where flat subscriptions punish heavy use most.** This is usually anything involving long documents or repeated passes on the same material — the kind of work attorneys and CPAs actually do. If you're hitting rate limits on any tool regularly, that workflow on BYOK is going to feel different. Your API key has no rate limit that someone else set for business reasons.

**Don't run too many subscriptions in parallel.** This is the trap, and it's a data architecture trap as much as a cost trap. Running 3-4 AI tool subscriptions at once means 3-4 parties potentially touching your client data. For professionals with formal confidentiality obligations, that's not a hedge. It's exposure.

## Where this is going

Two predictions, both medium-confidence.

**By Q4 2026, the $200 premium tier is going to start showing rate limits too.** The convergence at $200 is unstable. As frontier models get more capable and more expensive per response, the same $200 will buy less compute. Either prices rise above $200 or rate limits tighten. Probably both.

**BYOK as a pricing model is going to become more mainstream, but only on the long tail.** The mainstream tools (Cursor, Copilot, ChatGPT) are not going to switch. Their unit economics depend on the hidden margin. The smaller tools, the profession-specific tools, the tools built for users with specific data requirements, are going to compete on transparency, and BYOK is the natural endpoint of that competition.

For professionals, there's a third trend that matters more than either of those: regulatory and bar guidance on AI use is moving in the direction of requiring professionals to actually understand and document what AI tools do with client data. The February 2026 *Heppner* decision, ABA Op 512, and the FTC Safeguards Rule for tax preparers are early signals of a compliance environment that's going to make "I just used the subscription tool and didn't read the data handling terms" a harder position to defend.

The deeper thing I keep coming back to is that AI inference pricing is not like any pricing model the SaaS world has produced before. The vendor controls the price of the unit, the size of the unit, the verbosity of the unit, and the cap on usage of the unit. The user sees one of those four. A subscription model that doesn't put the other three in front of the user is going to keep producing surprises.

The honest pricing models put all four in front of the user. BYOK does this by design. Cursor 3's dollar-budget approach does some of this. Windsurf's quota model does the opposite, intentionally.

If you're a professional buying these tools, watch the layers between you and the cost. Each layer is a place where the math can change without you noticing — and for professionals with confidentiality obligations, each layer is also a party that may be touching your client's information.

I'll keep the [Advisor Prep Hero pricing](https://keepance.com/#pricing) consistent with what I argue for: Professional at $149/year (one profession pack, BYOK, no markup on inference), Practice at $499 a year for up to five seats and all four packs. If you're running a different setup and seeing different math, or different compliance considerations, I'd like to hear about it.
