# Projelli v1.5 build-in-public tweet sequence

> A 14-day arc of posts across X, with the PH/Show HN launch as Day 4. Every tweet under 280 chars, voice-rule compliant, first-person singular, no em dashes. Variants provided so you can pick the phrasing that feels right the morning you post.
>
> **Which account?** This assumes you post from @jamesondaines (your real name). If you go pseudonymous instead, swap "I've been" → "I've been" (still works) and skip the Day 5 "day-job" line.
>
> **Cadence rule:** no more than 2 posts per day outside launch week. Don't batch; spread across morning + afternoon so the algorithm sees engagement from multiple slots.
>
> **Format key:**
> - `[SINGLE]` = one post
> - `[THREAD]` = two or more connected posts
> - `[WITH_MEDIA]` = needs a screenshot, GIF, or video attached
> - `[LINK]` = outbound link included
> - Variants labeled `A/B/C`, pick one, don't post more than one

---

## Day -3 (Monday before launch week)

### Main post `[SINGLE]` `[LINK]`

**A.** I've been building Projelli on nights + weekends for 18 months. Desktop AI workspace, local files, BYOK. Shipping the 1.5 release Thursday. Previewing it this week if you want to kick the tires. projelli.com

**B.** Ship date locked: Thursday, Projelli 1.5. Big release, covers 4 new capabilities I've wanted in my own workflow for a year. Quick thread on what's in it so nothing lands as a surprise the day of. projelli.com

**C.** Every AI chat I have in my own tool produces a Markdown file on my hard drive. No cloud DB, no Projelli server in the middle. I'm shipping the 1.5 update Thursday. projelli.com

### Morning reinforcement `[SINGLE]`

**A.** 4 things I wanted in an AI workspace and didn't find anywhere: (1) remembers what I wrote 3 months ago, (2) Claude Desktop can read my files, (3) AI edits next to me instead of in a chat tab, (4) works offline. Thursday.

**B.** Pricing question someone asked me last week: "why one-time if AI is a subscription cost?" Because the AI cost is yours, not mine. BYOK = you keep your keys, I never touch your tokens. Projelli stays one-time.

---

## Day -2 (Tuesday)

### Feature deep-dive `[THREAD]` `[WITH_MEDIA]`

**Thread starter:**
> One of the 4 things shipping in Projelli 1.5 Thursday: local memory. Here's what that actually means in practice. [screenshot of @workspace query with citation]

**2/** My whole workspace lives in a folder of Markdown files. 1.5 adds a vector index so I can ask "what did I decide about pricing three months ago?" and get the actual paragraph back, with a link to the source file.

**3/** No server. No OpenAI embeddings. e5-small-v2 ONNX running on your CPU via fastembed-rs, stored in LanceDB. Indexes ~1000 files in under a minute. Queries in 200ms. All local, all offline.

**4/** And because the index is a local LanceDB table, any other tool can read it too. If I disappear tomorrow, your memory works fine with any LanceDB-capable client. The data is yours.

### Afternoon observation `[SINGLE]`

**A.** 1.5M people canceled ChatGPT Plus in March 2026. AI subscription fatigue is peaking. The move I'm betting on: let people bring their own API keys, pay me $49 once for the tool, and their monthly AI spend drops from $20/mo to $2-5.

**B.** Building something with a one-time price, zero server cost, zero cloud dep. Unit economics are simple: $49 × paying users = revenue. No dunning. No churn cohorts. Either it's useful enough that people pay, or it isn't.

---

## Day -1 (Wednesday, launch-eve)

### Last-call teaser `[SINGLE]`

**A.** Projelli 1.5 ships tomorrow morning. Desktop AI workspace, local files, BYOK, one-time $49 / $99 lifetime. If you've been waiting for the "AI workspace you actually own" thing, this is that. projelli.com

**B.** Tomorrow: Projelli 1.5. 4 new flags land at once (memory, MCP server, side-by-side edit, voice + Ollama). First 100 buyers get $29 lifetime. projelli.com

**C.** 24 hours out. If you run Claude Desktop and want your own files to be searchable from it, tomorrow's release adds that. .mcpb one-click install for Claude Desktop / Cursor / Zed.

### Evening: founder line `[SINGLE]`

**A.** Writing tomorrow's launch post right now. I've been building this for 18 months around my day job. Five minutes of nervous, four hours of re-reading every sentence. If you see me up late tonight on X, that's why.

**B.** The hard part of launching solo isn't the product, it's the audience. I should have started posting here six months ago. Starting now instead, which is still better than the day-of. Tomorrow is Projelli 1.5.

---

## Day 0 (Thursday, LAUNCH DAY)

### Main launch tweet `[SINGLE]` `[LINK]` `[WITH_MEDIA]`

**A.** Launching Projelli 1.5 on Product Hunt today. Desktop AI workspace for indie founders. Your files, your keys, your machine. Memory + MCP + side-by-side AI editing + offline voice. $49 one-time. [PH link]

**B.** Today: Projelli 1.5 on Product Hunt. The AI workspace I've wanted to use for a year. Every chat produces a real file. Works in every AI tool (MCP). Edits alongside you. Offline with Ollama. [PH link]

**C.** Projelli 1.5 is live on Product Hunt. If you've been burned by AI subscription creep, paying for Notion, ChatGPT, Cursor, and Claude separately, this is my counter-bet: $49 once, bring your own AI key, files on your disk forever. [PH link]

### Launch mid-morning update `[SINGLE]` `[WITH_MEDIA]`

At hour ~3:

**A.** Projelli 1.5 at [X] upvotes, currently #[N] of the day. Thanks to everyone who hunted + commented. Replying to every question in the thread, come say hi. [PH link]

**B.** Projelli 1.5 at 2 hours: [X] upvotes, [Y] comments, [Z] sales. Real numbers, not vibes. Keep them coming. [PH link]

### Show HN parallel `[SINGLE]` `[LINK]`

Post ~30 minutes after PH:

**A.** Show HN: Projelli, desktop AI workspace, every chat becomes a file on your disk (BYOK, one-time) [HN link]

**B.** Show HN: Projelli 1.5, local-first AI workspace with a first-party MCP server for Claude Desktop [HN link]

### End-of-day thanks `[SINGLE]` `[WITH_MEDIA]`

End of day:

**A.** Day-1 numbers: [X] upvotes on PH, [Y] on HN, [Z] first sales. More than I expected. Thank you, all of you. Replying to the last comments now, then sleeping. Back tomorrow.

**B.** Launch day done. Real numbers: [stats]. The best part wasn't the number, it was [specific nice comment or interaction]. Going to sleep for 10 hours.

---

## Day 1 (Friday, launch +1)

### Overnight reflection `[SINGLE]` `[WITH_MEDIA]`

**A.** Slept 10 hours for the first time in a month. Woke up to [X] more sales overnight. PH is still on fire, HN thread tapered. Replying to everything this morning. Then back to fixing the 3 bugs you all found.

**B.** 8am-ET update: [numbers]. 3 bugs reported by early users, all fixed already (small enough to patch in the updater). If you bought yesterday and got an install weirdness, 1.5.1 auto-updates today.

### Thank-you thread `[THREAD]` `[LINK]`

**Starter:** Thanks for the first [X] sales. I want to name a few specific people who made this launch actually land.

**2/** [@handle], the PH hunter who picked it up when I was nervous about self-hosting: thank you.

**3/** [@handle_1], [@handle_2], [@handle_3] who gave real beta feedback in the last week: every one of the 4 flags has your fingerprints on it.

**4/** And everyone who commented in the PH thread. I learned more about my own positioning in 6 hours than in 18 months of building. The launch was the user interview I'd been too shy to run.

---

## Day 2-3 (weekend after launch)

### Usage pic `[SINGLE]` `[WITH_MEDIA]`

**A.** Saturday morning, Projelli open, coffee. Running the Weekly Review template. This is why I built it: it's the tool I actually use. [screenshot]

**B.** Using my own product on a Saturday. This is the retention metric that matters. [screenshot of workspace with real personal files]

### One-pic deep dive `[SINGLE]` `[WITH_MEDIA]`

**A.** Someone in the PH thread asked if the MCP server actually works. Here's Claude Desktop reading my Projelli workspace in one screenshot. [screenshot]

**B.** Answering yesterday's most-asked question with a picture. "Does the cost meter really work in real time?" Yes, and here's a 12-second GIF of it. [GIF]

---

## Day 4 (Monday after launch week)

### Numbers post `[SINGLE]`

**A.** Week 1 Projelli 1.5 numbers: [X] sales, [Y] users, [Z] in revenue. Median customer bought $49 Pro, 30% went $99 Lifetime, 12% hit the $29 Founder's Launch. More than I projected, less than it feels like.

**B.** Real week-1 numbers, not vanity: [revenue], [paying users], [refund requests]. Bought: [breakdown by tier]. What surprised me: [one specific thing].

### Answer a common question `[SINGLE]`

**A.** "Why no cloud sync?" came up 40 times last week. Answer: because the moment I add sync I compete with Notion, and Notion has 40M users. My moat is "your files on your disk, forever." Adding cloud erodes that. Use iCloud or Dropbox if you want sync.

**B.** "Mobile app?" Also no. For the same reason. Different product, different buyer. Your Projelli files are plain Markdown; any mobile Markdown app reads them (I use Working Copy).

---

## Day 5-7 (rest of week 2)

### Lesson from launch `[THREAD]`

**Starter:** 5 things that surprised me about launching Projelli 1.5 last week.

**2/** The PH comments were less about features and more about pricing philosophy. Half the top 10 were people arguing about whether one-time pricing is sustainable. It wasn't what I'd prepared for.

**3/** HN cared about the tech stack more than any other channel. Tauri vs Electron, LanceDB vs Chroma, fastembed vs OpenAI embeddings. I had answers ready because I'd thought through every trade-off, but the depth of the questioning was still intense.

**4/** Nobody asked about the 15 workflow templates, which I thought was one of the killer features. Lesson: if a feature needs explanation, it's not the hook. The hooks were memory + MCP, because they compress to one sentence.

**5/** Launching solo is lonely. The product is fine. The PH post is fine. The sales are fine. What I wish I'd had: one other person in the same room to celebrate with when hour 3 numbers came in. Next time, schedule a dinner with a friend that night.

### Feature reveal 2 `[SINGLE]` `[WITH_MEDIA]`

**A.** 10 days into Projelli 1.5 and the feature I use most turns out to be the cost meter, not the memory. I watch it tick up in real time during a long chat and it trains me to write better prompts. Anti-feature turned favorite.

**B.** The most-used feature after a week isn't the one I expected. It's the "Ask my workspace" toggle in chat. I forget things I wrote two weeks ago, this surfaces them, and I end up writing better follow-ups because I know my own history.

### Community question `[SINGLE]`

**A.** Question for people who bought Projelli 1.5 in the first week: what's the one thing you wish worked but doesn't? Replying to every answer.

**B.** Build-in-public ask: if you've used Projelli for 7+ days, what's the first thing that bugs you? Brutal honesty please, I'm doing the v1.6 planning this weekend.

---

## Day 8-10 (week 2, mid)

### Ship-progress post `[SINGLE]`

**A.** v1.6 planning done. 3 things shipping in the next 30 days based on week-1 feedback: [item 1], [item 2], [item 3]. If you're a v1.5 customer, auto-updater will deliver them. No charge. That's the Lifetime tier deal.

**B.** First patch release (1.5.1) shipped tonight. Fixes the 3 bugs that landed in my GitHub issue tracker during the first 48 hours. If you own Projelli, the updater delivered it, no action required.

### Metric transparency `[SINGLE]` `[WITH_MEDIA]`

**A.** Public metric: [paying users] × $49 avg = $[X] total revenue since launch. No VC, no advisors, no cofounders, just me and a day job. Sharing because I want to normalize solo founders showing real numbers.

**B.** 10 days in: [revenue], [DAU], [refund rate of X%]. Refund reasons (2 so far): both were "expected cloud sync, didn't realize it was local-only." Adding a clearer callout on the homepage.

### User screenshot `[SINGLE]` `[WITH_MEDIA]`

**A.** [Customer @handle] shared how they're using Projelli for their investor update workflow. 12 months of memory facts + 6 months of workspace chats. Asked them to send a screenshot. Permission granted. [screenshot]

**B.** RT or quote-tweet a genuinely nice thing someone said.

---

## Day 11-14 (week 2 closeout)

### Long reflection `[THREAD]` `[LINK]` (blog post tie-in)

**Starter:** I wrote a longer piece on the 2 weeks since launching Projelli 1.5. The stuff that went right, the stuff I'd do different. Link below, but a preview: [blog permalink]

**2/** The single best decision I made pre-launch was the market assessment doc. Spent a weekend getting it right. Every subsequent feature decision referred back to it. It kept me honest when feature creep called.

**3/** The single worst decision was not starting build-in-public 3 months earlier. The audience I launched to was 100 X followers. If I'd started the "8 weeks to ship" arc in mid-January, I'd have had ~1000 followers at launch. Different order of magnitude of first-week reach.

**4/** The best surprise: how many HN commenters were thoughtful and kind. HN has a reputation. The reality in my thread was 90% constructive. I think it's because I was honest about being a solo founder with a day job, which disarmed the "startup pitch" reflex.

**5/** The thing I'd tell another solo founder week before launch: have 5 friends scheduled to like + comment on your PH post in the first 20 minutes. PH's ranking algorithm looks at early velocity hard. Every upvote in minute 0-20 is worth 10x an upvote at hour 3.

**6/** Full write-up here. [blog link]

### Momentum post `[SINGLE]`

**A.** 2 weeks post-launch: [total revenue], [users], [retention signal]. Moving into v1.6 build mode starting Monday. Keeping the weekly build-in-public cadence going, one update every Thursday.

**B.** Projelli closes its first 2 weeks at [number] paying users. Not a unicorn, not supposed to be. This is "solo indie app supports itself and its maker." That's the shape I wanted. Back to shipping.

---

## Reserved slots (not in the 14-day plan but keep in pocket)

### If PH goes above top 5 of the day

> Holy sh\*t. [screenshot of PH rank]. I don't know what to say. Thank you. I'm going to open my inbox and reply to every single DM. If I take more than an hour, I'm eating lunch. Then back.

### If someone prominent endorses

> [@big-name] just said nice things about Projelli. That's kind of a bucket list moment. Thank you. For everyone else reading: nothing in my tool changed between yesterday and today. If [@big-name]'s endorsement helps you try it, welcome. If it doesn't, same answer.

### If you hit a target number

> Projelli just passed [milestone]. I set this goal in week 3 of the 8-week ramp and told nobody because I was scared of missing. Now I can say it: the target was [X] and we hit it at [Y] days. Thank you.

### If you get a negative review / criticism thread

> Saw the thread about Projelli. Every point in it is either fair or a reasonable mistake I'd rather fix than argue. Here's the fix list, in the order I'm tackling them this week. [Link to issue tracker]

---

## Posting discipline

- **Morning:** 7-10am local. Algorithm peak.
- **Afternoon:** 2-4pm local. Lunch-scroll window.
- **Never between 11pm-6am.** The "launch week buzz" keeps you up, don't feed it with tweets that won't land.
- **Always reply within 30 minutes during peak hours.** Don't schedule a tweet and disappear.
- **Pin your launch tweet for the first 7 days.** Unpin on Day 8, replace with the "week 1 numbers" post.
- **Don't delete tweets.** If something's wrong, quote-tweet with correction. Deleting looks like you're hiding.

---

## What NOT to post

- No "we" language. Always "I". You're a solo founder.
- No emoji-heavy tweets. 1 emoji max per tweet, and only if it adds meaning.
- No subtweeting competitors by name. Explicit side-by-sides are fine in blog posts; tweets stay on you.
- No vague growth tweets. "Big news soon" / "something's coming" = unfollow bait. Say the specific thing or don't post.
- No fake scarcity. If there are 100 Founder's Launch slots, say "42 slots left" only when it's true, with the number visible on projelli.com.
- No em dashes. Replace with periods or commas.

---

## After the 14-day arc

Switch to a **weekly "ship day" post** every Thursday. Format:
1. What shipped this week (1-2 sentences)
2. One metric (users, revenue, or usage)
3. What's next Thursday

Compounds for 6 months, then re-evaluate cadence.

---

*Created 2026-04-17 night run. Update with specific numbers before each post. Don't send without filling in the bracket placeholders.*
