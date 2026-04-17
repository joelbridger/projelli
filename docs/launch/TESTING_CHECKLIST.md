# Projelli v1.5-rc.8 testing checklist

> A thorough dogfood pass so you know what you're shipping. Allow 45-60 minutes for the full sweep, 15 minutes for the "critical path only" subset. Work top to bottom. Check each box as you go. If anything fails, write the failure next to the box and keep going, we triage at the end.

---

## 1. Download + install (5 min)

### Where to get it

**https://github.com/projelli/projelli/releases**

Top of the page shows **Projelli v1.5-rc.8** with a `Draft` badge. Click in, pick your platform:

| Your platform | File to download |
|---|---|
| Windows 10/11 | `Projelli_1.5.0_x64-setup.exe` (installer) or `Projelli_1.5.0_x64_en-US.msi` |
| Mac Apple Silicon (M1/M2/M3/M4) | `Projelli_1.5.0_aarch64.dmg` |
| Mac Intel | `Projelli_1.5.0_x64.dmg` |
| Linux Debian/Ubuntu | `Projelli_1.5.0_amd64.deb` |
| Linux Fedora/RHEL | `Projelli-1.5.0-1.x86_64.rpm` |
| Linux portable | `Projelli_1.5.0_amd64.AppImage` (chmod +x to run) |

**If the page shows only published releases and no draft:** you're logged in with the wrong GitHub account. Switch to `joelbridger` (owns the Projelli org; sees drafts). If you still don't see it, the `v1.5-rc.8` tag exists but the draft might have been cleaned up, pull down `v1.5-rc.6` or `-rc.7` (same code path, both are valid drafts).

### Install
- [ ] **Windows:** Double-click the `.exe`. **No SmartScreen warning** (Azure-signed). If you see one, note it, that's a signing regression.
- [ ] **Mac:** Open the `.dmg`, drag Projelli to Applications. First launch: right-click → Open → Open (Gatekeeper warning expected; Apple notarization still disabled from March 2026 outage). After first open, trusted thereafter.
- [ ] **Linux:** `sudo dpkg -i Projelli_1.5.0_amd64.deb` (Debian) or `chmod +x Projelli*.AppImage && ./Projelli*.AppImage`.
- [ ] Launch completes within 5 seconds. If it takes 30+ seconds, note it. LanceDB + fastembed load on startup, 10 seconds is expected on first launch.

---

## 2. First-run wizard (5 min), tests Q9, Q11, Q20

On first launch you should see a welcome dialog, not the empty editor.

- [ ] Welcome dialog appears with the Projelli coral wordmark (branded start screen from v1.0.8)
- [ ] Pitch line reads something like: "Your AI workspace. Your files. Your machine."
- [ ] Click "New Workspace" (or "Open Existing" if you want to reuse an old one)
- [ ] Pick a folder. On Mac/Windows: your Documents or Desktop. On Linux: `~/projelli-test/`.
- [ ] After selecting the workspace, the **API key wizard** should offer itself (Q20). If you have a Claude / OpenAI / Gemini key handy, click into the 3-step flow:
  - [ ] Step 1 opens the provider's API keys page in your browser
  - [ ] Step 2 shows a mock dashboard illustration (not a real screenshot yet, placeholder SVG is fine)
  - [ ] Step 3 accepts the key, shows estimated monthly cost ($2-5 typical for Claude Haiku)
  - [ ] Save. The wizard closes.
- [ ] Before finishing, the wizard should offer a **"Populate workspace with 3 sample files?"** toggle (Q11). Default ON.
- [ ] Finish wizard. Three sample files should appear in the file tree:
  - [ ] `Sample: Pricing Strategy.md`
  - [ ] `Sample: Pitch Deck.md`
  - [ ] `Sample: Weekly Review.md`
- [ ] Click one. It opens in the editor with real content about the fictional "Acme Budget" company. No em dashes anywhere in the text.

**Critical check:** in Settings → AI → Models, the default selected model should be `claude-haiku-4-5-20251001` (Q9). If it's Sonnet or Opus, Q9 regressed.

---

## 3. Quick Wins sweep (15 min), tests Q1-Q6, Q8, Q12-Q15, Q19

### Q1 + Q2, Mermaid + KaTeX in markdown preview
- [ ] Create a new Markdown file. Paste:
  ```
  # Diagram test

  \`\`\`mermaid
  graph LR; A-->B; B-->C;
  \`\`\`

  Inline math: $E = mc^2$

  Block math:
  $$\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}$$
  ```
- [ ] Switch to preview mode (or split view). The mermaid block renders as an SVG graph (3 connected nodes). Math expressions render as typeset formulas, not raw `$...$`.

### Q3, Real-time cost chip
- [ ] Open the AI chat pane (sidebar, or Ctrl+Shift+A)
- [ ] Send a short prompt: "write a 3-line poem about coffee"
- [ ] After response streams in, the bottom-right of chat shows something like `$0.00 this chat • $0.00 today` (Haiku is nearly free). Small non-zero number expected.
- [ ] Hover the chip: tooltip shows per-provider breakdown.

### Q4, Monthly cost dashboard
- [ ] Settings → Cost & Usage. See a bar chart for last 30 days (mostly empty bars for today's first-run). Per-provider breakdown visible.
- [ ] "This month" total visible.

### Q5 + Q6, Audit log export + filter
- [ ] Settings (or sidebar) → Audit Log.
- [ ] Action-type filter (dropdown) changes the list. Date-range picker narrows it. Model filter works.
- [ ] Click **Export as JSON**: a `projelli-audit-*.json` file downloads.
- [ ] Click **Export as CSV**: a `.csv` downloads. Open it in any text editor or spreadsheet. First row is headers.

### Q8, Per-template model
- [ ] Settings → Templates. See a table listing all 16 templates (the built-in 15 plus `UserInterviewsSynthesis`).
- [ ] Change one template's default provider + model (e.g. set `PricingStrategy` to Gemini Flash).
- [ ] Run that template. It uses the override, not the global default.

### Q12, Smart paste URL
- [ ] In the Markdown editor, paste a URL like `https://github.com/projelli/projelli`.
- [ ] Within 1-2 seconds, the URL transforms into `[Projelli, GitHub](https://github.com/projelli/projelli)` (or whatever the page's `<title>` is).
- [ ] If you paste a URL inside a code block (inside triple backticks), it stays raw. Good.
- [ ] If you paste with text selected, the selection becomes the link text: `[selected text](url)`.

### Q13, Image paste
- [ ] Copy any image to clipboard (screenshot, or right-click → copy image on a web image).
- [ ] In the editor, Ctrl+V.
- [ ] Image saves to `<workspace>/media/YYYY-MM/image-<hash>.png`. Markdown inserted: `![](media/YYYY-MM/image-<hash>.png)`.
- [ ] Drag-drop an image file from your desktop into the editor. Same behavior.
- [ ] Drop an image >20 MB: toast warns "Image too large".

### Q14, Wiki-link autocomplete
- [ ] In a Markdown file, type `[[`. A dropdown of your workspace files appears.
- [ ] Type `pric` to filter. The Pricing Strategy sample should match.
- [ ] Enter inserts `[[Sample: Pricing Strategy]]` and closes the brackets.

### Q15, Run-on-all-3 (Pro-tier gated)
- [ ] You'll need keys for 2+ providers to test. If you have Claude + OpenAI keys: open chat, type a prompt, click "Run on all 3". Both providers respond in parallel, side-by-side.
- [ ] Each column shows a "Keep this" button. Click one; that response becomes the canonical chat message.
- [ ] If you only have one provider key configured: the button shows "Configure more providers" and is disabled.

### Q16, `?` keyboard shortcut overlay (shipped v1.0.8)
- [ ] Press `?` anywhere. Modal opens listing every keyboard shortcut grouped by category (editor, chat, workflow, etc.).
- [ ] Esc closes it.

### Q18, In-app "What's new" after update (shipped v1.0.8)
- [ ] This only fires on first launch after an update from an older version. If you're installing v1.5 directly, it won't show. Skip this one unless you're testing the v1.0.8 → v1.5 auto-update path.

### Q19, Template fork
- [ ] Workflow picker (sidebar). Hover any built-in template. "Duplicate" button appears.
- [ ] Click it. A copy is created with a "Custom" badge.
- [ ] Edit the system prompt. Save. The edited version appears separately in the picker.
- [ ] Delete it via the trash icon. Confirms with a modal.

---

## 4. Flag 1, Memory (10 min), THE BIG ONE

### M1, Local RAG indexing
- [ ] After opening the workspace, watch the status bar / a banner. It should say "Indexing workspace: X / Y files" for the first 10-60 seconds on a fresh workspace.
- [ ] When done, status reads "Memory: ready" (or similar).
- [ ] Settings → Memory: toggle is ON by default. If you turn OFF, retrieval short-circuits; turn ON again for the rest of the test.

**Stress:** try copying 20-50 Markdown files from somewhere (your Obsidian vault, old notes, Wikipedia scrape) into the workspace. Progress bar should tick up. Full index under 2 minutes.

### M2, @workspace query + citation
- [ ] Open AI chat. Type: `@workspace what's my pricing strategy?`
- [ ] The chat auto-injects the workspace-context block into the prompt. You'll see a chip in the sent message indicating retrieval ran.
- [ ] Response quotes specific content from `Sample: Pricing Strategy.md` with citations like `[Sample: Pricing Strategy §2]`.
- [ ] **Click the citation.** The referenced file opens and (ideally) scrolls to the exact paragraph. Note: if it opens but doesn't scroll to the exact paragraph, that's a known small gap, logged as a v1.5.1 follow-up.

### Ask-my-workspace mode
- [ ] Chat header has an **"Ask my workspace"** toggle. Turn it ON.
- [ ] Send a message: "what should I prioritize this week?"
- [ ] Response cites your Weekly Review sample (or whatever's in workspace) and responds in context.
- [ ] Turn toggle OFF. Same message now responds without workspace context.

### M3, Memory facts
- [ ] Send 10 messages in a chat with durable-fact content. Example:
  1. "my company is called Acme Budget"
  2. "we target freelancers"
  3. "we ship every Friday"
  4. "our main competitor is YNAB"
  5. "our pricing is $9/month"
  6. "our founder team is 1 person (me)"
  7. "we're based in Austin"
  8. "we're bootstrapped, no VC"
  9. "our brand colors are coral + cream"
  10. "our voice is casual + direct"
- [ ] After message 10, a **"Proposed facts"** chip appears below the AI response.
- [ ] Expand it. 1-3 proposed facts to accept / reject / edit.
- [ ] Accept one. Settings → Memory → Facts: it's in the table.
- [ ] Start a NEW chat. Send: "what do you know about my company?". Response references the accepted fact.

---

## 5. Flag 2, MCP (10 min), only if you have Claude Desktop installed

### Download the bundle
- [ ] In Projelli: Settings → Integrations → MCP. Status shows "Ready".
- [ ] Click "Download .mcpb for Claude Desktop". A file downloads named `projelli-<platform>.mcpb` (180+ MB because it includes the MCP binary + ONNX model).

### Install in Claude Desktop
- [ ] Double-click the `.mcpb` file. Claude Desktop asks to install the Projelli extension.
- [ ] Approve. Claude Desktop restarts (or picks up live).
- [ ] Open Claude Desktop. Start a new conversation. Look for a "tools" or "extensions" indicator, the Projelli tools should be listed.

### Use it
- [ ] In Claude Desktop, ask: "list the files in my Projelli workspace". Claude calls `list_workspace_files`, gets real results.
- [ ] "read the Pricing Strategy sample". Claude reads the file.
- [ ] "search my workspace for pricing". Claude uses `search_workspace` (which calls Projelli's RAG index). Real results.
- [ ] "write a new file to my workspace called test.md with the content 'hello'". Projelli (the main app) should show an approval modal. Click "Approve this write". Claude confirms the write succeeded; file appears in Projelli's file tree.

---

## 6. Flag 3, Canvas / side-by-side AI editing (5 min)

- [ ] Open a Markdown file. Type a paragraph of rough text. Example: "so basically what I want to do is build an AI tool for founders and the main thing is that it should be local and you should own your data and also it shouldnt be too expensive."
- [ ] Select the paragraph.
- [ ] A floating chat icon appears near the end of the selection. Click it.
- [ ] Inline chat input: type "tighten this to 2 sentences in my voice".
- [ ] Response streams inline with per-hunk diff highlighting (strikethrough old, underline new).
- [ ] Each hunk has **Accept** / **Reject** buttons.
- [ ] Accept one hunk, reject another. The accepted change persists; the rejected one reverts.
- [ ] Settings → History: the change is logged with `author: 'ai'`.

**Keyboard:** select text + press `Ctrl+Shift+E` (`Cmd+Shift+E` on Mac) to fire the same flow.

**Editor coverage:** works on MarkdownEditor + PlainTextEditor. RichText / DocxEditor / RtfEditor are v1.6 follow-ups, expected NOT to work there yet.

---

## 7. Flag 4, Voice + Ollama (5-15 min depending)

### Ollama (Q7)
- [ ] If Ollama isn't installed: Settings → Integrations → Ollama shows an **"Install Ollama"** link. Click, download Ollama from ollama.com, install, run.
- [ ] If Ollama IS running: status shows "Connected" + lists your local models (e.g. llama3.2:3b, mistral, qwen2.5).
- [ ] In the chat model picker, select an Ollama model.
- [ ] Send a message. Response streams in. Cost chip stays at `$0.00` (Ollama is local, free).

### Voice (M6)
- [ ] Settings → Voice. Status probably shows **"Sidecar missing"**. **This is expected for v1.5-rc.8**, the Parakeet/whisper binary isn't bundled yet (you set the URL post-ship per the handoff doc).
- [ ] The press-to-talk hotkey (`Ctrl+Shift+Space`) is registered but transcription will fail with "Sidecar missing" until you provide a binary.
- [ ] Visually confirm the voice settings panel exists and shows the expected error state. Don't treat this as a bug; it's a flagged gap.

---

## 8. Workflow chain (M7) + multi-interview synthesis (M8) (10 min)

### M7 chain
- [ ] Workflow picker. Run `CompetitorAnalysis` for Acme Budget (fake inputs).
- [ ] After it completes, a **"Use this as input for another template →"** callout appears with `PricingStrategy` highlighted (because PricingStrategy declares `acceptsOutputFrom: ['competitor_list']`).
- [ ] Click through. The second workflow runs with the first one's output pre-filled as input.
- [ ] Save the chain as a `.workflowchain` file. Re-run it later with one click.

### M8 synthesis
- [ ] Workflow picker → `UserInterviewsSynthesis`.
- [ ] Drag-drop 3 Markdown files (or 3 plain-text transcripts) into the drop zone.
- [ ] Run. Results panel shows:
  - [ ] Themes (collapsible sections)
  - [ ] Killer quotes
  - [ ] Contradictions (in amber)
  - [ ] JTBD framework table
  - [ ] Priority-ranked feature requests

---

## 9. Performance sanity checks (5 min)

- [ ] Typing in the editor is smooth, no lag even with a 10,000-word document.
- [ ] Switching between 5-10 tabs is instant.
- [ ] Streaming response from Claude feels like it's keeping up with the token rate (not batching).
- [ ] Idle memory usage (from Task Manager / Activity Monitor / `top`) is under 500 MB for the Projelli process.
- [ ] Initial indexing of a 100-file workspace completes in under 2 minutes on decent hardware (M1/M2/M3 Mac or modern 8-core laptop).
- [ ] Search (Ctrl+P) responds in under 200 ms with a 500-file workspace.

---

## 10. Edge cases worth a 60-second poke each (5 min)

- [ ] Close and reopen Projelli. Your workspace remembers you. Tabs you had open reopen to the same state.
- [ ] Delete a file outside Projelli (in Finder / Explorer). Projelli's file tree updates within 1-2 seconds (via the notify file watcher).
- [ ] Rename a file outside Projelli. Same, live update.
- [ ] Add a file outside Projelli. Shows up in tree; gets indexed into the RAG automatically within a few seconds.
- [ ] Disconnect your internet. Open a file, edit it, save, close. No errors. AI chat gracefully shows "no internet" if you try a non-Ollama provider. Ollama still works offline.
- [ ] Settings → Export your workspace: zips the whole workspace (optional; may or may not be wired in v1.5).

---

## 11. Cleanup + regression check

- [ ] Close Projelli.
- [ ] Reopen. State loads correctly. No crash.
- [ ] Open the settings backup (Settings → Export Settings → JSON). Inspect. Values look reasonable.

---

## If anything failed

Note the failure against the checkbox, then copy this template into a GitHub issue at `github.com/projelli/projelli/issues`:

```
**Build:** v1.5-rc.8
**Platform:** [Win 11 / Mac Sonoma ARM / Ubuntu 22.04 / etc.]
**Step that failed:** Section X, step "[exact text]"
**Expected:** [what should happen]
**Actual:** [what happened]
**Logs / screenshots:** [if any]
```

Tag with `v1.5-blocker` if the bug is something that would embarrass you in front of a paying customer, otherwise `v1.5.1-followup`.

---

## The 15-minute critical-path version

If you don't have 45 minutes:

1. Install (5 min), sections 1 + 2
2. Flag 1 memory `@workspace` query → citation click (2 min), section 4
3. Flag 3 Canvas inline edit → accept one hunk (2 min), section 6
4. Q3 cost chip visible (30 sec), section 3 Q3
5. Q12 smart paste URL (30 sec), section 3 Q12
6. Close + reopen, state persists (30 sec), section 11

These six cover the demo moments you'd screenshot for Product Hunt. If they work, you can ship with confidence that the 4 flag story holds. The rest of the checklist just increases confidence that nothing obscure is broken.

---

*Checklist generated 2026-04-17 night run. Update after your pass with any steps that were unclear or missing.*
