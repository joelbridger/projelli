// Version History Panel Component
// Displays file version history with restore and compare capabilities

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { History, RotateCcw, Trash2, Download, X, Clock, FileText, GitCompare } from 'lucide-react';
import { getVersionService, type FileVersion } from '@/modules/versioning/VersionService';
import { DiffViewer } from '@/components/editor/DiffViewer';
import { cn } from '@/lib/utils';

interface VersionHistoryPanelProps {
  filePath: string;
  fileName: string;
  currentContent: string;
  onRestore: (content: string) => void;
  onClose: () => void;
  className?: string;
}

export function VersionHistoryPanel({
  filePath,
  fileName,
  currentContent,
  onRestore,
  onClose,
  className,
}: VersionHistoryPanelProps) {
  const [versions, setVersions] = useState<FileVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<FileVersion | null>(null);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [previewMode, setPreviewMode] = useState<'diff' | 'raw'>('diff');
  const versionService = getVersionService();

  // Load versions on mount
  useEffect(() => {
    const loadedVersions = versionService.getVersions(filePath);
    setVersions(loadedVersions);
  }, [filePath]);

  const handleRestore = useCallback(
    (version: FileVersion) => {
      if (window.confirm(`Restore file to version from ${formatDate(version.timestamp)}?`)) {
        onRestore(version.content);
        onClose();
      }
    },
    [onRestore, onClose]
  );

  const handleDelete = useCallback(
    (versionId: string) => {
      if (window.confirm('Delete this version?')) {
        versionService.deleteVersion(filePath, versionId);
        const updatedVersions = versionService.getVersions(filePath);
        setVersions(updatedVersions);
        if (selectedVersion?.id === versionId) {
          setSelectedVersion(null);
          setPreviewContent('');
        }
      }
    },
    [filePath, selectedVersion]
  );

  const handlePreview = useCallback((version: FileVersion) => {
    setSelectedVersion(version);
    setPreviewContent(version.content);
  }, []);

  const handleExport = useCallback(() => {
    const data = versionService.exportVersions();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `version-history-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className={cn('flex flex-col h-full bg-background border-l', className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold">Version History</h2>
            <p className="text-sm text-muted-foreground">{fileName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleExport} title="Export all versions">
            <Download className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Version List */}
      <div className="flex-1 overflow-y-auto">
        {versions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
            <History className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-center">No version history yet</p>
            <p className="text-sm text-center mt-2">
              Versions are saved automatically when you edit and save the file
            </p>
          </div>
        ) : (
          <div className="p-4 space-y-2">
            {versions.map((version, index) => (
              <div
                key={version.id}
                className={cn(
                  'p-3 border rounded-lg transition-colors cursor-pointer hover:bg-muted/50',
                  selectedVersion?.id === version.id && 'bg-primary/10 border-primary'
                )}
                onClick={() => handlePreview(version)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="text-sm font-medium">
                        {index === 0 ? 'Latest' : `Version ${versions.length - index}`}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(version.timestamp)}
                      </span>
                    </div>
                    {version.message && (
                      <p className="text-xs text-muted-foreground mb-1 truncate">
                        {version.message}
                      </p>
                    )}
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{formatSize(version.size)}</span>
                      {index > 0 && versions[index - 1] && (
                        <span className="text-green-600">
                          {version.size > versions[index - 1]!.size
                            ? `+${formatSize(version.size - versions[index - 1]!.size)}`
                            : `-${formatSize(versions[index - 1]!.size - version.size)}`}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRestore(version);
                      }}
                      title="Restore this version"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                    {index !== 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(version.id);
                        }}
                        title="Delete this version"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Preview Panel */}
      {selectedVersion && (
        <div className="border-t bg-muted/30 flex flex-col max-h-96">
          <div className="flex items-center justify-between p-3 border-b bg-muted/50">
            <div className="flex items-center gap-2">
              {previewMode === 'diff' ? (
                <GitCompare className="h-4 w-4 text-muted-foreground" />
              ) : (
                <FileText className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="text-sm font-medium">Preview</span>
              <div className="flex items-center gap-1 ml-2">
                <Button
                  variant={previewMode === 'diff' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => setPreviewMode('diff')}
                >
                  Diff
                </Button>
                <Button
                  variant={previewMode === 'raw' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => setPreviewMode('raw')}
                >
                  Raw
                </Button>
              </div>
            </div>
            <Button
              variant="default"
              size="sm"
              onClick={() => handleRestore(selectedVersion)}
            >
              <RotateCcw className="h-3.5 w-3.5 mr-2" />
              Restore
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {previewMode === 'diff' ? (
              <DiffViewer
                originalContent={previewContent}
                modifiedContent={currentContent}
                originalLabel={`Version ${versions.findIndex((v) => v.id === selectedVersion.id) + 1}`}
                modifiedLabel="Current"
                showLineNumbers={true}
                viewMode="unified"
              />
            ) : (
              <pre className="text-xs bg-background border rounded p-3 overflow-x-auto whitespace-pre-wrap break-words">
                {previewContent}
              </pre>
            )}
          </div>
        </div>
      )}

      {/* Stats Footer */}
      {versions.length > 0 && (
        <div className="border-t p-3 bg-muted/20">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{versions.length} version{versions.length > 1 ? 's' : ''}</span>
            <span>
              Total: {formatSize(versions.reduce((sum, v) => sum + v.size, 0))}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
