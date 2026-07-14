import { FileText, FolderOpen, Plus, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/ui/kp';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';

export interface DocumentsCreateMenuProps {
  onCreateDocument?: () => void;
  onCreateFolder?: () => void;
  onAddFiles?: () => void;
  disabled?: boolean;
}

/** Shared Documents create doorway used by both the global and client-scoped views. */
export function DocumentsCreateMenu({
  onCreateDocument,
  onCreateFolder,
  onAddFiles,
  disabled = false,
}: DocumentsCreateMenuProps) {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          data-testid="documents-files-create-menu"
          icon={Plus}
          label={t('workspace.documents.create-menu')}
          size="sm"
          variant="ghost"
          disabled={disabled}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem
          data-testid="documents-create-document"
          {...(onCreateDocument ? { onSelect: onCreateDocument } : {})}
          disabled={!onCreateDocument}
          className="gap-2"
        >
          <FileText className="h-3.5 w-3.5 text-blue-600" />
          {t('workspace.documents.new-document')}
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid="documents-create-folder"
          {...(onCreateFolder ? { onSelect: onCreateFolder } : {})}
          disabled={!onCreateFolder}
          className="gap-2"
        >
          <FolderOpen className="h-3.5 w-3.5 text-[var(--kp-navy)]" />
          {t('workspace.documents.new-folder')}
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid="add-files-btn"
          {...(onAddFiles ? { onSelect: onAddFiles } : {})}
          disabled={!onAddFiles}
          className="gap-2"
        >
          <Upload className="h-3.5 w-3.5 text-[var(--kp-navy)]" />
          {t('workspace.documents.add-files')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
