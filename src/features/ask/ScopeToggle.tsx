import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, ChevronDown, FileText, FolderOpen, Mail } from 'lucide-react';
import { Button } from '@/ui/kp';
import type { IconType } from '@/ui/kp';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { useFlag } from '@/platform/flags';
import { normalizeVisibleAskScope, type AskScope } from './askHelpers';

/* -------------------------------------------------------------------------- */
/* ScopeToggle — compact scope menu                                            */
/* -------------------------------------------------------------------------- */

interface ScopeOptionDef {
  value: AskScope;
  label: string;
  selectedLabel: string;
  Icon: IconType;
}

export function ScopeToggle({
  scope,
  onChange,
  hasMatter,
}: {
  scope: AskScope;
  onChange: (s: AskScope) => void;
  hasMatter: boolean;
  isSample: boolean;
}) {
  const { t } = useTranslation();
  const firmWideScopeEnabled = useFlag('own-clients-permissions');
  const normalizedScope = normalizeVisibleAskScope(scope, hasMatter);
  const visibleScope =
    !firmWideScopeEnabled &&
    (normalizedScope === 'all-matters' || normalizedScope === 'whole-practice')
      ? hasMatter
        ? 'this-matter'
        : 'documents'
      : normalizedScope;

  useEffect(() => {
    if (visibleScope !== scope) {
      onChange(visibleScope);
    }
  }, [onChange, scope, visibleScope]);

  // Build the available options based on context.
  const options: ScopeOptionDef[] = [
    ...(hasMatter ? [{
      value: 'this-matter' as AskScope,
      label: t('ask.scope-menu.this-client'),
      selectedLabel: t('ask.scope-menu.this-client'),
      Icon: FileText,
    }] : []),
    ...(firmWideScopeEnabled ? [{
      value: 'all-matters' as AskScope,
      label: t('ask.scope-menu.all-clients'),
      selectedLabel: t('ask.scope-menu.all-selected'),
      Icon: FolderOpen,
    }] : []),
    {
      value: 'email' as AskScope,
      label: t('ask.scope-menu.email'),
      selectedLabel: t('ask.scope-menu.email'),
      Icon: Mail,
    },
    {
      value: 'documents' as AskScope,
      label: t('ask.scope-menu.documents'),
      selectedLabel: t('ask.scope-menu.documents-selected'),
      Icon: FileText,
    },
    ...(firmWideScopeEnabled ? [{
      value: 'whole-practice' as AskScope,
      label: t('ask.scope-menu.book-overview'),
      selectedLabel: t('ask.scope-menu.book-selected'),
      Icon: BookOpen,
    }] : []),
  ];
  const selected = options.find((opt) => opt.value === visibleScope) ?? options[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          iconRight={ChevronDown}
          data-testid="scope-toggle"
          aria-label={t('ask.scope-toggle.aria-label')}
          style={{
            height: 34,
            padding: '0 11px',
            borderRadius: 999,
            fontWeight: 700,
          }}
        >
          {selected?.selectedLabel ?? t('ask.scope-menu.all-selected')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuRadioGroup
          value={visibleScope}
          onValueChange={(value) => { onChange(value as AskScope); }}
        >
          {options.map((opt) => (
            <DropdownMenuRadioItem
              key={opt.value}
              value={opt.value}
              data-testid={`scope-option-${opt.value}`}
            >
              <opt.Icon className="mr-2 h-3.5 w-3.5" strokeWidth={1.75} />
              {opt.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
