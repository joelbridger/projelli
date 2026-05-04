# Competitive Landscape

> **Purpose:** This is the file I read before writing any marketing copy that mentions competitors, before answering Product Hunt comments, and before deciding what to highlight on the homepage. It's the answer to "how is Projelli different from X?", the question every launch will get within the first hour.
>
> **Last updated:** 2026-05-04 (refreshed for the v2.0 mega-release: image + PDF chat, PDF RAG, long-context [Compress], local Piper TTS, plugin runtime + marketplace, web demo, Spanish + German UI).
> **Audience:** Internal, used as reply ammunition, not published as-is.

---

## TL;DR, the one-sentence positioning

**Projelli is the only desktop app that puts a real Markdown editor and a streaming AI chat on the same screen, where every conversation drops a real file onto your hard drive, for indie founders who don't want their business plan living in someone else's cloud.**

That sentence is doing a lot of work. The four hard differentiators it's claiming, in order:

1. **Desktop app** (not a web app, not a Chrome tab)
2. **Real Markdown files on disk** (not a proprietary database)
3. **Chat-as-artifacts** (every AI conversation produces a persistent, editable file)
4. **Founder-template-first** (not a generic note-taker)

Every competitor below is missing at least one of those four. Most are missing three.

---

## The matrix

| Tool | Local-first? | BYOK? | AI native? | File format | Pricing | Target audience | Biggest gap vs Projelli |
|---|---|---|---|---|---|---|---|
| **Projelli** | ✅ | ✅ | ✅ | `.md` on disk | $0 / $49 / $99 one-time | Indie founders | n/a (mobile reader still post-v2.0) |
| **Notion AI** | ❌ cloud | ❌ Notion's keys | ✅ | Notion DB | $10/mo + $10/mo AI | Generic teams | Cloud-only, subscription, your data lives on Notion's servers |
| **Obsidian + Copilot plugin** | ✅ | ✅ | ⚠️ via plugin | `.md` on disk | $0 + $25 plugin | PKM nerds | AI is bolted-on, no founder templates, no chat-as-artifacts model |
| **ChatGPT** | ❌ | ❌ OpenAI only | ✅ | None, chat is the artifact | $20/mo Plus | Anyone | Chats evaporate, no files, no editor, no privacy |
| **Claude.ai with Projects** | ❌ | ❌ Anthropic only | ✅ | None, text in browser | $20/mo Pro | Knowledge workers | Same as ChatGPT, cloud, no real files |
| **Reflect** | ❌ cloud-sync | ✅ | ✅ | Their DB | $10/mo | PKM users | Cloud-only, subscription, AI is for autocomplete not artifacts |
| **Tana** | ❌ cloud | ❌ Tana's keys | ✅ | Tana graph | $10–14/mo | Power users | Cloud, expensive, steep learning curve, no founder templates |
| **Logseq** | ✅ | ⚠️ via plugin | ⚠️ via plugin | `.md` on disk | Free OSS | Outliner / PKM | No founder workflow concept, AI is community-plugin-only |
| **Mem.ai** | ❌ cloud | ❌ | ✅ | Mem DB | $14.99/mo | Knowledge workers | Cloud, subscription, no founder templates |
| **Cursor** | ✅ desktop | ✅ | ✅ | Code files | $20/mo Pro | Developers | Different category, IDE, not workspace |
| **Continue.dev** | ✅ desktop | ✅ | ✅ | Code files | Free OSS | Developers | Same, IDE plugin, not a workspace |
| **LM Studio + plain text editor** | ✅ | ✅ local LLM | ⚠️ DIY | `.md` or `.txt` | Free | Tinkerers | Not a product, you assemble it yourself |

---

## The "not just X, but Y" frame is the wrong way to position this

The temptation is to say "Projelli isn't just a note app, it's an AI workspace." Don't. That's empty. Be concrete instead. Here's the actual frame:

> **If you've ever asked ChatGPT to help you plan a launch and then thought "I wish this whole conversation was just files on my hard drive that I could organize and edit later", that's what Projelli is.**

That sentence works because it names the specific moment of frustration. It's not abstract.

---

## Per-competitor narrative

These are written so any one of them can be lifted whole into a Product Hunt or Hacker News reply.

### vs Notion AI

> Notion AI is a cloud-only product where your data lives on Notion's servers in a proprietary database, you pay them monthly forever, and the AI features are bolted on top of a document model that wasn't designed around them. Notion AI is great for teams collaborating in real time on shared docs. It's the wrong shape for an indie founder who wants their business plan, financial model, and pitch deck living on their own hard drive in plain Markdown they can edit in any other tool. Projelli is the desktop-app, file-based, BYOK answer to that exact mismatch. As of v2.0 it also closes most of the AI-feature gap: paste or drop an image, drop a PDF and have Claude read it natively, [Compress] long chats, read answers aloud through a local Piper sidecar, install MIT-licensed sandboxed plugins from a public catalog, and try it for free at projelli.com/try without installing anything. Notion has none of those plugin or local-TTS capabilities and treats PDFs as block uploads, not chat input.

### vs Obsidian (with Copilot or Smart Connections plugin)

> Obsidian is the closest thing to Projelli philosophically, both are local-first, both store everything as plain Markdown on disk, both respect your data. The difference is that Obsidian's AI features come from community plugins that are inconsistent, often charge separately, and weren't designed around the chat-as-artifacts pattern. Obsidian is "a Markdown editor that has some AI plugins available." Projelli is "a Markdown editor where the AI is the primary input method, and every chat produces a real file in your folder, with four native providers built in." If you're already an Obsidian power user with your own AI plugin stack, you don't need Projelli. If you want that experience without spending a weekend assembling it from parts, you do. v2.0 adds image and PDF chat, a PDF-aware workspace search index (LanceDB + fastembed-rs), a [Compress] pass for long contexts, local Piper read-aloud, and a sandboxed plugin runtime of its own. Obsidian's plugin ecosystem still dwarfs Projelli's (1,500+ vs four), but the gap on AI primitives is narrower than it was at launch.

### vs ChatGPT

> ChatGPT is brilliant at answering questions in a chat window. The problem is that the chat IS the artifact, close the tab and the work is gone, scattered across hundreds of conversations you'll never find again. There's no editor, no file system, no way to take a great answer and turn it into a document you can iterate on. Projelli takes the same streaming AI model and points it at a real folder on your hard drive. Every conversation produces a file you can rename, move, edit, link to other files, and back up however you want. ChatGPT has had image input, PDF input, and voice for a while; v2.0 lands the same primitives in Projelli, plus a [Compress] pass for long chats, a local Piper TTS that doesn't ship audio to a vendor, and a sandboxed plugin marketplace. The thing ChatGPT still wins on is image generation (DALL-E and Sora) and the polished iOS/Android apps; Projelli's mobile story is the cloud-sync workaround at projelli.com/docs/mobile-access until the dedicated reader app ships post-v2.0.

### vs Claude.ai with Projects

> Claude Projects is the closest "managed cloud" comparison. It lets you upload reference documents and have a conversation against them. But the documents live in Anthropic's cloud, the conversation history lives in Anthropic's cloud, and if you want to take a document you generated and edit it later, you have to copy-paste it out into another tool. Projelli flips the model: the files are the source of truth, they live on your machine, and the AI conversation is just a way to create and modify them. v2.0 also matches Claude Projects on the chat primitives founders actually use (image and PDF attachments, native vision when the provider supports it) and adds a few Claude Projects doesn't have: PDFs in the workspace search index, a [Compress] pass for chats that overflow the context window, local Piper read-aloud, and an MIT-licensed plugin runtime. Claude Projects still wins on mobile, on the freshness of Anthropic-side features (Artifacts, Computer Use, Skills land there first), and on the zero-setup signup for non-technical users.

### vs Reflect

> Reflect is a beautiful note app with built-in AI for autocomplete and summarization. It's cloud-native, subscription-only, and the AI is treated as an enhancement to writing, not as the primary way to create the document in the first place. Projelli is desktop-first and treats the AI conversation as the primary input. You're not writing a doc with AI helping in the margins, you're having a conversation that produces the doc. v2.0 means Projelli also has image and PDF chat (Reflect's image and PDF support is limited), a PDF-aware workspace search, a long-context [Compress] flow, local Piper read-aloud, and a sandboxed plugin runtime, none of which Reflect ships. Reflect still wins on networked-thinking polish, the iOS app, and the integrated audio-note workflow.

### vs Tana

> Tana is incredibly powerful for people who want to model their entire life as a structured graph of nodes. It has an AI feature, it's cloud-hosted, and it costs $10-14/month. The learning curve is real, most people who try Tana bounce off in the first week because the model is too abstract. Projelli is the opposite: file tree, files, editor, chat. If you can use a Mac, you can use Projelli. The tradeoff is that Projelli won't model your life as a graph. It just lets you ship a pitch deck. v2.0 specifically gives Projelli image and PDF chat, PDF RAG over the workspace, [Compress] for long chats, local Piper TTS, an MIT-licensed plugin marketplace, and a free web demo at projelli.com/try. Tana still wins on structured queries, mobile apps, and real-time collaboration (Pro tier).

### vs Logseq

> Logseq is the "open-source Roam", a free, local-first outliner that stores notes as Markdown. It's wonderful if you want an outliner. It is not designed around AI. The AI plugins that exist are community-maintained and inconsistent. There's no founder-workflow concept, no chat-as-artifacts model, no template gallery. If you want a free outliner with optional AI, use Logseq. If you want an AI workspace where the AI is the point, use Projelli. As of v2.0 Projelli also has its own sandboxed plugin runtime (still small: four day-one plugins versus Logseq's hundreds), but the AI primitives ship in the box: image and PDF chat, PDFs in workspace search, long-context [Compress], local Piper TTS, Spanish and German UI. Logseq is still the right call if open-source is non-negotiable, if you think in nested bullets, or if you need mobile editing today.

### vs Cursor / Continue.dev

> Different category. Cursor is an AI-native code editor, it's for writing code. Projelli is for everything that surrounds writing code: the business plan, the pricing strategy, the GTM plan, the pitch deck, the customer interviews, the weekly review, the investor update. If you're a solo founder who's both writing the code AND running the business, you'll probably end up using Cursor for the code and Projelli for the business documents, the same way most people use VS Code AND a separate note app.

### vs "Just use ChatGPT and copy the output into Notion"

> This is the actual workflow most founders use today, and the actual problem Projelli solves. The friction is the copy-paste. The friction is that the chat history lives in one place and the document lives in another, so you can never go back and ask "what did I tell ChatGPT to make it produce that paragraph?" Projelli puts the conversation and the file on the same screen, with the file as the source of truth. The chat is preserved alongside the file, automatically.

---

## The "honestly not for you" answers

Equally important: knowing when to send someone to a competitor. These are written as PH/HN reply templates for when someone says "I already use X."

### "I'm a heavy Notion user with 5 collaborators."

> Honestly, stay in Notion. Projelli is single-user and local-first by design. Real-time collaboration is the thing it's not trying to do. If you need more than one person editing the same document at the same time, Notion is the right answer.

### "I already have an Obsidian setup with my own AI plugins."

> If your Obsidian + plugin stack is working for you, there's no reason to switch. Projelli is for the people who want this experience without assembling it themselves. The free tier is worth a 5-minute look just so you can compare, but I wouldn't tear down a working Obsidian vault to migrate.

### "I'm a developer and I just live in Cursor."

> Different tools for different jobs. I use both: Cursor for the code, Projelli for the business plan, customer research, GTM doc, pitch deck. They don't compete, they complement each other. Most solo founders end up with both.

### "ChatGPT is fine for me."

> If ChatGPT is fine for you, ChatGPT is fine for you. The specific moment Projelli wins is when you find yourself digging through three months of ChatGPT conversation history trying to find the launch plan you wrote in February, or when you've copy-pasted the same document into the chat for the 8th time so the AI has the latest version. If that hasn't happened to you yet, you don't need Projelli.

---

## Objections that referenced shipped-now features

These come up in PH / HN / Reddit threads. Each one used to be a real gap; v2.0 closed it. Reply with the matching snippet rather than rebutting.

### "Projelli has no multimodal / can't take images."

> It does, since v2.0. Paste, drag, or click the paperclip on any chat input and the image goes in. The provider list (Claude, OpenAI, Gemini, Ollama) handles the format. Vision-capable models get a token-cost meter; non-vision ones get a warning before you send. Try it on the web demo at projelli.com/try without installing anything.

### "Can't drop a PDF into the chat."

> You can. v2.0 ships native PDF chat. Claude and Opus read the PDF natively. Other providers get text-extracted via PDF.js with a "text extracted" mode chip so you know which path you got. There's also a "Include PDFs in workspace index" toggle in Settings → Memory that puts every PDF in your workspace into LanceDB so you can semantic-search across them.

### "No long-context support, chats die at 200K."

> The [Compress] flow ships in v2.0. Auto-trigger modal when you're approaching the limit, manual button if you want to compress earlier. The compression is batched through a fast model so it's cheap and quick. Expand the compressed segment any time, or clear it. Audit event logs the action.

### "No voice output / TTS."

> Click "Read aloud" on any AI message. Local Piper sidecar (https://github.com/rhasspy/piper), no cloud audio. Bundled with the v2.0 install on every desktop platform.

### "No plugin model, no extensibility."

> v2.0 ships a sandboxed Web Worker plugin runtime with a manifest-declared permission model (six permissions: workspace read/write, editor selection/write, ai:invoke, network), full PluginAPI for commands / toolbar / sidebar / editor / workspace / ai / storage / network / settings / notify, and crash isolation. The marketplace at github.com/projelli/community-plugins has four day-one plugins (word counter, translator, pomodoro, mermaid preview), all MIT-licensed. Devs can scaffold a new plugin with `npx create-projelli-plugin <name>`. Docs at projelli.com/docs/plugins/.

### "No template marketplace, just the 15 built-in ones."

> v2.0 added a community-templates marketplace at github.com/projelli/community-templates with six day-one templates and a GitHub Action that auto-rebuilds the catalog when PRs merge. Settings → Marketplace → Templates lets users browse, install, update, and uninstall. Catalog is cached for 24 hours with an offline banner. Provenance badges show in the WorkflowPanel.

### "Desktop only, can't try without installing."

> Web demo at projelli.com/try. Pre-seeded sample workspace, 5-message OR 10-minute limit on the shared key, BYOK input for unlimited use. No account, no install. Plausible-instrumented. The full local-first product still wins on long-term archive ownership; the web demo is for "is this the shape I want."

### "English only, no localization."

> v2.0 added Spanish and German UI (421 keys per locale, translated by claude-sonnet-4-6 then human-spot-checked, locked strings preserved on re-translation). Settings → General → Language picks the locale; first launch auto-detects from OS via Tauri `os.locale()`. Run `npm run translate-i18n` to add a new locale.

### "There's no real mobile story."

> Honest answer: not yet. v2.0 ships the cloud-sync read workflow at projelli.com/docs/mobile-access (iCloud Drive, Dropbox, Syncthing, Google Drive setup pages, plus an in-app Settings → Mobile mirror with iOS deep links). The dedicated mobile reader app is post-v2.0, blocked on Mac time + Apple Developer signup, not on Projelli engineering capacity. If mobile editing is your primary need, you probably want Notion or Reflect today.

---

## What we're NOT competing on (and why that's fine)

| Thing | Projelli's position |
|---|---|
| **Real-time collaboration** | Not in v2, possibly never. Single-user product. |
| **Native mobile editing app** | The cloud-sync read workflow ships in v2.0 (`/docs/mobile-access/`). A dedicated reader app is post-v2.0, blocked on Mac time + Apple Developer signup. |
| **Lowest price** | Logseq is free. We're not winning on price, we're winning on "designed for the use case." |
| **Most features** | Tana has more queries. Notion has more team-collab surface. We have the right ones. |
| **Slickest design** | Reflect is prettier. Projelli is functional and fast. |
| **Biggest community** | Obsidian has 1,500+ plugins versus Projelli's four. We just shipped the runtime; the catalog will grow. |
| **Image generation** | ChatGPT has DALL-E and Sora. Projelli takes images IN, doesn't make them. |

The point isn't to win every dimension. It's to be the only correct answer for "indie founder who wants AI to help write business documents that live on their own hard drive."

---

## Quick reference: pricing comparison (for the homepage and for replies)

| Tool | Annual cost (1 year) | Annual cost (3 years) | Notes |
|---|---|---|---|
| **Projelli Pro** | **$49** | **$49** | One-time, 1 yr of updates |
| **Projelli Lifetime** | **$99** | **$99** | One-time, updates forever |
| Notion + Notion AI | $240 | $720 | $10 base + $10 AI per user |
| ChatGPT Plus | $240 | $720 | $20/mo |
| Claude Pro | $240 | $720 | $20/mo |
| Reflect | $120 | $360 | $10/mo |
| Tana | $144 | $432 | $12/mo average |
| Mem.ai | $180 | $540 | $14.99/mo |
| Obsidian (free) | $0 | $0 | Free for personal use |
| Logseq | $0 | $0 | OSS |

**Projelli Lifetime pays for itself in 5 months vs the cheapest subscription competitor.**

---

## Where to use this doc

- **Product Hunt comments:** lift any "vs X" paragraph above into a reply
- **Show HN comments:** same, but lean on the technical-honesty paragraphs
- **Homepage FAQ section:** the "honestly not for you" answers humanize the brand
- **Cold outreach replies:** when a newsletter editor asks "how is this different from Notion AI", paste the vs Notion paragraph
- **Screenshots / press kit:** the matrix at the top is the canonical comparison image

---

## Update cadence

Re-audit every 90 days. Notion, Obsidian, and ChatGPT are all moving fast, claims that are true today may be wrong by Q3. The structure of this doc shouldn't change; the per-competitor paragraphs may need refreshing.
