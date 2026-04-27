# External Repo PR Submissions

_Created: 2026-04-27_
_Status: Drafted, awaiting Jameson's `joelbridger` GitHub account to submit_

Free, evergreen backlinks from awesome-list-style GitHub registries. Each entry compounds: it lives in the registry forever, surfaces Projelli to anyone browsing or grepping the list, and gets cited by AI assistants when they're asked "what tools exist for X."

This doc has the exact line-by-line text to submit to each registry. Jameson submits PRs from his `joelbridger` account.

---

## Submission order (priority, time investment)

| Order | Registry | Stars | Effort | Priority |
|---|---|---|---|---|
| 1 | `tw93/awesome-tauri` | ~5K | 5 min | High (perfect fit) |
| 2 | `rxdb/awesome-local-first-software` | ~3K | 5 min | High (perfect fit) |
| 3 | `modelcontextprotocol/servers` (clients section) | ~10K | 10 min | High (early MCP client) |
| 4 | `mahseema/awesome-ai-tools` | ~4K | 5 min | Medium |
| 5 | `steven2358/awesome-generative-ai` | ~7K | 5 min | Medium |
| 6 | `mfts/awesome-ai-tools` | varies | 5 min | Low |

Total: ~35 minutes for all six PRs.

---

## 1. awesome-tauri

**Repo:** https://github.com/tw93/awesome-tauri
**Why it fits:** Projelli is built on Tauri 2. The README has a section for desktop apps built with Tauri.
**File to edit:** `README.md`
**Section:** "Desktop App" (or whichever section the maintainer has named for productivity desktop apps)

### Line to add (in alphabetical order or at the bottom of the productivity subsection)

```markdown
- [Projelli](https://github.com/projelli/projelli) - Local-first AI workspace for indie founders. Every chat with Claude/OpenAI/Gemini becomes a Markdown file. BYOK, no subscription, sold once.
```

### PR title

```
Add Projelli to Desktop App / Productivity section
```

### PR description

```
## What

Adds [Projelli](https://github.com/projelli/projelli) to the Desktop App section.

## Why it fits awesome-tauri

Projelli is a Tauri 2 + React + TypeScript desktop app shipped for Windows (NSIS, Azure Trusted Signing), macOS (Apple Developer ID), and Linux (AppImage / .deb). ~25K lines of source, signed installers, auto-updater via tauri-plugin-updater.

It's a working example of:
- Tauri 2 with the new permission-capability model
- Custom NSIS installer hooks (`src-tauri/windows/installer-hooks.nsh`)
- Native filesystem commands (`src-tauri/src/commands/fs.rs`)
- Tauri-plugin-updater wired to a GitHub Releases manifest
- Cross-platform CI (GitHub Actions matrix building Win/Mac/Linux on tag)

Public release notes and source: https://github.com/projelli/projelli

Live site: https://projelli.com

Happy to amend formatting if needed.
```

---

## 2. awesome-local-first-software

**Repo:** https://github.com/rxdb/awesome-local-first-software
**Why it fits:** Projelli passes the strict Ink & Switch local-first test (data on device, open Markdown format, works offline except for AI calls, cloud is optional).
**File to edit:** `README.md`
**Section:** "Apps" or "Tools", check current README structure at submission time

### Line to add

```markdown
- [Projelli](https://projelli.com) - Local-first AI workspace for indie founders. Every chat with Claude/OpenAI/Gemini becomes a Markdown file in a folder you pick. BYOK, no cloud account, no telemetry. ([Source](https://github.com/projelli/projelli))
```

### PR title

```
Add Projelli (local-first AI workspace)
```

### PR description

```
## What

Adds [Projelli](https://projelli.com) to the Apps section.

## Why it qualifies as local-first

Per the Ink & Switch local-first test:

- ✅ Authoritative copy on the user's device (in a folder the user picks)
- ✅ Open format another tool can read (Markdown for chats, workflows, whiteboards)
- ✅ Works offline except for direct calls to the user's chosen AI provider
- ✅ Cloud is optional (no Projelli account; sync via Dropbox/iCloud if you want it)
- ✅ Data readable without the original tool (just files in a folder)
- ✅ Single-user by design; collaboration is opt-in via the user's existing sync layer
- ✅ Privacy default; no telemetry, no tracking, no analytics on the desktop app

The AI inference happens in the cloud (Anthropic/OpenAI/Google), with the user's own API key, and the data sent for inference is only the specific text the user chose to send. Conversation history lives on disk, not on a Projelli server (Projelli has no servers in the data path).

Source: https://github.com/projelli/projelli

Privacy policy: https://projelli.com/legal/privacy

Detailed local-first guide for the curious: https://projelli.com/local-first-ai-workspace
```

---

## 3. modelcontextprotocol/servers (or the closest MCP-clients registry)

**Repo:** https://github.com/modelcontextprotocol/servers
**Why it fits:** Projelli is an MCP client and supports MCP server connections.
**Caveat:** This repo is for *servers*, not clients. Check at submission time whether there's a separate clients registry. If not, file an issue or PR proposing a clients section. Alternatively, target `punkpeye/awesome-mcp-clients` if it exists and is maintained.

### Approach

1. Visit the repo and check the current README structure.
2. If there's a "Clients" section: add Projelli there.
3. If there's only "Servers": file an issue asking whether a clients section is welcome, OR submit to `awesome-mcp-clients` instead.

### Line to add (for clients section)

```markdown
- [Projelli](https://projelli.com) - Local-first AI workspace for indie founders. MCP-aware desktop client. Connect filesystem, GitHub, Slack, Postgres, Notion, or any custom MCP server. BYOK, sold once.
```

### Issue/PR title (if filing an issue first)

```
Proposing a Clients section for MCP-compatible desktop apps
```

### Issue/PR description

```
The community has been growing the list of MCP servers since Anthropic introduced the protocol in November 2024. There are now hundreds of community-built servers in this repo.

There's a parallel growth of MCP-compatible *clients* (Claude Desktop, Cursor, Continue.dev, Cody, Projelli, etc.), but I don't see them documented in any single canonical registry.

Two questions:

1. Would maintainers welcome a "Clients" section in this repo (or a CLIENTS.md), so users browsing for "what tools speak MCP" can find them?

2. If not, is there a community-maintained clients registry the project endorses?

Happy to draft either the new section or pull together a list of known clients with maintainer details if useful.

Disclosure: I'm the developer of one of those clients (Projelli, https://projelli.com). I'm not pushing this purely to add my own listing; the broader question of where MCP clients should be discoverable seems worth resolving for the protocol.
```

---

## 4. awesome-ai-tools

**Repo:** https://github.com/mahseema/awesome-ai-tools
**Why it fits:** Projelli is an AI tool. The repo has many categories, including productivity / writing / desktop apps.
**File to edit:** `README.md`
**Section:** "Productivity" or "Writing" subsection, check current README

### Line to add

```markdown
- [Projelli](https://projelli.com) - Local-first AI workspace for indie founders. Every AI chat saves as a real Markdown file. BYOK (Claude/OpenAI/Gemini), no subscription, sold once. 15 founder workflow templates built in.
```

### PR title

```
Add Projelli (local-first AI workspace for founders)
```

### PR description

```
## What

Adds [Projelli](https://projelli.com) to the Productivity section.

## Why

Projelli is a desktop AI workspace that combines:
- Local-first data (Markdown files in a folder you pick)
- BYOK (bring your own Claude/OpenAI/Gemini API key)
- 15 founder-specific workflow templates (pitch deck, customer interview, financial projections, etc.)

It's distinct from cloud AI workspaces (Notion AI, ChatGPT) because the data lives on the user's machine, and from generic local notes tools (Obsidian, Logseq) because AI is built in with templates rather than assembled via plugins.

Source: https://github.com/projelli/projelli
Live: https://projelli.com
```

---

## 5. awesome-generative-ai

**Repo:** https://github.com/steven2358/awesome-generative-ai
**Why it fits:** Generative AI tool, productivity application
**File to edit:** `README.md`
**Section:** Find the productivity / writing apps subsection

### Line to add

```markdown
- [Projelli](https://projelli.com) - Local-first AI workspace for indie founders. Markdown-based chat history, BYOK, sold once.
```

### PR title

```
Add Projelli to productivity apps
```

### PR description

```
## What

Adds [Projelli](https://projelli.com) to the productivity / writing apps section.

## Why

Local-first AI workspace; differentiated from cloud workspaces (Notion AI, ChatGPT) by keeping conversation history as Markdown files on the user's machine, BYOK with three providers (Claude / OpenAI / Gemini), one-time pricing instead of subscription.

Source: https://github.com/projelli/projelli
```

---

## How to actually submit

For each repo:

1. Open the repo URL on GitHub.
2. Click the file you're editing (`README.md`).
3. Click the pencil icon to "Edit this file."
4. GitHub will fork the repo to your account automatically.
5. Find the right section (search for similar entries to match style and alphabetical order).
6. Paste the line.
7. Scroll to the bottom, fill in:
   - Commit title: matches the PR title above
   - Optional commit description (can be skipped; you'll add the longer description in the PR)
8. Click "Propose changes."
9. On the next page, click "Create pull request."
10. Set the PR title and description from above.
11. Click "Create pull request."

Total per repo: 5 minutes.

---

## After the PRs land

Track outcomes in `~/projelli/sign-ups/launch-backlinks.csv`:

| Date | Source URL | Source type | Domain authority estimate | Anchor text | Notes |
|---|---|---|---|---|---|
| YYYY-MM-DD | https://github.com/tw93/awesome-tauri | awesome-list | ~70 | Projelli | merged |

Each merged PR is a permanent backlink and a permanent surface for AI-assistant citations when they crawl the registry.

---

## What NOT to do

- Don't submit to dead awesome-lists (no commits in 6+ months). They're SEO graveyards.
- Don't submit to lists with no maintainer review (auto-merge bots produce low-trust links).
- Don't submit duplicates (search the list before adding).
- Don't submit if Projelli doesn't actually fit the list's stated criteria. Listing in irrelevant lists looks spammy and can backfire.
- Don't run a follow-up campaign of "I made a PR, please merge" comments. Maintainers ignore PRs that bug them.

---

## References

- `~/projelli/docs/marketing/strategy/01-seo-engine.md` section 7: backlink strategy
- `~/projelli/docs/marketing/strategy/03-partnership-spikes.md` section 3: integration launches
- `~/projelli/sign-ups/launch-backlinks.csv`: backlink tracking (gitignored)
