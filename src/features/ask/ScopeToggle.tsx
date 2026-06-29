import { FileText, FolderOpen, Mail } from 'lucide-react';
import { Chip } from '@/ui/kp';
import type { IconType } from '@/ui/kp';
import type { AskScope } from './askHelpers';
import { useEntityLabel } from '@/platform/hooks/useEntityLabel';

/* -------------------------------------------------------------------------- */
/* ScopeToggle — compact segmented pill control                                */
/* -------------------------------------------------------------------------- */

interface ScopeOptionDef {
  value: AskScope;
  label: string;
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
  const entityLabel = useEntityLabel();
  // Build the available options based on context.
  // Email/Documents hidden on the sample matter so demo chips stay prominent.
  const options: ScopeOptionDef[] = [
    ...(hasMatter ? [{ value: 'this-matter' as AskScope, label: `This ${entityLabel.one}`, Icon: FileText }] : []),
    { value: 'all-matters' as AskScope, label: `All ${entityLabel.other}`, Icon: FolderOpen },
    ...(!isSample ? [
      { value: 'email' as AskScope, label: 'Email', Icon: Mail },
      { value: 'documents' as AskScope, label: 'Documents', Icon: FileText },
    ] : []),
  ];

  return (
    <div
      data-testid="scope-toggle"
      role="group"
      aria-label="Ask scope"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
    >
      {options.map((opt) => {
        const isActive = scope === opt.value;
        return (
          <Chip
            key={opt.value}
            size="md"
            active={isActive}
            data-testid={`scope-option-${opt.value}`}
            onClick={() => { onChange(opt.value); }}
            // Demo-Ask pill sizing: larger + more spaced (brand.css .kpd-pill).
            style={{
              padding: '8px 16px',
              fontSize: '13.5px',
              fontWeight: 600,
              borderWidth: '1.5px',
              ...(isActive ? {} : { borderColor: 'var(--kp-divider-strong)' }),
            }}
          >
            {opt.label}
          </Chip>
        );
      })}
    </div>
  );
}
