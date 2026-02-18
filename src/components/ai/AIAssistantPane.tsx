// AI Assistant Pane
// Right-side panel for AI chat management, API keys, and model settings
// Rebuilt from ground up to ensure all content fits within container

import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Bot,
  Key,
  MessageSquare,
  ChevronRight,
  Trash2,
  Check,
  Eye,
  EyeOff,
  Plus,
  HelpCircle,
  FileText,
  Settings,
} from 'lucide-react';
import { ApiKeyHelpDialog } from '@/components/common/ApiKeyHelpDialog';
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
  onCreateNewChat: (provider: 'anthropic' | 'openai' | 'google') => void;
  onOpenChat: (chatFile: AIChatFile) => void;
  onDeleteChat: (chatId: string) => void;
  onOpenAIRules?: () => void;
  onClose: () => void;
  className?: string;
}

// Inline fallback arrays matching the original hardcoded options
const FALLBACK_ANTHROPIC: ModelInfo[] = [
  { id: 'claude-opus-4-5', displayName: 'Claude Opus 4.5', provider: 'anthropic' },
  { id: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5', provider: 'anthropic' },
  { id: 'claude-sonnet-4', displayName: 'Claude Sonnet 4', provider: 'anthropic' },
  { id: 'claude-3-opus', displayName: 'Claude 3 Opus', provider: 'anthropic' },
  { id: 'claude-3-sonnet', displayName: 'Claude 3 Sonnet', provider: 'anthropic' },
  { id: 'claude-3-haiku', displayName: 'Claude 3 Haiku', provider: 'anthropic' },
];

const FALLBACK_OPENAI: ModelInfo[] = [
  { id: 'gpt-4-turbo', displayName: 'GPT-4 Turbo', provider: 'openai' },
  { id: 'gpt-4', displayName: 'GPT-4', provider: 'openai' },
  { id: 'gpt-4-32k', displayName: 'GPT-4 32K', provider: 'openai' },
  { id: 'gpt-3.5-turbo', displayName: 'GPT-3.5 Turbo', provider: 'openai' },
  { id: 'gpt-3.5-turbo-16k', displayName: 'GPT-3.5 Turbo 16K', provider: 'openai' },
];

const FALLBACK_GOOGLE: ModelInfo[] = [
  { id: 'gemini-pro', displayName: 'Gemini Pro', provider: 'google' },
  { id: 'gemini-ultra', displayName: 'Gemini Ultra', provider: 'google' },
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
  onClose,
  className,
}: AIAssistantPaneProps) {
  const [activeTab, setActiveTab] = useState<'chats' | 'keys' | 'settings'>('chats');
  const [showHelpDialog, setShowHelpDialog] = useState(false);

  // Model selection state
  const [selectedModels, setSelectedModels] = useState<Record<string, string>>({
    anthropic: 'claude-opus-4-5',
    openai: 'gpt-4-turbo',
    google: 'gemini-pro',
  });

  // Model options state
  const [modelOptions, setModelOptions] = useState<Record<string, Record<string, boolean>>>({
    anthropic: { thinking: false, webSearch: false },
    openai: { webSearch: false, planning: false },
    google: { webSearch: false },
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
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const handleSaveKey = useCallback((provider: 'anthropic' | 'openai' | 'google') => {
    const key = keyInputs[provider];
    if (!key) return;

    setSavingKey(provider);
    onSaveApiKey(provider, key);
    setKeyInputs(prev => ({ ...prev, [provider]: '' }));
    setSavingKey(null);
  }, [keyInputs, onSaveApiKey]);

  const handleDeleteKey = useCallback((provider: 'anthropic' | 'openai' | 'google') => {
    onDeleteApiKey(provider);
  }, [onDeleteApiKey]);

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

  return (
    <div className={cn(
      'flex flex-col h-full w-full bg-card',
      className
    )}>
      {/* Header - Fixed */}
      <div className="flex items-center justify-between border-b px-3 py-2 shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 shrink-0" />
          <span className="text-sm font-medium truncate">AI Assistant</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onOpenAIRules && (
            <Button
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
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" onClick={onClose}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Tab Buttons - Fixed */}
      <div className="flex border-b shrink-0">
        <button
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
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs w-full justify-start"
                    onClick={() => onCreateNewChat(provider)}
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
                      className="p-3 hover:bg-muted/50 cursor-pointer group"
                      onClick={() => onOpenChat(chatFile)}
                    >
                      <div className="flex items-start gap-2 min-w-0">
                        <FileText className="h-4 w-4 text-purple-500 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 min-w-0">
                            <h4 className="text-sm font-medium truncate min-w-0">{chatFile.title}</h4>
                            <Button
                              variant="ghost"
                              size="sm"
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
              return (
                <div key={provider} className="space-y-2">
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <label className="text-sm font-medium truncate">{getProviderLabel(provider)}</label>
                    {existingKey?.isValid && (
                      <span className="flex items-center gap-1 text-xs text-green-600 shrink-0 whitespace-nowrap">
                        <Check className="h-3 w-3 shrink-0" />
                        Connected
                      </span>
                    )}
                  </div>
                  {existingKey ? (
                    <div className="flex gap-1.5 min-w-0">
                      <Input
                        value={showKeys[provider] ? existingKey.key : '••••••••••••••••'}
                        readOnly
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
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 shrink-0 text-destructive hover:text-destructive"
                        onClick={() => handleDeleteKey(provider)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="flex gap-1.5 min-w-0">
                        <Input
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
                        size="sm"
                        className="h-8 w-full"
                        onClick={() => handleSaveKey(provider)}
                        disabled={!keyInputs[provider] || savingKey === provider}
                      >
                        {savingKey === provider ? 'Saving...' : 'Save'}
                      </Button>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground break-words">
                    {provider === 'anthropic' && 'Get your API key from console.anthropic.com'}
                    {provider === 'openai' && 'Get your API key from platform.openai.com'}
                    {provider === 'google' && 'Get your API key from aistudio.google.com'}
                  </p>
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
                value={selectedModels['anthropic']}
                onChange={(e) => setSelectedModels(prev => ({ ...prev, anthropic: e.target.value }))}
                disabled={!hasApiKey('anthropic')}
                className="w-full h-8 text-xs px-2 border rounded-md bg-background"
              >
                {(modelLists?.['anthropic'] ?? FALLBACK_ANTHROPIC).map(m => (
                  <option key={m.id} value={m.id}>{m.displayName}</option>
                ))}
              </select>
              {hasApiKey('anthropic') && (
                <div className="space-y-2 pt-1">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={modelOptions['anthropic']?.['thinking'] || false}
                      onChange={(e) =>
                        setModelOptions(prev => ({
                          ...prev,
                          anthropic: { ...prev['anthropic'], thinking: e.target.checked }
                        }))
                      }
                      className="rounded shrink-0"
                    />
                    <span className="text-xs">Extended Thinking Mode</span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={modelOptions['anthropic']?.['webSearch'] || false}
                      onChange={(e) =>
                        setModelOptions(prev => ({
                          ...prev,
                          anthropic: { ...prev['anthropic'], webSearch: e.target.checked }
                        }))
                      }
                      className="rounded shrink-0"
                    />
                    <span className="text-xs">Web Search</span>
                  </label>
                </div>
              )}
            </div>

            {/* OpenAI / ChatGPT */}
            <div className="space-y-2 border-t pt-4">
              <label className="text-sm font-medium block truncate">ChatGPT (OpenAI)</label>
              <select
                value={selectedModels['openai']}
                onChange={(e) => setSelectedModels(prev => ({ ...prev, openai: e.target.value }))}
                disabled={!hasApiKey('openai')}
                className="w-full h-8 text-xs px-2 border rounded-md bg-background"
              >
                {(modelLists?.['openai'] ?? FALLBACK_OPENAI).map(m => (
                  <option key={m.id} value={m.id}>{m.displayName}</option>
                ))}
              </select>
              {hasApiKey('openai') && (
                <div className="space-y-2 pt-1">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={modelOptions['openai']?.['webSearch'] || false}
                      onChange={(e) =>
                        setModelOptions(prev => ({
                          ...prev,
                          openai: { ...prev['openai'], webSearch: e.target.checked }
                        }))
                      }
                      className="rounded shrink-0"
                    />
                    <span className="text-xs">Web Search (Browsing)</span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={modelOptions['openai']?.['planning'] || false}
                      onChange={(e) =>
                        setModelOptions(prev => ({
                          ...prev,
                          openai: { ...prev['openai'], planning: e.target.checked }
                        }))
                      }
                      className="rounded shrink-0"
                    />
                    <span className="text-xs">Planning Mode</span>
                  </label>
                </div>
              )}
            </div>

            {/* Google / Gemini */}
            <div className="space-y-2 border-t pt-4">
              <label className="text-sm font-medium block truncate">Gemini (Google)</label>
              <select
                value={selectedModels['google']}
                onChange={(e) => setSelectedModels(prev => ({ ...prev, google: e.target.value }))}
                disabled={!hasApiKey('google')}
                className="w-full h-8 text-xs px-2 border rounded-md bg-background"
              >
                {(modelLists?.['google'] ?? FALLBACK_GOOGLE).map(m => (
                  <option key={m.id} value={m.id}>{m.displayName}</option>
                ))}
              </select>
              {hasApiKey('google') && (
                <div className="space-y-2 pt-1">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={modelOptions['google']?.['webSearch'] || false}
                      onChange={(e) =>
                        setModelOptions(prev => ({
                          ...prev,
                          google: { ...prev['google'], webSearch: e.target.checked }
                        }))
                      }
                      className="rounded shrink-0"
                    />
                    <span className="text-xs">Web Search (Grounding)</span>
                  </label>
                </div>
              )}
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
