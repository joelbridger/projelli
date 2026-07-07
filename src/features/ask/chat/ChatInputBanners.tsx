// ChatInputBanners — the stack of strips that sit above the composer in
// AIChatViewer: trial-expired banner, missing-source toast, cost chip, context
// meter, attachment-error strip, PDF pre-send previews, the "what the AI can
// see" indicator, and the egress indicator. Extracted VERBATIM as a
// pass-through presentational component; the chat-input-area wrapper + the
// toolbar/textarea/send row stay in AIChatViewer.

import type { useTranslation } from 'react-i18next';
import type { AIChatFile, ChatAttachment, ChatMessage } from '@/platform/types/ai';
import type { ExtractedContext } from '@/platform/utils/ai-file-context';
import type { PdfExtractionResult } from '@/lib/pdf-extract';
import type { ChatProvider } from '@/features/ask/chat/providerModelResolution';
import type { useTrialGate } from '@/platform/hooks/useTrial';
import { createProvider } from '@/platform/providers/providerFactory';
import { ChatCostChip } from '@/features/ask/ChatCostChip';
import { AIContextIndicator } from '@/features/ask/AIContextIndicator';
import { EgressIndicator } from '@/platform/privacy/ui/EgressIndicator';
import { ContextMeterBar } from '@/features/ask/chat/ContextMeterBar';
import { PdfPreviewBeforeSend } from '@/features/ask/chat/PdfPreviewBeforeSend';
import { FileAccessConsentBanner } from '@/features/ask/chat/FileAccessConsentBanner';
import type { ConsentScope, FileAccessConsent } from '@/platform/ai/fileAccessConsent';

interface ChatInputBannersProps {
  trialGate: ReturnType<typeof useTrialGate>;
  t: ReturnType<typeof useTranslation>['t'];
  missingSourceWarning: string | null;
  setMissingSourceWarning: React.Dispatch<React.SetStateAction<string | null>>;
  showAiCostMeters: boolean;
  chatId: string;
  messages: ChatMessage[];
  inputValue: string;
  chatData: AIChatFile;
  chatContextTokenLimit: number;
  handleManualCompress: () => void;
  attachmentError: string | null;
  pendingAttachments: ChatAttachment[];
  pdfExtractions: Record<string, PdfExtractionResult>;
  openFiles: ExtractedContext[];
  scopedOpenFiles: ExtractedContext[];
  rootPath: string | undefined;
  scopedFolder: string | null;
  setScopedFolder: (chatId: string, folder: string | null) => void;
  effectiveProvider: ChatProvider | 'none' | null;
  assuredAvailableForChat: boolean;
  /** F2.5 — per-conversation file-access consent + the scope the next send runs
   *  under. The banner is only meaningful when a workspace is present (tools can
   *  register); `rootPath` gates that. */
  fileAccessConsent: FileAccessConsent;
  fileAccessConsentScope: ConsentScope;
  fileAccessScopeLabel: string;
  setFileAccessConsent: (chatId: string, consent: FileAccessConsent | null) => void;
}

export function ChatInputBanners({
  trialGate,
  t,
  missingSourceWarning,
  setMissingSourceWarning,
  showAiCostMeters,
  chatId,
  messages,
  inputValue,
  chatData,
  chatContextTokenLimit,
  handleManualCompress,
  attachmentError,
  pendingAttachments,
  pdfExtractions,
  openFiles,
  scopedOpenFiles,
  rootPath,
  scopedFolder,
  setScopedFolder,
  effectiveProvider,
  assuredAvailableForChat,
  fileAccessConsent,
  fileAccessConsentScope,
  fileAccessScopeLabel,
  setFileAccessConsent,
}: ChatInputBannersProps) {
  return (
    <>
        {/* Trial-expired banner. Sits above the input so the user knows
             *why* the send button is disabled. */}
        {trialGate.isLocked && (
          <div
            data-testid="chat-trial-expired-banner"
            className="mb-3 px-3 py-2 rounded border border-amber-400/50 bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200 text-xs"
          >
            <strong>{t('ai.chat.trial-ended', { days: trialGate.trialDays })}</strong>{' '}
            {t('ai.chat.trial-ended-help')}
          </div>
        )}
        {/* M2 — inline toast for missing source files. Rendered as a
             dismissable strip above the input so the user can keep
             typing while the warning is visible. */}
        {missingSourceWarning && (
          <div
            data-testid="chat-missing-source-warning"
            className="mb-2 px-3 py-2 rounded border border-amber-400/50 bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200 text-xs"
          >
            {missingSourceWarning}
            <button
              type="button"
              className="ml-2 underline hover:no-underline"
              onClick={() => setMissingSourceWarning(null)}
            >
              Dismiss
            </button>
          </div>
        )}
        {/* Q3 — real-time cost chip, anchored bottom-right of the chat pane
             just above the input. Hover reveals today's provider breakdown.
             Hidden unless the user opts into developer cost meters. */}
        {showAiCostMeters && (
          <div className="flex justify-end mb-2">
            <ChatCostChip chatId={chatId} />
          </div>
        )}
        {/* Stream A4 — context meter bar. The token / cost / "Context: N of 200K"
            meters are hidden unless the user opts in (showAiCostMeters), but the
            manual Compress action stays reachable for everyone, so this always
            renders and only the meter visuals are gated (showMeters). */}
        {(() => {
          // Simple 4-chars-per-token heuristic for meter display.
          const historyChars = messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
          const usedTokens = Math.round((historyChars + inputValue.length) / 4);
          const metadata = chatData.provider ? undefined : undefined; // cost lookup deferred
          void metadata;
          // Only price the next message when the cost meters are actually shown.
          const costPerInputToken = showAiCostMeters ? (() => {
            try {
              if (!chatData.provider || !chatData.model) return null;
              // Only cloud providers carry a per-token price; local engines
              // ('ollama'/'lantern-local') have no cost, so preserve the
              // original null result for them instead of constructing one just
              // to read metadata. Build the cloud probe through the shared
              // factory (fix F2.2) — apiKey is empty because this reads model
              // metadata only, it never sends.
              if (
                chatData.provider === 'anthropic' ||
                chatData.provider === 'openai' ||
                chatData.provider === 'google'
              ) {
                const p = createProvider({ provider: chatData.provider, apiKey: '', model: chatData.model });
                return p.getMetadata().costPerInputToken ?? null;
              }
            } catch {
              // ignore metadata errors for cost preview
            }
            return null;
          })() : null;
          const projectedCost = costPerInputToken != null
            ? costPerInputToken * usedTokens
            : null;
          const modelLabel = chatData.model
            ? chatData.model.split('-').slice(0, 2).join('-')
            : 'AI';
          return (
            <ContextMeterBar
              usedTokens={usedTokens}
              limitTokens={chatContextTokenLimit}
              projectedCost={projectedCost}
              modelLabel={modelLabel}
              onCompressClick={handleManualCompress}
              showMeters={showAiCostMeters}
              className="mb-2"
            />
          );
        })()}
        {/* Stream A2 — attachment error strip (covers both image and PDF errors) */}
        {attachmentError && (
          <div className="mb-2 px-3 py-2 rounded border border-red-400/50 bg-red-50 dark:bg-red-900/20 text-red-900 dark:text-red-200 text-xs">
            {attachmentError}
          </div>
        )}
        {/* Stream A2 — PDF pre-send preview panel, one per pending PDF attachment */}
        {pendingAttachments
          .filter((a) => a.type === 'pdf')
          .map((a) => {
            const extraction = pdfExtractions[a.id];
            if (!extraction) return null;
            const mode = a.metadata.extractionMode ?? 'text-extract';
            return (
              <PdfPreviewBeforeSend
                key={a.id}
                fileName={a.fileName}
                extractedText={extraction.pages.join('\n\n')}
                pageCount={extraction.pageCount}
                scanned={extraction.scanned}
                encrypted={extraction.encrypted}
                mode={mode}
                className="mb-2"
              />
            );
          })}
        {/* Workstream D — "What the AI can see" indicator + cross-client warning.
             Always visible so the user knows exactly which files are in context
             for the next message. The cross-client warning appears when open
             files span more than one top-level folder (different clients).
             D1 — passes the active scopedFolder and change handler so the
             picker and scope-active banner render correctly. */}
        {openFiles.length > 0 && (
          <AIContextIndicator
            openFiles={scopedOpenFiles}
            workspaceRoot={rootPath}
            scopedFolder={scopedFolder}
            onScopeChange={(folder) => setScopedFolder(chatId, folder)}
            className="mb-2"
          />
        )}
        {/* F2.5 — file-access consent affordance. Only meaningful when a
             workspace is present (so tools could register); sits just above the
             egress indicator so the "what can leave" story is complete. The
             component self-hides for local / no provider. */}
        {rootPath && (
          <FileAccessConsentBanner
            effectiveProvider={effectiveProvider}
            consent={fileAccessConsent}
            consentScope={fileAccessConsentScope}
            scopeLabel={fileAccessScopeLabel}
            onChange={(next) => { setFileAccessConsent(chatId, next); }}
            className="mb-2"
          />
        )}
        {/* WS-C — egress indicator: states exactly where the NEXT send goes,
             driven by the active provider + confidentiality mode. Always
             visible right above the composer so the user can never send
             without seeing the destination. */}
        <EgressIndicator
          provider={effectiveProvider}
          assuredAvailable={assuredAvailableForChat}
          variant="full"
          className="mb-2"
        />
    </>
  );
}
