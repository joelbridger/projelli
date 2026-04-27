# Jameson Action Pack — Marketing Tasks Only You Can Do

> **Status:** Pre-staged drafts and step-by-step instructions for the 8 things only Jameson can do (items A-H from the marketing assessment).
> **Read time:** ~20 minutes if you do it all in one sitting.
> **Implementation time:** ~3-4 hours of active work over 2-3 days.
> **Goal:** Move from "marketing strategy is mapped" to "marketing strategy is executing" without any blockers waiting on Claude.

This document is structured as 8 sections, one per item. Each section has:
- **What needs doing**
- **Why it can only be you**
- **Pre-staged drafts** (DMs, posts, scripts) you can copy/edit/send
- **Step-by-step instructions**
- **What to send Claude back when done** (so Claude can resume the dependent work)

---

## Item A — Decide whether to start build-in-public NOW

### What needs doing

You decide whether you're going to publicly tweet about Projelli's launch ramp under your real name, starting this week.

### Why only you

This is a public commitment that ties your real name (and your day job at Wheel Health) to the product. The conflict-of-interest question is cleared (per `user_current_job.md`), but the level of public visibility is your call.

### The question I need you to answer

> Are you OK with your name + Projelli appearing in the same X timeline / LinkedIn feed that your Wheel colleagues, prospective employers, and the indie hacker community all see?

If **yes**: build-in-public starts now. The rest of this section gives you the playbook.

If **no**: we drop the X arc and lean harder on PH, HN, IH, and newsletter outreach. The launch will still work but the day-1 reach will be ~50% lower.

If **partially** (e.g., "I'll tweet but not from my main account"): I recommend creating a separate `@jamesondaines` X account (if one doesn't exist) that's dedicated to the indie hacker side of your work. Same name, different focus. This is what most "have a day job and a side project" founders do.

### What to send back

Just one of: **GO**, **NO**, or **PARTIAL — using account @____**.

---

## Item B — Reach out to PH hunters

### What needs doing

DM 5-10 established Product Hunt hunters and ask one of them to hunt the Projelli launch. Self-hunting kills the algorithm signal — having an established hunter is worth ~30-50% more upvotes on day one.

### Why only you

The DMs need to come from your personal account. Hunters get pitched constantly and they read every cold pitch through a "is this person credible" filter. A real person with a real face and a real LinkedIn beats a Claude-generated message every time.

### The DM template (copy from `PRODUCT_HUNT_LAUNCH.md` § Hunter outreach DM)

The full template is in `PRODUCT_HUNT_LAUNCH.md`. Don't copy-paste it verbatim — the personalization line is what gets you a yes.

**The personalization rule:** Open every DM with a sincere, specific reference to one of the hunter's recent hunts. Not "I love your work" — that's noise. Say "your hunt of [tool name] last [month] was the reason I tried it and [specific impact on your work]."

### How to find candidates

The PH "Top Hunters" leaderboard for 2026 changes monthly. Don't pick from the all-time leaderboard — those people are saturated and will ignore you. Instead:

1. **Look at the last 30 days** of PH launches in the Productivity, AI, and Developer Tools categories
2. **Find launches that hit top 5 of the day** in those categories
3. **Click through to the hunter's profile** for each one — these are people who hunt successful launches
4. **Filter for hunters who have hunted ≥10 products in the last 6 months** (active) but **NOT hunted >100 in the last year** (those are hunt-farmers, low engagement)
5. **Check their X profile** — if they have an active presence (>5K followers, weekly posts), they amplify launch day reach
6. **Read their last 3 PH comments** — if they engage with founders thoughtfully, they're a real partner; if they drop one-liners, skip

Make a list of 8-10 candidates that pass all 5 filters. DM them in order of fit, spaced ~30 minutes apart.

### Specific shortlist (start here, then expand)

I cannot reliably name specific hunter handles in this document because the PH leaderboard is too volatile and I might be 3 months out of date. But the **type** of person to look for is:

- Indie founders who themselves shipped in 2024-2025 and have stayed active on PH as supporters of new launches
- Newsletter writers in the productivity / AI / indie space who use PH as part of their discovery flow
- Long-time PH community members who hunted 5-15 launches in the last 6 months across the right categories

**One specific person to start with:** check `Chris Messina` and `Bram Kanstein` — both have hunted prolifically in productivity-adjacent categories in past years. Verify their recent activity before pitching either.

### What to send back

A list of who you DM'd, who said yes, who said no, who ignored. If you get a yes, send Claude:
- Hunter name and PH handle
- Their preferred launch date / time slot
- Any specific asks they made (e.g., "include me in the maker comment")

Claude will then schedule the launch and update `PRODUCT_HUNT_LAUNCH.md` with the confirmed hunter.

---

## Item C — Recruit 10-20 beta testers from your network

### What needs doing

Get 10-20 real people to download Projelli, use it for 1-2 weeks before the public launch, and be present in PH/HN comments on launch day with honest first-hand observations.

### Why only you

Beta tester recruitment requires personal asks from someone the recipient already knows or trusts. A cold DM from "Projelli Team" gets ignored. A DM from "Jameson, your former colleague at [X], building this on weekends and would love your honest take" gets a 60% response rate.

### Who to ask (in priority order)

1. **Wheel Health colleagues** (only those NOT in your reporting chain — avoid implying your manager-reports owe you a favor). 2-5 people.
2. **Friends who run side projects or small businesses.** 3-5 people. These are the highest-quality testers because they're in your target persona.
3. **Former colleagues from Samsung, AstraZeneca, Tesla** who are still in design/product. 2-3 people.
4. **Indie hacker / founder Twitter mutuals** if you have any. 2-3 people.
5. **Cold DMs to ~10 indie hackers in your wider network** (people you've interacted with on social, but never met in person). Lower yield but worth trying for the broadest signal.

Total ask: 15-20 DMs sent, expect 8-12 to actually engage, 5-8 to use the app for the full beta period.

### Beta tester DM template (warm contacts)

> Hi [name],
>
> Quick favor — I've been building a thing called Projelli on weekends for the last 18 months and it's about to launch publicly. Before I do, I'd love a few honest beta testers from people I trust.
>
> What it is: a desktop AI workspace for indie founders. Every chat with Claude / GPT / Gemini becomes a real Markdown file on your hard drive, with 15 founder workflow templates baked in. Local-first, BYOK, one-time pricing.
>
> What I'd love from you, if you have an hour over the next week:
>
> 1. Download it (free, link below)
> 2. Run any one of the templates on a real project of yours
> 3. Tell me one thing that worked and one thing that didn't
>
> If it's useful to you, I'll give you the Lifetime tier for free as a thank-you. If it's not your thing, no obligation — your honest feedback is more valuable to me than any download.
>
> Download: https://github.com/projelli/projelli/releases/latest
> Site: https://projelli.com
>
> Either way — thanks for considering. Let me know.
>
> Jameson

### Beta tester DM template (cold contacts / weak ties)

> Hi [name],
>
> Saw your [tweet / post / comment] about [specific topic]. Love how you [specific compliment]. I'm reaching out because I think you might find what I've been building useful.
>
> I'm Jameson — I'm a Senior Product Designer at a health-tech company, and on weekends I've been building a desktop AI workspace called Projelli. It's local-first, BYOK, and produces real Markdown files in a folder on your hard drive instead of locking your data in a cloud database.
>
> I'm launching publicly in [timeframe] and looking for 10-15 beta testers to give it an honest 1-week try before launch day. If you're up for it, I'll give you the Lifetime tier free as a thank-you, and your only ask is to tell me one thing that worked and one that didn't.
>
> Free download: https://github.com/projelli/projelli/releases/latest
>
> No pressure if it's not your thing. Either way, thanks for reading.
>
> Jameson
> projelli.com

### How to give them the free Lifetime tier

This is something you'll need Claude to set up before you start sending DMs:

1. Generate 20 free Lifetime license keys via the LemonSqueezy dashboard (Products → Lifetime → "Add license key" or via the API)
2. Save them to `~/projelli/sign-ups/beta-tester-keys.csv` with columns: `key, recipient_name, recipient_email, sent_at, used_at`
3. As you DM each beta tester and they say yes, paste a fresh key in the response and update the CSV

**Alternative if generating keys is hard:** offer them a free Pro license (the lower tier) as the thank-you. Cheaper and easier to manage manually if needed.

### What to send back

A list of who said yes, with names + email addresses + license keys assigned. Claude will set up a beta tester email sequence for them.

---

## Item D — Take 6 product screenshots on Windows

> ✅ **SHIPPED 2026-04-27** via `scripts/marketing-capture/` pipeline. 5 of 6 slots filled (S01–S04, S06). S05 multi-model deferred — UI absent in product. See `docs/marketing/asset-capture/RUNBOOK.md`. Reproducible via `npm run capture:all`. Original Windows-screenshot path obsolete.

### What needs doing

6 high-quality screenshots of Projelli in action, exported as PNG at minimum 1920×1080, saved to `website/press-kit/assets/`.

### Why only you

Screenshots require running the actual app on a real machine with a real workspace and real content. Claude cannot do this remotely.

### The 6 specific screenshots (matches `website/press-kit/index.html`)

| # | File name | What's in the shot | Notes |
|---|---|---|---|
| 1 | `screenshot-01-workspace.png` | Full app: file tree (left), editor (center), AI chat (right). A real founder workflow document open in the editor. Maybe 6-10 files visible in the tree. | The "hero" shot. Use the New Business Kickoff template output as the visible document. |
| 2 | `screenshot-02-ai-chat.png` | AI mid-stream — a streaming response visible in the chat panel, with a new file appearing in the workspace tree. | Catch the moment between "AI is responding" and "file is now in the workspace." |
| 3 | `screenshot-03-wikilinks.png` | The editor showing a document with multiple `[[wiki-links]]` highlighted, and the backlinks panel visible at the bottom. | Pick a document with at least 3 visible wiki-links so the pattern is clear. |
| 4 | `screenshot-04-templates.png` | The Templates / Workflows panel showing the gallery of 15 templates. | Ideally with one of them mid-interview ("Question 4 of 10"). |
| 5 | `screenshot-05-multi-model.png` | The multi-model comparison view showing the same prompt with side-by-side responses from Claude and GPT. | Pro feature — make sure it's visible. |
| 6 | `screenshot-06-api-keys.png` | Settings → API Keys screen with all 3 providers listed and one of them filled in (with the key obscured for the screenshot — show `sk-ant-•••••••••3xQ` or similar). | Critical for the BYOK story. Don't accidentally show your real key. |

### Screenshot capture instructions

**Tools:**
- Windows Snipping Tool (built-in, Win+Shift+S) or
- ShareX (free, more control over quality)
- DON'T use a phone camera screenshot of your monitor

**Settings:**
- Resolution: 1920×1080 minimum (2560×1440 ideal if your monitor supports)
- Format: PNG (not JPG — JPG compresses text badly)
- Background: Use the default Projelli theme. Don't change anything cosmetic for the shot.
- Window state: Resize the Projelli window to 1280×800 minimum so all 3 panels (file tree, editor, chat) are visible at once.

**Content prep:**
- Create a fresh workspace called "My SaaS Launch" or similar. Realistic, not "test."
- Run the New Business Kickoff template once with a believable answer set (something like a hypothetical founder tool — meta but fine).
- Create a few extra documents manually with realistic names: `Vision.md`, `Pricing.md`, `Customers.md`, `Launch Plan.md`.
- Add some wiki-links between them so screenshot 3 has real content to show.
- For the API Keys screenshot, manually obscure your real key in an image editor BEFORE saving the file. Or use a fake key like `sk-ant-api03-•••••••••example-key` typed into the field but not actually saved.

**File naming + saving:**
1. Save each PNG with the exact filename from the table above
2. Copy them to the `website/press-kit/assets/` folder in the projelli repo
3. Commit and push (or scp them to the server)

Once they're in the repo, the press kit page (`projelli.com/press-kit/`) will display them automatically.

### What to send back

The 6 PNG files. Easiest path: scp them to the server at `/tmp/projelli-screenshots/` and tell Claude they're there. Claude will commit them to the right path.

---

## Item E — Record the demo video

> ✅ **SHIPPED 2026-04-27** as V01 (`demo-30s.mp4`) plus 7 additional feature videos (V02–V08, ~160s of content) via `scripts/marketing-capture/videos/`. See `docs/marketing/asset-capture/RUNBOOK.md`. Reproducible via `npm run capture:all`. Original screen-recording path obsolete.

### What needs doing

A 30-second screen recording of Projelli in action, showing the magic moment: type a question → AI streams a response → a real file appears in the workspace folder → editor switches to show the new file.

### Why only you

Same as screenshots — requires running the actual app on a real machine.

### Recording tools

**Recommended for Windows:**
- **OBS Studio** (free, full control) — for the highest quality output
- **Windows Game Bar** (Win+G, built-in) — easier but lower quality control
- **ShareX** (free) — has built-in screen recording with good defaults

**Settings:**
- Resolution: 1920×1080
- Frame rate: 30fps (60fps is overkill for a UI demo)
- Codec: H.264 (universal)
- Audio: NONE — the demo should work without sound. People watch at work with sound off.
- Length: ~30 seconds. Hard ceiling: 45 seconds.

### The script (the exact actions to perform on camera)

| Time | Action | What viewer sees |
|---|---|---|
| 0:00 | Projelli is open, workspace visible with 3-4 files in the tree | Static frame for ~1 second |
| 0:01 | Click into the chat panel, start typing | Cursor in chat input |
| 0:02-0:05 | Type slowly: "Help me plan a SaaS launch in 8 weeks" | Text appears character by character |
| 0:06 | Press Enter | Message sent |
| 0:07-0:18 | AI streams a response: "I'll outline an 8-week launch plan for your SaaS. Creating LAUNCH_PLAN.md with milestones..." | Tokens stream in real time |
| 0:19 | A new file `LAUNCH_PLAN.md` appears in the file tree (highlighted briefly) | New file animation |
| 0:20 | Click the new file in the tree | Editor switches to show LAUNCH_PLAN.md |
| 0:21-0:27 | Editor shows the generated content scrolling slightly | Real document visible |
| 0:28-0:30 | End frame: full app with the new document open | Static frame |

### Recording tips

1. **Practice the script 5-10 times** before recording. The fluidity matters more than the duration.
2. **Use a clean Windows desktop** — minimize the taskbar, hide notifications, clear unnecessary windows.
3. **Record at 1920×1080 even if your monitor is bigger** — cropping in post is easy, scaling up is impossible.
4. **Don't speak.** No voiceover.
5. **Multiple takes are normal.** Plan for 5-10 attempts to get one clean version.
6. **Edit in DaVinci Resolve (free)** if you want to trim the start/end. iMovie or Windows Photos work for basic trimming.

### Output formats needed

| Format | Use case | Tool |
|---|---|---|
| `.mp4` (1920×1080, H.264) | Embed in homepage, send to press, upload to YouTube | OBS / direct export |
| `.gif` (1280×720, optimized) | Inline in tweets, Reddit posts, IH posts | https://ezgif.com (online tool, paste MP4, get GIF) |

Save both to `website/press-kit/assets/projelli-demo-30s.mp4` and `.gif`.

### YouTube upload (optional but recommended)

1. Upload the MP4 to YouTube as **unlisted**
2. Set the title to "Projelli — 30-second demo"
3. Set the description to "Projelli is a local-first AI workspace for indie founders. projelli.com"
4. Save the YouTube URL and add it to the press kit

### What to send back

Just the MP4 file (and optional YouTube URL). Claude will handle GIF conversion and embedding.

---

## Item F — Decide whether to stand up a Projelli X account vs. tweet from your personal account

### What needs doing

Pick one of three options for the Projelli X presence:

| Option | Pros | Cons | Recommendation |
|---|---|---|---|
| **A. Tweet from your personal account** | Authenticity, existing followers, no setup | Mixes Projelli with personal content, harder to brand | ✅ Recommended for launch |
| **B. Create a `@projelli` brand account, no founder voice** | Clean branding, dedicated audience | Lower engagement, sounds corporate, harder to grow from zero | Only if you grow past 1K customers |
| **C. Both — personal account is the founder voice, brand account retweets and posts product news** | Best of both | 2 accounts to manage | Worth doing once you have momentum |

### Why only you

Branding identity decision. Affects how every future tweet, post, and DM gets framed.

### Recommended path

**Launch from your personal account (Option A) for the first 90 days.** Indie hackers respond to founder voices, not brand voices. Your personal account already has trust and recent activity (presumably) and the Projelli launch tweets get amplified by people who know you.

**After day 90, evaluate:** if Projelli has paying customers and an active community, create the brand account (Option C) and have it retweet/repost the founder content while occasionally posting product updates ("v1.1 just shipped — here's what's new"). Don't create the brand account before there's anything to put in it — empty brand accounts make products look smaller than they are.

### If you go with Option A (recommended)

1. Update your X bio to mention Projelli explicitly: `Senior Product Designer @ [day job redacted]. Building Projelli — local-first AI workspace for indie founders. projelli.com`
2. Pin a launch-day tweet (drafted in Item H below)
3. Add `projelli.com` as your profile URL (replace anything else)
4. Don't change your handle. Continuity matters.

### What to send back

Your decision: A / B / C / something else. Claude will adjust the launch playbook accordingly.

---

## Item G — Set up Plausible conversion goals (5 minutes, browser only)

### What needs doing

Add 3 conversion goals to the Plausible analytics dashboard for projelli.com so we can measure whether anything in the launch is actually working.

### Why only you

Plausible dashboard requires your login to `analytics.jamesondaines.com`. Claude can't access the browser session.

### Step-by-step

1. Open https://analytics.jamesondaines.com
2. Sign in with your credentials
3. Click on **projelli.com** in the site list
4. Click **Site Settings** (top right) → **Goals** in the left sidebar
5. Click **Add Goal**
6. For each of the 3 goals below, fill in the form and save:

| Goal | Type | Event Name |
|---|---|---|
| **Download click** | Custom Event | `Download click` |
| **GitHub click** | Custom Event | `GitHub click` |
| **Buy click** | Custom Event | `Buy click` |

7. Save and verify all 3 goals appear in the Goals list

### After you finish

Tell Claude "Plausible goals are set up." Claude will then add the corresponding `plausible('Download click')`, `plausible('GitHub click')`, and `plausible('Buy click')` event triggers to the homepage JS so the goals start firing on real user clicks.

---

## Item H — First X posts to start the build-in-public arc

### What needs doing

Post the first 3-5 tweets / threads to start the build-in-public momentum. This is the foundation for everything in Item A and the launch-day social amplification in `PRODUCT_HUNT_LAUNCH.md`.

### Why only you

Posting from your personal X account requires your hands on the keyboard. Claude drafts, you post.

### The 5 starter tweets (post over 5-7 days, one per day)

#### Tweet 1 — The "I'm doing this in public" announcement

> I've been quietly building a local-first AI workspace called Projelli for the last 18 months on weekends.
>
> Decided to launch it publicly in the next few weeks.
>
> Going to build in public for the runup. Founder template gallery, BYOK, one-time pricing, Tauri + React stack.
>
> Wish me luck → projelli.com

**When to post:** Day 1. Sets the framing for everything else.

---

#### Tweet 2 — The "why I built it" anecdote (the most engaging type)

> The breaking point for me with ChatGPT was when I'd had a 2-hour conversation with Claude about pricing strategy on a Saturday morning, and a week later I couldn't find it.
>
> The conversations evaporated. The documents lived in another tool. The friction was the copy-paste.
>
> Projelli puts the chat and the file on the same screen, with the file as the source of truth.
>
> Every conversation produces a real Markdown file on your hard drive. Local-first, BYOK, your data never leaves your machine.
>
> Launching in a few weeks. projelli.com

**When to post:** Day 2.

---

#### Tweet 3 — The "honest behind-the-scenes" tweet (vulnerability sells)

> Here's an honest thing about building a paid software product on the side:
>
> The product was 95% done over a year ago.
>
> The other 5% — legal docs, payment integration, code signing, CI, onboarding, marketing — is what's actually been blocking the launch.
>
> 8 weeks of focused work to close the 5%. About 50 hours total.
>
> Started writing a blog post about it. The lesson is brutal: the boring commercial work is more important than I wanted to believe.

**When to post:** Day 3.

---

#### Tweet 4 — The product showcase (pin or thread)

> What Projelli looks like (30-second demo):
>
> [embed the demo video / GIF]
>
> Type a question → AI streams a response → a real file appears in your workspace folder → editor opens it.
>
> No copy-paste. No "where did that conversation go." No vendor cloud.
>
> 15 founder workflow templates baked in. BYOK. One-time pricing.
>
> projelli.com

**When to post:** Day 4. Pin this one. It's the canonical "what is Projelli" tweet.

---

#### Tweet 5 — The "Founder's Launch is coming" pre-launch tease

> Quick heads up if you're an indie founder:
>
> Projelli launches publicly next [day]. Local-first AI workspace, BYOK, one-time pricing.
>
> The first 100 buyers get the Lifetime tier for $29 instead of $99. Founder's Launch tier.
>
> If you've been on the email list, you'll get the announcement first. If not — projelli.com.

**When to post:** Day 5-7 (closest to launch day).

### Hashtags (use sparingly)

- `#buildinpublic` — works on indie hacker / founder Twitter, use on tweets 2 and 3
- `#localfirst` — small but engaged community, use on tweets 1 and 4
- `#indiehackers` — works on launch tweet, use on tweet 5
- DON'T use 5+ hashtags per tweet — reads as spam
- DON'T use `#AI` — too generic, signal-to-noise terrible

### Engagement tactics for the first 72 hours

1. **Reply to every reply within 1 hour** for the first 3 days. This is how you build the algorithmic momentum.
2. **Like every reply, even the dumb ones.** Costs nothing, builds reciprocity.
3. **Don't argue with critics.** Acknowledge ("fair question!") and pivot to the next thing.
4. **Quote-tweet other indie founders' wins** in your network. Reciprocity rule applies.
5. **Don't tweet more than 3 times a day** in the first week. Quality over volume.

### What to send back

Just confirmation when each one is posted, plus the URL of any that get unusual engagement (>50 likes, replies from people who matter, etc.). Claude will use that data to refine the launch-day playbook.

---

## Summary checklist (print this and check things off)

### Decisions (5 minutes each)
- [ ] **A.** Build-in-public yes / no / partial decision
- [ ] **F.** Personal vs brand X account decision

### Actions (15-30 min each)
- [ ] **G.** Set up 3 Plausible conversion goals in browser
- [ ] **H.** Post tweet 1 (the "I'm doing this in public" announcement)
- [ ] **H.** Post tweet 2 (the "why I built it" anecdote)
- [ ] **H.** Post tweet 3 (the "honest behind-the-scenes" tweet)
- [ ] **H.** Post tweet 4 (the product showcase, PIN this one)
- [ ] **H.** Post tweet 5 (the Founder's Launch tease)

### Bigger lifts (1-3 hours each)
- [ ] **B.** Identify 8-10 PH hunters and DM them
- [ ] **C.** Send 15-20 beta tester DMs (warm + cold contacts)
- [ ] **D.** Take all 6 product screenshots
- [ ] **E.** Record the 30-second demo video

### Total time investment
- Decisions: ~10 min
- Quick actions: ~30 min
- Bigger lifts: ~6-8 hours
- **Grand total: ~7-9 hours of focused work over 1-2 weeks**

---

## How to give Claude updates

When you complete any of these, just message in the next session with a quick status:

> "Did A — going PARTIAL, using @____"
> "Did G — Plausible goals are set up, here are the names: Download click, GitHub click, Buy click"
> "Did C — beta tester emails are at /tmp/projelli-screenshots/beta-list.txt"
> "Did D — screenshots are scp'd to /tmp/projelli-screenshots/, all 6 PNGs"

Claude will immediately resume the dependent work for each completed item.

---

*This document is the bridge between "marketing strategy is mapped" and "marketing strategy is executing." Every item here is on the critical path to a successful launch. The more of these you can knock out in the next 7 days, the higher the launch ceiling.*
