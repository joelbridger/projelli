# r/SideProject Post — Ready to Paste

> **Instructions:** Copy the title and body below. Paste into Reddit at https://www.reddit.com/r/SideProject/submit. Review and edit for your voice before posting.

---

## Title

After 18 months of weekends, I launched a desktop AI workspace that saves every conversation as real files on your hard drive

## Body

I'm a product designer who's spent the last 8 years in health-tech. Day job is great. But I've always had side project brain — constantly kicking around startup ideas, doing market research, writing specs that go nowhere.

The problem: I was doing all of it in ChatGPT. Which means I was also losing all of it in ChatGPT. Scroll back far enough in a conversation thread and it's just... gone. No structure, no search, no memory. Just vibes.

So I built Projelli. It's a local-first desktop app (Tauri — Rust backend, React UI) where every AI conversation saves as actual Markdown files in a folder on your hard drive. Open it in VS Code, sync it to Git, back it up however you want. The app doesn't touch it. Your files are just... files.

The other thing I built in is 15 founder workflow templates — stuff like competitor analysis, pricing research, pitch deck drafting, user interview synthesis. Not because those are hard prompts to write, but because having them pre-structured means I actually run them instead of staring at a blank chat box and giving up.

BYOK (bring your own API key) for Claude, GPT-4, and Gemini. Your API calls go directly from your machine to the provider. I never see your data, never proxy your requests.

Pricing is one-time. $49 Pro, $99 Lifetime. There's also a $29 Founder's Launch price for the first 100 buyers — I wanted early users who'd actually give me feedback, not just people hunting for the cheapest option.

The comparison that keeps coming up when I describe it: Obsidian meets Claude. Which isn't wrong, but the difference is that AI is built in natively here rather than assembled from community plugins. And unlike Notion AI or similar cloud tools, nothing leaves your machine except the API call itself.

Took 18 months of weekend work to get the product to a state I was happy with. Then 8 more weeks of heads-down work on the stuff I'd been avoiding — code signing, payment integration, privacy policy, CI pipeline, all of it. That part was its own education.

It runs on Windows, Mac, and Linux. The source is visible on GitHub (source-available, not open source — you can read the code to verify what it does, but it's commercial software).

Website: https://projelli.com
GitHub: https://github.com/projelli/projelli
Download: https://github.com/projelli/projelli/releases/latest

Happy to answer questions about the Tauri build, the BYOK implementation, or anything else. And if the landing page is confusing or the positioning is off, tell me — I'd rather hear it now than six months from now.
