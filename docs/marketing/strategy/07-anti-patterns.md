# 07: Anti-Patterns and Siren Songs

_Last reviewed: 2026-04-27_
_Status: Living doc. Add to it when a new trap is identified. Re-read at the start of every monthly review._

The strategy in `00-master-strategy.md` works only if we don't talk ourselves out of it on slow months. The tactics in `01-seo-engine.md` through `06-measurement-cadence.md` work only if we don't add a "quick win" tactic that pulls hours away.

This doc collects the moves that look like they should work but reliably don't, for a tool with our shape (indie founder ICP, BYOK, local-first, one-time pricing, 5-10 hr/week founder, $10K MRR target). Every entry has the form: trap, why it's seductive, why it's wrong for Projelli, the signal that we're about to fall into it.

Read this before any major tactical change. Re-read at the start of every monthly review.

---

## 1. Adding cloud sync because buyers ask

**The trap:** Some buyers will ask for cloud sync. The polite framing ("just a small toggle"), the implied threat ("I'll have to use Notion if you don't"), the engineering temptation ("it's not even that hard").

**Why it's seductive:** Customer voice feels authoritative. Saying yes feels customer-centric.

**Why it's wrong:** Local-first is one of the five message pillars. Adding cloud sync compromises the privacy story, the BYOK story, and the "your data on your machine" hero claim. The buyers who ask for sync are a small minority; the buyers who came specifically because there's no cloud are the larger group, and they will leave if we add cloud.

**The signal we're about to fall in:** A monthly review surfaces "X buyers asked for cloud sync" as a trend, and the impulse is to add it to the BACKLOG.

**The correct response:** "Projelli doesn't sync to a cloud. Put your workspace folder in Dropbox, iCloud, or Syncthing if you want sync. Here's a doc explaining how." Document the request count but never act on it.

---

## 2. Adding a subscription tier when revenue stalls

**The trap:** Month 4 hits, revenue is at $1,500/mo and growing slowly. The temptation: "What if we add a $9/mo tier? Predictable revenue!"

**Why it's seductive:** Subscription revenue is the indie-tool gold standard. A $9/mo tier sounds harmless.

**Why it's wrong:** "Sold once" is one of the five pillars. Adding a subscription tier dilutes the message instantly. Worse, it creates a complicated pricing matrix that takes home-page real estate the message pillars need. Every founder who has done this in our category has regretted it within a year.

**The signal:** Anyone (Claude, Jameson, an advisor) starts a sentence with "What if we tried a small subscription...".

**The correct response:** "We don't sell subscriptions, ever. The pricing decision is locked in `PROJELLI_BUSINESS_PLAN.md` and revisiting it requires a full strategy retrospective, not a tactical change."

---

## 3. Verticalizing into "Projelli for therapists" / "Projelli for writers" / "Projelli for X"

**The trap:** SEO data shows interest from a specific profession. The temptation: "Let's spin up `/projelli-for-therapists` with HIPAA-leaning copy."

**Why it's seductive:** Vertical pages can rank well. Targeted positioning improves conversion. The product already supports the use case technically.

**Why it's wrong:** Projelli's positioning is "for indie founders" (CEO decision #1). Every vertical we add dilutes that focus. We end up with a vague pan-knowledge-worker tool that doesn't convince any specific buyer. Worse, vertical micro-positioning often comes with industry-specific compliance promises (HIPAA, FERPA) that the product doesn't actually meet.

**The signal:** A monthly review proposes a `/projelli-for-X` page where X is not "indie founders" or "solo developers".

**The correct response:** "Projelli is for indie founders. If a non-founder finds Projelli useful, we're glad. We don't market to them."

**Exception:** Adjacent ICPs like "indie hackers", "solo developers", "building-in-public makers", and "first-time founders" are all variations of the same buyer. Use them flexibly. Don't introduce truly different verticals.

---

## 4. Pivoting after one bad week

**The trap:** A week's revenue dips 40%. The product flow seems off. Maybe we should rebuild the onboarding? Maybe rewrite the homepage? Maybe rethink the message pillars?

**Why it's seductive:** Doing something feels productive. The dip feels like signal.

**Why it's wrong:** Indie tool sales are spiky. A 40% week-over-week dip from 12 sales to 7 sales is normal noise. Reacting to it costs days of work and almost certainly doesn't fix the (non-existent) problem.

**The signal:** Conversation pattern of "this week was rough, what should we change?" without monthly review data backing it.

**The correct response:** Trust the cadence. The weekly review is for keeping operations clean. The monthly review is where strategy gets adjusted. If it isn't a monthly review, we don't pivot. Per `06-measurement-cadence.md`, "Most 'bad months' are noise. Reacting to noise is more dangerous than ignoring it."

---

## 5. Optimizing content for PH upvotes / HN points / X engagement

**The trap:** A launch post gets 50 upvotes when 200 was the goal. The temptation: rewrite the headline to be punchier, add an emoji, add a hook.

**Why it's seductive:** Engagement metrics are visible and dopamine-rewarding. There's a whole industry of "viral indie launch" advice.

**Why it's wrong:** PH upvotes don't buy product. HN points don't pay for hosting. The launch metrics that matter (revenue, signups, backlinks, testimonials) are downstream of substance, not engagement-bait. Engagement-bait copy also reads as low-trust, which depresses the metrics that actually matter.

**The signal:** Drafting a post and asking "how do I make this go viral" instead of "how do I describe this honestly".

**The correct response:** Write the post that an indie founder would respect. Honest, specific, no superlatives. The voice profile rules in `feedback_jameson_voice_profile.md` are designed to produce this. Trust them.

---

## 6. Cold DMs at scale

**The trap:** "Let's send 500 personalized DMs to indie founders on X with a 30% off code."

**Why it's seductive:** Direct outreach feels productive. Some founders genuinely have built audiences this way.

**Why it's wrong:** Three problems. First, X / LinkedIn algorithms penalize accounts that DM-spam. Second, the recipients screenshot it and post it as a complaint, which is reputation damage. Third, the conversion rate on cold DMs is typically <0.5%, and at the volume needed to matter, the time cost is enormous.

**The signal:** Anyone proposes a "DM campaign", "warm DM list", "founder outreach week".

**The correct response:** Earned DMs only. If a specific founder writes about a specific problem Projelli solves (publicly, on X or IH), a thoughtful reply is fine. Mass cold DMs are off the table.

---

## 7. Influencer marketing

**The trap:** "Let's pay [productivity YouTuber with 200K subs] $1,500 to do a Projelli video."

**Why it's seductive:** Influencer videos sometimes produce viral spikes. Founders love showing this off.

**Why it's wrong:** Most paid influencer placements convert at 0.1-0.5% of audience to a free signup, and a fraction of that to buyers. $1,500 producing 5-10 buyers is break-even at best. Worse, paid influencer audiences are usually not our ICP, productivity YouTubers attract a wide audience of dabblers, not paying indie founders.

**The signal:** A pitch arrives ("I make productivity content, would love to feature you for $X") or someone in the strategy review proposes one.

**The correct response:** Earned mentions only. If a creator organically tries Projelli and posts about it, we engage warmly and offer them the affiliate program once it launches in Q3. We don't pay for placements.

---

## 8. Premature paid ads

**The trap:** "Google Ads / X Ads / Meta Ads is just $200 to test. Why not?"

**Why it's seductive:** Cheap test. Direct attribution. Feeds the impatience.

**Why it's wrong:** $200 in Google Ads on broad indie-tool keywords gets you 50-150 visitors. With a homepage that hasn't been optimized for direct-buy intent, those visitors convert at 0.1-0.5%. That's 0-1 buyers, $200 spent. Worse, the paid tests don't compound, when the budget runs out, the visitors stop.

**Why this is in the anti-patterns:** SEO compounds. Newsletter sponsorships have 30+ day decay. Paid ads have zero-day decay. They are the worst-shaped channel for an indie tool with a one-time price.

**The signal:** Discussion proposes a "small ad test" before SEO has shown traction.

**The correct response:** Per `00-master-strategy.md`, no paid ads in year one. The exception is newsletter sponsorships, which behave differently and become available at M3.

---

## 9. Massive content volumes (the 200-thin-pages mistake)

**The trap:** SEO advice often suggests publishing 200+ pages to dominate a category. There are tools (RankIQ, AISEO, NeuronWriter) that claim to help.

**Why it's seductive:** More pages = more shots on goal.

**Why it's wrong:** 200 thin pages dilute domain authority across thin content. Google rewards depth over breadth for tools sites. AI search assistants explicitly downrank thin AI-generated content. The plan in `01-seo-engine.md` is 30-40 high-quality pages, maintained, refreshed, internally linked. That outperforms 200 thin pages by 3-5x.

**The signal:** Anyone proposes "we should publish daily" or "let's spin up 50 long-tail keyword pages".

**The correct response:** "We do 30-40 pages over 12 months. Each one earns its slot. Each one is in Jameson's voice. Each one is refreshed quarterly."

---

## 10. Building community before having buyers

**The trap:** "We need a Discord / Slack / forum so users can talk to each other."

**Why it's seductive:** Community sounds defensible. Other tools (Notion, Obsidian) have communities.

**Why it's wrong:** Communities require a critical mass of active users (typically 1,000+) and a daily-active host. A Discord with 30 members and 1 message per week is depressing for everyone. Worse, community management is a 5-10 hr/week job all by itself, which would consume the entire founder budget.

**The signal:** "Should we set up a Discord?" appears in any monthly review before month 9.

**The correct response:** No community channel until we have 500+ paying customers. Until then, we point buyers to existing communities (IndieHackers, X #buildinpublic, r/SideProject). When we do build one, we treat it as a 12-month commitment, not an experiment.

---

## 11. Shipping a new feature instead of fixing onboarding

**The trap:** A monthly review identifies that 40% of free signups never activate (don't run a single AI chat). The temptation: "Let's add feature X to make activation more compelling."

**Why it's seductive:** Building features feels productive. New features are demoable.

**Why it's wrong:** Most non-activation is friction, not feature gaps. The feature exists; the user can't get to it. Adding more features adds more friction. The right move is almost always to make existing features more discoverable.

**The signal:** A drop in any conversion metric prompts a feature proposal.

**The correct response:** First, fix onboarding (per `04-retention-and-wom.md`). Only after onboarding is dialed do we propose new features in response to retention data.

---

## 12. Going broad when the ICP is working

**The trap:** SEO data shows traffic growing from a non-ICP segment (e.g., students, hobbyists). The temptation: write content for them too.

**Why it's seductive:** "More traffic = more revenue."

**Why it's wrong:** Non-ICP visitors convert at 5-10x lower rates. Writing for them costs Jameson hours that should go to ICP content. The traffic looks great in Plausible, the dashboard looks healthy, the revenue stalls.

**The signal:** Content cadence proposes a piece for an audience not described in `00-master-strategy.md` section 2.

**The correct response:** Politely thank the non-ICP audience that finds us. Don't write for them. The ICP is small but high-conversion; that's the math we built around.

---

## 13. Founder burnout from over-posting

**The trap:** Brand account starts strong (5 posts/week + thread + replies). Month 3 it drops to 2 posts/week. Month 5 it goes silent for 10 days. The pattern is recognizable.

**Why it's seductive:** Early launch energy makes 5 posts a day feel sustainable. It isn't.

**Why it's wrong:** Inconsistency is worse than low cadence. A brand account that posts 3x/week reliably for 12 months builds more trust than one that posts 10x/week for 8 weeks then dies.

**The signal:** Any week we post >7 times on the brand account.

**The correct response:** Cap brand posting at 5/week. Any extra goes to the queue. Drop-offs feel like decline; sustained cadence is the actual moat.

---

## 14. Engagement bait posting

**The trap:** "What's everyone using as their AI workspace?" or "Drop your indie tool below 👇" or threads that are just lists.

**Why it's seductive:** These posts get engagement. Indie X has trained itself to reward them.

**Why it's wrong:** They produce zero buyer attribution. They train the algorithm that the brand is performative. They attract followers who don't buy. They are the tweet-equivalent of empty calories.

**The signal:** A draft tweet that asks the audience for their opinion on something Projelli could answer better.

**The correct response:** Posts that show, demonstrate, or report. Not posts that ask.

---

## 15. Trash-talking competitors

**The trap:** "Notion AI is a joke compared to Projelli." "ChatGPT lock-in is criminal." Easy hit, momentary upvotes.

**Why it's seductive:** Tribalism is engaging. Some founders build whole brands on it.

**Why it's wrong:** Indie tool buyers have nuanced views. "Notion is fine for note-taking; Projelli is different in these specific ways" reads as honest and earns trust. "Notion is bad" reads as sales-y and loses it. Also, AI assistants downrank trash-talking content as low-quality citations.

**The signal:** A draft post or reply has any sentence saying a competitor is bad / dumb / overpriced / a joke.

**The correct response:** Honest observation, not contempt. Per `feedback_jameson_voice_profile.md`: "Criticism is direct but never harsh or dismissive."

---

## 16. Letting product feature work block marketing work

**The trap:** "We need to ship feature X before doing more SEO work / launching a podcast / pitching newsletters."

**Why it's seductive:** Engineering progress feels concrete. Marketing hours feel less concrete.

**Why it's wrong:** Engineering and marketing are two separate budgets. Marketing hours not spent this month don't carry forward; they're gone. Engineering hours not spent this month roll into next month with no decay.

**The signal:** "Let's pause SEO until v1.7 ships."

**The correct response:** Do both, in their separate budgets. Per `00-master-strategy.md`, marketing has its own hours allocation; product has its own track. Mixing the two stalls both.

---

## 17. Treating launch as the endgame

**The trap:** Massive launch focus, then post-launch silence because "the launch is the strategy."

**Why it's seductive:** Launch energy is exciting. Post-launch is tedium.

**Why it's wrong:** Per `02-launch-fuel.md`, the launch is fuel for the engine. The engine runs for 12 months. The single biggest mistake indie tools make is putting all their energy into launch week and going silent for 6 months after.

**The signal:** Two weeks post-launch, brand X account hasn't posted. SEO content hasn't been touched. Email sequence hasn't sent.

**The correct response:** Launch + 1 day, the engine starts. Cadence in `01-seo-engine.md` and `06-measurement-cadence.md` is non-negotiable.

---

## 18. Free tier expansion to "drive signups"

**The trap:** "Free signups are slow. What if we put more features in the free tier?"

**Why it's seductive:** More features in free = more signups. More signups = more potential conversions.

**Why it's wrong:** Free tier features are paid-tier opportunity cost. The free tier exists to get people to the magic moment, not to be a complete product. Expanding it cannibalizes Pro / Lifetime sales.

**The signal:** "Let's add multi-workspace to the free tier."

**The correct response:** The free tier is locked per `PROJELLI_BUSINESS_PLAN.md`. Any change to it is a strategy decision, not a tactical one.

---

## 19. Replying to every Reddit / HN thread about workspaces

**The trap:** Anyone in any subreddit asks "what AI tool do you use?", the temptation is to reply with Projelli.

**Why it's seductive:** Each reply feels like free promotion.

**Why it's wrong:** Reddit and HN have strong promotional self-policing. Three replies in a week from the same brand account = shadowbanned. The brand account's value depends on it being trusted, not maximally promoted.

**The signal:** Any week the brand account makes more than 2 promotional replies on Reddit.

**The correct response:** Reply only when:
- The thread specifically asks about local-first or BYOK AI tools
- We have a substantive answer beyond "we have a product like that"
- We disclose that we built Projelli ("Disclosure: I built Projelli, but...")

Cap at 1 promotional reply per subreddit per week.

---

## 20. Hiring or contracting before $5K/mo sustained

**The trap:** "I'm overwhelmed. Should I hire a VA / contract a content writer / get a freelance designer?"

**Why it's seductive:** Hiring promises capacity expansion.

**Why it's wrong:** Until $5K/mo sustained, hiring eats margin and adds management overhead Jameson doesn't have time for. The 5-10 hr/week budget is a feature, not a bug; it forces ruthless prioritization.

**The signal:** "I should hire someone to do X" before month 7-9.

**The correct response:** Don't hire until $5K/mo for 60 consecutive days. When that hits, the first hire is most likely a part-time content / community contractor at 5-10 hr/week, not a developer. Per `~/financial/08-recommendations/minimum-viable-launch.md`, this is a structural M4 trigger.

---

## 21. Pivoting to enterprise

**The trap:** A single enterprise lead emails: "Could we license Projelli for our 50-person team?"

**Why it's seductive:** Enterprise revenue is large per deal. The math looks great.

**Why it's wrong:** Enterprise sales motion is incompatible with the 5-10 hr/week founder budget. SOC 2, contracts, MSAs, security reviews, custom integration requests, each one is months of work. We chose indie founder ICP for a reason.

**The signal:** Any enterprise lead surfaces and the impulse is to "just see what they need."

**The correct response:** "Projelli isn't sold to teams. We sell to individual indie founders. If your team members want it, they can each buy a Pro license at $49." Don't engage further.

---

## 22. Stopping marketing because the product needs more features

**The trap:** Several months in, a buyer asks for feature X. The impulse: "I should pause marketing and ship features so the product is better when buyers arrive."

**Why it's seductive:** Better product = more sales. Right?

**Why it's wrong:** No. Marketing without product = no sales. Product without marketing = no buyers. They run in parallel. Pausing one to feed the other slows both. Per `00-master-strategy.md`, the hours budgets are separate tracks.

**The signal:** "I'll stop posting / writing / pitching for a few weeks while I ship X."

**The correct response:** The marketing engine runs at minimum cadence (1 post/week on brand X, 1 SEO page/month, monthly review) regardless of product work. Below that minimum, the engine seizes up.

---

## How to use this doc

At the start of every monthly review, scan the headings. Ask: did anyone propose any of these in the past month? If yes, did we resist?

If we ever fall into one of these traps, add a line to the relevant section: "Hit this on YYYY-MM-DD, lost X weeks, recovered by [action]." Future Claude sessions read these warnings before suggesting the same trap.

Add new traps as we discover them. The list grows over time. The strategy doesn't change every month, but the trap inventory does.

---

## References

- `00-master-strategy.md`: the core strategy these traps would compromise
- `~/projelli/PROJELLI_BUSINESS_PLAN.md`: pricing, ICP, and feature scope decisions
- `~/financial/08-recommendations/minimum-viable-launch.md`: milestone framework that gates spend
- `~/projelli/docs/strategy/market-assessment-2026-04/`: market research that informs which traps to avoid
- `feedback_jameson_voice_profile.md` (memory): the voice rules that prevent trap #5 and #15
