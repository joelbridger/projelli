// Spreadsheet loading + error state components extracted from
// SpreadsheetViewer.tsx (behavior-preserving 3.0 reorg). The loading
// skeleton and the parse-error fallback. Pure presentational.

import { useTranslation } from 'react-i18next';
import { AlertTriangle, ExternalLink, FileSpreadsheet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/button';
import { openExternal } from '@/utils/openExternal';

export function SpreadsheetSkeleton({ fileName, className }: { fileName: string; className?: string | undefined }) {
  return (
    <div
      data-testid="spreadsheet-loading"
      className={cn('flex h-full flex-col items-center justify-center gap-2 text-muted-foreground', className)}
    >
      <FileSpreadsheet className="h-10 w-10 animate-pulse opacity-50" />
      <p className="text-sm">Opening {fileName}...</p>
    </div>
  );
}

export interface SpreadsheetErrorProps {
  fileName: string;
  message: string;
  className?: string | undefined;
}

export function SpreadsheetError({ fileName, message, className }: SpreadsheetErrorProps) {
  const { t } = useTranslation();
  return (
    <div
      data-testid="spreadsheet-error"
      className={cn('flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground', className)}
    >
      <AlertTriangle className="h-10 w-10 text-destructive opacity-70" />
      <div>
        <p className="text-sm font-medium text-foreground">{t('media.spreadsheet.could-not-open', { fileName })}</p>
        <p className="mt-1 text-xs text-muted-foreground">{message}</p>
      </div>
      {/* TODO: When we wire up the Tauri command for opening the original file
          from disk, swap this for `openExternal(filePath)` against the absolute
          path. For now, this is a no-op placeholder so the UI is consistent. */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          void openExternal('https://support.microsoft.com/excel');
        }}
      >
        <ExternalLink className="mr-2 h-4 w-4" />
        {t('media.spreadsheet.open-native')}
      </Button>
    </div>
  );
}
