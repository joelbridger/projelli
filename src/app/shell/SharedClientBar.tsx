import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppSurfaceClientContext } from '@/app/shell/registry/types';
import { useClientContextStore } from '@/platform/client-context';

export interface SharedClientBarProps {
  onChooseClient?: () => void;
}

/** Minimal shell plumbing; the v1 redesign lane owns the final visual swap. */
export function SharedClientBar({ onChooseClient }: SharedClientBarProps) {
  const { t } = useTranslation();
  const client = useClientContextStore((state) => state.client);
  const clearClient = useClientContextStore((state) => state.clearClient);

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
            onClick={clearClient}
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
