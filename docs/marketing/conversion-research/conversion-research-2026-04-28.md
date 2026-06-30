# Advisor Prep Hero landing page — conversion research brief

Compiled 2026-04-28 from focused web research into landing-page conversion patterns
for indie-tool / prosumer SaaS products with skeptical technical audiences. Used to
drive the rewrite committed alongside this file.

## Section A — Top 12 conversion principles for Advisor Prep Hero's audience

1. **The H1 must name a sharp outcome for a specific person, not the product category.**
   What to do: replace category/metaphor headlines with a one-line outcome statement.
   Why: pages that win lead with a sharp outcome for a specific person, not by
   describing themselves ([Evil Martians dev-tool study](https://evilmartians.com/chronicles/we-studied-100-devtool-landing-pages-here-is-what-actually-works-in-2025)).

2. **Use a proven indie-SaaS headline formula instead of inventing a metaphor.**
   What to do: pick one — Fathom's "[Category leader] alternative with [benefits]",
   Loom's "Do [job], not [annoying task]", Hey's "We finally fixed [category]",
   Slite's "Your [thing], [benefit]". Why: observed top-performers across SaaS heroes
   ([landingrabbit.com](https://landingrabbit.com/blog/saas-website-hero-text)).

3. **Strip the hero down. Carousels, multi-paragraph copy, and stacked badges kill
   conversion for technical buyers.** What to do: headline + one-line subhead +
   one primary CTA + one product visual. Why: Evil Martians studied 100 dev-tool
   pages and found the dominant winning pattern is "centered headline + one visual
   below," with "no salesy BS, clever and simple wins."

4. **Two CTAs max — primary + low-commitment secondary.** What to do: "Download for
   Mac" stays primary; pair with a low-friction secondary like "See it work · 60s"
   (inline product GIF/video) instead of vague "Watch the tour." Why: Evil Martians
   A/B'd "Build with us" → "Hire Martians" and went 1.3% → 2.0% just from rewording.

5. **Specificity beats adjectives.** What to do: every benefit on the page should be
   a number, a noun, or a screenshot. Replace "powerful" with "15 templates";
   replace "private" with "files in `~/Documents/Advisor Prep Hero/`". Why: technical buyers
   need lowest-possible level of abstraction; aggressive sales language triggers
   skepticism while concrete claims build trust.

6. **Use problem-first storytelling, not feature lists.** What to do: lead each
   section with the pain ("You re-explain your project to ChatGPT every morning"),
   then the mechanism ("Advisor Prep Hero remembers"), then the proof (screenshot). Why:
   Evil Martians' 100-page study ranked storytelling hierarchies — function lists
   were weakest; problem-oriented stories produced "better emotional resonance."

7. **Show social proof early but curated, not auto-pulled or hyped.** What to do:
   3–5 named indie founders with handles + role, not "Trusted by 10,000 founders"
   you don't have. Why: vague social proof "reeks of marketing speak and sleaziness."

8. **Translate "local-first" into a concrete user benefit, not a category label.**
   What to do: don't say "local-first storage" — say "your files live in a folder
   on your hard drive. You can open them in VS Code. You can back them up to
   Dropbox. We can't see them. Ever." Why: Obsidian uses "Your thoughts are yours.
   No one else can read them, not even us."

9. **Frame BYOK as "no middleman" and "no caps," not as a technical setup step.**
   What to do: lead with cost/control benefit ("Pay OpenAI directly. No markup,
   no rate limits"), not "supports BYOK." Why: BYOK research positions the win as
   eliminating wrapper-app middlemen and removing artificial caps
   ([surfmind.ai](https://surfmind.ai/blog/byok-bring-your-own-key-future-of-ai-tools)).

10. **One-time pricing is a *story*, not just a number.** What to do: explicitly
    contrast against subscription fatigue. "$49 once. Not $49/month. Not $49/year.
    $49 ever." Why: 2025 research shows consumers actively choosing one-time buys
    to escape recurring decisions
    ([influencers-time.com](https://www.influencers-time.com/subscription-fatigue-in-2025-why-one-time-buys-dominate/)).

11. **The Founder's Launch (first 100 at $29) is a real FOMO lever — surface it
    visually.** What to do: live counter ("47 of 100 spots left") next to the
    price, not buried in fine print. Why: live-counter banners can lift conversion
    up to 332% ([99signals.com](https://www.99signals.com/psychology-of-lifetime-deals-fomo-saas/)).

12. **Show the product working in the hero; don't make people watch a tour to get
    it.** What to do: a 6–10 second autoplaying loop showing one chat happening +
    the .md file appearing in Finder. Why: Evil Martians' study identified animated
    product UI as the dominant winning visual.

## Section B — Recommended hero structure

**Headline formula** — pick one (A/B candidates):
- A (Fathom alternative): "A Notion AI alternative for founders who want their
  files on their own machine."
- B (Loom do/not): "Stop re-explaining your project to ChatGPT every morning."
- C (Slite your-X): "Your AI workspace, on your hard drive."
- D (problem-led, recommended): "An AI workspace that learns you. Saves every
  chat as a file you own."

**Sub-headline formula:** `[Audience]. [Mechanism in concrete nouns]. [Proof of
control].`

**Primary CTA:** OS-specific ("Download for Mac" / "Download for Windows") —
removes a click and pre-qualifies. Better than bare "Download Advisor Prep Hero."

**Secondary CTA:** "See it work · 60s" — sets a time expectation, which is a
documented friction-reducer. Better than vague "Watch the tour."

**Hero visual:** a 6-10 second muted, autoplaying loop. Three beats: (1) user
types into chat, AI responds, (2) Finder/Explorer shows the new .md file
appearing in the workspace folder, (3) user opens the file in another editor
(VS Code). Proves four claims simultaneously: AI chat, real files, files on
disk, standard Markdown.

## Section C — Most likely conversion killers on Advisor Prep Hero specifically

1. **Hero metaphor "Chat that leaves something behind."** Vague metaphors are
   the #1 documented conversion killer for technical audiences.
2. **"Watch the tour" as the secondary CTA.** Open-ended commitment to a
   skeptical audience.
3. **Founder's Launch ($29 first 100) buried as a one-line note.** Strongest
   scarcity lever, currently invisible.
4. **"Your data lives on your computer" without proof.** Add a literal
   screenshot of Finder/Explorer showing the workspace folder.
5. **No named social proof above the fold.**
6. **"Free 30-day trial" + "Download Advisor Prep Hero" mismatch.** Reads like
   bait-and-switch. Either rename CTA to "Try Advisor Prep Hero free for 30 days" or
   make the trial mechanic immediately visible.

## Section D — Sources actually fetched

1. https://keepance.com — current page audit
2. https://linear.app — hero structure reference
3. https://www.raycast.com — above-the-fold social proof pattern
4. https://plausible.io — privacy-first hero, trust metrics
5. https://obsidian.md — local-first user-facing language
6. https://obsidian.md/pricing — one-time / optional-license framing
7. https://cal.com — hero + CTA pattern
8. https://kit.com — creator-audience headline structure
9. https://usefathom.com — "category alternative + benefits" headline
10. https://reflect.app — AI-in-notes positioning
11. https://tana.inc — AI + persistent context positioning
12. https://cursor.com — "AI that learns your codebase" positioning
13. https://zed.dev — speed/local benefit framing
14. https://anytype.io — local-first as "safe haven"
15. https://www.notesnook.com — encryption translated to user benefit
16. https://www.beeper.com — value-stacking hero formula
17. https://culturedcode.com/things/ — indie-tool benefit-driven headline
18. https://cron.com — minimalist 3-word hero
19. https://landingrabbit.com/blog/saas-website-hero-text — 11 working hero formulas
20. https://evilmartians.com/chronicles/how-to-kill-conversions-on-your-developer-tool-landing-page — five named killers, A/B data
21. https://evilmartians.com/chronicles/we-studied-100-devtool-landing-pages-here-is-what-actually-works-in-2025 — 100-page dev-tool study
22. https://www.indiehackers.com/post/common-design-patterns-used-by-successful-saas-landing-pages-3ac5ce41c6
23. https://surfmind.ai/blog/byok-bring-your-own-key-future-of-ai-tools — BYOK user-benefit framing
24. https://www.99signals.com/psychology-of-lifetime-deals-fomo-saas/ — lifetime deal + FOMO data (332% lift)
25. https://www.subi.co/post/subscription-vs-one-time-purchase — buy-once psychology
26. https://www.influencers-time.com/subscription-fatigue-in-2025-why-one-time-buys-dominate/
27. https://calmops.com/indie-hackers/pricing-psychology-indie-hackers/
28. https://www.jenova.ai/en/resources/ai-that-remembers-you — "AI that remembers you" language
29. https://www.crazyegg.com/blog/landing-page-video/ — video conversion-lift data

## Section E — What was actually shipped (2026-04-28)

See git history. Major rewrites:

- Hero H1 changed from "Your AI conversations as files you actually own"
  to "An AI workspace that learns you. Saves every chat as a file you own."
- Hero subhead rewritten to lead with the audience + mechanism + proof of
  control, plus surfaced the $29 Founder's Launch tier inline.
- Secondary CTA "Watch the tour" → "See it work · 60s".
- Section H2 "Chat that leaves something behind" → "Every chat becomes a
  file you can open in Finder."
- Section H2 "A workspace that keeps your thinking connected" → "Your
  notes link to each other. Your AI remembers what you told it last week."
- Section H2 "Your data lives on your computer" → "Your files, in a
  folder you control. We can't see them — even if we wanted to."
- Pricing H2 "30 days free. Then $49 once." → "$49 once. Not $49/month.
  $49 ever."
- Live "X of 100 Founder's Launch spots left" widget added beside pricing,
  driven by `/spots-remaining.json` (manually editable file at
  `website/spots-remaining.json` — update as sales come in, or wire to a
  LemonSqueezy webhook later).
