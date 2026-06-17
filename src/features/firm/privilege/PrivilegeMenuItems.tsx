/**
 * PrivilegeMenuItems (WS-PRIV) — a dropdown SUB-MENU for tagging a single
 * source's privilege. Drop it inside any `DropdownMenuContent` (the file-tree
 * context menu, the editor header menu, the mail header menu) and pass the
 * source id (a file path, a `mail:<id>`, or a `.aichat` path).
 *
 * It reads + writes the privilege store directly, so the host menu does not
 * have to thread privilege state through. On change it ALSO triggers the engine
 * re-tag via the privilege store subscription in `usePrivilegeWiring`
 * (`useMemoryWiring`), so the source's indexed chunks are excluded from default
 * retrieval immediately.
 *
 * The three statuses are a radio group (a source has exactly one privilege),
 * with a short explanation that privileged content is kept out of AI retrieval.
 */

import { ShieldCheck } from 'lucide-react';
import {
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/ui/dropdown-menu';
import { usePrivilegeStore, usePrivilegeForSource } from '@/platform/firm/privilegeStore';
import {
  ALL_PRIVILEGE_STATUSES,
  privilegeLabel,
  type Privilege,
} from '@/platform/types/privilege';

export interface PrivilegeMenuItemsProps {
  /** The source being tagged: a file path, `mail:<id>`, or `.aichat` path. */
  sourceId: string;
  /** Optional: called after the privilege is changed (e.g. to close the menu). */
  onChanged?: (privilege: Privilege) => void;
}

export function PrivilegeMenuItems({ sourceId, onChanged }: PrivilegeMenuItemsProps) {
  const current = usePrivilegeForSource(sourceId);
  const setPrivilege = usePrivilegeStore((s) => s.setPrivilege);

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid="privilege-menu-trigger" data-privilege={current}>
        <ShieldCheck className="h-3.5 w-3.5 mr-2" />
        Privilege
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Privileged sources are kept out of AI retrieval by default.
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(value) => {
            const next = value as Privilege;
            setPrivilege(sourceId, next);
            onChanged?.(next);
          }}
        >
          {ALL_PRIVILEGE_STATUSES.map((status) => (
            <DropdownMenuRadioItem
              key={status}
              value={status}
              data-testid={`privilege-option-${status}`}
              className="text-xs"
            >
              {privilegeLabel(status)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export default PrivilegeMenuItems;
