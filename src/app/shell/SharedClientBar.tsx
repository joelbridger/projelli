import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppSurfaceClientContext } from '@/app/shell/registry/types';
import {
  ClientBarV1,
  getSharedClientQuickActions,
} from '@/features/client-bar';
import { useAppSurfaceRegistry } from '@/app/shell/runtime/useAppSurfaceRegistry';
import { useOptionalAppSurfaceCapabilities } from '@/app/shell/runtime/AppSurfaceRuntime';
import { useFlag } from '@/platform/flags';
import {
  requestClearClientSelection,
  useClientContextStore,
} from '@/platform/client-context';

export interface SharedClientBarProps {
  onChooseClient?: (() => void) | undefined;
}

/** Minimal shell plumbing; the v1 redesign lane owns the final visual swap. */
export function SharedClientBar({ onChooseClient }: SharedClientBarProps) {
  const sharedClientBarV1Enabled = useFlag('shared-client-bar');
  const { t } = useTranslation();
  const client = useClientContextStore((state) => state.client);
  const { descriptors } = useAppSurfaceRegistry();
  const capabilities = useOptionalAppSurfaceCapabilities();
  const quickActions = getSharedClientQuickActions(descriptors);

  const navigate = (surfaceId: string) => {
    const descriptor = descriptors.find(
      (candidate) => candidate.id === surfaceId
    );
    if (descriptor) capabilities?.navigation.setSurface(descriptor.id);
  };

  if (sharedClientBarV1Enabled) {
    return (
      <ClientBarV1
        onChooseClient={onChooseClient}
        onNavigate={navigate}
        quickActions={quickActions}
      />
    );
  }

  return (
    <section
      aria-label={t('shared-client.bar.label')}
      className="flex min-h-10 items-center gap-3 border-b border-slate-200 bg-white px-4 py-2 text-sm text-slate-700"
      data-testid="shared-client-bar"
    >
      <span className="font-medium text-slate-500">
        {t('shared-client.bar.label')}
      </span>
      {onChooseClient ? (
        <button
          className="rounded-md border border-slate-300 bg-white px-2 py-1 font-medium text-slate-800"
          data-testid="shared-client-bar-picker"
          onClick={onChooseClient}
          type="button"
        >
          {client?.displayName ?? t('shared-client.bar.empty')}
        </button>
      ) : (
        <span data-testid="shared-client-bar-current">
          {client?.displayName ?? t('shared-client.bar.empty')}
        </span>
      )}
      {client ? (
        <>
          {client.primaryPeople?.length ? (
            <span className="text-slate-500">
              {client.primaryPeople.join(' · ')}
            </span>
          ) : null}
          <button
            className="ml-auto rounded px-2 py-1 text-slate-600 hover:bg-slate-100"
            data-testid="shared-client-bar-clear"
            onClick={requestClearClientSelection}
            type="button"
          >
            {t('shared-client.bar.clear')}
          </button>
        </>
      ) : null}
    </section>
  );
}

interface SharedClientSurfaceProps {
  enabled: boolean;
  clientContext: AppSurfaceClientContext;
  children: ReactNode;
}

/**
 * Uses AppSurfaceDescriptor.clientContext as the shell mount decision. The
 * flag is resolved by AppSurfaceRouter so feature code never reads flags.
 */
export function SharedClientSurface({
  enabled,
  clientContext,
  children,
}: SharedClientSurfaceProps) {
  if (!enabled || clientContext !== 'shared') return children;
  return (
    <>
      <SharedClientBar />
      {children}
    </>
  );
}
