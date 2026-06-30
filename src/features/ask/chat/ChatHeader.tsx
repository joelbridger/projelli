// ChatHeader — the AIChatViewer title bar: title + provider/model picker,
// active-matter scope, Ask-my-workspace + include-privileged toggles, and
// Export. Extracted VERBATIM from AIChatViewer as a pure render + callback
// forwarding shell; no state or logic lives here.

import { Download, Sparkles, ShieldAlert } from 'lucide-react';
import type { useTranslation } from 'react-i18next';
import { Button } from '@/ui/button';
import { cn } from '@/lib/utils';
import type { AIChatFile } from '@/platform/types/ai';
import type { RetrievalScope } from '@/platform/utils/tauri-commands';
import { MatterScopeSelector } from '@/features/matters/MatterScopeSelector';
import { ChatModelPicker } from '@/features/ask/chat/ChatModelPicker';
import { PrivilegeExclusionExplainer } from '@/features/ask/PrivilegeExclusionExplainer';
import type { ChatProvider } from '@/features/ask/chat/providerModelResolution';
import type { APIKey } from '@/features/ask/AIChatViewer';

interface ChatHeaderProps {
  chatData: AIChatFile;
  apiKeys: APIKey[];
  handleSwitchProviderModel: (provider: ChatProvider, model: string) => void;
  setMatterManagerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  askWorkspaceMode: boolean;
  handleToggleAskWorkspace: () => void;
  t: ReturnType<typeof useTranslation>['t'];
  includePrivileged: boolean;
  setIncludePrivileged: (value: boolean) => void;
  explainerQuery: string;
  explainerScope: RetrievalScope;
  handleExport: () => void;
}

export function ChatHeader({
  chatData,
  apiKeys,
  handleSwitchProviderModel,
  setMatterManagerOpen,
  askWorkspaceMode,
  handleToggleAskWorkspace,
  t,
  includePrivileged,
  setIncludePrivileged,
  explainerQuery,
  explainerScope,
  handleExport,
}: ChatHeaderProps) {
  return (
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 data-testid="chat-title" className="text-lg font-semibold">{chatData.title}</h2>
            {/* Provider/model picker — replaces the old display-only chip. Lets
                the user choose which provider + model the next message uses,
                limited to providers they hold a valid key for (and to local
                providers when the matter is "On this computer only"). */}
            <ChatModelPicker
              provider={chatData.provider}
              model={chatData.model}
              apiKeys={apiKeys}
              onSelect={handleSwitchProviderModel}
            />
          </div>
          <p data-testid="chat-created-date" className="text-xs text-muted-foreground">
            Created {new Date(chatData.created).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* WS-B/C — active-matter scope. Always visible so the user knows
              which matter the next question is confined to. Switching it
              changes retrieval scope; "All matters" is the explicit
              cross-matter capability. */}
          <MatterScopeSelector
            onManageMatters={() => {
              setMatterManagerOpen(true);
            }}
          />
          {/* M2 — Ask my workspace toggle. When ON, every message in
              this chat retrieves workspace context before calling the
              model. Persisted per-chat in aiChatStore so flipping it
              once sticks across navigation. */}
          <Button
            data-testid="ask-workspace-toggle"
            data-enabled={askWorkspaceMode ? 'true' : 'false'}
            variant={askWorkspaceMode ? 'default' : 'outline'}
            size="sm"
            onClick={handleToggleAskWorkspace}
            className={cn(
              'gap-2',
              askWorkspaceMode && 'bg-primary text-primary-foreground',
            )}
            aria-pressed={askWorkspaceMode}
            title={
              askWorkspaceMode
                ? t('ai.chat.ask-workspace-on-title')
                : t('ai.chat.ask-workspace-off-title')
            }
          >
            <Sparkles className="h-4 w-4" />
            {t('ai.chat.ask-workspace')}
          </Button>
          {/* WS-PRIV — explicit, visible "Include privileged sources" toggle.
              OFF by default (privileged content excluded from retrieval). Only
              shown when retrieval is active, so the deliberate opt-in sits right
              next to the workspace-aware control. Amber/rose accent so turning it
              on never reads as the normal, safe state. */}
          {askWorkspaceMode && (
            <>
              <Button
                data-testid="include-privileged-toggle"
                data-enabled={includePrivileged ? 'true' : 'false'}
                variant="outline"
                size="sm"
                onClick={() => setIncludePrivileged(!includePrivileged)}
                className={cn(
                  'gap-2',
                  includePrivileged
                    ? 'border-rose-400 bg-rose-50 text-rose-700 hover:bg-rose-100'
                    : 'text-muted-foreground',
                )}
                aria-pressed={includePrivileged}
                title={
                  includePrivileged
                    ? 'Privileged sources ARE included in retrieval for this chat. Click to exclude them again.'
                    : 'Privileged sources are excluded from retrieval (default). Click to include them deliberately.'
                }
              >
                <ShieldAlert className="h-4 w-4" />
                {includePrivileged ? 'Privileged: included' : 'Include privileged'}
              </Button>
              {/* F-121 — what the exclusion does, enforced where, and a live
                  check the user can run against their own files. */}
              <PrivilegeExclusionExplainer
                query={explainerQuery}
                scope={explainerScope}
              />
            </>
          )}
          <Button
            data-testid="chat-export-button"
            variant="outline"
            size="sm"
            onClick={handleExport}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>
      </div>
  );
}
