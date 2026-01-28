// Search Service
// Full-text search using a simple in-memory index
// Designed to be replaceable with FlexSearch or embeddings later

export interface SearchDocument {
  id: string;
  path: string;
  title: string;
  content: string;
  tags?: string[];
  type?: string;
  modifiedAt?: Date;
}

export interface SearchResult {
  id: string;
  path: string;
  title: string;
  score: number;
  matches: SearchMatch[];
  snippet?: string;
}

export interface SearchMatch {
  field: 'title' | 'content' | 'tags';
  indices: [number, number][];
}

export interface SearchOptions {
  /** Fields to search in */
  fields?: ('title' | 'content' | 'tags')[];
  /** Filter by type */
  type?: string;
  /** Filter by tags */
  tags?: string[];
  /** Maximum results */
  limit?: number;
  /** Minimum score threshold (0-1) */
  threshold?: number;
  /** Include content snippets */
  includeSnippets?: boolean;
  /** Context size for snippets */
  snippetContext?: number;
}

/**
 * SearchService provides full-text search across documents
 */
export class SearchService {
  private documents: Map<string, SearchDocument> = new Map();
  private titleIndex: Map<string, Set<string>> = new Map(); // term -> doc IDs
  private contentIndex: Map<string, Set<string>> = new Map();
  private tagIndex: Map<string, Set<string>> = new Map();

  /**
   * Add or update a document in the index
   */
  index(doc: SearchDocument): void {
    // Remove existing if updating
    if (this.documents.has(doc.id)) {
      this.remove(doc.id);
    }

    this.documents.set(doc.id, doc);

    // Index title
    const titleTerms = this.tokenize(doc.title);
    for (const term of titleTerms) {
      if (!this.titleIndex.has(term)) {
        this.titleIndex.set(term, new Set());
      }
      this.titleIndex.get(term)!.add(doc.id);
    }

    // Index content
    const contentTerms = this.tokenize(doc.content);
    for (const term of contentTerms) {
      if (!this.contentIndex.has(term)) {
        this.contentIndex.set(term, new Set());
      }
      this.contentIndex.get(term)!.add(doc.id);
    }

    // Index tags
    if (doc.tags) {
      for (const tag of doc.tags) {
        const normalizedTag = tag.toLowerCase();
        if (!this.tagIndex.has(normalizedTag)) {
          this.tagIndex.set(normalizedTag, new Set());
        }
        this.tagIndex.get(normalizedTag)!.add(doc.id);
      }
    }
  }

  /**
   * Remove a document from the index
   */
  remove(id: string): boolean {
    const doc = this.documents.get(id);
    if (!doc) return false;

    // Remove from title index
    const titleTerms = this.tokenize(doc.title);
    for (const term of titleTerms) {
      this.titleIndex.get(term)?.delete(id);
    }

    // Remove from content index
    const contentTerms = this.tokenize(doc.content);
    for (const term of contentTerms) {
      this.contentIndex.get(term)?.delete(id);
    }

    // Remove from tag index
    if (doc.tags) {
      for (const tag of doc.tags) {
        this.tagIndex.get(tag.toLowerCase())?.delete(id);
      }
    }

    return this.documents.delete(id);
  }

  /**
   * Search documents
   */
  search(query: string, options: SearchOptions = {}): SearchResult[] {
    const {
      fields = ['title', 'content', 'tags'],
      type,
      tags,
      limit = 50,
      threshold = 0,
      includeSnippets = true,
      snippetContext = 50,
    } = options;

    // Handle fielded search (e.g., "title:example" or "tag:business")
    const { parsedQuery, fieldFilters } = this.parseQuery(query);

    if (!parsedQuery && fieldFilters.length === 0) {
      return [];
    }

    const queryTerms = this.tokenize(parsedQuery);
    const scores = new Map<string, number>();
    const matches = new Map<string, SearchMatch[]>();

    // Search in specified fields
    for (const term of queryTerms) {
      const prefixMatches = this.getPrefixMatches(term);

      if (fields.includes('title')) {
        for (const matchTerm of prefixMatches) {
          const docIds = this.titleIndex.get(matchTerm);
          if (docIds) {
            for (const id of docIds) {
              scores.set(id, (scores.get(id) ?? 0) + 10); // Title matches weighted higher
              this.addMatch(matches, id, 'title', term);
            }
          }
        }
      }

      if (fields.includes('content')) {
        for (const matchTerm of prefixMatches) {
          const docIds = this.contentIndex.get(matchTerm);
          if (docIds) {
            for (const id of docIds) {
              scores.set(id, (scores.get(id) ?? 0) + 1);
              this.addMatch(matches, id, 'content', term);
            }
          }
        }
      }

      if (fields.includes('tags')) {
        for (const matchTerm of prefixMatches) {
          const docIds = this.tagIndex.get(matchTerm);
          if (docIds) {
            for (const id of docIds) {
              scores.set(id, (scores.get(id) ?? 0) + 5);
              this.addMatch(matches, id, 'tags', term);
            }
          }
        }
      }
    }

    // Apply field filters
    for (const filter of fieldFilters) {
      if (filter.field === 'title') {
        const term = filter.value.toLowerCase();
        const docIds = this.titleIndex.get(term);
        if (docIds) {
          for (const id of docIds) {
            scores.set(id, (scores.get(id) ?? 0) + 20);
          }
        }
      } else if (filter.field === 'tag') {
        const docIds = this.tagIndex.get(filter.value.toLowerCase());
        if (docIds) {
          for (const id of docIds) {
            scores.set(id, (scores.get(id) ?? 0) + 15);
          }
        }
      }
    }

    // Build results
    let results: SearchResult[] = [];

    for (const [id, score] of scores) {
      const doc = this.documents.get(id);
      if (!doc) continue;

      // Apply type filter
      if (type && doc.type !== type) continue;

      // Apply tag filter
      if (tags && tags.length > 0) {
        const docTags = doc.tags?.map((t) => t.toLowerCase()) ?? [];
        const hasMatchingTag = tags.some((t) =>
          docTags.includes(t.toLowerCase())
        );
        if (!hasMatchingTag) continue;
      }

      // Normalize score (0-1)
      const maxPossibleScore = queryTerms.length * 15; // Assuming title match
      const normalizedScore = Math.min(score / maxPossibleScore, 1);

      if (normalizedScore < threshold) continue;

      const result: SearchResult = {
        id: doc.id,
        path: doc.path,
        title: doc.title,
        score: normalizedScore,
        matches: matches.get(id) ?? [],
      };

      // Add snippet
      if (includeSnippets && doc.content) {
        result.snippet = this.createSnippet(
          doc.content,
          queryTerms,
          snippetContext
        );
      }

      results.push(result);
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    // Apply limit
    return results.slice(0, limit);
  }

  /**
   * Get document count
   */
  getDocumentCount(): number {
    return this.documents.size;
  }

  /**
   * Get all document IDs
   */
  getDocumentIds(): string[] {
    return Array.from(this.documents.keys());
  }

  /**
   * Get a document by ID
   */
  getDocument(id: string): SearchDocument | undefined {
    return this.documents.get(id);
  }

  /**
   * Clear the entire index
   */
  clear(): void {
    this.documents.clear();
    this.titleIndex.clear();
    this.contentIndex.clear();
    this.tagIndex.clear();
  }

  /**
   * Get index statistics
   */
  getStats(): {
    documentCount: number;
    titleTermCount: number;
    contentTermCount: number;
    tagCount: number;
  } {
    return {
      documentCount: this.documents.size,
      titleTermCount: this.titleIndex.size,
      contentTermCount: this.contentIndex.size,
      tagCount: this.tagIndex.size,
    };
  }

  /**
   * Tokenize text into searchable terms
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((term) => term.length >= 2);
  }

  /**
   * Get terms that match a prefix
   */
  private getPrefixMatches(prefix: string): string[] {
    const matches: string[] = [];
    const allTerms = new Set([
      ...this.titleIndex.keys(),
      ...this.contentIndex.keys(),
      ...this.tagIndex.keys(),
    ]);

    for (const term of allTerms) {
      if (term.startsWith(prefix)) {
        matches.push(term);
      }
    }

    // Include exact match
    if (!matches.includes(prefix)) {
      matches.push(prefix);
    }

    return matches;
  }

  /**
   * Parse query for field filters (e.g., "title:example")
   */
  private parseQuery(query: string): {
    parsedQuery: string;
    fieldFilters: { field: string; value: string }[];
  } {
    const fieldFilters: { field: string; value: string }[] = [];
    let parsedQuery = query;

    // Match field:value patterns
    const fieldPattern = /(\w+):(\w+)/g;
    let match;

    while ((match = fieldPattern.exec(query)) !== null) {
      const field = match[1];
      const value = match[2];
      if (field && value) {
        fieldFilters.push({ field, value });
        parsedQuery = parsedQuery.replace(match[0], '').trim();
      }
    }

    return { parsedQuery, fieldFilters };
  }

  /**
   * Add a match to the matches map
   */
  private addMatch(
    matches: Map<string, SearchMatch[]>,
    docId: string,
    field: 'title' | 'content' | 'tags',
    _term: string
  ): void {
    if (!matches.has(docId)) {
      matches.set(docId, []);
    }

    const docMatches = matches.get(docId)!;
    let fieldMatch = docMatches.find((m) => m.field === field);

    if (!fieldMatch) {
      fieldMatch = { field, indices: [] };
      docMatches.push(fieldMatch);
    }

    // Note: For simplicity, we don't track exact indices
    // A real implementation would store character positions
  }

  /**
   * Create a snippet showing context around matches
   */
  private createSnippet(
    content: string,
    terms: string[],
    contextSize: number
  ): string {
    const lowerContent = content.toLowerCase();
    let bestIndex = -1;
    let bestTermCount = 0;

    // Find position with most term matches nearby
    for (const term of terms) {
      const index = lowerContent.indexOf(term);
      if (index !== -1) {
        // Count nearby terms
        const windowStart = Math.max(0, index - contextSize);
        const windowEnd = Math.min(content.length, index + term.length + contextSize);
        const window = lowerContent.slice(windowStart, windowEnd);

        let termCount = 0;
        for (const t of terms) {
          if (window.includes(t)) termCount++;
        }

        if (termCount > bestTermCount) {
          bestTermCount = termCount;
          bestIndex = index;
        }
      }
    }

    if (bestIndex === -1) {
      // No matches found, return beginning of content
      return content.slice(0, contextSize * 2) + '...';
    }

    const start = Math.max(0, bestIndex - contextSize);
    const end = Math.min(content.length, bestIndex + contextSize * 2);

    let snippet = content.slice(start, end);
    if (start > 0) snippet = '...' + snippet;
    if (end < content.length) snippet = snippet + '...';

    return snippet;
  }
}

/**
 * Create a search service instance
 */
export function createSearchService(): SearchService {
  return new SearchService();
}
