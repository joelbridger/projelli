# Keepance v1.5 launch-day reply bank

> Pre-drafted answers to the 30 most predictable questions and objections from Product Hunt, Show HN, IndieHackers, Reddit, and X. Paste, tweak one detail for context, send.
>
> **Voice rules enforced:** first-person singular, contractions, specific concrete nouns, no em dashes, no "leverage / seamless / empower / unlock / delve / tapestry / elevate". Every claim that references a fact has a link.
>
> **Sizing:** most replies are 2-4 sentences. HN prefers short and specific. PH tolerates slightly longer. X wants 1-2 sentences, period.
>
> **How to use:** Ctrl-F the keyword in the question. Tweak the one specific reference to the commenter's context (their username, their tool, their point). Send. Don't paste cold without that 5-second personalization, it reads as canned.

---

## Block 1: Positioning + competitive ("how is this different from X?")

### Q1. "How is this different from Notion AI?"

Notion AI lives inside Notion's cloud database. Your notes are in their cloud, your AI context is their cloud, your billing's a subscription. Keepance is the opposite: every chat I have produces a real Markdown file in a folder on my hard drive. I bring my own Claude / OpenAI / Gemini key, nothing routes through a Keepance server, and the workspace works offline except for the AI call itself. If I delete Keepance tomorrow, my files are still there. One-time $49 instead of Notion's $20/mo + Notion AI $10/mo.

### Q2. "How is this different from Obsidian + Smart Connections?"

I like Obsidian, I used it for two years. Smart Connections is the closest thing in spirit to Keepance's memory flag, which is why I name it explicitly. The difference: Obsidian's AI story is a plugin ecosystem you assemble yourself, and the UX is inconsistent between plugins (Smart Connections + Copilot + Text Generator all have different cursor/selection models). Keepance ships the AI workspace as one integrated thing. Also: Obsidian is free, Keepance is $49 one-time. If you're already deep in Obsidian and happy, stay. If you're evaluating an AI-native workspace fresh, I want you to try Keepance.

### Q3. "How is this different from Claude Desktop / Cursor?"

Claude Desktop + Cursor are chat-first. Your conversation is the artifact. Keepance is file-first. Every chat I have produces a real Markdown file I can open in any other editor, search with grep, back up with git. And Keepance's new MCP server means Claude Desktop can read my Keepance workspace as context, so they stack: Keepance owns the files, Claude Desktop can use them. They're not really competitors, more like Keepance is "Claude Desktop's workspace."

### Q4. "How is this different from ChatGPT?"

ChatGPT is a chat. Keepance is a workspace. Your ChatGPT history lives in OpenAI's cloud, billed monthly, searchable only via their UI, lost if you cancel. Keepance's chats are Markdown files on your disk, searchable via any tool, yours forever, billed once. Also: Keepance uses Claude / Gemini / Ollama too, not just OpenAI. BYOK means you pick the best model for the task, not whoever OpenAI priced into the current plan.

### Q5. "How is this different from [some other local-first tool]?"

Short answer: I probably don't know the specific one. Happy to pull up its feature page and give you an honest side-by-side in a reply. Keepance's positioning is the combination: local files + BYOK across all 4 providers + founder-focused workflow templates + one-time pricing + MCP server. Few tools hit all five. The product that's closest in spirit is probably Heptabase, but Heptabase is Notion-style cards where Keepance is Obsidian-style files.

### Q6. "Notion just launched Custom Agents, aren't you late?"

Notion's agents are cloud agents on Notion's cloud DB, $20/mo and metered credits. Keepance is the local-first / BYOK / one-time counter. Different architecture, different buyer. If your data is already in Notion you probably don't want Keepance. If subscription fatigue and data privacy are why you're reading this comment, Keepance is for you.

---

## Block 2: Pricing objections

### Q7. "Why one-time pricing? How do you stay in business?"

Local-first apps historically survive on one-time pricing because users hate paying monthly for software with no server behind it. Obsidian, Sublime Text, Things, BBEdit, iA Writer all prove this works. TypingMind hit $1M revenue at $39-79 one-time. My unit economics: zero server cost (files live on your disk, AI calls are BYOK), zero cloud cost. $49 * 1000 customers = $49K a year on the price of a studio apartment budget. I'm building it around a full-time job at 5-10 hours a week; it doesn't need to be a VC outcome.

### Q8. "BYOK seems like extra work, why not just include AI?"

Three reasons. (1) Cost: AI is priced per token. If I bundle it, I either charge subscription to cover variance, or I cap usage and users hit walls. Both worse than "use your own key and see the exact cost." (2) Privacy: when you BYOK, your chats go directly from your machine to Anthropic/OpenAI/Google. My server is not in the middle. I cannot see your data even if I wanted to. (3) Model choice: you can pick Claude Sonnet for writing, Gemini Flash for cheap bulk work, Ollama for fully offline. Bundled AI locks you to whoever I bundled.

### Q9. "What's the difference between Pro ($49) and Lifetime ($99)?"

Pro includes one year of updates. Lifetime includes updates forever. Both tiers get every feature. If I keep shipping for five years, Lifetime saves you the next four $49 renewals. If I disappear in six months, Pro was the safer bet. Your call. I price Lifetime at 2x Pro on purpose so it's a clear "I believe in this" signal rather than a 30% upsell.

### Q10. "What happens if Keepance shuts down?"

Your files keep working. Every chat in Keepance is a real Markdown file on your disk. Open it in any text editor, any other Markdown app, any other AI tool. The memory index is a LanceDB table in `.keepance/vectors/`, which any other LanceDB-compatible tool can read. Your API keys live in your OS keychain, which Keepance just reads from. I wrote the app so that if I disappeared tomorrow, the only thing you'd lose is updates.

### Q11. "Is there a trial?"

The Free tier is the trial. Core editor, file tree, Markdown, wiki-links, version history, audit log, 1 AI provider (Claude Haiku 4.5), 3 templates, 1 workspace. Free forever. If you want all 4 providers + all 15 templates + unlimited workspaces + whiteboard + audio + research + multi-model comparison, that's Pro.

### Q12. "14-day refund policy?"

Yes. LemonSqueezy's standard refund flow, no questions asked for the first 14 days. Refunds beyond that on a case-by-case basis. I'd rather refund a disappointed user than have them write a bad review.

---

## Block 3: Technical / HN-flavor

### Q13. "Why Tauri, not Electron?"

Binary size and native performance. Tauri 2 uses the OS's built-in webview (WebView2 on Windows, WebKit on Mac/Linux) instead of bundling Chromium. My installer is around 100MB signed vs 200-300MB for an Electron equivalent. Memory footprint at idle is about a third. Also, Tauri ships a Rust backend for filesystem and crypto, which matters because I did not want to hand JavaScript access to the OS keychain.

### Q14. "Why LanceDB for the memory index?"

LanceDB runs in-process, zero ops, disk-based, and it's built on Apache Arrow so the embedding vectors sit next to the text chunks in one columnar format. fastembed-rs ships the e5-small-v2 ONNX model (384-dim, ~80MB), which is small enough to bundle and fast enough that indexing a 1000-file workspace takes under a minute. The alternatives (Chroma, Qdrant, Weaviate) all require running a separate service, which violates the local-first guardrail.

### Q15. "How does the MCP server work?"

Keepance ships a `keepance-mcp` binary inside a `.mcpb` Desktop Extension bundle. Double-click it in Claude Desktop (or Cursor, or Zed, any MCP-compatible client) and the client gets five tools: `list_workspace_files`, `read_workspace_file`, `search_workspace` (uses the same RAG index as Keepance's own chat), `write_workspace_file` (with user approval), `get_memory_facts`. The write-approval flow goes through a filesystem rendezvous channel so no MCP client can write to your disk without you seeing a modal.

### Q16. "Is the source available?"

Yes, github.com/keepance/keepance. MIT-licensed for the app code. The installer is the only thing you pay for, and even then you can build from source yourself if you want. I don't open-source the MCP registry submission or the DKIM keys, but everything in the app binary is there.

### Q17. "What's the footprint / install size?"

About 100MB for the signed installer. About 500MB once installed because of the bundled fastembed ONNX model, the LanceDB dependencies, and the SQLite WASM. Idle memory is about 200MB, which is typical for Tauri apps. The MCP sidecar binary adds maybe 150MB if you download the .mcpb, but you don't have to.

### Q18. "Why not just use SQLite FTS5 instead of a vector index?"

I use both. FTS5 (via MiniSearch on the frontend) handles keyword search, fast, tiny, useful. The vector index handles semantic search, "what did I write about pricing that didn't use the word pricing?". They coexist. Keyword for the terms you remember, semantic for the ideas you remember.

### Q19. "Does it hit Anthropic's rate limits?"

Yes, and that's a you-problem more than a me-problem since the keys are yours. Keepance honors the `Retry-After` header and surfaces "rate limit, retry in N seconds" to the UI. If you're hitting limits consistently, upgrade your Anthropic tier or switch to Gemini Flash for cheap bulk work.

### Q20. "Is the Windows installer signed?"

Yes, via Azure Trusted Signing with a Public Trust cert. Publisher reads "Jameson Daines". macOS is signed with my Developer ID. Linux binaries are signed with my Tauri updater key for the auto-update verification.

**If you see a SmartScreen warning on Windows:** that's the new-certificate reputation warning, not a signing regression. My cert is brand new (days old) so SmartScreen hasn't built reputation for it yet. The publisher line proves the cert is applied. Click More info → Run anyway. The warning clears automatically once enough people install it, which is the whole catch-22 with new-publisher Windows signing.

**macOS notarization** is currently disabled because Apple's notary service has been degraded since March 2026, so you'll see a Gatekeeper warning on first open. Right-click → Open → Open once, trusted after that.

### Q20a. "I saw a Windows SmartScreen warning, is it safe?"

Yes. SmartScreen is saying "unrecognized" not "unsafe". The installer is signed by Azure Trusted Signing with my verified publisher identity (check the publisher line: "Jameson Daines, Provo, Utah"). SmartScreen reputation for new publishers builds up over the first few hundred installs, 2 to 4 weeks. I'm the first paying customer you're watching go through this. If you want extra assurance, build from source: github.com/keepance/keepance.

---

## Block 4: Trust + founder questions

### Q21. "Who are you / why should I trust this?"

I'm Jameson Daines. I'm a Senior Product Designer at a health-tech company (day job), and I build Keepance nights and weekends. Eighteen months of evenings to get the product to v1.0, eight weeks to get it commercially shippable. I don't have a startup cofounder, I don't have VC money, I don't have a team. Just me, Claude (I use it to help me manage the business side), and a few hundred hours of build time.

### Q22. "Solo founder? What if you get hit by a bus?"

Files are on your disk in plain Markdown. Memory index is a LanceDB dataset any other tool can read. API keys are in your OS keychain, not Keepance. The source is on GitHub under MIT, so if I disappear, someone could fork it or you could build from source. The only thing you lose is updates.

### Q23. "How do I know my API keys are safe?"

On Tauri (Windows, Mac, Linux desktop), keys go to the native OS keychain via the `keyring` Rust crate. Never written to disk in plain text. Never sent to any server, including mine. You can audit the code at `src-tauri/src/commands/keychain.rs` on GitHub.

### Q24. "Business plan?"

Target: 5,000 paying customers in year 1 at $49-99 one-time, for $250-500K ARR-equivalent. Conservative. The goal isn't to grow to 100 employees, it's to support my family if I ever leave the day job, and keep shipping the tool I use every day.

### Q25. "Why are you telling us all this? Sales should be mysterious."

Because I'm not a big cloud company and my moat isn't NDA-able tech, it's that I'm honest about trade-offs. If you're deciding between Keepance and something with a $100M Series B, my story is "I'll still be here in three years whether I have 500 customers or 5000." That's worth more to me in indie-founder circles than any pitch-deck magic.

---

## Block 5: Feature-specific

### Q26. "Collaboration?"

No. Single-user by design. If multiple people need to edit, put your workspace in Dropbox or iCloud or git, whichever you trust. The moment I add real-time collab I compete with Notion and I lose that fight.

### Q27. "Mobile?"

No. Desktop only. Mobile is a different product for a different buyer; I'm not building it. Your files are Markdown, so read them on mobile with any Markdown app (Working Copy, Obsidian Mobile, plain Files.app), Keepance just doesn't have a mobile client.

### Q28. "Plugin ecosystem?"

Not yet, intentionally. The MCP server gives you a way to connect any external MCP client (Claude Desktop, Cursor, Zed, future ones). That's the integration surface. A full plugin marketplace is Obsidian's model and adds a support burden I can't carry solo. If there's strong signal post-launch, I'll consider a plugin API in v2.

### Q29. "Roadmap?"

v1.5 is the "4 flags live" release I just shipped. Next 6 months: (1) fix whatever bugs real users find in the first 30 days, (2) extend the side-by-side AI editor to RichText / Docx / Rtf editors that v1.5 didn't cover, (3) add voice sidecar binary bundling so the offline voice feature works without manual setup, (4) MCP server: publish to the Official MCP Registry. After that I'll pick 1-2 Big Bet items based on what paying users actually ask for.

### Q30. "Can you open-source the whole thing?"

The app code is already MIT on GitHub. The paid part is the signed binary + the commercial-use license for Pro/Lifetime. If you want to self-build, it's `npm install && npm run tauri build` after you have Rust and the Tauri deps. Anyone who wants the code has it.

---

## Reply etiquette (important)

- **Reply in 30 minutes or less** during peak hours (8am-11pm your local). PH and HN both reward speed.
- **Never ignore hostile comments.** Reply once, calmly, with specifics. If they keep attacking, stop, don't feed it.
- **Upvote constructive comments even if they critique you.** "Good point, here's why I made the trade-off I did" lands better than defensive.
- **For "I'll try it" comments:** thank + point at a specific doc (`/docs/getting-started`, `/templates/`, `/vs/obsidian`), not a generic "let me know what you think."
- **For typos / broken-link reports:** thank, fix it in the live site within the hour, reply with "fixed, thanks." Visible velocity builds trust.
- **For your own tweets / shares** of PH traction: show actual numbers ("hit top 5 by noon, 80 comments in 4 hours") not vibes.

---

## When a question isn't in here

Default shape: "Short honest answer. One specific fact or link. One-sentence acknowledgment of the trade-off."

Example: someone asks "what if I want X feature?" → "No, X isn't in v1.5. I didn't build it because [reason]. [Link to issue tracker or roadmap doc]. If 10+ paying users ask, I'll reconsider for v1.6."

The worst reply is a promise. The best reply is a ranked trade-off.

---

## Meta-reply templates (for situations)

### Someone offers to buy Keepance (M&A feeler)
> Not for sale. I'm building this because I use it every day, not because I want to exit. Happy to keep the door open if that changes, but today the answer's no.

### Someone says it's vaporware / too good to be true
> Installer's right there, repo's right there, both live. Install and see. If I'm making stuff up you'll find it in 20 minutes.

### Someone says this should be free / open source
> The source is on GitHub. The app binary is where I charge, $49 one-time. If you build from source you get the same thing without paying me. That's the deal.

### Someone asks if I'm using AI to write my marketing
> Yes and no. I write drafts, Claude helps me edit for voice. Every published word I read and approve. If you spot a sentence that sounds like AI wrote it, call it out, I'll fix it.

### Someone asks what I think about [incumbent competitor]
> [Competitor] is good at [actual strength]. Keepance's different at [actual difference]. The two can coexist. I'm not here to kill [competitor].

---

*Created 2026-04-17 night run. Update after launch with any reply patterns that worked or didn't.*
