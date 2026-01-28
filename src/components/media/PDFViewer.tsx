// PDF Viewer Component
// Displays PDF files using an iframe with blob URL for better compatibility

import { useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  ZoomIn,
  ZoomOut,
  Download,
  ExternalLink,
  FileText,
} from 'lucide-react';

interface PDFViewerProps {
  src: string; // Data URL or blob URL
  fileName?: string;
  className?: string;
}

/**
 * Convert a data URL to a blob URL for better browser compatibility
 */
function dataUrlToBlobUrl(dataUrl: string): string {
  try {
    const parts = dataUrl.split(',');
    if (parts.length !== 2) return dataUrl;

    const mimeMatch = parts[0]?.match(/data:([^;]+)/);
    const mimeType = mimeMatch?.[1] ?? 'application/pdf';
    const base64Data = parts[1] ?? '';

    const byteString = atob(base64Data);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }

    const blob = new Blob([ab], { type: mimeType });
    return URL.createObjectURL(blob);
  } catch (e) {
    console.error('Failed to convert data URL to blob URL:', e);
    return dataUrl;
  }
}

export function PDFViewer({ src, fileName = 'document.pdf', className }: PDFViewerProps) {
  const [zoom, setZoom] = useState(100);
  const [loadError, setLoadError] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  // Convert data URL to blob URL for better browser compatibility
  useEffect(() => {
    if (src.startsWith('data:')) {
      const url = dataUrlToBlobUrl(src);
      setBlobUrl(url);
      return () => {
        if (url !== src) {
          void URL.revokeObjectURL(url);
        }
      };
    }
    setBlobUrl(src);
    return undefined;
  }, [src]);

  const handleZoomIn = useCallback(() => {
    setZoom(prev => Math.min(prev + 25, 200));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom(prev => Math.max(prev - 25, 50));
  }, []);

  const handleDownload = useCallback(() => {
    const link = document.createElement('a');
    link.href = blobUrl ?? src;
    link.download = fileName;
    link.click();
  }, [blobUrl, src, fileName]);

  const handleOpenExternal = useCallback(() => {
    if (blobUrl) {
      window.open(blobUrl, '_blank');
    } else {
      window.open(src, '_blank');
    }
  }, [blobUrl, src]);

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b bg-muted/30">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleZoomOut}
          title="Zoom out"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="text-xs text-muted-foreground w-12 text-center">
          {zoom}%
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleZoomIn}
          title="Zoom in"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleDownload}
          title="Download"
        >
          <Download className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleOpenExternal}
          title="Open in new tab"
        >
          <ExternalLink className="h-4 w-4" />
        </Button>
      </div>

      {/* PDF container */}
      <div className="flex-1 overflow-hidden bg-muted/20 flex items-center justify-center">
        {loadError || !blobUrl ? (
          <div className="text-center p-8">
            <FileText className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-lg font-medium mb-2">
              {!blobUrl ? 'Loading PDF...' : 'PDF Preview Not Available'}
            </p>
            {loadError && (
              <>
                <p className="text-sm text-muted-foreground mb-4">
                  Your browser may not support inline PDF viewing.
                </p>
                <div className="flex gap-2 justify-center">
                  <Button variant="outline" onClick={handleDownload}>
                    <Download className="h-4 w-4 mr-2" />
                    Download PDF
                  </Button>
                  <Button variant="outline" onClick={handleOpenExternal}>
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Open in New Tab
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : (
          <iframe
            src={blobUrl}
            title={fileName}
            className="border-0 w-full h-full"
            style={{
              transform: zoom !== 100 ? `scale(${zoom / 100})` : undefined,
              transformOrigin: 'top left',
              width: zoom !== 100 ? `${10000 / zoom}%` : '100%',
              height: zoom !== 100 ? `${10000 / zoom}%` : '100%',
            }}
            onError={() => setLoadError(true)}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Check if a file extension is a PDF
 */
export function isPDFFile(extension: string | undefined): boolean {
  if (!extension) return false;
  return extension.toLowerCase() === 'pdf';
}

/**
 * Check if a file is a spreadsheet
 */
export function isSpreadsheetFile(extension: string | undefined): boolean {
  if (!extension) return false;
  const spreadsheetExtensions = ['xlsx', 'xls', 'csv'];
  return spreadsheetExtensions.includes(extension.toLowerCase());
}

/**
 * Check if a file is a presentation
 */
export function isPresentationFile(extension: string | undefined): boolean {
  if (!extension) return false;
  const presentationExtensions = ['pptx', 'ppt'];
  return presentationExtensions.includes(extension.toLowerCase());
}

/**
 * Check if a file is a Word document
 */
export function isWordFile(extension: string | undefined): boolean {
  if (!extension) return false;
  const wordExtensions = ['docx', 'doc'];
  return wordExtensions.includes(extension.toLowerCase());
}

export default PDFViewer;
