// Source Service
// Manages research sources for citations and evidence

import type { SourceCard } from '@/types/research';

export interface SourceCardQuery {
  /** Filter by topic tags */
  topics?: string[];
  /** Filter by type (competitor, market, customer, etc.) */
  types?: string[];
  /** Filter by reliability (high, medium, low) */
  reliability?: ('high' | 'medium' | 'low')[];
  /** Search in title, quote, or claim */
  search?: string;
  /** Date range - start */
  startDate?: Date;
  /** Date range - end */
  endDate?: Date;
  /** Maximum number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

export interface SourceCardStats {
  totalCards: number;
  byType: Record<string, number>;
  byReliability: Record<string, number>;
  recentlyAdded: number; // Last 7 days
}

/**
 * SourceCardService manages research sources
 */
export class SourceCardService {
  private cards: Map<string, SourceCard> = new Map();
  private readonly storageKey: string;

  constructor(workspaceId: string = 'default') {
    this.storageKey = `source_cards_${workspaceId}`;
    this.load();
  }

  /**
   * Create a new source
   */
  create(card: Omit<SourceCard, 'id'>): SourceCard {
    const id = this.generateId();
    const today = new Date().toISOString().split('T')[0] ?? '';
    const dateAccessed = card.date_accessed || today;
    const newCard: SourceCard = {
      id,
      url: card.url,
      title: card.title,
      date_accessed: dateAccessed,
      quote_or_snippet: card.quote_or_snippet,
      claim_supported: card.claim_supported,
      reliability_notes: card.reliability_notes,
    };

    this.cards.set(id, newCard);
    this.persist();
    return newCard;
  }

  /**
   * Get a source by ID
   */
  get(id: string): SourceCard | undefined {
    return this.cards.get(id);
  }

  /**
   * Update a source
   */
  update(id: string, updates: Partial<SourceCard>): SourceCard | undefined {
    const existing = this.cards.get(id);
    if (!existing) return undefined;

    const updated: SourceCard = { ...existing, ...updates, id }; // Preserve ID
    this.cards.set(id, updated);
    this.persist();
    return updated;
  }

  /**
   * Delete a source
   */
  delete(id: string): boolean {
    const deleted = this.cards.delete(id);
    if (deleted) {
      this.persist();
    }
    return deleted;
  }

  /**
   * Query sources with filters
   */
  query(options: SourceCardQuery = {}): SourceCard[] {
    let results = Array.from(this.cards.values());

    // Filter by topics
    if (options.topics && options.topics.length > 0) {
      results = results.filter((card) => {
        const cardTopics = this.extractTopics(card);
        return options.topics!.some((topic) =>
          cardTopics.some((t) => t.toLowerCase().includes(topic.toLowerCase()))
        );
      });
    }

    // Filter by types
    if (options.types && options.types.length > 0) {
      results = results.filter((card) => {
        const cardType = this.inferType(card);
        return options.types!.includes(cardType);
      });
    }

    // Filter by reliability
    if (options.reliability && options.reliability.length > 0) {
      results = results.filter((card) => {
        const reliability = this.inferReliability(card);
        return options.reliability!.includes(reliability);
      });
    }

    // Search
    if (options.search) {
      const query = options.search.toLowerCase();
      results = results.filter(
        (card) =>
          card.title.toLowerCase().includes(query) ||
          card.quote_or_snippet.toLowerCase().includes(query) ||
          card.claim_supported.toLowerCase().includes(query) ||
          card.reliability_notes.toLowerCase().includes(query)
      );
    }

    // Filter by date range
    if (options.startDate) {
      const startTime = options.startDate.getTime();
      results = results.filter(
        (card) => new Date(card.date_accessed).getTime() >= startTime
      );
    }
    if (options.endDate) {
      const endTime = options.endDate.getTime();
      results = results.filter(
        (card) => new Date(card.date_accessed).getTime() <= endTime
      );
    }

    // Sort by date accessed descending
    results.sort(
      (a, b) =>
        new Date(b.date_accessed).getTime() - new Date(a.date_accessed).getTime()
    );

    // Apply pagination
    const offset = options.offset ?? 0;
    const limit = options.limit ?? results.length;
    return results.slice(offset, offset + limit);
  }

  /**
   * Get all sources
   */
  getAll(): SourceCard[] {
    return Array.from(this.cards.values());
  }

  /**
   * Get cards by URL domain
   */
  getByDomain(domain: string): SourceCard[] {
    return this.getAll().filter((card) => {
      try {
        const url = new URL(card.url);
        return url.hostname.includes(domain);
      } catch {
        return false;
      }
    });
  }

  /**
   * Get cards that support a specific claim
   */
  getByClaimKeyword(keyword: string): SourceCard[] {
    const lowerKeyword = keyword.toLowerCase();
    return this.getAll().filter((card) =>
      card.claim_supported.toLowerCase().includes(lowerKeyword)
    );
  }

  /**
   * Get statistics
   */
  getStats(): SourceCardStats {
    const cards = this.getAll();
    const byType: Record<string, number> = {};
    const byReliability: Record<string, number> = {};
    let recentlyAdded = 0;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    for (const card of cards) {
      // Count by type
      const type = this.inferType(card);
      byType[type] = (byType[type] ?? 0) + 1;

      // Count by reliability
      const reliability = this.inferReliability(card);
      byReliability[reliability] = (byReliability[reliability] ?? 0) + 1;

      // Count recent
      if (new Date(card.date_accessed) >= sevenDaysAgo) {
        recentlyAdded++;
      }
    }

    return {
      totalCards: cards.length,
      byType,
      byReliability,
      recentlyAdded,
    };
  }

  /**
   * Generate a citation reference
   */
  getCitationRef(id: string): string {
    return `[src:${id}]`;
  }

  /**
   * Parse citation references from text
   */
  parseCitations(text: string): string[] {
    const regex = /\[src:([^\]]+)\]/g;
    const citations: string[] = [];
    let match;

    while ((match = regex.exec(text)) !== null) {
      if (match[1]) {
        citations.push(match[1]);
      }
    }

    return [...new Set(citations)];
  }

  /**
   * Get cards referenced in text
   */
  getReferencedCards(text: string): SourceCard[] {
    const ids = this.parseCitations(text);
    return ids
      .map((id) => this.get(id))
      .filter((card): card is SourceCard => card !== undefined);
  }

  /**
   * Export to JSON
   */
  exportJSON(): string {
    return JSON.stringify(Array.from(this.cards.values()), null, 2);
  }

  /**
   * Import from JSON
   */
  importJSON(json: string): number {
    const data = JSON.parse(json) as SourceCard[];
    let imported = 0;

    for (const card of data) {
      if (card.id && !this.cards.has(card.id)) {
        this.cards.set(card.id, card);
        imported++;
      }
    }

    this.persist();
    return imported;
  }

  /**
   * Clear all cards
   */
  clear(): void {
    this.cards.clear();
    this.persist();
  }

  /**
   * Create source from URL metadata
   */
  createFromUrl(url: string, metadata: {
    title: string;
    snippet: string;
    claim: string;
    notes?: string;
  }): SourceCard {
    const today = new Date().toISOString().split('T')[0] ?? '';
    return this.create({
      url,
      title: metadata.title,
      date_accessed: today,
      quote_or_snippet: metadata.snippet,
      claim_supported: metadata.claim,
      reliability_notes: metadata.notes ?? '',
    });
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `src_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * Extract topics from card content
   */
  private extractTopics(card: SourceCard): string[] {
    const text = `${card.title} ${card.claim_supported}`.toLowerCase();
    const topics: string[] = [];

    // Simple topic extraction based on keywords
    const keywords = [
      'competitor',
      'market',
      'customer',
      'pricing',
      'product',
      'technology',
      'trend',
      'research',
      'analysis',
      'report',
    ];

    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        topics.push(keyword);
      }
    }

    return topics;
  }

  /**
   * Infer source type from content
   */
  private inferType(card: SourceCard): string {
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
    if (text.includes('technology') || text.includes('tech')) {
      return 'technology';
    }

    return 'general';
  }

  /**
   * Infer reliability from notes
   */
  private inferReliability(card: SourceCard): 'high' | 'medium' | 'low' {
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

  /**
   * Load from localStorage
   */
  private load(): void {
    if (typeof localStorage === 'undefined') return;

    try {
      const data = localStorage.getItem(this.storageKey);
      if (data) {
        const cards = JSON.parse(data) as SourceCard[];
        this.cards.clear();
        for (const card of cards) {
          this.cards.set(card.id, card);
        }
      }
    } catch {
      // Ignore load errors
    }
  }

  /**
   * Persist to localStorage
   */
  private persist(): void {
    if (typeof localStorage === 'undefined') return;

    try {
      const data = Array.from(this.cards.values());
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch {
      // Ignore storage errors
    }
  }
}

/**
 * Create a source service instance
 */
export function createSourceCardService(workspaceId?: string): SourceCardService {
  return new SourceCardService(workspaceId);
}
