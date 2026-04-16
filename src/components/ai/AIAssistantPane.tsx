// AI Assistant Pane
// Right-side panel for AI chat management, API keys, and model settings
// Rebuilt from ground up to ensure all content fits within container

import { useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Bot,
  Key,
  MessageSquare,
  Trash2,
  Check,
  Eye,
  EyeOff,
  Plus,
  HelpCircle,
  FileText,
  Settings,
  ExternalLink,
  X,
  Maximize2,
} from 'lucide-react';
import { ApiKeyHelpDialog } from '@/components/common/ApiKeyHelpDialog';
import { getCorsSafeFetch, getProviderBaseUrl } from '@/modules/models/fetchUtils';
import { openExternal } from '@/utils/openExternal';
import { getDefaultModelsForTier } from '@/utils/defaultModel';
import { useLicense } from '@/hooks/useLicense';
import type { AIChatFile } from '@/types/ai';
import type { ModelInfo } from '@/modules/models/ModelListService';

interface APIKey {
  provider: 'anthropic' | 'openai' | 'google';
  key: string;
  isValid: boolean;
  lastValidated?: Date;
}

interface AIAssistantPaneProps {
  apiKeys: APIKey[];
  chatFiles: AIChatFile[];
  modelLists?: Record<string, ModelInfo[]>;
  onSaveApiKey: (provider: 'anthropic' | 'openai' | 'google', key: string) => void;
  onDeleteApiKey: (provider: 'anthropic' | 'openai' | 'google') => void;
  onCreateNewChat: (provider: 'anthropic' | 'openai' | 'google', model?: string) => void;
  onOpenChat: (chatFile: AIChatFile) => void;
  onDeleteChat: (chatId: string) => void;
  onOpenAIRules?: () => void;
  /**
   * When provided, forces the pane's inner tab to this value on mount AND any
   * time this prop changes. Used by UX-04 onboarding card to drop users
   * directly into the Keys sub-tab when they click "Add API key".
   */
  requestedTab?: 'chats' | 'keys' | 'settings' | undefined;
  /**
   * Fires after requestedTab has been applied, so the parent can clear the
   * one-shot request (otherwise re-renders would keep snapping back to it).
   */
  onRequestedTabApplied?: () => void;
  /**
   * UX-21: when provided, renders a "Pop out to tab" button in the header
   * that opens the AI Assistant as a main-panel tab. The sidebar pane
   * keeps existing unchanged — the pop-out is additive.
   */
  onPopOut?: () => void;
  className?: string;
}

// Inline fallback arrays matching the original hardcoded options
const FALLBACK_ANTHROPIC: ModelInfo[] = [
  { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', provider: 'anthropic' },
  { id: 'claude-opus-4-6', displayName: 'Claude Opus 4.6', provider: 'anthropic' },
  { id: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5', provider: 'anthropic' },
  { id: 'claude-sonnet-4-5-20250514', displayName: 'Claude Sonnet 4.5', provider: 'anthropic' },
];

const FALLBACK_OPENAI: ModelInfo[] = [
  { id: 'gpt-4o', displayName: 'GPT-4o', provider: 'openai' },
  { id: 'gpt-4o-mini', displayName: 'GPT-4o Mini', provider: 'openai' },
  { id: 'gpt-4-turbo', displayName: 'GPT-4 Turbo', provider: 'openai' },
  { id: 'gpt-4', displayName: 'GPT-4', provider: 'openai' },
];

const FALLBACK_GOOGLE: ModelInfo[] = [
  { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', provider: 'google' },
  { id: 'gemini-1.5-pro', displayName: 'Gemini 1.5 Pro', provider: 'google' },
  { id: 'gemini-1.5-flash', displayName: 'Gemini 1.5 Flash', provider: 'google' },
];

export function AIAssistantPane({
  apiKeys,
  chatFiles,
  modelLists,
  onSaveApiKey,
  onDeleteApiKey,
  onCreateNewChat,
  onOpenChat,
  onDeleteChat,
  onOpenAIRules,
  requestedTab,
  onRequestedTabApplied,
  onPopOut,
  className,
}: AIAssistantPaneProps) {
  const [activeTab, setActiveTab] = useState<'chats' | 'keys' | 'settings'>(
    requestedTab ?? 'chats'
  );
  const [showHelpDialog, setShowHelpDialog] = useState(false);
  const { tier } = useLicense();

  // When the parent passes a new requestedTab (e.g. onboarding card clicked),
  // snap to it and tell the parent it was applied so it can clear the request.
  useEffect(() => {
    if (requestedTab && requestedTab !== activeTab) {
      setActiveTab(requestedTab);
      onRequestedTabApplied?.();
    } else if (requestedTab) {
      // Already on the right tab; still clear the request so future re-mounts
      // don't re-trigger.
      onRequestedTabApplied?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedTab]);

  // Model selection state.
  // Defaults resolve through `getDefaultModelsForTier` (Q9 — Wave 1.5) so free-tier
  // founders land on Claude Haiku 4.5 out of the box. Paid tiers keep Sonnet 4.6.
  // This only seeds the initial selection; a user's explicit pick is respected.
  const [selectedModels, setSelectedModels] = useState<Record<string, string>>(() =>
    getDefaultModelsForTier(tier)
  );

  // Transient key-flow state: drives the Save button's "Testing..." state and
  // success/error inline messages for the Save path.
  const [keyStatus, setKeyStatus] = useState<Record<string, { state: 'idle' | 'testing' | 'success' | 'error'; message?: string }>>({
    anthropic: { state: 'idle' },
    openai: { state: 'idle' },
    google: { state: 'idle' },
  });

  // Persisted "last test result" for each saved key. Drives the status chip:
  //   - undefined / 'untested': "Not tested"
  //   - 'valid': "Valid ✓"
  //   - 'invalid': "Invalid ✗" (with tooltip showing error)
  // Note: when a key is saved through the Save flow we seed this to 'valid'
  // because saveApiKey only fires after a successful testApiKey call.
  const [testResults, setTestResults] = useState<Record<string, { status: 'untested' | 'valid' | 'invalid'; error?: string }>>({
    anthropic: { status: 'untested' },
    openai: { status: 'untested' },
    google: { status: 'untested' },
  });

  // API Key form state
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({
    anthropic: '',
    openai: '',
    google: '',
  });
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({
    anthropic: false,
    openai: false,
    google: false,
  });
  const handleDeleteKey = useCallback((provider: 'anthropic' | 'openai' | 'google') => {
    onDeleteApiKey(provider);
    setTestResults(prev => ({ ...prev, [provider]: { status: 'untested' } }));
    setKeyStatus(prev => ({ ...prev, [provider]: { state: 'idle' } }));
  }, [onDeleteApiKey]);

  const testApiKey = useCallback(async (provider: 'anthropic' | 'openai' | 'google', key: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const safeFetch = await getCorsSafeFetch();
      const baseUrl = getProviderBaseUrl(provider);

      if (provider === 'anthropic') {
        const resp = await safeFetch(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify({ model: 'claude-3-haiku-20240307', max_tokens: 1, messages: [{ role: 'user', content: 'test' }] }),
        });
        if (resp.ok) return { ok: true };
        if (resp.status === 401) return { ok: false, error: 'Invalid API key' };
        return { ok: false, error: `API returned ${resp.status}` };
      }

      if (provider === 'openai') {
        const resp = await safeFetch(`${baseUrl}/v1/models`, {
          headers: { Authorization: `Bearer ${key}` },
        });
        if (resp.ok) return { ok: true };
        if (resp.status === 401) return { ok: false, error: 'Invalid API key' };
        return { ok: false, error: `API returned ${resp.status}` };
      }

      if (provider === 'google') {
        const resp = await safeFetch(`${baseUrl}/v1beta/models?key=${key}`);
        if (resp.ok) return { ok: true };
        if (resp.status === 400 || resp.status === 403) return { ok: false, error: 'Invalid API key' };
        return { ok: false, error: `API returned ${resp.status}` };
      }

      return { ok: false, error: 'Unknown provider' };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }, []);

  const getProviderLabel = (provider: string) => {
    switch (provider) {
      case 'anthropic': return 'Claude (Anthropic)';
      case 'openai': return 'ChatGPT (OpenAI)';
      case 'google': return 'Gemini (Google)';
      default: return provider;
    }
  };

  const getProviderShortLabel = (provider: string) => {
    switch (provider) {
      case 'anthropic': return 'Claude';
      case 'openai': return 'GPT';
      case 'google': return 'Gemini';
      default: return provider;
    }
  };

  const hasApiKey = (provider: string) => {
    return apiKeys.some(k => k.provider === provider && k.isValid);
  };

  const getKeyUrl = (provider: 'anthropic' | 'openai' | 'google') => {
    switch (provider) {
      case 'anthropic':
        return 'https://console.anthropic.com/settings/keys';
      case 'openai':
        return 'https://platform.openai.com/api-keys';
      case 'google':
        return 'https://aistudio.google.com/app/apikey';
    }
  };

  /**
   * Mask a key for display: show first 7 chars + ellipsis + last 3 chars.
   * Short keys (<= 10 chars) are fully masked to avoid leaking too much.
   */
  const maskKey = (key: string): string => {
    if (key.length <= 10) return '•'.repeat(Math.max(key.length, 8));
    return `${key.slice(0, 7)}••••••••${key.slice(-3)}`;
  };

  /**
   * Revalidate an already-saved key. Updates `testResults[provider]` which
   * drives the status chip. Does not change the saved key itself.
   */
  const handleTestKey = useCallback(
    async (provider: 'anthropic' | 'openai' | 'google') => {
      const existing = apiKeys.find(k => k.provider === provider);
      if (!existing) return;
      setTestResults(prev => ({ ...prev, [provider]: { status: 'untested' } }));
      setKeyStatus(prev => ({ ...prev, [provider]: { state: 'testing' } }));
      const result = await testApiKey(provider, existing.key);
      if (result.ok) {
        setTestResults(prev => ({ ...prev, [provider]: { status: 'valid' } }));
        setKeyStatus(prev => ({ ...prev, [provider]: { state: 'success', message: 'Valid' } }));
        setTimeout(() => setKeyStatus(prev => ({ ...prev, [provider]: { state: 'idle' } })), 2500);
      } else {
        setTestResults(prev => ({
          ...prev,
          [provider]: { status: 'invalid', error: result.error ?? 'Validation failed' },
        }));
        setKeyStatus(prev => ({
          ...prev,
          [provider]: { state: 'error', message: result.error ?? 'Invalid key' },
        }));
      }
    },
    [apiKeys, testApiKey]
  );

  return (
    <div data-testid="ai-assistant-pane" className={cn(
      'flex flex-col h-full w-full bg-card',
      className
    )}>
      {/* Header - Fixed */}
      <div className="flex items-center justify-between border-b px-3 py-2 shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 shrink-0" />
          <span data-testid="ai-assistant-title" className="text-sm font-medium truncate">AI Assistant</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onOpenAIRules && (
            <Button
              data-testid="ai-rules-button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs gap-1 shrink-0"
              onClick={onOpenAIRules}
              title="Open AI Rules file"
            >
              <FileText className="h-3 w-3" />
              Rules
            </Button>
          )}
          {/* UX-21: pop the AI Assistant out into a main-panel tab where it
              gets the full editor width instead of the narrow sidebar slot. */}
          {onPopOut && (
            <Button
              data-testid="ai-pop-out-button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs gap-1 shrink-0"
              onClick={onPopOut}
              title="Open AI Assistant in a main-panel tab (Ctrl+Shift+A)"
              aria-label="Open AI Assistant in a main-panel tab"
            >
              <Maximize2 className="h-3 w-3" />
              Pop out
            </Button>
          )}
        </div>
      </div>

      {/* Tab Buttons - Fixed */}
      <div className="flex border-b shrink-0">
        <button
          data-testid="ai-tab-chats"
          onClick={() => setActiveTab('chats')}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2',
            activeTab === 'chats'
              ? 'border-primary bg-muted/50 text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30'
          )}
        >
          <MessageSquare className="h-3 w-3 shrink-0" />
          <span className="truncate">Chats</span>
        </button>
        <button
          data-testid="ai-tab-keys"
          onClick={() => setActiveTab('keys')}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2',
            activeTab === 'keys'
              ? 'border-primary bg-muted/50 text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30'
          )}
        >
          <Key className="h-3 w-3 shrink-0" />
          <span className="truncate">Keys</span>
        </button>
        <button
          data-testid="ai-tab-models"
          onClick={() => setActiveTab('settings')}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2',
            activeTab === 'settings'
              ? 'border-primary bg-muted/50 text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30'
          )}
        >
          <Settings className="h-3 w-3 shrink-0" />
          <span className="truncate">Models</span>
        </button>
      </div>

      {/* Tab Content - Scrollable */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Chats Tab */}
        {activeTab === 'chats' && (
          <div className="flex flex-col h-full">
            {/* New chat buttons */}
            <div className="border-b p-3 shrink-0 bg-card sticky top-0 z-10">
              <div className="text-xs text-muted-foreground mb-2">Start new chat:</div>
              <div className="flex flex-col gap-2">
                {(['anthropic', 'openai', 'google'] as const).map(provider => (
                  <Button
                    key={provider}
                    data-testid={`new-chat-${provider}`}
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs w-full justify-start"
                    onClick={() => onCreateNewChat(provider, selectedModels[provider])}
                    disabled={!hasApiKey(provider)}
                    title={hasApiKey(provider) ? `New ${getProviderShortLabel(provider)} chat` : 'Add API key first'}
                  >
                    <Plus className="h-3 w-3 mr-2 shrink-0" />
                    <span className="truncate">{getProviderLabel(provider)}</span>
                  </Button>
                ))}
              </div>
            </div>

            {/* Chat files list */}
            <div className="flex-1 min-h-0">
              {chatFiles.length === 0 ? (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground p-4 text-center">
                  {apiKeys.some(k => k.isValid)
                    ? 'Click a button above to start a new chat'
                    : 'Add your API keys in the API Keys tab to start chatting'}
                </div>
              ) : (
                <div className="divide-y">
                  {chatFiles.map(chatFile => (
                    <div
                      key={chatFile.id}
                      data-testid={`chat-item-${chatFile.id}`}
                      className="p-3 hover:bg-muted/50 cursor-pointer group"
                      onClick={() => onOpenChat(chatFile)}
                    >
                      <div className="flex items-start gap-2 min-w-0">
                        <FileText className="h-4 w-4 text-purple-500 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 min-w-0">
                            <div className="flex items-baseline gap-2 min-w-0 flex-1">
                              <h4 data-testid={`chat-title-${chatFile.id}`} className="text-sm font-medium truncate min-w-0">{chatFile.title}</h4>
                              {chatFile.model && (
                                <span
                                  data-testid={`chat-model-${chatFile.id}`}
                                  className="text-[10px] text-muted-foreground font-normal whitespace-nowrap shrink-0"
                                  title={chatFile.model}
                                >
                                  {(() => {
                                    const provider = chatFile.provider;
                                    const list = provider && modelLists?.[provider];
                                    const match = list?.find(m => m.id === chatFile.model);
                                    return match?.displayName ?? chatFile.model;
                                  })()}
                                </span>
                              )}
                            </div>
                            <Button
                              data-testid={`delete-chat-${chatFile.id}`}
                              variant="ghost"
                              size="sm"
                              aria-label="Delete chat"
                              className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 shrink-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteChat(chatFile.id);
                              }}
                            >
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          </div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {chatFile.messages.length} message{chatFile.messages.length !== 1 ? 's' : ''}
                            </span>
                            <span className="text-xs text-muted-foreground">•</span>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(chatFile.updated).toLocaleDateString()}
                            </span>
                          </div>
                          {chatFile.messages.length > 0 && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2 break-words">
                              {chatFile.messages[chatFile.messages.length - 1]?.content}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* API Keys Tab */}
        {activeTab === 'keys' && (
          <div className="p-3 space-y-4">
            {/* Help button */}
            <div className="flex justify-end">
              <Button
                data-testid="api-key-help-button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs gap-1 shrink-0"
                onClick={() => setShowHelpDialog(true)}
              >
                <HelpCircle className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">How to get API keys</span>
              </Button>
            </div>
            {(['anthropic', 'openai', 'google'] as const).map(provider => {
              const existingKey = apiKeys.find(k => k.provider === provider);
              const test = testResults[provider] ?? { status: 'untested' };
              const isTesting = keyStatus[provider]?.state === 'testing';
              return (
                <div
                  key={provider}
                  data-testid={`api-key-row-${provider}`}
                  className="space-y-2 border-b pb-4 last:border-b-0 last:pb-0"
                >
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <label className="text-sm font-medium truncate">{getProviderLabel(provider)}</label>
                    {existingKey && (
                      <span
                        data-testid={`api-key-status-${provider}`}
                        data-status={test.status}
                        title={test.status === 'invalid' ? test.error : undefined}
                        className={cn(
                          'flex items-center gap-1 text-[11px] font-medium shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 border',
                          test.status === 'valid' &&
                            'text-green-700 border-green-300 bg-green-50 dark:text-green-300 dark:border-green-900 dark:bg-green-950',
                          test.status === 'invalid' &&
                            'text-red-700 border-red-300 bg-red-50 dark:text-red-300 dark:border-red-900 dark:bg-red-950',
                          test.status === 'untested' &&
                            'text-muted-foreground border-border bg-muted'
                        )}
                      >
                        {test.status === 'valid' && (
                          <>
                            <Check className="h-3 w-3 shrink-0" />
                            Valid
                          </>
                        )}
                        {test.status === 'invalid' && (
                          <>
                            <X className="h-3 w-3 shrink-0" />
                            Invalid
                          </>
                        )}
                        {test.status === 'untested' && 'Not tested'}
                      </span>
                    )}
                  </div>
                  {/* "Get key →" link - always visible, per-provider */}
                  <button
                    data-testid={`api-key-get-link-${provider}`}
                    type="button"
                    onClick={() => openExternal(getKeyUrl(provider))}
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    Get key
                    <ExternalLink className="h-3 w-3" />
                  </button>
                  {existingKey ? (
                    <div className="space-y-1.5">
                      <div className="flex gap-1.5 min-w-0">
                        <Input
                          data-testid={`api-key-masked-${provider}`}
                          value={showKeys[provider] ? existingKey.key : maskKey(existingKey.key)}
                          readOnly
                          className="flex-1 h-8 text-xs font-mono min-w-0"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 shrink-0"
                          onClick={() => setShowKeys(prev => ({ ...prev, [provider]: !prev[provider] }))}
                          title={showKeys[provider] ? 'Hide key' : 'Show key'}
                          aria-label={showKeys[provider] ? 'Hide key' : 'Show key'}
                        >
                          {showKeys[provider] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          data-testid={`api-key-test-${provider}`}
                          variant="outline"
                          size="sm"
                          className="h-8 px-2 text-xs shrink-0"
                          onClick={() => handleTestKey(provider)}
                          disabled={isTesting}
                          title="Re-test this API key"
                        >
                          {isTesting ? 'Testing...' : 'Test'}
                        </Button>
                        <Button
                          data-testid={`api-key-clear-${provider}`}
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 shrink-0 text-destructive hover:text-destructive"
                          onClick={() => handleDeleteKey(provider)}
                          title="Clear saved key"
                          aria-label="Clear saved key"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      {keyStatus[provider]?.state === 'error' && (
                        <p className="text-xs text-red-600 dark:text-red-400">{keyStatus[provider].message}</p>
                      )}
                      {keyStatus[provider]?.state === 'success' && (
                        <p className="text-xs text-green-600 dark:text-green-400">{keyStatus[provider].message}</p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="flex gap-1.5 min-w-0">
                        <Input
                          data-testid={`api-key-input-${provider}`}
                          type={showKeys[provider] ? 'text' : 'password'}
                          value={keyInputs[provider]}
                          onChange={(e) => setKeyInputs(prev => ({ ...prev, [provider]: e.target.value }))}
                          placeholder="Enter API key..."
                          className="flex-1 h-8 text-xs font-mono min-w-0"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 shrink-0"
                          onClick={() => setShowKeys(prev => ({ ...prev, [provider]: !prev[provider] }))}
                        >
                          {showKeys[provider] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                      <Button
                        data-testid={`api-key-save-${provider}`}
                        size="sm"
                        className="h-8 w-full"
                        onClick={async () => {
                          const key = keyInputs[provider];
                          if (!key) return;
                          setKeyStatus(prev => ({ ...prev, [provider]: { state: 'testing' } }));
                          const result = await testApiKey(provider, key);
                          if (result.ok) {
                            setKeyStatus(prev => ({ ...prev, [provider]: { state: 'success', message: 'Connected!' } }));
                            setTestResults(prev => ({ ...prev, [provider]: { status: 'valid' } }));
                            onSaveApiKey(provider, key);
                            setKeyInputs(prev => ({ ...prev, [provider]: '' }));
                            // Clear success after 3s
                            setTimeout(() => setKeyStatus(prev => ({ ...prev, [provider]: { state: 'idle' } })), 3000);
                          } else {
                            setKeyStatus(prev => ({ ...prev, [provider]: { state: 'error', message: result.error ?? 'Unknown error' } }));
                            setTestResults(prev => ({
                              ...prev,
                              [provider]: { status: 'invalid', error: result.error ?? 'Validation failed' },
                            }));
                          }
                        }}
                        disabled={!keyInputs[provider] || keyStatus[provider]?.state === 'testing'}
                      >
                        {keyStatus[provider]?.state === 'testing' ? 'Testing...' : 'Save'}
                      </Button>
                      {keyStatus[provider]?.state === 'error' && (
                        <p className="text-xs text-red-600 dark:text-red-400">{keyStatus[provider].message}</p>
                      )}
                      {keyStatus[provider]?.state === 'success' && (
                        <p className="text-xs text-green-600 dark:text-green-400">{keyStatus[provider].message}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            <div className="pt-4 border-t">
              <p className="text-xs text-muted-foreground break-words">
                API keys are stored securely in your local workspace and never sent to our servers.
              </p>
            </div>
          </div>
        )}

        {/* Model Settings Tab */}
        {activeTab === 'settings' && (
          <div className="p-3 space-y-4">
            {/* Anthropic / Claude */}
            <div className="space-y-2">
              <label className="text-sm font-medium block truncate">Claude (Anthropic)</label>
              <select
                data-testid="model-select-anthropic"
                value={selectedModels['anthropic']}
                onChange={(e) => setSelectedModels(prev => ({ ...prev, anthropic: e.target.value }))}
                disabled={!hasApiKey('anthropic')}
                className="w-full h-8 text-xs px-2 border rounded-md bg-background"
              >
                {(modelLists?.['anthropic'] ?? FALLBACK_ANTHROPIC).map(m => (
                  <option key={m.id} value={m.id}>{m.displayName}</option>
                ))}
              </select>
            </div>

            {/* OpenAI / ChatGPT */}
            <div className="space-y-2 border-t pt-4">
              <label className="text-sm font-medium block truncate">ChatGPT (OpenAI)</label>
              <select
                data-testid="model-select-openai"
                value={selectedModels['openai']}
                onChange={(e) => setSelectedModels(prev => ({ ...prev, openai: e.target.value }))}
                disabled={!hasApiKey('openai')}
                className="w-full h-8 text-xs px-2 border rounded-md bg-background"
              >
                {(modelLists?.['openai'] ?? FALLBACK_OPENAI).map(m => (
                  <option key={m.id} value={m.id}>{m.displayName}</option>
                ))}
              </select>
            </div>

            {/* Google / Gemini */}
            <div className="space-y-2 border-t pt-4">
              <label className="text-sm font-medium block truncate">Gemini (Google)</label>
              <select
                data-testid="model-select-google"
                value={selectedModels['google']}
                onChange={(e) => setSelectedModels(prev => ({ ...prev, google: e.target.value }))}
                disabled={!hasApiKey('google')}
                className="w-full h-8 text-xs px-2 border rounded-md bg-background"
              >
                {(modelLists?.['google'] ?? FALLBACK_GOOGLE).map(m => (
                  <option key={m.id} value={m.id}>{m.displayName}</option>
                ))}
              </select>
            </div>

            <div className="pt-4 border-t">
              <p className="text-xs text-muted-foreground break-words">
                Model settings are saved per workspace and apply to all new chats.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* API Key Help Dialog */}
      <ApiKeyHelpDialog
        open={showHelpDialog}
        onOpenChange={setShowHelpDialog}
      />
    </div>
  );
}

export default AIAssistantPane;
