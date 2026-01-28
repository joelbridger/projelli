// Source Form Component
// Form for creating and editing sources

import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LinkIcon, Save, X, Tag, Plus } from 'lucide-react';
import type { SourceCard } from '@/types/research';

interface SourceCardFormProps {
  initialData?: Partial<SourceCard>;
  onSubmit: (data: Omit<SourceCard, 'id'>) => void;
  onCancel?: () => void;
  className?: string;
}

export function SourceCardForm({
  initialData,
  onSubmit,
  onCancel,
  className,
}: SourceCardFormProps) {
  const [url, setUrl] = useState(initialData?.url ?? '');
  const [title, setTitle] = useState(initialData?.title ?? '');
  const [quote, setQuote] = useState(initialData?.quote_or_snippet ?? '');
  const [claim, setClaim] = useState(initialData?.claim_supported ?? '');
  const [notes, setNotes] = useState(initialData?.reliability_notes ?? '');
  const [dateAccessed, setDateAccessed] = useState(
    initialData?.date_accessed ?? (new Date().toISOString().split('T')[0] ?? '')
  );
  const [tags, setTags] = useState<string[]>(initialData?.tags ?? []);
  const [tagInput, setTagInput] = useState('');

  const [urlError, setUrlError] = useState('');
  const [titleError, setTitleError] = useState('');
  const [quoteError, setQuoteError] = useState('');
  const [claimError, setClaimError] = useState('');

  const validate = useCallback((): boolean => {
    let valid = true;

    if (!url.trim()) {
      setUrlError('URL is required');
      valid = false;
    } else {
      try {
        new URL(url);
        setUrlError('');
      } catch {
        setUrlError('Invalid URL format');
        valid = false;
      }
    }

    if (!title.trim()) {
      setTitleError('Title is required');
      valid = false;
    } else {
      setTitleError('');
    }

    // Quote and claim are now optional - just clear any errors
    setQuoteError('');
    setClaimError('');

    return valid;
  }, [url, title]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      if (!validate()) return;

      const today = new Date().toISOString().split('T')[0] ?? '';
      const accessedDate = dateAccessed.trim() || today;
      const submissionData: Omit<SourceCard, 'id'> = {
        url: url.trim(),
        title: title.trim(),
        date_accessed: accessedDate,
        quote_or_snippet: quote.trim(),
        claim_supported: claim.trim(),
        reliability_notes: notes.trim(),
      };
      if (tags.length > 0) {
        submissionData.tags = tags;
      }
      onSubmit(submissionData);
    },
    [url, title, dateAccessed, quote, claim, notes, tags, validate, onSubmit]
  );

  const handleAddTag = useCallback(() => {
    const tag = tagInput.trim();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
      setTagInput('');
    }
  }, [tagInput, tags]);

  const handleRemoveTag = useCallback((tagToRemove: string) => {
    setTags(tags.filter(t => t !== tagToRemove));
  }, [tags]);

  return (
    <form onSubmit={handleSubmit} className={cn('space-y-4', className)}>
      {/* URL */}
      <div className="space-y-1">
        <label className="text-sm font-medium">Source URL *</label>
        <div className="relative">
          <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/article"
            className={cn('pl-9', urlError && 'border-destructive')}
          />
        </div>
        {urlError && <p className="text-xs text-destructive">{urlError}</p>}
      </div>

      {/* Title */}
      <div className="space-y-1">
        <label className="text-sm font-medium">Title *</label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Article or page title"
          className={cn(titleError && 'border-destructive')}
        />
        {titleError && <p className="text-xs text-destructive">{titleError}</p>}
      </div>

      {/* Date Accessed */}
      <div className="space-y-1">
        <label className="text-sm font-medium">Date Accessed</label>
        <Input
          type="date"
          value={dateAccessed}
          onChange={(e) => setDateAccessed(e.target.value)}
        />
      </div>

      {/* Quote */}
      <div className="space-y-1">
        <label className="text-sm font-medium">Quote or Snippet <span className="text-muted-foreground font-normal">(optional)</span></label>
        <textarea
          value={quote}
          onChange={(e) => setQuote(e.target.value)}
          placeholder="Copy the relevant excerpt from the source..."
          rows={3}
          className={cn(
            'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
            'ring-offset-background placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'resize-none',
            quoteError && 'border-destructive'
          )}
        />
        {quoteError && <p className="text-xs text-destructive">{quoteError}</p>}
      </div>

      {/* Claim Supported */}
      <div className="space-y-1">
        <label className="text-sm font-medium">Claim Supported <span className="text-muted-foreground font-normal">(optional)</span></label>
        <textarea
          value={claim}
          onChange={(e) => setClaim(e.target.value)}
          placeholder="What business claim does this source support?"
          rows={2}
          className={cn(
            'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
            'ring-offset-background placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'resize-none',
            claimError && 'border-destructive'
          )}
        />
        {claimError && <p className="text-xs text-destructive">{claimError}</p>}
      </div>

      {/* Reliability Notes */}
      <div className="space-y-1">
        <label className="text-sm font-medium">Reliability Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Is this a primary source? How reliable is it?"
          rows={2}
          className={cn(
            'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
            'ring-offset-background placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'resize-none'
          )}
        />
        <p className="text-xs text-muted-foreground">
          Include keywords like "verified", "official", "primary source" for high reliability,
          or "speculation", "unverified" for low reliability.
        </p>
      </div>

      {/* Tags */}
      <div className="space-y-1">
        <label className="text-sm font-medium">Tags</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
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
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {tags.map((tag) => (
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
          Add tags to organize and filter your sources (e.g., "competitor", "market-research", "pricing")
        </p>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            <X className="h-4 w-4 mr-1" />
            Cancel
          </Button>
        )}
        <Button type="submit">
          <Save className="h-4 w-4 mr-1" />
          {initialData?.id ? 'Update Source' : 'Save Source'}
        </Button>
      </div>
    </form>
  );
}

export default SourceCardForm;
