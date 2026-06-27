import { FileText, FolderOpen, Mail } from 'lucide-react';
import { Chip } from '@/ui/kp';
import type { IconType } from '@/ui/kp';
import type { AskScope } from './askHelpers';
import { useEntityLabel } from '@/platform/hooks/useEntityLabel';
import { useNewNav } from '@/platform/flags/newNav';

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
  const newNav = useNewNav();
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
      aria-label={newNav ? 'Ask scope' : 'Search scope'}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
    >
      {options.map((opt) => (
        <Chip
          key={opt.value}
          size="md"
          active={scope === opt.value}
          data-testid={`scope-option-${opt.value}`}
          onClick={() => { onChange(opt.value); }}
        >
          {opt.label}
        </Chip>
      ))}
    </div>
  );
}
