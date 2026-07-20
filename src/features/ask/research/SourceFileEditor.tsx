// Source File Editor Component
// Displays and edits .source files

import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { openExternal } from '@/platform/utils/openExternal';
import { toSafeFrameSrc } from '@/platform/security/urlAllowlist';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import { ExternalLink, Save, Calendar, Tag, Plus, X, Loader2 } from 'lucide-react';
import type { SourceCard } from '@/features/ask/types/research';

interface SourceFileEditorProps {
  filePath: string;
  initialContent: string;
  onSave: (content: string) => Promise<void>;
  className?: string;
}

export function SourceFileEditor({
  initialContent,
  onSave,
  className,
}: SourceFileEditorProps) {
  const { t } = useTranslation();
  const [sourceCard, setSourceCard] = useState<SourceCard | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Parse initial content
  useEffect(() => {
    try {
      const parsed = JSON.parse(initialContent) as SourceCard;
      setSourceCard(parsed);
      setParseError(null);
    } catch (error) {
      setParseError('Failed to parse source file. Invalid JSON format.');
      console.error('Failed to parse source file:', error);
    }
  }, [initialContent]);

  // Reset image loading state when URL changes
  useEffect(() => {
    if (sourceCard?.url) {
      setImageLoading(true);
      setImageError(false);
    }
  }, [sourceCard?.url]);

  // Timeout-based error detection for iframe loading
  useEffect(() => {
    if (sourceCard?.url && imageLoading && !imageError) {
      const timeoutId = setTimeout(() => {
        setImageLoading(false);
        setImageError(true);
      }, 5000); // 5 second timeout

      return () => clearTimeout(timeoutId);
    }
    return undefined;
  }, [sourceCard?.url, imageLoading, imageError]);

  const handleFieldChange = useCallback((field: keyof SourceCard, value: string) => {
    setSourceCard(prev => {
      if (!prev) return null;
      return { ...prev, [field]: value };
    });
    setHasChanges(true);
  }, []);

  const handleAddTag = useCallback(() => {
    const tag = tagInput.trim();
    if (tag && sourceCard) {
      const currentTags = sourceCard.tags || [];
      if (!currentTags.includes(tag)) {
        setSourceCard({ ...sourceCard, tags: [...currentTags, tag] });
        setTagInput('');
        setHasChanges(true);
      }
    }
  }, [tagInput, sourceCard]);

  const handleRemoveTag = useCallback((tagToRemove: string) => {
    if (sourceCard && sourceCard.tags) {
      setSourceCard({
        ...sourceCard,
        tags: sourceCard.tags.filter(t => t !== tagToRemove),
      });
      setHasChanges(true);
    }
  }, [sourceCard]);

  const handleSave = useCallback(async () => {
    if (!sourceCard) return;

    try {
      setIsSaving(true);
      const content = JSON.stringify(sourceCard, null, 2);
      await onSave(content);
      setHasChanges(false);
    } catch (error) {
      console.error('Failed to save source file:', error);
    } finally {
      setIsSaving(false);
    }
  }, [sourceCard, onSave]);

  // Keyboard shortcut for save (Ctrl+S / Cmd+S)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (hasChanges && !isSaving) {
          void handleSave();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasChanges, isSaving, handleSave]);

  // Auto-save effect (save after 2 seconds of no changes)
  useEffect(() => {
    if (!hasChanges || isSaving) return;

    // Clear existing timer
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    // Set new auto-save timer
    autosaveTimerRef.current = setTimeout(async () => {
      await handleSave();
    }, 2000);

    // Cleanup on unmount
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [hasChanges, isSaving, handleSave]);

  if (parseError) {
    return (
      <div className={cn('flex items-center justify-center h-full p-8', className)}>
        <div className="text-center max-w-md">
          <p className="text-destructive mb-4">{parseError}</p>
          <p className="text-sm text-muted-foreground">
            {t('research.source-editor.parse-error-help')}
          </p>
        </div>
      </div>
    );
  }

  if (!sourceCard) {
    return (
      <div className={cn('flex items-center justify-center h-full', className)}>
        <p className="text-muted-foreground">Loading source...</p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full overflow-hidden', className)}>
      {/* Header with save button */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">Source</h2>
          {hasChanges && (
            <span className="text-xs text-muted-foreground">(unsaved changes)</span>
          )}
        </div>
        <Button
          onClick={handleSave}
          disabled={!hasChanges || isSaving}
          size="sm"
          className="gap-2"
        >
          <Save className="h-4 w-4" />
          {isSaving ? 'Saving...' : 'Save'}
        </Button>
      </div>

      {/* Form fields */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* URL */}
        <div className="space-y-2">
          <Label htmlFor="url">URL</Label>
          <div className="flex gap-2">
            <Input
              id="url"
              value={sourceCard.url}
              onChange={(e) => handleFieldChange('url', e.target.value)}
              placeholder="https://example.com/article"
              className="flex-1"
            />
            {sourceCard.url && (
              <Button
                variant="outline"
                size="icon"
                onClick={() => openExternal(sourceCard.url)}
                title="Open URL in new tab"
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Website Preview */}
        {sourceCard.url && (
          <div className="space-y-2">
            <Label>Website Preview</Label>
            <div className="relative border rounded-lg overflow-hidden bg-muted/30 min-h-[120px]">
              {imageLoading && !imageError && (
                <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Loading preview...</p>
                  </div>
                </div>
              )}
              {imageError ? (
                <div className="flex items-center justify-center gap-3 py-4 px-6 bg-muted text-muted-foreground">
                  <ExternalLink className="h-5 w-5 flex-shrink-0 opacity-50" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Preview unavailable</p>
                    <p className="text-xs text-muted-foreground">
                      {t('research.source-editor.iframe-blocked')}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openExternal(sourceCard.url)}
                    className="gap-2 flex-shrink-0"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open
                  </Button>
                </div>
              ) : (
                <iframe
                  // SECURITY (render-sink S19): sourceCard.url is un-validated
                  // JSON from a `.source` workspace file (or live user input) —
                  // it can carry javascript:/data:text/html, which in this
                  // allow-scripts+allow-same-origin frame would execute in the
                  // app origin. Constrain it to http(s)/about:blank here; anything
                  // else becomes an inert about:blank (the "preview unavailable"
                  // fallback already covers sites that refuse framing).
                  src={toSafeFrameSrc(sourceCard.url)}
                  className="w-full h-full border-0"
                  title={`Preview of ${sourceCard.title || sourceCard.url}`}
                  onLoad={() => setImageLoading(false)}
                  onError={() => {
                    setImageLoading(false);
                    setImageError(true);
                  }}
                  sandbox="allow-scripts allow-same-origin"
                  style={{ display: imageLoading ? 'none' : 'block', minHeight: '300px' }}
                />
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {imageError
                ? 'This site cannot be embedded due to X-Frame-Options restrictions. Use "Open in Browser" to view.'
                : 'Live website preview. Note: Some sites block iframe embedding for security (X-Frame-Options).'
              }
            </p>
          </div>
        )}

        {/* Title */}
        <div className="space-y-2">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            value={sourceCard.title}
            onChange={(e) => handleFieldChange('title', e.target.value)}
            placeholder="Article or source title"
          />
        </div>

        {/* Date Accessed */}
        <div className="space-y-2">
          <Label htmlFor="date_accessed">Date Accessed</Label>
          <div className="flex gap-2">
            <Input
              id="date_accessed"
              type="date"
              value={sourceCard.date_accessed}
              onChange={(e) => handleFieldChange('date_accessed', e.target.value)}
              className="flex-1"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => handleFieldChange('date_accessed', new Date().toISOString().split('T')[0]!)}
              title="Set to today"
            >
              <Calendar className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Quote or Snippet */}
        <div className="space-y-2">
          <Label htmlFor="quote_or_snippet">{t('research.source-editor.quote-label')}</Label>
          <Textarea
            id="quote_or_snippet"
            value={sourceCard.quote_or_snippet}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => handleFieldChange('quote_or_snippet', e.target.value)}
            placeholder="Relevant quote or excerpt from the source..."
            rows={4}
            className="resize-y"
          />
        </div>

        {/* Claim Supported */}
        <div className="space-y-2">
          <Label htmlFor="claim_supported">Claim Supported</Label>
          <Textarea
            id="claim_supported"
            value={sourceCard.claim_supported}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => handleFieldChange('claim_supported', e.target.value)}
            placeholder="What claim or hypothesis does this source support?"
            rows={3}
            className="resize-y"
          />
        </div>

        {/* Reliability Notes */}
        <div className="space-y-2">
          <Label htmlFor="reliability_notes">Reliability Notes</Label>
          <Textarea
            id="reliability_notes"
            value={sourceCard.reliability_notes}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => handleFieldChange('reliability_notes', e.target.value)}
            placeholder="Notes on source credibility, bias, methodology, etc."
            rows={3}
            className="resize-y"
          />
        </div>

        {/* Tags */}
        <div className="space-y-2">
          <Label htmlFor="tags">Tags</Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="tags"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                placeholder="Add a tag..."
                className="pl-9"
              />
            </div>
            <Button type="button" variant="outline" onClick={handleAddTag} className="shrink-0">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {sourceCard.tags && sourceCard.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {sourceCard.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary text-secondary-foreground text-xs"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    className="hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {t('research.source-editor.tags-help')}
          </p>
        </div>

        {/* Source ID (read-only) */}
        <div className="space-y-2">
          <Label htmlFor="id">{t('research.source-editor.source-id-label')}</Label>
          <Input
            id="id"
            value={sourceCard.id}
            readOnly
            className="bg-muted/50 cursor-not-allowed"
          />
        </div>
      </div>

      {/* Footer hint */}
      <div className="px-4 py-2 border-t bg-muted/30 text-xs text-muted-foreground flex items-center justify-between">
        <span>
          {hasChanges ? (
            'Auto-saving in 2 seconds...'
          ) : (
            'Auto-save enabled'
          )}
        </span>
        <span className="opacity-60">
          <kbd className="px-1.5 py-0.5 bg-background border rounded">Ctrl+S</kbd> {t('research.source-editor.save-immediately')}
        </span>
      </div>
    </div>
  );
}

export default SourceFileEditor;
