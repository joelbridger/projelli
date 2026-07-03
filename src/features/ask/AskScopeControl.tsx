/**
 * AskScopeControl — Wave B / S4 replacement for ScopeToggle + the separate
 * Files-only switch.
 *
 * Before: up to five separate controls sat above the composer (This matter /
 * All matters / Email / Documents pills, plus a Files-only toggle) — seven
 * decisions before the user typed a word. Now: ONE segmented control for the
 * 90% case (This client / All clients, one click), plus a single "More"
 * segment that opens a compact "Sources" popover holding the rarer Email-only
 * / Documents-only scopes and the Files-only mode switch — two clicks for the
 * remaining 10%.
 *
 * Pure UI reorganization: still drives the exact same `AskScope` union and
 * `filesOnly` boolean as before (see askHelpers.ts) — no retrieval/consent
 * logic changed here.
 */

import { ChevronDown, Mail, FileText, Check } from 'lucide-react';
import { Chip } from '@/ui/kp';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/ui/dropdown-menu';
import type { AskScope } from './askHelpers';
import { useEntityLabel } from '@/platform/hooks/useEntityLabel';

// Module-scope label — the i18n lint rule targets JSX text / string props, not
// const references (same pattern the old inline FilesOnlyToggle used).
const FILES_ONLY_LABEL = 'Files-only mode';

export interface AskScopeControlProps {
  scope: AskScope;
  onChange: (s: AskScope) => void;
  hasMatter: boolean;
  /** Email/Documents/Files-only are hidden on the sample matter (nothing real
   *  to filter to), same as the old ScopeToggle's isSample behavior. */
  isSample: boolean;
  filesOnly: boolean;
  onFilesOnlyChange: (v: boolean) => void;
}

const CHIP_STYLE_BASE: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: '13.5px',
  fontWeight: 600,
  borderWidth: '1.5px',
};

function chipStyle(active: boolean): React.CSSProperties {
  return active ? CHIP_STYLE_BASE : { ...CHIP_STYLE_BASE, borderColor: 'var(--kp-divider-strong)' };
}

export function AskScopeControl({
  scope,
  onChange,
  hasMatter,
  isSample,
  filesOnly,
  onFilesOnlyChange,
}: AskScopeControlProps) {
  const entityLabel = useEntityLabel();
  const showMore = !isSample;
  const moreActive = scope === 'email' || scope === 'documents';

  return (
    <div
      data-testid="ask-scope-control"
      role="group"
      aria-label="Ask scope"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
    >
      {hasMatter && (
        <Chip
          size="md"
          active={scope === 'this-matter'}
          data-testid="scope-option-this-matter"
          onClick={() => { onChange('this-matter'); }}
          style={chipStyle(scope === 'this-matter')}
        >
          {`This ${entityLabel.one}`}
        </Chip>
      )}
      <Chip
        size="md"
        active={scope === 'all-matters'}
        data-testid="scope-option-all-matters"
        onClick={() => { onChange('all-matters'); }}
        style={chipStyle(scope === 'all-matters')}
      >
        {`All ${entityLabel.other}`}
      </Chip>
      {showMore && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Chip
              size="md"
              active={moreActive}
              data-testid="scope-option-more"
              style={chipStyle(moreActive)}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                More
                <ChevronDown style={{ width: 14, height: 14 }} aria-hidden />
              </span>
            </Chip>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="text-xs">Sources</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid="scope-option-email"
              onClick={() => { onChange('email'); }}
              className="flex items-center gap-2 text-xs"
            >
              <Mail className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">Email only</span>
              {scope === 'email' && <Check className="h-3.5 w-3.5 shrink-0" />}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="scope-option-documents"
              onClick={() => { onChange('documents'); }}
              className="flex items-center gap-2 text-xs"
            >
              <FileText className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">Documents only</span>
              {scope === 'documents' && <Check className="h-3.5 w-3.5 shrink-0" />}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              data-testid="ask-files-only-toggle"
              checked={filesOnly}
              onCheckedChange={onFilesOnlyChange}
              className="text-xs"
            >
              {FILES_ONLY_LABEL}
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

export default AskScopeControl;
