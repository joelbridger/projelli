# Reddit Posts, 5 Subreddits, 5 Angles

**Per `strategy/02-launch-fuel.md` § 2 Day 3:** posted Thursday of launch week, after PH (Day 1) and Show HN (Day 2) build credibility.

**Per `strategy/07-anti-patterns.md` § 19:** Brand-account posting in subreddits requires the brand-account FIRST having 5+ unrelated helpful comments in the same subreddit. Reddit punishes promotion-only accounts. Track participation in `~/projelli/sign-ups/reddit-participation.csv`.

**Voice rules:** zero em dashes, zero forbidden vocab, first-person, contractions. Per `feedback_jameson_voice_profile.md` and `feedback_marketing_copy_voice.md`.

**Disclosure rule:** every promotional reply or post must include "Disclosure: I built Projelli" or equivalent. Reddit moderators check.

---

## 1. r/SideProject, "After 18 months of weekends" (story arc)

**Subreddit:** https://www.reddit.com/r/SideProject/
**Best post day/time:** Tuesday-Thursday, 8-10 AM PT
**Pre-requisites:** 5+ helpful comments in r/SideProject in the past 30 days
**Submit URL:** https://www.reddit.com/r/SideProject/submit

### Title
After 18 months of weekends, I launched a desktop AI workspace that saves every conversation as real files on your hard drive

### Body

I'm a product designer who's spent the last 8 years in health-tech. Day job is great. But I've always had side project brain, constantly kicking around startup ideas, doing market research, writing specs that go nowhere.

The problem: I was doing all of it in ChatGPT. Which means I was also losing all of it in ChatGPT. Scroll back far enough in a conversation thread and it's just gone. No structure, no search, no memory. Just vibes.

So I built Projelli. It's a local-first desktop app (Tauri, Rust backend, React UI) where every AI conversation saves as actual Markdown files in a folder on your hard drive. Open it in VS Code, sync it to Git, back it up however you want. The app doesn't touch it. Your files are just files.

The other thing I built in is 15 founder workflow templates: competitor analysis, pricing research, pitch deck drafting, user interview synthesis. Not because those are hard prompts to write, but because having them pre-structured means I actually run them instead of staring at a blank chat box and giving up.

BYOK (bring your own API key) for Claude, GPT-4, and Gemini. Your API calls go directly from your machine to the provider. I never see your data, never proxy your requests.

Pricing is one-time. $49 Pro, $99 Lifetime. There's also a $29 Founder's Launch price for the first 100 buyers. I wanted early users who'd actually give me feedback, not just people hunting for the cheapest option.

The comparison that keeps coming up when I describe it: Obsidian meets Claude. Which isn't wrong, but the difference is that AI is built in natively here rather than assembled from community plugins. And unlike Notion AI or similar cloud tools, nothing leaves your machine except the API call itself.

Took 18 months of weekend work to get the product to a state I was happy with. Then 8 more weeks of heads-down work on the stuff I'd been avoiding: code signing, payment integration, privacy policy, CI pipeline, all of it. That part was its own education.

It runs on Windows, Mac, and Linux. The source is visible on GitHub (source-available, not open source, you can read the code to verify what it does but it's commercial software).

Website: https://projelli.com
GitHub: https://github.com/projelli/projelli
Download: https://github.com/projelli/projelli/releases/latest

Happy to answer questions about the Tauri build, the BYOK implementation, or anything else. And if the landing page is confusing or the positioning is off, tell me, I'd rather hear it now than six months from now.

---

## 2. r/Entrepreneur, Business outcomes / launch math

**Subreddit:** https://www.reddit.com/r/Entrepreneur/
**Best post day/time:** Tuesday-Thursday, 9-11 AM PT
**Pre-requisites:** 5+ comments in r/Entrepreneur in the past 30 days; subreddit mods are strict on self-promo, this needs to read as a story not a sales pitch
**Submit URL:** https://www.reddit.com/r/Entrepreneur/submit

### Title
The 8-week pre-launch checklist I wish I'd had before I launched my first paid software product

### Body

I shipped my first paid software product last week after 18 months of side-project building. The product itself was 95% done a year ago. The other 5%, the boring commercial work that's not "code", took the last 8 weeks. This is the checklist I wish I'd had on day 1.

**Week 1: Legal foundations**
Privacy policy, terms of service, EULA. There are AI-generated boilerplates that work fine for a starting point. The blocker is reading them once to make sure they actually match what your product does. Mine took ~3 hours total.

**Week 2: Code signing**
Mac requires Apple Developer Program enrollment ($99/year) and Developer ID certificate. Windows requires either Azure Trusted Signing (~$120/year for Individual Validation) or an OV cert from SSL.com (~$160/year). Both processes have multi-day waits for identity validation. Start them before you think you need them.

**Week 3: CI for cross-platform builds**
GitHub Actions can build Tauri apps for Mac (ARM + Intel), Windows, and Linux on every git tag. Tauri's official action handles most of the signing dance. Budget a full day to get the workflow working end-to-end. Don't skip Linux even if you don't think you need it, the marginal cost is one extra runner job.

**Week 4: Payments**
LemonSqueezy as merchant of record handles tax for you, costs ~5%. Stripe is cheaper but you handle tax. For an indie tool with global buyers, LemonSqueezy is the right tradeoff. Allow 5-7 days for Stripe to verify the LS store before you can take real payments.

**Week 5: License validation**
If you're selling licensed software, you need a tiny server that validates license keys. Mine is a 150-line Bun service running on the same VPS as my website. It validates LemonSqueezy keys and issues short-lived signed JWTs. Total infrastructure cost: $0 above what I was already paying.

**Week 6: Marketing arsenal**
Press kit, blog posts, comparison pages against competitors, FAQ replies, email sequences. This is the highest-payoff week. Pre-stage every reply you can imagine to launch-day comments before launch day. The day of, you'll be too overwhelmed to write thoughtful copy.

**Week 7: Beta cohort**
Recruit 10-20 honest beta testers from your warmest network. They use the product for 1-2 weeks. Their first-hand comments on launch day are worth more than anything you can write yourself.

**Week 8: Hard launch**
Product Hunt Tuesday. Show HN Wednesday. IndieHackers + Reddit Thursday. Newsletter outreach Friday. Don't do them all on Monday, the staggered rollout uses each channel's traction to build the next.

The single biggest miss in my own version of this list: I didn't start the email list until week 5. Should have been week 1.

Disclosure: I built Projelli (https://projelli.com), a local-first AI workspace, after this 8-week ramp. Happy to answer specific questions about any of these steps.

---

## 3. r/macapps, Mac-specific quality + signed/notarized

**Subreddit:** https://www.reddit.com/r/macapps/
**Best post day/time:** Tuesday-Thursday, 9 AM-noon PT
**Pre-requisites:** 5+ helpful comments in r/macapps in the past 30 days; this subreddit values native Mac feel and quality
**Submit URL:** https://www.reddit.com/r/macapps/submit

### Title
Projelli, a native Mac AI workspace that saves your conversations as Markdown files in Finder

### Body

Just shipped Mac builds for a desktop AI workspace I've been building. Both Apple Silicon and Intel are signed and notarized, so first launch goes through the standard Gatekeeper "Apple checked it" prompt rather than the right-click-Open dance.

What it does: every chat with Claude, GPT, or Gemini becomes a Markdown file in `~/Documents/Projelli/`. You see the file appear in Finder as the AI streams the response. You can open it in any other Mac editor (BBEdit, Sublime, VS Code, or just Quick Look). Wiki-links between documents work like Obsidian. There are 15 workflow templates baked in for things like competitor analysis and pricing strategy.

Bring your own API key. Claude, OpenAI, Gemini all supported. There's also Ollama support if you want fully-offline operation, no API key needed.

Mac-specific quality I cared about:
- Signed with Apple Developer ID + notarized (no scary first-launch warnings)
- Native window chrome, traffic-light buttons in the right spot
- Cmd+, opens Settings (not Ctrl+,)
- Cmd+P opens quick-file-switcher (not Ctrl+P)
- Files in your real Documents folder, not buried in a sandboxed container
- Works with iCloud Drive if you put your workspace folder there
- Respects prefers-reduced-motion in the hero animation on the website

Built with Tauri (Rust + React + WebView). Binary is around 20 MB, way smaller than an Electron-equivalent.

Pricing: $49 one-time Pro, $99 one-time Lifetime. First 100 buyers get Lifetime for $29.

Download (signed/notarized): https://projelli.com (the page detects Mac and links the right .dmg)
Source on GitHub: https://github.com/projelli/projelli

Disclosure: I built it. Happy to answer Mac-specific questions about the build, the keychain usage for API keys, or the workspace folder setup.

---

## 4. r/LocalLLaMA, Local-first, Ollama support, technical detail

**Subreddit:** https://www.reddit.com/r/LocalLLaMA/
**Best post day/time:** Tuesday-Thursday, any time (subreddit is global; comments come around the clock)
**Pre-requisites:** 5+ technical contributions in r/LocalLLaMA in the past 30 days. This subreddit values technical depth and is hostile to marketing fluff.
**Submit URL:** https://www.reddit.com/r/LocalLLaMA/submit

### Title
Built a local-first AI workspace where every chat is a real Markdown file. BYOK for cloud models, Ollama for fully-offline.

### Body

Releasing Projelli, a desktop app that does what most "AI notes" tools don't: keeps your conversations as plain Markdown files on your machine and treats Ollama as a first-class provider equal to Claude, GPT-4, and Gemini.

**The architecture:**
- Tauri 2 (Rust + React) for the desktop binary, ~20 MB
- Files written to `~/Documents/Projelli/` (or wherever you point it). Open them in any editor. Sync them via Dropbox / Syncthing / Git.
- API keys stored in your OS keychain (macOS Keychain / Windows Credential Manager / libsecret on Linux). Never written to disk in plaintext.
- API calls go from your machine directly to Anthropic / OpenAI / Google / Ollama. There's no Projelli proxy server. The only thing my server ever sees is your license key when you activate.
- Source visible on GitHub (source-available, not OSS).

**Ollama integration:**
- Discovers local models via the Ollama API on `localhost:11434`
- Treated identically to cloud providers: same chat UI, same streaming, same template runs
- $0/call obviously
- The only thing Ollama doesn't get is the cloud-only multi-model comparison feature (since the comparison is cloud-vs-cloud), but you can chat or run templates with any model in your Ollama install

**Memory / RAG:**
- Local embeddings via fastembed-rs (no embeddings API needed)
- Vector index in LanceDB
- `@workspace` chat command pulls relevant documents into context
- Per-chat toggle for Ask-my-workspace mode
- A user-approved "memory facts" file is always in the system prompt

**MCP server:**
- Built-in JSON-RPC 2.0 MCP server exposing list / read / search / write-with-approval / facts
- Ships as a `.mcpb` Desktop Extension bundle for Claude Desktop, Cursor, Zed
- Lets you query your Projelli workspace from any MCP-compatible AI client

**Voice + sidecar:**
- Press-to-talk via bundled Parakeet.cpp / whisper.cpp sidecar (audio never leaves the machine)
- Cmd+Shift+Space inserts transcript into focused field
- Cmd+Shift+N saves transcript to Inbox/note-{ISO}.md

**Pricing:**
- $49 one-time Pro, $99 one-time Lifetime, $29 first 100 buyers Lifetime
- BYOK for cloud, free for Ollama
- No subscription, no usage cap, no telemetry by default (opt-in only)

Download: https://projelli.com
Source: https://github.com/projelli/projelli

Disclosure: I built it. Happy to dig into the Tauri build, the local embeddings setup, the MCP server protocol implementation, or anything else. Real technical questions welcome.

---

## 5. r/ChatGPTPro, ChatGPT alternative angle

**Subreddit:** https://www.reddit.com/r/ChatGPTPro/
**Best post day/time:** Tuesday-Thursday, 9 AM-noon PT
**Pre-requisites:** 5+ comments in r/ChatGPTPro in the past 30 days. The audience here is paying $20/mo for ChatGPT and frustrated by limits, lock-in, or memory.
**Submit URL:** https://www.reddit.com/r/ChatGPTPro/submit

### Title
Replaced ChatGPT Plus with Projelli + my own API key. ~$8/mo instead of $20/mo, and every chat is a file I own.

### Body

If you're a heavy ChatGPT Plus user (multiple long conversations per day, the kind where you're treating it like a thinking partner not a search box), you've probably hit the same wall I hit:

1. Chat history search is bad. Conversations evaporate.
2. The data is in OpenAI's database, not yours.
3. $20/mo forever, even months when you barely use it.
4. Memory is opaque (you don't really know what it remembers about you).
5. No way to organize chats around projects you actually work on.

Last month I switched to a different setup: paying OpenAI directly via API + a local desktop app called Projelli that I built.

**The math:**
- Old: $20/mo ChatGPT Plus = $240/year
- New: ~$8/mo OpenAI API (my actual usage, heavy days included) + $49 one-time for the app = ~$145 first year, ~$96/year after
- Savings: roughly 60% off year 1, 60% off ongoing

**What's better:**
- Every conversation saves as a Markdown file in `~/Documents/Projelli/`. Search across all of them with grep, full-text search inside the app, or by file name in Finder.
- I can fork conversations (split off a tangent into a new file).
- Wiki-links between documents work like Obsidian, so my "Pricing Strategy" file links to my "Customer Persona" file links to my "Customer Interview Notes" file.
- The AI can read my workspace as context (RAG over the files I've created). It actually remembers what I told it last week, because it's reading last week's file.
- 15 workflow templates for the work I do (competitor analysis, pricing, customer interviews, etc.). Each one is an interview-style prompt sequence that produces a structured doc.
- Works offline for everything except the OpenAI call itself. Drop your workspace folder in iCloud Drive if you want sync.

**What's worse:**
- BYOK setup takes ~5 minutes (sign up at platform.openai.com, generate key, paste into Projelli)
- No mobile (it's a desktop app)
- No DALL-E, Sora, or other multimodal stuff yet (text + image input + voice via local whisper, that's it)
- If you want Claude or Gemini too, you sign up at each provider separately (they all have API keys)

For me, the trade-off was worth it within a week. The "all my chats are files I own" alone changed how I use AI. The "60% cheaper" is honestly secondary.

Pricing: $49 one-time Pro, $99 one-time Lifetime, $29 for first 100 buyers (Founder's Launch).

Download: https://projelli.com
Source on GitHub: https://github.com/projelli/projelli

Disclosure: I built Projelli. Happy to answer questions about the BYOK setup, the actual API costs (mine + others I've talked to), or the migration from ChatGPT.

---

## Posting cadence + safety

Per `strategy/02-launch-fuel.md`:
- These posts go up on Day 3 of the launch week (Thursday)
- Spaced through the day: r/SideProject 09:00, r/Entrepreneur 12:00, r/macapps 14:00, r/LocalLLaMA 16:00, r/ChatGPTPro 18:00 PT
- Reply to every comment within 2 hours
- Per `07-anti-patterns.md` § 19: cap at 1 promotional reply per subreddit per week after the launch beat
- Per `07-anti-patterns.md` § 6: NO mass cold DMs to upvoters
- If any post gets removed by mods: do NOT re-post; message the mods politely asking what to fix
- Capture every backlink and quote in `~/projelli/sign-ups/launch-backlinks.csv`

## Voice + visual checklist before posting each one

For every post:
- [ ] Zero em dashes (verified in this file)
- [ ] First-person singular ("I" never "we")
- [ ] Specific numbers, not adjectives
- [ ] Disclosure line included
- [ ] One relevant image attached (Reddit allows image uploads with text posts; use a screenshot of the relevant UI: workspace for r/macapps, MCP/Ollama for r/LocalLLaMA, side-by-side comparison for r/ChatGPTPro, etc.)
- [ ] Re-read once for "would an indie founder respect this" voice check (per `07-anti-patterns.md` § 5)
