/**
 * PluginPermissionsList — reusable component that renders a plugin's
 * declared permissions as labelled icons + plain-language descriptions
 * + risk notes.
 *
 * Used by both the install consent dialog (Group II) and the plugin
 * detail view (Group IV) so users see the same risk wording in both
 * places. Risk levels match the spec: a permission either touches user
 * files / network / billing-relevant AI calls (medium) or only reads
 * passive editor state (low).
 */

import {
  Folder,
  FolderPen,
  Globe,
  MousePointer,
  Sparkles,
  TextCursorInput,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PluginPermission } from '@/types/plugin';

type RiskLevel = 'low' | 'medium';

interface PermissionMeta {
  label: string;
  description: string;
  risk: RiskLevel;
  /** Extra note appended after the description. Used for billing / exfiltration notes. */
  note?: string;
  icon: LucideIcon;
}

const PERMISSION_META: Record<PluginPermission, PermissionMeta> = {
  'workspace:read': {
    label: 'Read your files',
    description:
      'This plugin can read every file in your current workspace.',
    risk: 'low',
    icon: Folder,
  },
  'workspace:write': {
    label: 'Modify your files',
    description:
      'This plugin can create, edit, or delete files in your current workspace.',
    risk: 'medium',
    icon: FolderPen,
  },
  'editor:selection': {
    label: 'Read your current text selection',
    description:
      'This plugin can see the text you have selected in the editor.',
    risk: 'low',
    icon: MousePointer,
  },
  'editor:write': {
    label: 'Insert or replace text in your editor',
    description:
      'This plugin can write text into the file you are editing.',
    risk: 'low',
    icon: TextCursorInput,
  },
  'ai:invoke': {
    label: 'Send prompts to your AI provider',
    description:
      'This plugin can call your configured AI provider on your behalf.',
    note: 'Counts toward your AI bill.',
    risk: 'medium',
    icon: Sparkles,
  },
  network: {
    label: 'Make network requests',
    description:
      'This plugin can talk to other servers on the internet.',
    note: 'Could be used to send your data off your machine.',
    risk: 'medium',
    icon: Globe,
  },
};

interface PluginPermissionsListProps {
  permissions: PluginPermission[];
  /** Optional className passthrough so callers can tighten spacing inside dialogs. */
  className?: string;
}

export function PluginPermissionsList({
  permissions,
  className,
}: PluginPermissionsListProps) {
  if (permissions.length === 0) {
    return (
      <div
        data-testid="plugin-permissions-list-empty"
        className={cn(
          'rounded-md border border-dashed p-3 text-sm text-muted-foreground',
          className,
        )}
      >
        This plugin requests no special permissions.
      </div>
    );
  }

  return (
    <ul
      data-testid="plugin-permissions-list"
      className={cn('space-y-2', className)}
    >
      {permissions.map((permission) => {
        const meta = PERMISSION_META[permission];
        const Icon = meta.icon;
        return (
          <li
            key={permission}
            data-testid={`plugin-permission-${permission}`}
            data-risk={meta.risk}
            className="flex items-start gap-3 rounded-md border bg-card p-3"
          >
            <span
              className={cn(
                'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                meta.risk === 'medium'
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                  : 'bg-muted text-muted-foreground',
              )}
              aria-hidden="true"
            >
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium leading-none">
                  {meta.label}
                </span>
                <span
                  data-testid={`plugin-permission-${permission}-risk`}
                  className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                    meta.risk === 'medium'
                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {meta.risk === 'medium' ? 'Medium risk' : 'Low risk'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {meta.description}
                {meta.note ? (
                  <>
                    {' '}
                    <span
                      data-testid={`plugin-permission-${permission}-note`}
                      className="font-medium text-foreground/80"
                    >
                      {meta.note}
                    </span>
                  </>
                ) : null}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
