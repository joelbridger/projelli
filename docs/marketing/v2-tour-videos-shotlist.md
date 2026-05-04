# v2.0 Tour Videos: Shot List for Jameson to Record

These are the 5 remaining v2.0 tour videos that need a real Mac screen recording. Two of the seven planned videos shipped already (web demo at `try-in-browser-v1.mp4` and the plugin runner sandbox harness at `plugin-spike-harness-v1.mp4`); both were captured headless with Playwright. The five below need real visual fidelity (drag-and-drop, audio playback, language-switch animation), which is much easier to film on the real desktop than to script.

## What good looks like

- Mute the recording. The whole tour page is captioned in copy, no narration needed.
- Aim for **20 to 35 seconds** per clip. The shortest existing clip is 12 seconds; the longest is 51. Most live around 25.
- Real screen recording with the **app window cropped tight**, no Mac menu bar, no Dock, no other windows. The existing v3 tour videos run at **1808 by 1032** but anything in the **1280 by 800 to 1920 by 1200** range works. Final ffmpeg pass will resize.
- Move the cursor deliberately. Pause for half a second on each thing you click so the viewer's eye can keep up.
- Use the **real Anthropic key** that lives in the local Settings, not BYOK or demo. Real responses are short and reproducible.
- Drop the resulting `.mov` or `.mp4` in `~/projelli/website/press-kit/assets/`. I'll convert to web-friendly H.264 and generate a poster the same way the existing v3 videos were post-processed.
- Filename pattern: `<feature>-v1.mp4` plus `<feature>-v1-poster.jpg`. Same as the two videos I just shipped.

## Voice rules for any captions or on-screen text

- First-person singular when it sounds natural. Contractions everywhere.
- No em dashes. Use commas or rewrite.
- No "leverage", "delve", "seamless", "transform", "empower", "elevate", "unlock".
- One short sentence is better than a tagline + clarifier.

---

## Video 1: Image attachment to chat

**Filename:** `images-in-chat-v1.mp4` plus `images-in-chat-v1-poster.jpg`

**Suggested tour-page title:** Drop an image into AI chat

**Duration target:** 25 seconds

**Aspect ratio:** 1808 by 1032 (or 1920 by 1200 cropped down)

**Setup checklist before clicking record:**
- [ ] Real Anthropic key already pasted in Settings, API Keys
- [ ] Pick an image with obvious content. Suggestion: a screenshot of a dashboard mockup or a real product label. PNG, around 800 by 600. Save to `~/Desktop/demo-image.png`.
- [ ] Open Projelli with a clean workspace (or `test-workspace`) and AI Assistant pane visible on the left
- [ ] Start a new Claude chat (Sonnet 4.6 model). Empty messages.
- [ ] Welcome onboarding dialogs dismissed

**Shot list:**

1. **0 to 3s.** Workspace open, AI chat panel visible with empty Claude chat. Cursor sits over the chat input.
2. **3 to 8s.** Drag `demo-image.png` from Finder (or a folder window already open in frame) into the chat input area. Drop indicator highlights the drop zone. The image preview chip appears above the textarea.
3. **8 to 13s.** Click into the textarea. Type: "What's wrong with the alignment in this mockup?" (or whatever fits the image). Send.
4. **13 to 22s.** Real Claude response streams in. It will mention specific visual details from the image, which proves the model actually saw it.
5. **22 to 25s.** Hold on the final response so the viewer can read it.

**On-screen text (none required.)** The tour page caption will say: "Paperclip, paste, or drag-drop an image into chat. Claude, GPT, Gemini, and Ollama vision models all handle it."

**Crop / framing notes:**
- App window only. No Mac menu bar. No Dock.
- If you need a Finder window in frame for the drag, pre-position it at the right edge so it cleanly leaves once the file is dropped.

---

## Video 2: PDF chat

**Filename:** `pdf-chat-v1.mp4` plus `pdf-chat-v1-poster.jpg`

**Suggested tour-page title:** Drop a PDF, ask it anything

**Duration target:** 30 seconds

**Aspect ratio:** 1808 by 1032

**Setup checklist before clicking record:**
- [ ] Real Anthropic key in Settings
- [ ] Pick a PDF with real signal: a research paper abstract, a one-page contract, a pricing sheet. **Avoid scanned PDFs.** Around 5 to 15 pages is ideal. Save to `~/Desktop/demo.pdf`.
- [ ] Suggestion: the Notion AI pricing teardown (already in the demo workspace as a `.source` file, but for this video use a real public PDF, e.g. the [a16z Markets vs Models report](https://a16z.com)).
- [ ] Empty Claude chat open

**Shot list:**

1. **0 to 3s.** Workspace open, empty chat. Cursor near the chat input.
2. **3 to 8s.** Drag the PDF from Finder into the chat. PDF chip appears above the textarea with the filename and "X pages" badge.
3. **8 to 13s.** Type: "Summarize this in three bullets" (or use your real prompt that fits the PDF). Send.
4. **13 to 25s.** Real response streams in: three bullets that match the PDF.
5. **25 to 30s.** Hold so the bullets are readable.

**On-screen text (none required.)** Tour-page caption: "Drop a PDF into chat or toggle Include PDFs in workspace index so every PDF in your folder becomes searchable AI context."

**Optional follow-up shot (if you have time):** After the summary, ask a second question like "Which of these is most likely to be wrong?" so the viewer sees follow-up Q+A, not just summarization.

**Crop / framing notes:** Same as Video 1.

---

## Video 3: Plugin install + use

**Filename:** `plugin-install-v1.mp4` plus `plugin-install-v1-poster.jpg`

**Suggested tour-page title:** Install a plugin, use it on a selection

**Duration target:** 35 seconds (this one's the longest because it has more steps)

**Aspect ratio:** 1808 by 1032

**Setup checklist before clicking record:**
- [ ] Real Anthropic key (Translator plugin uses it)
- [ ] Translator plugin is **NOT** installed yet. If it is, uninstall via Settings, Plugins.
- [ ] Open a Markdown file with at least one paragraph of plain English text. The Roadmap Q3 file in the demo workspace works, or paste a few lines from any blog post.

**Shot list:**

1. **0 to 4s.** Open Settings (gear icon). Click Marketplace, then Plugins.
2. **4 to 10s.** Marketplace lists 4 day-one plugins. Cursor moves to Translator. Click Install.
3. **10 to 14s.** Permission consent dialog appears. Show the six-permission breakdown briefly, then click Approve.
4. **14 to 18s.** Close Settings. Plugin is now loaded; the editor toolbar shows a new Translator button.
5. **18 to 24s.** Select a paragraph of text in the open Markdown file. Click the Translator toolbar button. Pick Spanish from the dropdown.
6. **24 to 32s.** Translation appears inline (or in a sidebar panel, depending on plugin design). Hold so the viewer reads both source and translation.
7. **32 to 35s.** Cursor moves away. End on the translated paragraph in frame.

**On-screen text (none required.)** Tour-page caption: "Settings, Marketplace, Plugins. Sandboxed Web Worker runtime, six-permission consent dialog, four day-one plugins."

**Crop / framing notes:**
- The permission consent dialog is the most important moment for skeptical viewers. Hold on it for at least one full second; don't blink past it.
- If the toolbar button isn't visually obvious, mouse over it briefly to show a tooltip before clicking.

---

## Video 4: Read aloud

**Filename:** `read-aloud-v1.mp4` plus `read-aloud-v1-poster.jpg`

**Suggested tour-page title:** Click play, hear the AI message

**Duration target:** 22 seconds

**Aspect ratio:** 1808 by 1032

**This is the only video in the set that ships WITH audio.** Don't mute the recording. The tour page mutes everything by default, so users have to click play with sound on to hear it. That's fine, the visual still tells the story (waveform animates while playing).

**Setup checklist before clicking record:**
- [ ] Piper sidecar is running (it ships bundled, but verify there's no missing-binary warning in Settings, Read Aloud)
- [ ] Voice is set to a clear English voice (en_US-libritts-high or similar)
- [ ] AI chat with a recent assistant message that's 2 to 4 sentences long. Real or pre-saved doesn't matter. The Naming the product chat in the demo workspace has good ones.
- [ ] System volume up (you'll trim and normalize in post)

**Shot list:**

1. **0 to 3s.** Chat panel open, assistant message in frame. Cursor moves up to the message.
2. **3 to 6s.** Hover over the assistant message. The action toolbar appears (copy, regenerate, read aloud).
3. **6 to 9s.** Click Read aloud. A small play indicator or waveform appears next to the message.
4. **9 to 18s.** Audio plays. The waveform animates. Voice is clearly audible. The assistant message text stays on screen.
5. **18 to 22s.** Audio finishes naturally. Hold one beat. End.

**Audio post-processing notes:**
- Normalize to -16 LUFS (standard for spoken content on the web)
- Trim any silence at start and end
- Add a fade-in over the first 100 ms

**On-screen text (none required.)** Tour-page caption: "Click Read aloud on any AI message. Local Piper sidecar, no cloud."

**Crop / framing notes:**
- The action toolbar is the visual center. Crop tight around the chat message and toolbar.
- If the waveform isn't visually striking enough, the audio carries the demo. Don't oversell the visual.

---

## Video 5: Spanish and German switch

**Filename:** `language-switch-v1.mp4` plus `language-switch-v1-poster.jpg`

**Suggested tour-page title:** Switch the UI to Spanish or German

**Duration target:** 25 seconds

**Aspect ratio:** 1808 by 1032

**Setup checklist before clicking record:**
- [ ] App in English to start
- [ ] Workspace with visible chrome: file tree, editor with at least one tab, AI chat. The labels you'll see translate are sidebar items (Files, Search, Workflows, AI Assistant), buttons (Save, Download, Export), settings categories.
- [ ] Settings dialog ready to open

**Shot list:**

1. **0 to 4s.** App in English. Sidebar visible with Files, Search, Workflows, AI Assistant. Hold so the English baseline registers.
2. **4 to 8s.** Open Settings. Click General, then Language.
3. **8 to 11s.** Dropdown opens, showing English, Spanish, German. Click Spanish.
4. **11 to 16s.** UI translates. Settings dialog stays open and re-renders in Spanish (Configuración, Idioma, etc). Sidebar in the background also switches.
5. **16 to 19s.** Click Language dropdown again. Click German.
6. **19 to 24s.** UI re-renders in German (Einstellungen, Sprache, Dateien). Hold so the viewer sees the third state.
7. **24 to 25s.** End frame: Settings still open in German.

**On-screen text (none required.)** Tour-page caption: "Full UI translation. Auto-detects on first launch. Switch any time in Settings, General, Language."

**Crop / framing notes:**
- Crop so both the Settings modal AND the sidebar are visible. The sidebar translation is the prettiest payoff because it's farthest from where you click.
- If the modal sits center-screen and obscures the sidebar, drag it to the right or left before recording so both are visible.

---

## After you film all five

Drop the raw `.mov` or `.mp4` files in `~/projelli/website/press-kit/assets/` and ping me. I'll:

1. Convert to web-friendly H.264 with the same ffmpeg flags I used for the first two: `ffmpeg -i raw.mov -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p -movflags +faststart -an out.mp4` (drop `-an` for the read-aloud video so audio is preserved)
2. Generate a poster JPG from the most representative frame
3. Insert each new video card into the tour page with the right number badge, caption, and meta
4. Update the v2.0 callout grid to remove the cards that now have videos
5. Update header copy and meta description for the new total
6. Deploy to projelli.com

If you want to film in a different order, no problem; I'll wire them in as they arrive.
