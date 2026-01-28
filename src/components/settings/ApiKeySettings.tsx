// API Key Settings Component
// Manages API keys for AI providers

import { useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Key,
  Eye,
  EyeOff,
  Check,
  X,
  AlertCircle,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import type { KeyProvider, StoredKey } from '@/modules/models/KeychainService';

interface ApiKeySettingsProps {
  keychainService: {
    getKey(provider: KeyProvider): Promise<string | null>;
    setKey(provider: KeyProvider, key: string): Promise<void>;
    deleteKey(provider: KeyProvider): Promise<void>;
    hasKey(provider: KeyProvider): Promise<boolean>;
    getMaskedKey(provider: KeyProvider): Promise<string | null>;
    validateKey(provider: KeyProvider): Promise<{ valid: boolean; error?: string }>;
    isEnvKey(provider: KeyProvider): Promise<boolean>;
    getStoredKeys(): StoredKey[];
  };
  onKeysChanged?: () => void;
  className?: string;
}

const PROVIDERS: {
  id: KeyProvider;
  name: string;
  description: string;
  placeholder: string;
  docsUrl: string;
}[] = [
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    description: 'Access Claude models for document generation and analysis',
    placeholder: 'sk-ant-...',
    docsUrl: 'https://console.anthropic.com/',
  },
  {
    id: 'openai',
    name: 'OpenAI (GPT)',
    description: 'Access GPT models for alternative generation',
    placeholder: 'sk-...',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'google',
    name: 'Google AI (Gemini)',
    description: 'Access Gemini models for multi-model comparison',
    placeholder: 'AIza...',
    docsUrl: 'https://aistudio.google.com/app/apikey',
  },
];

export function ApiKeySettings({
  keychainService,
  onKeysChanged,
  className,
}: ApiKeySettingsProps) {
  return (
    <div className={cn('space-y-6', className)}>
      <div>
        <h3 className="text-lg font-medium">API Keys</h3>
        <p className="text-sm text-muted-foreground">
          Configure API keys for AI model providers. Keys are stored securely and never logged.
        </p>
      </div>

      <div className="space-y-4">
        {PROVIDERS.map((provider) => (
          <ProviderKeyCard
            key={provider.id}
            provider={provider}
            keychainService={keychainService}
            onKeyChanged={onKeysChanged}
          />
        ))}
      </div>
    </div>
  );
}

interface ProviderKeyCardProps {
  provider: {
    id: KeyProvider;
    name: string;
    description: string;
    placeholder: string;
    docsUrl: string;
  };
  keychainService: ApiKeySettingsProps['keychainService'];
  onKeyChanged?: (() => void) | undefined;
}

function ProviderKeyCard({
  provider,
  keychainService,
  onKeyChanged,
}: ProviderKeyCardProps) {
  const [hasKey, setHasKey] = useState(false);
  const [maskedKey, setMaskedKey] = useState<string | null>(null);
  const [isEnvKey, setIsEnvKey] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadKeyStatus = useCallback(async () => {
    setIsLoading(true);
    try {
      const [exists, masked, fromEnv] = await Promise.all([
        keychainService.hasKey(provider.id),
        keychainService.getMaskedKey(provider.id),
        keychainService.isEnvKey(provider.id),
      ]);
      setHasKey(exists);
      setMaskedKey(masked);
      setIsEnvKey(fromEnv);
    } catch (err) {
      console.error('Failed to load key status:', err);
    } finally {
      setIsLoading(false);
    }
  }, [keychainService, provider.id]);

  useEffect(() => {
    loadKeyStatus();
  }, [loadKeyStatus]);

  const handleSave = useCallback(async () => {
    if (!newKey.trim()) {
      setError('API key is required');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await keychainService.setKey(provider.id, newKey.trim());
      setNewKey('');
      setIsEditing(false);
      await loadKeyStatus();
      onKeyChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save key');
    } finally {
      setIsLoading(false);
    }
  }, [newKey, keychainService, provider.id, loadKeyStatus, onKeyChanged]);

  const handleDelete = useCallback(async () => {
    if (!confirm('Are you sure you want to remove this API key?')) {
      return;
    }

    setIsLoading(true);
    try {
      await keychainService.deleteKey(provider.id);
      await loadKeyStatus();
      onKeyChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete key');
    } finally {
      setIsLoading(false);
    }
  }, [keychainService, provider.id, loadKeyStatus, onKeyChanged]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setNewKey('');
    setError(null);
  }, []);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4" />
            <CardTitle className="text-base">{provider.name}</CardTitle>
            {hasKey && (
              <span className={cn(
                'text-xs px-1.5 py-0.5 rounded',
                isEnvKey
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                  : 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
              )}>
                {isEnvKey ? 'From Env' : 'Configured'}
              </span>
            )}
          </div>
          <a
            href={provider.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            Get API Key
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <CardDescription>{provider.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-10 flex items-center">
            <span className="text-sm text-muted-foreground">Loading...</span>
          </div>
        ) : isEditing ? (
          <div className="space-y-3">
            <div className="relative">
              <Input
                type={showKey ? 'text' : 'password'}
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder={provider.placeholder}
                className={cn('pr-10', error && 'border-destructive')}
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            {error && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave} disabled={isLoading}>
                <Check className="h-4 w-4 mr-1" />
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCancel}
                disabled={isLoading}
              >
                <X className="h-4 w-4 mr-1" />
                Cancel
              </Button>
            </div>
          </div>
        ) : hasKey ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <code className="text-sm bg-muted px-2 py-1 rounded">
                {maskedKey ?? '********'}
              </code>
              {isEnvKey && (
                <span className="text-xs text-muted-foreground">
                  (read-only)
                </span>
              )}
            </div>
            {!isEnvKey && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsEditing(true)}
                >
                  Change
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={handleDelete}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsEditing(true)}
          >
            <Key className="h-4 w-4 mr-1" />
            Add API Key
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default ApiKeySettings;
