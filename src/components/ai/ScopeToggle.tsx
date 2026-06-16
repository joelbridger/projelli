import { FileText, FolderOpen, Mail } from 'lucide-react';
import { Chip } from '@/components/ui/kp';
import type { IconType } from '@/components/ui/kp';
import type { AskScope } from './askHelpers';

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
  // Build the available options based on context.
  // Email/Documents hidden on the sample matter so demo chips stay prominent.
  const options: ScopeOptionDef[] = [
    ...(hasMatter ? [{ value: 'this-matter' as AskScope, label: 'This matter', Icon: FileText }] : []),
    { value: 'all-matters' as AskScope, label: 'All matters', Icon: FolderOpen },
    ...(!isSample ? [
      { value: 'email' as AskScope, label: 'Email', Icon: Mail },
      { value: 'documents' as AskScope, label: 'Documents', Icon: FileText },
    ] : []),
  ];

  return (
    <div
      data-testid="scope-toggle"
      role="group"
      aria-label="Search scope"
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
