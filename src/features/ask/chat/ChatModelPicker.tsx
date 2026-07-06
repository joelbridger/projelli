/**
 * ChatModelPicker — the provider + model picker in the AI chat header.
 *
 * Replaces the old display-only model chip. Lets the user choose which AI
 * provider (and which model on that provider) the next message goes to. Only
 * providers the user has a VALID key for are shown; under each, its available
 * models (from the live cache, the hardcoded defaults, or a single fallback so
 * a freshly-keyed provider is never empty).
 *
 * Confidentiality: when the active confidentiality mode is "local-only" (On
 * this computer only), cloud providers must never be selectable. We hide them
 * entirely and surface a one-line note so the picker can't be used to send a
 * matter's data off the machine.
 *
 * Design: light theme, compact, navy (primary) accent, reuses the same
 * DropdownMenu primitive as MatterScopeSelector so it can't overflow the
 * window and matches the rest of the header.
 */

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Check, Cpu, Cloud } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { providerDisplayName, isLocalProvider } from '@/platform/privacy/egress';
import { useConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import { detectOllama } from '@/platform/providers/OllamaProvider';
import { preStartLocalAi } from '@/platform/providers/localAiPreStart';
import { useLocalLlmModelStatus } from '@/platform/hooks/useLocalLlmModelStatus';
import type { ModelInfo } from '@/platform/providers/ModelListService';
import type { APIKey } from '@/features/ask/AIChatViewer';
import {
  resolveAvailableProviders,
  resolveModelsForProvider,
  type ChatProvider,
} from './providerModelResolution';

export interface ChatModelPickerProps {
  /** The chat's current provider, if any. */
  provider?: string | undefined;
  /** The chat's current model, if any. */
  model?: string | undefined;
  /** Valid + invalid keys; only valid ones produce selectable providers. */
  apiKeys: APIKey[];
  /** Called with the chosen provider + model when the user picks one. */
  onSelect: (provider: ChatProvider, model: string) => void;
  className?: string;
}

export function ChatModelPicker({
  provider,
  model,
  apiKeys,
  onSelect,
  className,
}: ChatModelPickerProps) {
  // Reactive: if the user flips to local-only, cloud providers disappear here.
  const confidentialityMode = useConfidentialityMode();
  const localOnly = confidentialityMode === 'local-only';

  // Live local-model detection: ping a running Ollama daemon on mount so a
  // local model shows up in the picker even with no explicit apiKeys entry.
  // Fails closed (reachable:false) when the daemon isn't there or fetch is
  // blocked (e.g. the browser dev server), so nothing breaks off the desktop.
  const [ollama, setOllama] = useState<{ reachable: boolean; models: string[] }>({
    reachable: false,
    models: [],
  });
  useEffect(() => {
    let cancelled = false;
    void detectOllama().then((result) => {
      if (!cancelled) setOllama(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Advisor Prep Hero Local AI (the embedded llama.cpp engine) is selectable only once
  // its GGUF model has been downloaded. Reuse the live status hook (which probes
  // on mount AND subscribes to the download-progress event) so the picker reacts
  // when the model becomes ready mid-session — e.g. the user finishes the
  // download from Settings while this chat header stays mounted — instead of a
  // one-shot probe. Fails closed (not ready) off the desktop.
  const localAiReady = useLocalLlmModelStatus().state === 'ready';

  // Providers the user can use, filtered by confidentiality mode. Advisor Prep Hero Local
  // AI is listed FIRST (the primary local option) once its model is ready;
  // Ollama is added after when its daemon is reachable. Both are local, so both
  // are allowed in local-only and cloud modes; de-duplicated against apiKeys.
  const providers = useMemo(() => {
    const available = resolveAvailableProviders(apiKeys);
    let withLocal: ChatProvider[] = available;
    if (localAiReady && !withLocal.includes('keepance-local')) {
      withLocal = ['keepance-local' as ChatProvider, ...withLocal];
    }
    if (ollama.reachable && !withLocal.includes('ollama')) {
      withLocal = [...withLocal, 'ollama' as ChatProvider];
    }
    return localOnly ? withLocal.filter((p) => isLocalProvider(p)) : withLocal;
  }, [apiKeys, localOnly, ollama.reachable, localAiReady]);

  // Models for a provider, narrowed to what the menu renders (id + label).
  // Ollama uses its live-detected tags; everything else uses the
  // cache → defaults → fallback resolution.
  const modelsFor = useMemo(
    () =>
      (p: ChatProvider): Array<Pick<ModelInfo, 'id' | 'displayName'>> => {
        if (p === 'ollama' && ollama.models.length > 0) {
          return ollama.models.map((id) => ({ id, displayName: id }));
        }
        return resolveModelsForProvider(p);
      },
    [ollama.models],
  );

  // Fix 1 (demo readiness): explicitly picking Advisor Prep Hero Local AI here is as
  // clear a signal as selecting Local-only mode — kick off the sidecar now
  // instead of waiting for the first message to discover it isn't running yet.
  const handleSelect = (p: ChatProvider, modelId: string): void => {
    if (p === 'keepance-local') preStartLocalAi();
    onSelect(p, modelId);
  };

  // Trigger label: "OpenAI · gpt-4o-mini", or just the provider when no model,
  // or "Choose a model" when nothing is set yet.
  const triggerLabel = useMemo(() => {
    if (!provider) return 'Choose a model';
    const name = providerDisplayName(provider as never);
    return model ? `${name} · ${model}` : name;
  }, [provider, model]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="chat-model-picker"
          data-provider={provider ?? ''}
          data-model={model ?? ''}
          title={provider ? `Provider: ${providerDisplayName(provider as never)}` : 'Choose an AI model'}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1 text-xs font-medium text-foreground hover:bg-accent hover:text-accent-foreground',
            !provider && 'text-muted-foreground',
            className,
          )}
        >
          <Cpu className="h-3.5 w-3.5 shrink-0 opacity-70" />
          <span className="max-w-[220px] truncate">{triggerLabel}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-[60vh] w-64 overflow-y-auto"
      >
        {providers.length === 0 ? (
          <div
            data-testid="chat-model-picker-empty"
            className="px-2 py-3 text-xs text-muted-foreground"
          >
            {localOnly
              ? 'No local model available. Set a local model to use chat on this computer only.'
              : 'No AI provider configured. Add a valid API key in Account to start.'}
          </div>
        ) : (
          providers.map((p, idx) => {
            const models = modelsFor(p);
            const local = isLocalProvider(p);
            return (
              <div key={p}>
                {idx > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="flex items-center gap-1.5 text-xs">
                  {local ? (
                    <Cpu className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  ) : (
                    <Cloud className="h-3.5 w-3.5 shrink-0 text-primary" />
                  )}
                  {providerDisplayName(p as never)}
                  {local && (
                    <span className="ml-auto text-[10px] font-normal text-emerald-600">
                      On this computer
                    </span>
                  )}
                </DropdownMenuLabel>
                {models.length === 0 ? (
                  // Provider with no specific model (e.g. ollama with no cache):
                  // still selectable — picks the provider with an empty model so
                  // the local provider uses its own default.
                  <DropdownMenuItem
                    data-testid={`chat-model-option-${p}-default`}
                    onClick={() => handleSelect(p, '')}
                    className="flex items-center gap-2 pl-7 text-xs"
                  >
                    <span className="flex-1 truncate">Default model</span>
                    {provider === p && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                    )}
                  </DropdownMenuItem>
                ) : (
                  models.map((m) => {
                    const selected = provider === p && model === m.id;
                    return (
                      <DropdownMenuItem
                        key={m.id}
                        data-testid={`chat-model-option-${p}-${m.id}`}
                        onClick={() => handleSelect(p, m.id)}
                        className="flex items-center gap-2 pl-7 text-xs"
                      >
                        <span className="flex-1 truncate" title={m.id}>
                          {m.displayName || m.id}
                        </span>
                        {selected && (
                          <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                        )}
                      </DropdownMenuItem>
                    );
                  })
                )}
              </div>
            );
          })
        )}
        {!localOnly && providers.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5 text-[10px] text-muted-foreground">
              Only providers with a valid key are shown. Manage keys in Account.
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ChatModelPicker;
