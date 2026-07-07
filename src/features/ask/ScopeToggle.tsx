import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, FolderOpen, Mail } from 'lucide-react';
import { Chip } from '@/ui/kp';
import type { IconType } from '@/ui/kp';
import { normalizeVisibleAskScope, type AskScope } from './askHelpers';
import { useEntityLabel } from '@/platform/hooks/useEntityLabel';

/* -------------------------------------------------------------------------- */
/* ScopeToggle — compact segmented pill control                                */
/* -------------------------------------------------------------------------- */

interface ScopeOptionDef {
  value: AskScope;
  label: string;
  helper?: string;
  Icon: IconType;
}

export function ScopeToggle({
  scope,
  onChange,
  hasMatter,
  isSample,
}: {
  scope: AskScope;
  onChange: (s: AskScope) => void;
  hasMatter: boolean;
  isSample: boolean;
}) {
  const { t } = useTranslation();
  const entityLabel = useEntityLabel();
  const visibleScope = normalizeVisibleAskScope(scope, hasMatter);

  useEffect(() => {
    if (visibleScope !== scope) {
      onChange(visibleScope);
    }
  }, [onChange, scope, visibleScope]);

  // Build the available options based on context.
  // Email/Documents hidden on the sample matter so demo chips stay prominent.
  const options: ScopeOptionDef[] = [
    ...(hasMatter ? [{ value: 'this-matter' as AskScope, label: t('ask.scope-toggle.this-entity', { entity: entityLabel.one }), Icon: FileText }] : []),
    { value: 'all-matters' as AskScope, label: t('ask.scope-toggle.all-entity', { entity: entityLabel.other }), Icon: FolderOpen },
    ...(!isSample ? [
      { value: 'email' as AskScope, label: t('ask.scope-pill.email'), Icon: Mail },
      { value: 'documents' as AskScope, label: t('ask.scope-pill.documents'), Icon: FileText },
    ] : []),
  ];

  return (
    <div
      data-testid="scope-toggle"
      role="group"
      aria-label={t('ask.scope-toggle.aria-label')}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
    >
      {options.map((opt) => {
        const isActive = visibleScope === opt.value;
        return (
          <Chip
            key={opt.value}
            size="pill"
            active={isActive}
            data-testid={`scope-option-${opt.value}`}
            onClick={() => { onChange(opt.value); }}
          >
            {opt.helper ? (
              <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.15 }}>
                <span>{opt.label}</span>
                <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.72 }}>{opt.helper}</span>
              </span>
            ) : opt.label}
          </Chip>
        );
      })}
    </div>
  );
}

/** The always-visible "Asking: ..." pill (spec: Ask always displays its
 *  current scope, one click to switch — the click target is the ScopeToggle
 *  above; this pill is a read-only status label). */
function scopePillLabel(scope: AskScope, t: (key: string) => string): string {
  switch (scope) {
    case 'this-matter':
      return t('ask.scope-pill.this-matter');
    case 'all-matters':
      return t('ask.scope-pill.all-matters');
    case 'email':
      return t('ask.scope-pill.email');
    case 'documents':
      return t('ask.scope-pill.documents');
    case 'whole-practice':
      return t('ask.book.option-label');
  }
}

export function ScopeStatusPill({ scope }: { scope: AskScope }) {
  const { t } = useTranslation();
  return (
    <Chip size="sm" active data-testid="ask-scope-pill" style={{ pointerEvents: 'none' }}>
      {scopePillLabel(scope, t)}
    </Chip>
  );
}
