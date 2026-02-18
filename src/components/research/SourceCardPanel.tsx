// Source Panel Component
// Displays and manages sources for research

import { useState, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  BookOpen,
  Search,
  Plus,
  CheckCircle,
  AlertCircle,
  HelpCircle,
  Tag,
  X,
} from 'lucide-react';
import type { SourceCard } from '@/types/research';
import { SourceCardForm } from './SourceCardForm';

// Utility function to extract favicon URL from a website URL
function extractFavicon(url: string): string | null {
  try {
    const urlObj = new URL(url);
    // Try common favicon location
    return `${urlObj.protocol}//${urlObj.host}/favicon.ico`;
  } catch {
    return null;
  }
}

interface SourceCardPanelProps {
  cards: SourceCard[];
  onCreateCard: (card: Omit<SourceCard, 'id'>) => void;
  onUpdateCard: (id: string, updates: Partial<SourceCard>) => void;
  onDeleteCard: (id: string) => void;
  onInsertCitation?: (cardId: string) => void;
  onOpenFile?: (cardId: string, title: string) => void;
  className?: string;
}

export function SourceCardPanel({
  cards,
  onCreateCard,
  onUpdateCard,
  onDeleteCard: _onDeleteCard, // Kept for API compatibility
  onInsertCitation: _onInsertCitation, // Kept for API compatibility
  onOpenFile,
  className,
}: SourceCardPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingCard, setEditingCard] = useState<SourceCard | null>(null);

  // Filter cards
  const filteredCards = useMemo(() => {
    let result = cards;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (card) =>
          card.title.toLowerCase().includes(query) ||
          card.quote_or_snippet.toLowerCase().includes(query) ||
          card.claim_supported.toLowerCase().includes(query) ||
          (card.tags && card.tags.some(tag => tag.toLowerCase().includes(query)))
      );
    }

    if (selectedType) {
      result = result.filter((card) => inferType(card) === selectedType);
    }

    if (selectedTag) {
      result = result.filter((card) => card.tags?.includes(selectedTag));
    }

    return result;
  }, [cards, searchQuery, selectedType, selectedTag]);

  // Get unique types
  const types = useMemo(() => {
    const typeSet = new Set<string>();
    for (const card of cards) {
      typeSet.add(inferType(card));
    }
    return Array.from(typeSet).sort();
  }, [cards]);

  // Get unique tags
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const card of cards) {
      if (card.tags) {
        card.tags.forEach(tag => tagSet.add(tag));
      }
    }
    return Array.from(tagSet).sort();
  }, [cards]);

  const handleCreateSubmit = useCallback(
    (data: Omit<SourceCard, 'id'>) => {
      onCreateCard(data);
      setShowForm(false);
    },
    [onCreateCard]
  );

  const handleEditSubmit = useCallback(
    (data: Omit<SourceCard, 'id'>) => {
      if (editingCard) {
        onUpdateCard(editingCard.id, data);
        setEditingCard(null);
      }
    },
    [editingCard, onUpdateCard]
  );

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
          <span className="font-medium">Sources</span>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Add Source
        </Button>
      </div>

      {/* Search and filters */}
      <div className="px-4 py-2 border-b space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search sources..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-8"
          />
        </div>

        {types.length > 1 && (
          <div className="flex flex-wrap gap-1">
            <Button
              variant={selectedType === null ? 'secondary' : 'ghost'}
              size="sm"
              className="h-6 text-xs"
              onClick={() => setSelectedType(null)}
            >
              All
            </Button>
            {types.map((type) => (
              <Button
                key={type}
                variant={selectedType === type ? 'secondary' : 'ghost'}
                size="sm"
                className="h-6 text-xs capitalize"
                onClick={() => setSelectedType(type)}
              >
                {type}
              </Button>
            ))}
          </div>
        )}

        {allTags.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Tag className="h-3 w-3" />
              <span>Tags:</span>
            </div>
            <div className="flex flex-wrap gap-1">
              <Button
                variant={selectedTag === null ? 'secondary' : 'ghost'}
                size="sm"
                className="h-6 text-xs"
                onClick={() => setSelectedTag(null)}
              >
                All
              </Button>
              {allTags.map((tag) => (
                <Button
                  key={tag}
                  variant={selectedTag === tag ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => setSelectedTag(tag)}
                >
                  {tag}
                  {selectedTag === tag && (
                    <X className="h-3 w-3 ml-1" />
                  )}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Card list */}
      <div className="flex-1 overflow-auto">
        {filteredCards.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-4">
            <BookOpen className="h-12 w-12 mb-2 opacity-20" />
            <p className="text-sm">
              {searchQuery ? 'No matching sources' : 'No sources yet'}
            </p>
            <Button
              variant="link"
              size="sm"
              className="mt-2"
              onClick={() => setShowForm(true)}
            >
              Add your first source
            </Button>
          </div>
        ) : (
          <div>
            {filteredCards.map((card) => (
              <SourceCardRow
                key={card.id}
                card={card}
                onOpenFile={
                  onOpenFile
                    ? () => onOpenFile(card.id, card.title)
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Source</DialogTitle>
          </DialogHeader>
          <SourceCardForm
            onSubmit={handleCreateSubmit}
            onCancel={() => setShowForm(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog
        open={editingCard !== null}
        onOpenChange={() => setEditingCard(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Source</DialogTitle>
          </DialogHeader>
          {editingCard && (
            <SourceCardForm
              initialData={editingCard}
              onSubmit={handleEditSubmit}
              onCancel={() => setEditingCard(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface SourceCardRowProps {
  card: SourceCard;
  onOpenFile?: (() => void) | undefined;
}

function SourceCardRow({
  card,
  onOpenFile,
}: SourceCardRowProps) {
  const reliability = inferReliability(card);
  const favicon = card.favicon || extractFavicon(card.url);
  const [faviconError, setFaviconError] = useState(false);

  const ReliabilityIcon =
    reliability === 'high'
      ? CheckCircle
      : reliability === 'low'
        ? AlertCircle
        : HelpCircle;

  const reliabilityColor =
    reliability === 'high'
      ? 'text-green-600 dark:text-green-400'
      : reliability === 'low'
        ? 'text-red-600 dark:text-red-400'
        : 'text-amber-600 dark:text-amber-400';

  return (
    <div className="hover:bg-muted/50 border-b last:border-0">
      {/* Simplified row - just title and open link */}
      <div className="px-4 py-3">
        <div className="flex items-start gap-3">
          <ReliabilityIcon
            className={cn('h-4 w-4 mt-0.5 flex-shrink-0', reliabilityColor)}
            aria-label={`${reliability} reliability`}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {/* Favicon display */}
              {favicon && !faviconError ? (
                <img
                  src={favicon}
                  alt=""
                  className="h-4 w-4 flex-shrink-0"
                  onError={() => setFaviconError(true)}
                />
              ) : (
                <BookOpen className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              )}
              {onOpenFile ? (
                <button
                  onClick={onOpenFile}
                  className="font-medium text-sm hover:text-primary hover:underline text-left"
                >
                  {card.title}
                </button>
              ) : (
                <span className="font-medium text-sm">{card.title}</span>
              )}
            </div>
            {card.tags && card.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {card.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs bg-secondary/50 text-secondary-foreground"
                  >
                    <Tag className="h-2.5 w-2.5" />
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function inferType(card: SourceCard): string {
  const text = `${card.title} ${card.claim_supported} ${card.url}`.toLowerCase();

  if (text.includes('competitor') || text.includes('alternative')) {
    return 'competitor';
  }
  if (text.includes('market') || text.includes('industry')) {
    return 'market';
  }
  if (text.includes('customer') || text.includes('user')) {
    return 'customer';
  }
  if (text.includes('pricing') || text.includes('cost')) {
    return 'pricing';
  }

  return 'general';
}

function inferReliability(card: SourceCard): 'high' | 'medium' | 'low' {
  const notes = card.reliability_notes.toLowerCase();

  if (
    notes.includes('verified') ||
    notes.includes('official') ||
    notes.includes('primary source') ||
    notes.includes('high confidence')
  ) {
    return 'high';
  }

  if (
    notes.includes('unverified') ||
    notes.includes('speculation') ||
    notes.includes('rumor') ||
    notes.includes('low confidence')
  ) {
    return 'low';
  }

  return 'medium';
}

export default SourceCardPanel;
