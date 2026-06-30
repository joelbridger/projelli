# AI Chat (Ask) + Search + Command Palette + Keyboard Shortcuts

Covers the full conversational AI surface (AIChatViewer + sidebar Ask), workspace RAG retrieval, provider/model picker, attachments/vision, compression, cost tracking, artifact save, the four Ask scope modes, full-text and fuzzy-file search, the command palette, and every registered global keyboard shortcut.

> Note: "11 modes" in the ticket brief refers to Career Coach, not Advisor Prep Hero. Advisor Prep Hero's Ask surface has 4 retrieval scopes (This matter / All matters / Email / Documents). These are catalogued as CHAT-06.

---

## AI Chat — Core Send / Receive

| Field | CHAT-01 |
|---|---|
| **ID** | CHAT-01 |
| **Persona** | any |
| **Story** | As any user I want to open a new AI chat tab so that I can start a conversation with my AI provider. |
| **Steps** | Press Ctrl+Shift+A (or open command palette → "Open AI Assistant") → a new `.aichat` tab opens in the main panel. |
| **Surface** | `AIChatViewer.tsx` · `data-testid="ai-chat-viewer"` · opened via `openAIAssistantTab()` in `useKeyboardShortcuts.ts` |
| **Precondition** | App loaded; workspace open. |
| **Expected** | AI chat viewer renders with input area, model picker, export button, and Ask-workspace toggle. |
| **Layer** | L1 |
| **Risk** | M |
| **Covered?** | `tests/e2e/ai-assistant-tab.spec.ts`, `tests/e2e/ai-assistant.spec.ts` |

| Field | CHAT-02 |
|---|---|
| **ID** | CHAT-02 |
| **Persona** | any |
| **Story** | As any user I want to type a message and send it so that I get an AI response. |
| **Steps** | Click `data-testid="chat-input"` → type message → press Enter (or click Send button). |
| **Surface** | `AIChatViewer.tsx` · `data-testid="chat-input"`, `data-testid="chat-send-button"` |
| **Precondition** | Valid API key configured; provider seeded on new chat. |
| **Expected** | User bubble appears; loading indicator shows; assistant response streams in. |
| **Layer** | L1 |
| **Risk** | H — primary chat send path |
| **Covered?** | `tests/e2e/ai-chat.spec.ts` (partial — draft/title tests; no live-send in L1) |

| Field | CHAT-03 |
|---|---|
| **ID** | CHAT-03 |
| **Persona** | any |
| **Story** | As any user I want to see streaming tokens appear in real time and be able to stop mid-stream so that I can interrupt long responses. |
| **Steps** | Send a message → observe token-by-token text accumulation → click `data-testid="chat-stop-button"`. |
| **Surface** | `AIChatViewer.tsx` · `data-testid="chat-loading-indicator"`, `data-testid="chat-stop-button"` · `useChatSending.ts` `AbortController` |
| **Precondition** | Valid key; browser dev server (streaming disabled in Tauri prod builds). |
| **Expected** | Tokens appear progressively; Stop truncates with "*(Response stopped by user)*"; no error bubble. |
| **Layer** | L1 |
| **Risk** | M |
| **Covered?** | NONE — no spec asserts streaming chunk behaviour or Stop cancellation |

| Field | CHAT-04 |
|---|---|
| **ID** | CHAT-04 |
| **Persona** | any |
| **Story** | As any user I want multi-turn context preserved across messages so that the AI remembers what was said earlier in the conversation. |
| **Steps** | Send message A → receive reply → send message B referencing A → receive reply that shows memory of A. |
| **Surface** | `useChatSending.ts` — `conversationContext` built from prior messages; `aiChatStore` session |
| **Precondition** | Valid key; at least two prior turns. |
| **Expected** | System prompt includes conversation history; reply is coherent with prior turns. |
| **Layer** | L1 |
| **Risk** | M |
| **Covered?** | NONE |

| Field | CHAT-05 |
|---|---|
| **ID** | CHAT-05 |
| **Persona** | any |
| **Story** | As any user I want my draft input preserved if I navigate away so that I do not lose a partially typed message. |
| **Steps** | Type in chat input → navigate to another panel → return to chat. |
| **Surface** | `AIChatViewer.tsx` — 300 ms debounce to `setDraftInput`; `aiChatStore` persisted via zustand-persist |
| **Precondition** | Chat session exists. |
| **Expected** | Draft text is still present in the input on return. |
| **Layer** | L1 |
| **Risk** | L |
| **Covered?** | `tests/e2e/ai-chat.spec.ts` (localStorage seed test — indirect) |

---

## AI Chat — Provider / Model Picker

| Field | CHAT-06 |
|---|---|
| **ID** | CHAT-06 |
| **Persona** | any |
| **Story** | As any user I want to choose which AI provider and model handles my next message so that I can switch between Anthropic, OpenAI, Gemini, and local Ollama. |
| **Steps** | Click `data-testid="chat-model-picker"` dropdown → select provider section → click a model item `data-testid="chat-model-option-{p}-{m}"`. |
| **Surface** | `ChatModelPicker.tsx` · `data-testid="chat-model-picker"` |
| **Precondition** | At least one valid API key stored; or Ollama daemon running. |
| **Expected** | Picker trigger label updates to "Provider · model"; next send uses the selected provider. |
| **Layer** | L1 |
| **Risk** | H — wrong provider selection could send to wrong cloud endpoint |
| **Covered?** | `tests/unit/chat-model-picker.test.tsx` |

| Field | CHAT-07 |
|---|---|
| **ID** | CHAT-07 |
| **Persona** | solo |
| **Story** | As a solo user in local-only confidentiality mode I want cloud providers hidden from the picker so that I cannot accidentally route matter data to the cloud. |
| **Steps** | Settings → Confidentiality → "On this computer only" → open ChatModelPicker. |
| **Surface** | `ChatModelPicker.tsx` · `useConfidentialityMode` · `data-testid="chat-model-picker-empty"` when no local model |
| **Precondition** | local-only mode set in settings. |
| **Expected** | Only Ollama (if reachable) appears; Anthropic/OpenAI/Google sections absent. |
| **Layer** | L1 |
| **Risk** | H — confidentiality guarantee |
| **Covered?** | `tests/unit/chat-model-picker.test.tsx` (partial) |

---

## AI Chat — Workspace Retrieval (RAG / Ask-my-workspace)

| Field | CHAT-08 |
|---|---|
| **ID** | CHAT-08 |
| **Persona** | any |
| **Story** | As any user I want to toggle "Ask my workspace" so that the AI grounds its answer in my indexed documents. |
| **Steps** | Click `data-testid="ask-workspace-toggle"` to enable (highlighted) → send a question. |
| **Surface** | `AIChatViewer.tsx` · `data-testid="ask-workspace-toggle"` · `MemoryService.retrieve()` in `useChatSending.ts` |
| **Precondition** | Workspace indexed (requires Tauri native index = L2); toggle readable in L1. |
| **Expected** | On L2: retrieved chunks injected into system prompt; sources accordion appears below answer. |
| **Layer** | L2 |
| **Risk** | H — RAG grounding is the core trust feature |
| **Covered?** | `tests/unit/ask-workspace-mode.test.tsx` (store wiring); no L2 retrieval integration test |

| Field | CHAT-09 |
|---|---|
| **ID** | CHAT-09 |
| **Persona** | any |
| **Story** | As any user I want to use the `@workspace` command inline so that I can trigger a retrieval-grounded answer without flipping the global toggle. |
| **Steps** | Type `@workspace what is the deposition schedule?` in chat input → send. |
| **Surface** | `useChatSending.ts` → `parseWorkspaceCommand()` → `MemoryService.retrieve()` |
| **Precondition** | Workspace indexed (L2). |
| **Expected** | `parsed.hasCommand = true`; retrieval runs; answer cites workspace files. |
| **Layer** | L2 |
| **Risk** | H |
| **Covered?** | `tests/unit/workspace-command.test.ts` (parse logic only) |

| Field | CHAT-10 |
|---|---|
| **ID** | CHAT-10 |
| **Persona** | any |
| **Story** | As any user I want the AI to refuse to answer (not silently hallucinate) when retrieval fails while Ask-my-workspace is on, so that I never get an ungrounded confident-looking response (Avianca guard). |
| **Steps** | Enable ask-workspace-toggle; force retrieval failure (L2: stop native index) → send question. |
| **Surface** | `useChatSending.ts` — retrieval-failed guard; `refusalKeyForReason()` |
| **Precondition** | Workspace mode ON; retrieval throws. |
| **Expected** | Assistant bubble shows refusal text (not a hallucinated answer); no provider call made. |
| **Layer** | L2 |
| **Risk** | H — safety-critical |
| **Covered?** | `tests/unit/chat/retrieval-failed-refuse.test.tsx`, `tests/unit/refusal-key.test.ts` |

| Field | CHAT-11 |
|---|---|
| **ID** | CHAT-11 |
| **Persona** | any |
| **Story** | As any user I want to see citation chips in the AI's answer and click them to open the source file at the cited paragraph, so that I can verify every claim. |
| **Steps** | Receive workspace-grounded answer with `{1}` citation chips → click chip → editor opens source file at paragraph. |
| **Surface** | `renderingHelpers.tsx` → `CitationText.tsx` · `data-testid="ask-citation-chip-{n}"` · `handleCitationClick` → `onOpenFileAtPath` |
| **Precondition** | Ask-workspace ON; retrieval returned sources; answer contains citation markers. |
| **Expected** | Chip renders; click fires `onOpenFileAtPath(path, paragraphIndex, snippet)`; source file opens in editor. |
| **Layer** | L2 |
| **Risk** | H — citation navigation is core trust feature |
| **Covered?** | `tests/unit/citation-navigation.test.tsx`, `tests/e2e/citation-persistence.spec.ts` |

| Field | CHAT-12 |
|---|---|
| **ID** | CHAT-12 |
| **Persona** | any |
| **Story** | As any user I want the Sources accordion to open and show all chunks retrieved for an answer so that I can browse beyond inline citations. |
| **Steps** | Receive answer with workspace sources → click `data-testid="chat-sources-toggle"` → see source list. |
| **Surface** | `ChatSourcesAccordion.tsx` · `data-testid="chat-sources-accordion"`, `data-testid="chat-sources-toggle"` |
| **Precondition** | Answer has `msg.sources.length > 0`. |
| **Expected** | Accordion expands; each source row shows file name + snippet; click opens file. |
| **Layer** | L1 |
| **Risk** | M |
| **Covered?** | `tests/unit/accordion-a11y.test.tsx` (a11y only) |

---

## AI Chat — Privilege / Matter Scope

| Field | CHAT-13 |
|---|---|
| **ID** | CHAT-13 |
| **Persona** | any |
| **Story** | As any user I want to scope retrieval to the active matter so that answers never mix another client's documents. |
| **Steps** | Activate a matter → open AI chat → Ask-workspace ON → send question. |
| **Surface** | `AIChatViewer.tsx` → `MatterScopeSelector` · `activeMatter` → `RetrievalScope {kind:'matter'}` in `useChatSending.ts` |
| **Precondition** | Matter created and indexed (L2). |
| **Expected** | Only chunks from the active matter returned; scope badge `data-testid="chat-message-{i}-scope"` shows matter name. |
| **Layer** | L2 |
| **Risk** | H — ethical wall / cross-matter contamination |
| **Covered?** | `tests/unit/matter-chat-scope.test.tsx` (unit); no L2 integration test |

| Field | CHAT-14 |
|---|---|
| **ID** | CHAT-14 |
| **Persona** | any |
| **Story** | As any user I want to explicitly include privileged sources so that when I deliberately need them, I can opt in. |
| **Steps** | Ask-workspace ON → click `data-testid="include-privileged-toggle"` (turns rose/amber) → send question. |
| **Surface** | `AIChatViewer.tsx` · `data-testid="include-privileged-toggle"` · `usePrivilegeStore` → `includePrivileged` passed to `MemoryService.retrieve()` |
| **Precondition** | Workspace has privileged-tagged chunks; matter active (L2). |
| **Expected** | Toggle shows "Privileged: included"; next retrieval includes privileged content; audit records privilege_evaluated event. |
| **Layer** | L2 |
| **Risk** | H — privilege exclusion is a legal-safety guarantee |
| **Covered?** | `tests/unit/email-privilege-control.test.tsx`; `tests/unit/privilege-explainer.test.tsx` |

| Field | CHAT-15 |
|---|---|
| **ID** | CHAT-15 |
| **Persona** | any |
| **Story** | As any user I want to understand how privilege exclusion works via the explainer so that I can trust the tool's defaults. |
| **Steps** | Ask-workspace ON → click `data-testid="privilege-explainer-trigger"` → dialog opens → click "See it work" demo → view result. |
| **Surface** | `PrivilegeExclusionExplainer.tsx` · `data-testid="privilege-explainer"`, `data-testid="privilege-explainer-demo"`, `data-testid="privilege-explainer-result"` |
| **Precondition** | None (dialog is display-only; demo runs a retrieval if memory on). |
| **Expected** | Dialog explains exclusion; demo runs with current question + scope; result shows whether privileged sources were found. |
| **Layer** | L1 (dialog) / L2 (demo retrieval) |
| **Risk** | L |
| **Covered?** | `tests/unit/privilege-explainer.test.tsx` |

| Field | CHAT-16 |
|---|---|
| **ID** | CHAT-16 |
| **Persona** | any |
| **Story** | As any user I want to scope retrieval to a specific client folder (D1) so that cross-client contamination is impossible even within a matter. |
| **Steps** | Open AI context indicator → click `data-testid="scope-folder-trigger"` → select a client folder. |
| **Surface** | `AIContextIndicator.tsx` · `data-testid="scope-folder-picker"`, `data-testid="scope-folder-trigger"` · `setScopedFolder` in `aiChatStore` |
| **Precondition** | Multiple top-level folders in workspace; open files present. |
| **Expected** | Scope-active banner `data-testid="ai-context-scope-active-banner"` appears; next retrieval filtered to folder; cross-client warning `data-testid="ai-context-cross-client-warning"` dismissed. |
| **Layer** | L1 |
| **Risk** | H — cross-client data leak risk |
| **Covered?** | NONE |

---

## AI Chat — Egress Indicator

| Field | CHAT-17 |
|---|---|
| **ID** | CHAT-17 |
| **Persona** | any |
| **Story** | As any user I want to see where my next message will be sent (local / cloud / assured proxy) before I send it so that I can never accidentally leak matter data. |
| **Steps** | Open chat → observe EgressIndicator above the composer → note destination text. |
| **Surface** | `AIChatViewer.tsx` → `EgressIndicator` · `resolveEgress()` |
| **Precondition** | Provider set on chat. |
| **Expected** | Indicator shows correct destination for the selected provider + confidentiality mode. |
| **Layer** | L1 |
| **Risk** | H — trust/honesty |
| **Covered?** | `tests/unit/privacy/egress.test.tsx` (logic unit); no E2E assertion |

---

## AI Chat — Attachments / Vision

| Field | CHAT-18 |
|---|---|
| **ID** | CHAT-18 |
| **Persona** | any |
| **Story** | As any user I want to attach an image (paperclip, paste, or drag-drop) so that I can ask the AI about visual content. |
| **Steps** | Click `data-testid="chat-paperclip-button"` → select image file (or paste / drag-drop onto composer) → see thumbnail tile → send. |
| **Surface** | `ChatInputToolbar.tsx` · `data-testid="chat-input-toolbar"`, `data-testid="chat-paperclip-button"`, `data-testid="attachment-tiles-strip"` · `AttachmentService` |
| **Precondition** | Vision-capable model selected; file ≤ 20 MB; MIME in SUPPORTED_IMAGE_MIMES. |
| **Expected** | Tile appears with preview; on send, image bytes forwarded to provider; tile `data-testid="attachment-tile-{id}"` visible. |
| **Layer** | L1 |
| **Risk** | H — attachment bytes leave device to provider |
| **Covered?** | `tests/e2e/image-attachment.spec.ts`, `tests/unit/components/chat/ChatInputToolbar.test.tsx` |

| Field | CHAT-19 |
|---|---|
| **ID** | CHAT-19 |
| **Persona** | any |
| **Story** | As any user I want a warning when I attach an image but my model can't see it so that I know to switch models before wasting a send. |
| **Steps** | Attach image → switch to a non-vision model (via ChatModelPicker) → observe warning banner. |
| **Surface** | `AIChatViewer.tsx` `visionWarning` state → `VisionWarningBanner` · `data-testid="vision-warning-banner"` · Send button disabled. |
| **Precondition** | Image attached; non-vision model selected. |
| **Expected** | Warning banner visible; send button disabled; "Switch model" button `data-testid="vision-warning-switch-button"` offered. |
| **Layer** | L1 |
| **Risk** | M |
| **Covered?** | `tests/unit/components/chat/VisionWarningBanner.test.tsx` |

| Field | CHAT-20 |
|---|---|
| **ID** | CHAT-20 |
| **Persona** | any |
| **Story** | As any user I want to attach a PDF so that I can ask questions about its text content. |
| **Steps** | Click paperclip → select PDF → see pre-send preview panel `data-testid="pdf-text-preview"` → send. |
| **Surface** | `AIChatViewer.tsx` + `ChatInputToolbar.tsx` + `PdfPreviewBeforeSend.tsx` · `data-testid="pdf-text-preview"`, `data-testid="pdf-mode-chip"` · `extractPdfText()` |
| **Precondition** | PDF not encrypted; model supports the extraction mode. |
| **Expected** | Preview shows extracted text and page count; mode chip `data-testid="pdf-mode-chip"` shows extraction mode; send attaches PDF text to message. |
| **Layer** | L1 |
| **Risk** | H — PDF text leaves device to provider |
| **Covered?** | `tests/unit/components/chat/PdfPreviewBeforeSend.test.tsx`, `tests/unit/components/chat/PdfModeChip.test.tsx` |

| Field | CHAT-21 |
|---|---|
| **ID** | CHAT-21 |
| **Persona** | any |
| **Story** | As any user I want encrypted PDFs to be blocked at attach time so that I cannot accidentally send unintelligible bytes. |
| **Steps** | Attach a password-protected PDF → observe error message. |
| **Surface** | `AIChatViewer.tsx` `handleFilesSelected` → `extraction.encrypted` → `attachmentError` state · `data-testid="pdf-encrypted-error"` |
| **Precondition** | Encrypted PDF available. |
| **Expected** | Error strip appears: "password-protected. Remove the password and re-attach." No tile created. |
| **Layer** | L1 |
| **Risk** | M |
| **Covered?** | `tests/unit/models/mock-pdf-format.test.ts` (unit); no E2E for the encrypted-block path |

| Field | CHAT-22 |
|---|---|
| **ID** | CHAT-22 |
| **Persona** | any |
| **Story** | As any user I want to remove a pending attachment before sending so that I can change my mind. |
| **Steps** | Add attachment → click `data-testid="attachment-remove-{id}"` X button → tile disappears. |
| **Surface** | `AttachmentTile.tsx` · `data-testid="attachment-remove-{id}"` → `handleRemoveAttachment` |
| **Precondition** | Attachment pending. |
| **Expected** | Tile removed; preview URL revoked; attachment not included in next send. |
| **Layer** | L1 |
| **Risk** | L |
| **Covered?** | NONE |

---

## AI Chat — Voice Input

| Field | CHAT-23 |
|---|---|
| **ID** | CHAT-23 |
| **Persona** | any |
| **Story** | As any user I want to dictate my message with my microphone so that I can ask questions hands-free. |
| **Steps** | Click `data-testid="chat-voice-button"` (mic icon) → speak → click again (stop) → text appears in chat input. |
| **Surface** | `AIChatViewer.tsx` · `data-testid="chat-voice-button"` · `useVoiceRecording` hook |
| **Precondition** | Browser supports Web Speech API; microphone permission granted; trial not locked. |
| **Expected** | Button pulses red during recording; recognized text appended to input on stop. |
| **Layer** | L1 |
| **Risk** | M |
| **Covered?** | `tests/e2e/v1.5-voice-ollama-stress.spec.ts` (stress only — not unit) |

---

## AI Chat — Context Meter & Compression

| Field | CHAT-24 |
|---|---|
| **ID** | CHAT-24 |
| **Persona** | any |
| **Story** | As any user I want to see how much of the context window is used so that I know when I'm approaching the limit. |
| **Steps** | Open a chat with several turns → observe `data-testid="context-meter-bar"` above the input. |
| **Surface** | `ContextMeterBar.tsx` · `data-testid="context-meter-bar"`, `data-testid="context-meter-usage"`, `data-testid="context-meter-warning"` |
| **Precondition** | Session has messages. |
| **Expected** | Bar fills proportional to estimated token usage; warning text appears when > 80% full. |
| **Layer** | L1 |
| **Risk** | L |
| **Covered?** | `tests/unit/components/chat/ContextMeterBar.test.tsx` |

| Field | CHAT-25 |
|---|---|
| **ID** | CHAT-25 |
| **Persona** | any |
| **Story** | As any user I want to manually compress old turns so that I can continue a long conversation without hitting the context limit. |
| **Steps** | Click `data-testid="context-meter-compress-btn"` → compression confirmation modal appears → click Compress. |
| **Surface** | `ContextMeterBar.tsx` → `CompressionConfirmModal.tsx` · `data-testid="compression-confirm-modal"`, `data-testid="modal-compress-btn"` · `handleManualCompress` |
| **Precondition** | Valid API key (cloud only — Ollama cannot compress); multiple turns exist. |
| **Expected** | Modal shows token count; on confirm, older turns replaced by summary; `data-testid="compressed-segment-marker"` appears. |
| **Layer** | L1 |
| **Risk** | H — irreversible destruction of turn history |
| **Covered?** | `tests/unit/chat/compression.test.ts`, `tests/unit/components/chat/CompressedSegmentMarker.test.tsx` |

| Field | CHAT-26 |
|---|---|
| **ID** | CHAT-26 |
| **Persona** | any |
| **Story** | As any user I want to be warned and choose whether to compress or send anyway when I exceed the configured context limit on send, so that I am never silently cut off. |
| **Steps** | Fill chat with many messages → send when `sendTokenEstimate > chatContextTokenLimit` → modal appears → choose Compress or Send Anyway. |
| **Surface** | `useChatSending.ts` context-limit check → `CompressionConfirmModal` · `data-testid="modal-send-anyway-btn"` |
| **Precondition** | Conversation exceeds `chatContextTokenLimit` setting. |
| **Expected** | Modal blocks send; Compress → compresses then re-sends; Send Anyway → sends immediately. |
| **Layer** | L1 |
| **Risk** | H — token overflow can truncate message silently at provider |
| **Covered?** | NONE (modal is tested in isolation; the send-path trigger is not) |

---

## AI Chat — Cost Tracking

| Field | CHAT-27 |
|---|---|
| **ID** | CHAT-27 |
| **Persona** | any |
| **Story** | As any user I want to see the per-chat and today's total AI cost so that I can manage my API spend. |
| **Steps** | Send messages → observe `data-testid="chat-cost-chip"` showing "X this chat / Y today". |
| **Surface** | `ChatCostChip.tsx` · `data-testid="chat-cost-chip"`, `data-testid="chat-cost-chip-today"` · `recordCost` in `aiChatStore` |
| **Precondition** | At least one completed turn (tokens + cost recorded). |
| **Expected** | Chip shows running totals; hover shows `data-testid="chat-cost-chip-tooltip"` with per-provider breakdown. |
| **Layer** | L1 |
| **Risk** | M |
| **Covered?** | `tests/unit/chat-cost-aggregation.test.ts`, `tests/unit/cost-period-hooks.test.ts` |

---

## AI Chat — Save / Export / Facts

| Field | CHAT-28 |
|---|---|
| **ID** | CHAT-28 |
| **Persona** | any |
| **Story** | As any user I want to export the full chat as Markdown so that I can share or archive a conversation outside the app. |
| **Steps** | Click `data-testid="chat-export-button"` → browser downloads `{title}.md`. |
| **Surface** | `AIChatViewer.tsx` · `data-testid="chat-export-button"` → `chatToMarkdown()` |
| **Precondition** | Chat has at least one message. |
| **Expected** | `.md` file downloaded with all turns formatted. |
| **Layer** | L1 |
| **Risk** | L |
| **Covered?** | NONE |

| Field | CHAT-29 |
|---|---|
| **ID** | CHAT-29 |
| **Persona** | any |
| **Story** | As any user I want to drag an AI response to the file tree to save it as a new file so that AI-generated content becomes a persistent workspace document. |
| **Steps** | Hover assistant message → grab `data-testid="ai-message-drag-handle-{i}"` → drag to file tree folder → file created. |
| **Surface** | `AIChatViewer.tsx` · `data-testid="ai-message-drag-handle-{i}"` · `dataTransfer.setData('application/x-keepance-chat-message', ...)` |
| **Precondition** | At least one non-error assistant message; workspace open. |
| **Expected** | Drop creates new file with message content; file tree updates. |
| **Layer** | L1 |
| **Risk** | M |
| **Covered?** | `tests/e2e/ai-message-drag-drop.spec.ts` |

| Field | CHAT-30 |
|---|---|
| **ID** | CHAT-30 |
| **Persona** | any |
| **Story** | As any user I want the AI to propose facts extracted from the conversation for me to approve/edit/reject so that I can build a durable memory about my matters. |
| **Steps** | Hold an N-turn conversation (every 5 turns triggers extraction) → see `data-testid="proposed-facts-panel"` appear → click Accept / Edit / Reject chips. |
| **Surface** | `ProposedFactsPanel.tsx` · `data-testid="proposed-facts-panel"`, `data-testid="proposed-fact-chip-{key}"`, `data-testid="fact-accept-{key}"`, `data-testid="fact-reject-{key}"` · `factsExtraction.ts` |
| **Precondition** | Valid key; ≥ 5 turns completed; FactsService writable (L2 for persistent store). |
| **Expected** | Chips appear; Accept saves fact with `approved_by:'user'`; Edit modifies text before save; Reject discards. |
| **Layer** | L2 |
| **Risk** | M |
| **Covered?** | `tests/unit/facts-service.test.ts` (service); no E2E for the panel interaction |

---

## AI Chat — Error Handling

| Field | CHAT-31 |
|---|---|
| **ID** | CHAT-31 |
| **Persona** | any |
| **Story** | As any user I want to retry the last message after an error without retyping it so that transient failures don't cost me work. |
| **Steps** | Receive error bubble (last message is error) → click "Retry last message" link below the bubble. |
| **Surface** | `AIChatViewer.tsx` — retry button rendered when `msg.isError && idx === messages.length - 1` |
| **Precondition** | Last message is an error. |
| **Expected** | Previous user message re-populated in input; send fires automatically. |
| **Layer** | L1 |
| **Risk** | M |
| **Covered?** | NONE |

| Field | CHAT-32 |
|---|---|
| **ID** | CHAT-32 |
| **Persona** | any |
| **Story** | As any user I want to copy diagnostic info on a parse error so that I can report a provider bug. |
| **Steps** | Receive ApiResponseParseError bubble → click "Copy diagnostic info". |
| **Surface** | `AIChatViewer.tsx` — `msg.errorDiagnostic` → clipboard write |
| **Precondition** | `ApiResponseParseError` thrown (Tauri production HTTP plugin bug path). |
| **Expected** | Diagnostic JSON copied to clipboard; button briefly shows "✓ Copied". |
| **Layer** | L4 |
| **Risk** | L |
| **Covered?** | NONE |

---

## Ask — Sidebar Cited-Ask Surface

| Field | CHAT-33 |
|---|---|
| **ID** | CHAT-33 |
| **Persona** | any |
| **Story** | As any user I want to ask a question in the Ask panel and see a cited answer scoped to my workspace data so that I can find information without losing my place. |
| **Steps** | Open Ask panel → type in `data-testid="ask-composer-input"` → press Enter → see TurnBlock with citations. |
| **Surface** | `Ask.tsx` + `useAsk.ts` · `data-testid="ask-composer-input"` · `TurnBlock.tsx` → `data-testid="ask-cited-attestation"` |
| **Precondition** | Memory enabled; workspace indexed (L2). |
| **Expected** | Answer appears with `{n}` citation chips; attestation badge shows "Based on your workspace". |
| **Layer** | L2 |
| **Risk** | H |
| **Covered?** | `tests/unit/reimagined-ask.test.tsx` (component smoke) |

| Field | CHAT-34 |
|---|---|
| **ID** | CHAT-34 |
| **Persona** | any |
| **Story** | As any user I want to switch the Ask scope between This matter / All matters / Email / Documents so that I can find information in the right slice. |
| **Steps** | Click `data-testid="scope-option-this-matter"` / `scope-option-all-matters"` / `scope-option-email"` / `scope-option-documents"`. |
| **Surface** | `ScopeToggle.tsx` · `data-testid="scope-toggle"`, `data-testid="scope-option-{value}"` · `useAsk.ts` `askScope` state |
| **Precondition** | Matter active (for this-matter option); email indexed (for email option, L2). |
| **Expected** | Active chip highlighted; next ask uses filtered scope. |
| **Layer** | L1 (UI) / L2 (email + semantic retrieval) |
| **Risk** | H — wrong scope = cross-matter contamination |
| **Covered?** | NONE |

| Field | CHAT-35 |
|---|---|
| **ID** | CHAT-35 |
| **Persona** | any |
| **Story** | As any user I want to save an Ask answer to a workspace document so that it becomes a persistent artifact. |
| **Steps** | Receive answer in Ask → click Save-to-document button on TurnBlock → new document created. |
| **Surface** | `Ask.tsx` `handleSaveToDocument` → `onSaveToDocument` callback → workspace write |
| **Precondition** | Workspace open and writable. |
| **Expected** | New document created containing turn content; file tree updates. |
| **Layer** | L1 |
| **Risk** | M |
| **Covered?** | NONE |

| Field | CHAT-36 |
|---|---|
| **ID** | CHAT-36 |
| **Persona** | any |
| **Story** | As any user I want to load a previous Ask session in the same matter so that I can continue an earlier conversation. |
| **Steps** | Open Ask panel → see recent session list `data-testid="matter-session-item"` → click one. |
| **Surface** | `Ask.tsx` · `data-testid="recent-in-matter"`, `data-testid="matter-session-item"` · `handleLoadSession` |
| **Precondition** | Prior sessions exist for this matter. |
| **Expected** | Previous turns loaded into TurnBlock list; composer ready for new input. |
| **Layer** | L1 |
| **Risk** | L |
| **Covered?** | NONE |

---

## Search — Full-text (MiniSearch / ContentIndex)

| Field | SRCH-01 |
|---|---|
| **ID** | SRCH-01 |
| **Persona** | any |
| **Story** | As any user I want to type a query in the Search panel and see workspace files matching by content so that I can find documents without knowing their names. |
| **Steps** | Click Ctrl+2 (or sidebar search icon) → type query in search field → results appear with snippets. |
| **Surface** | Search panel (`platform/search/ContentIndex.ts` + `platform/hooks/useContentIndex.ts`) · sidebar tab |
| **Precondition** | Workspace open; files indexed in MiniSearch. |
| **Expected** | Results list with file titles + content snippets; title hits scored higher; fielded search `title:foo` supported. |
| **Layer** | L1 |
| **Risk** | M |
| **Covered?** | `tests/e2e/search-content.spec.ts`, `tests/unit/content-index.test.ts` |

| Field | SRCH-02 |
|---|---|
| **ID** | SRCH-02 |
| **Persona** | any |
| **Story** | As any user I want to click a search result to open the file at the matched location so that I land in the right place. |
| **Steps** | Search → click a result card → file opens in editor. |
| **Surface** | Search panel result click → `handleFileOpen` |
| **Precondition** | Search returned results. |
| **Expected** | File opens in editor tab; editor focuses the matched snippet if possible. |
| **Layer** | L1 |
| **Risk** | M |
| **Covered?** | `tests/e2e/search-content.spec.ts` (partial) |

---

## Search — Quick-Open (Fuzzy File Switcher)

| Field | SRCH-03 |
|---|---|
| **ID** | SRCH-03 |
| **Persona** | any |
| **Story** | As any user I want to press Ctrl+P and type part of a file name to open any workspace file instantly so that I can navigate without the file tree. |
| **Steps** | Press Ctrl+P → modal opens → type partial name → arrow-key navigate or click result → file opens. |
| **Surface** | `QuickOpen.tsx` · `data-testid="quick-open-modal"`, `data-testid="quick-open-search"`, `data-testid="quick-open-result-{i}"` |
| **Precondition** | Workspace open; file tree populated. |
| **Expected** | Fuse.js fuzzy matches shown; Enter opens highlighted file; recents shown when input empty; Esc closes. |
| **Layer** | L1 |
| **Risk** | L |
| **Covered?** | `tests/e2e/quick-open.spec.ts` |

| Field | SRCH-04 |
|---|---|
| **ID** | SRCH-04 |
| **Persona** | any |
| **Story** | As any user I want recently opened files shown when Quick-open is empty so that I can re-visit frequent files with one keystroke. |
| **Steps** | Open files → press Ctrl+P → without typing, see recent files list. |
| **Surface** | `QuickOpen.tsx` — `loadRecents()` from `localStorage:quickopen:recents` · clock icon header |
| **Precondition** | Files previously opened. |
| **Expected** | "Recent" section header visible; up to 10 recent files listed in order; still-existing files only. |
| **Layer** | L1 |
| **Risk** | L |
| **Covered?** | `tests/e2e/quick-open.spec.ts` (partial) |

---

## Search — Semantic / RAG (LanceDB)

| Field | SRCH-05 |
|---|---|
| **ID** | SRCH-05 |
| **Persona** | any |
| **Story** | As any user I want the AI to semantically retrieve relevant workspace chunks so that questions not matching exact keywords still get relevant context. |
| **Steps** | Enable Ask-workspace → ask a paraphrased question → see sources that don't share exact keywords with the query. |
| **Surface** | `MemoryService.retrieve()` → LanceDB native Tauri command → `workspaceCommand.ts` `buildWorkspaceContextBlock()` |
| **Precondition** | Workspace indexed in LanceDB (Tauri, L2); fastembed model downloaded. |
| **Expected** | Semantically similar chunks returned even without exact keyword match. |
| **Layer** | L2 |
| **Risk** | H — index must exist and not be stale |
| **Covered?** | NONE (integration) |

---

## Command Palette

| Field | CMD-01 |
|---|---|
| **ID** | CMD-01 |
| **Persona** | any |
| **Story** | As any user I want to press Ctrl+K or Ctrl+Shift+P to open the command palette and run any action by name so that I don't need to memorize every UI location. |
| **Steps** | Press Ctrl+K → `data-testid="command-palette-dialog"` opens → type query → arrow navigate → Enter executes. |
| **Surface** | `CommandPalette.tsx` · `data-testid="command-palette-dialog"` · `useKeyboardShortcuts.ts` |
| **Precondition** | None. |
| **Expected** | Dialog opens with search input focused; commands filtered and sorted by relevance; recent commands shown when empty. |
| **Layer** | L1 |
| **Risk** | M |
| **Covered?** | `tests/e2e/command-palette.spec.ts` (a11y only) · `tests/campaign/sweep/shortcuts.spec.ts` |

| Field | CMD-02 |
|---|---|
| **ID** | CMD-02 |
| **Persona** | any |
| **Story** | As any user I want to execute "Open AI Assistant" from the command palette so that I can open chat without knowing the keyboard shortcut. |
| **Steps** | Ctrl+K → type "AI" → select "Open AI Assistant" → AI chat tab opens. |
| **Surface** | `useAppCommands.ts` command `view.aiAssistant` · shortcut `Ctrl+Shift+A` shown in palette |
| **Precondition** | None. |
| **Expected** | AI assistant tab opens in main panel. |
| **Layer** | L1 |
| **Risk** | M |
| **Covered?** | NONE |

| Field | CMD-03 |
|---|---|
| **ID** | CMD-03 |
| **Persona** | any |
| **Story** | As any user I want to execute "Change Workspace" from the command palette so that I can switch workspaces without navigating the settings modal. |
| **Steps** | Ctrl+K → type "workspace" → "Change Workspace" → workspace selector opens. |
| **Surface** | `useAppCommands.ts` command `workspace.change` |
| **Precondition** | None. |
| **Expected** | Workspace selector dialog shown. |
| **Layer** | L1 |
| **Risk** | L |
| **Covered?** | NONE |

| Field | CMD-04 |
|---|---|
| **ID** | CMD-04 |
| **Persona** | any |
| **Story** | As any user I want to execute "Open Browser Tab" from the command palette so that I can open an in-app browser without leaving the app. |
| **Steps** | Ctrl+K → type "browser" → "Open Browser Tab" → URL prompt → enter URL → browser tab opens. |
| **Surface** | `useAppCommands.ts` command `browser.open` → `prompt()` dialog → `handleOpenBrowserTab` |
| **Precondition** | None. |
| **Expected** | Prompt dialog accepts URL; browser tab opens in main panel. |
| **Layer** | L1 |
| **Risk** | L |
| **Covered?** | NONE |

| Field | CMD-05 |
|---|---|
| **ID** | CMD-05 |
| **Persona** | any |
| **Story** | As any user I want recently used commands shown at the top of the palette so that I can re-run frequent actions faster. |
| **Steps** | Execute any command → re-open Ctrl+K with empty query → see that command at top. |
| **Surface** | `CommandPalette.tsx` `recentCommands` prop; `onExecute` callback stores IDs |
| **Precondition** | At least one command previously executed. |
| **Expected** | Recent command appears before all other commands when query is empty. |
| **Layer** | L1 |
| **Risk** | L |
| **Covered?** | NONE |

---

## Keyboard Shortcuts

| Field | KB-01 |
|---|---|
| **ID** | KB-01 |
| **Persona** | any |
| **Story** | As any user I want to press `?` to see the full list of keyboard shortcuts so that I can discover the app's shortcuts without searching docs. |
| **Steps** | Ensure no text input focused → press `?`. |
| **Surface** | `useKeyboardShortcuts.ts` → `setShowShortcutsOverlay(true)` · `ShortcutsOverlay.tsx` |
| **Precondition** | Focus not in text input/textarea/contentEditable. |
| **Expected** | Shortcuts overlay opens showing all shortcuts grouped by category (File, View, Navigation, AI, General). |
| **Layer** | L1 |
| **Risk** | L |
| **Covered?** | `tests/e2e/shortcuts-overlay.spec.ts` |

| Field | KB-02 |
|---|---|
| **ID** | KB-02 |
| **Persona** | any |
| **Story** | As any user I want Ctrl+S to save the active file so that I can trigger a manual save without using the mouse. |
| **Steps** | Edit a file (dirty) → press Ctrl+S. |
| **Surface** | `useKeyboardShortcuts.ts` `isMod && e.key === 's'` → `handleSaveFile` |
| **Precondition** | A dirty tab is active. |
| **Expected** | File saved; dirty indicator clears. |
| **Layer** | L1 |
| **Risk** | M |
| **Covered?** | `tests/campaign/sweep/shortcuts.spec.ts` L-138 (no-error only) |

| Field | KB-03 |
|---|---|
| **ID** | KB-03 |
| **Persona** | any |
| **Story** | As any user I want Ctrl+W to close the active tab so that I can manage my open documents from the keyboard. |
| **Steps** | Open a tab → press Ctrl+W. |
| **Surface** | `useKeyboardShortcuts.ts` `isMod && e.key === 'w'` → `closeTab` |
| **Precondition** | At least one tab open. |
| **Expected** | Active tab closed; next tab focused. |
| **Layer** | L1 |
| **Risk** | M |
| **Covered?** | `tests/campaign/sweep/shortcuts.spec.ts` L-139 |

| Field | KB-04 |
|---|---|
| **ID** | KB-04 |
| **Persona** | any |
| **Story** | As any user I want Ctrl+B to toggle the sidebar so that I can maximize the editor area. |
| **Steps** | Press Ctrl+B → sidebar collapses. Press again → expands. |
| **Surface** | `useKeyboardShortcuts.ts` `isMod && !e.shiftKey && e.key === 'b'` → `setSidebarCollapsed` |
| **Precondition** | None. |
| **Expected** | Sidebar collapses on first press; expands on second. |
| **Layer** | L1 |
| **Risk** | L |
| **Covered?** | `tests/campaign/sweep/shortcuts.spec.ts` (indirectly via toggle-sidebar test) |

| Field | KB-05 |
|---|---|
| **ID** | KB-05 |
| **Persona** | any |
| **Story** | As any user I want Ctrl+\ to toggle a split editor so that I can view two files side-by-side. |
| **Steps** | Press Ctrl+\ → editor splits horizontally. Press again → split closes. |
| **Surface** | `useKeyboardShortcuts.ts` `isMod && e.key === '\\'` → `splitPane / closeSplit` |
| **Precondition** | None. |
| **Expected** | Split pane appears; second file can be opened in the right pane. |
| **Layer** | L1 |
| **Risk** | L |
| **Covered?** | `tests/campaign/sweep/shortcuts.spec.ts` L-140 |

| Field | KB-06 |
|---|---|
| **ID** | KB-06 |
| **Persona** | any |
| **Story** | As any user I want Ctrl+Shift+O to toggle the document outline panel so that I can navigate headings in a long document. |
| **Steps** | Open a document → press Ctrl+Shift+O → outline panel appears. |
| **Surface** | `useKeyboardShortcuts.ts` `isMod && e.shiftKey && e.key.toLowerCase() === 'o'` → `toggleOutline` |
| **Precondition** | Document open. |
| **Expected** | Outline panel visible with heading hierarchy; press again to close. |
| **Layer** | L1 |
| **Risk** | L |
| **Covered?** | `tests/campaign/sweep/shortcuts.spec.ts` L-141 |

| Field | KB-07 |
|---|---|
| **ID** | KB-07 |
| **Persona** | any |
| **Story** | As any user I want Ctrl+N to create a new document so that I can start fresh without using the file tree. |
| **Steps** | Ensure focus is NOT in a text input → press Ctrl+N. |
| **Surface** | `useKeyboardShortcuts.ts` `isMod && !e.shiftKey && e.key === 'n'` → `handleCreateDefaultDocument` |
| **Precondition** | Workspace open; focus not in input/textarea. |
| **Expected** | New document created and opened in editor tab. |
| **Layer** | L1 |
| **Risk** | L |
| **Covered?** | NONE |

| Field | KB-08 |
|---|---|
| **ID** | KB-08 |
| **Persona** | any |
| **Story** | As any user I want Ctrl+1..7 to jump directly to each sidebar tab so that I can navigate the app's main surfaces without the mouse. |
| **Steps** | Press Ctrl+1 → Matters tab. Ctrl+2 → Search. Ctrl+3 → Files. Ctrl+4 → Email. Ctrl+5 → Workflows. Ctrl+6 → Audit. Ctrl+7 → Settings. |
| **Surface** | `useKeyboardShortcuts.ts` spine tab map |
| **Precondition** | Focus not in input/textarea. |
| **Expected** | Corresponding sidebar tab activates; panel content changes. |
| **Layer** | L1 |
| **Risk** | L |
| **Covered?** | `tests/campaign/sweep/shortcuts.spec.ts` (L-138..L-147 covers some) |

| Field | KB-09 |
|---|---|
| **ID** | KB-09 |
| **Persona** | any |
| **Story** | As any user I want Ctrl+Z outside an editor to undo the most recent file rename or delete so that I can recover from mistakes. |
| **Steps** | Rename or delete a file → press Ctrl+Z (focus not in text input) → action reversed. |
| **Surface** | `useKeyboardShortcuts.ts` `isMod && !e.shiftKey && e.key === 'z'` → `handleRestoreFromTrash` / `workspaceService.rename` |
| **Precondition** | A rename or delete was performed this session (`undoStackRef` non-empty). |
| **Expected** | Deleted file restored from trash; renamed file reverted to original name. |
| **Layer** | L1 |
| **Risk** | H — data recovery |
| **Covered?** | `tests/e2e/undo-delete-ctrlz.spec.ts` |

| Field | KB-10 |
|---|---|
| **ID** | KB-10 |
| **Persona** | any |
| **Story** | As any user I want Ctrl+, to open Settings so that I can configure the app from the keyboard. |
| **Steps** | Press Ctrl+, → settings modal/panel opens. |
| **Surface** | `useKeyboardShortcuts.ts` `isMod && e.key === ','` → `setShowSettingsModal(true)` |
| **Precondition** | Settings tab not already active. |
| **Expected** | Settings modal opens; no-op if settings tab is already active. |
| **Layer** | L1 |
| **Risk** | L |
| **Covered?** | `tests/campaign/sweep/shortcuts.spec.ts` (shortcut sweep) |
