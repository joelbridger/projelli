// Backlink Index
// Tracks bidirectional wiki-style links across documents

import { parseWikiLinks, resolveWikiLinkTarget, type WikiLink } from './WikiLinkParser';

export interface BacklinkEntry {
  /** Source document path */
  sourcePath: string;
  /** Target document path (resolved) */
  targetPath: string;
  /** The wiki link that created this backlink */
  link: WikiLink;
  /** Context: the line containing the link */
  context: string;
}

export interface DocumentLinks {
  /** Path of this document */
  path: string;
  /** Links from this document to others (outgoing) */
  outgoingLinks: BacklinkEntry[];
  /** Links from other documents to this one (incoming/backlinks) */
  incomingLinks: BacklinkEntry[];
}

/**
 * BacklinkIndex maintains a bidirectional index of wiki links
 */
export class BacklinkIndex {
  /** Map from document path to its outgoing links */
  private outgoing: Map<string, BacklinkEntry[]> = new Map();

  /** Map from target path to incoming backlinks */
  private incoming: Map<string, BacklinkEntry[]> = new Map();

  /**
   * Index a document's wiki links
   * @param path Document path
   * @param content Document content
   */
  indexDocument(path: string, content: string): void {
    // Remove existing links from this document
    this.removeDocument(path);

    const lines = content.split('\n');
    const { links } = parseWikiLinks(content);

    const outgoingLinks: BacklinkEntry[] = [];

    for (const link of links) {
      const targetPath = resolveWikiLinkTarget(link.target);
      const contextLine = lines[link.lineNumber - 1] ?? '';

      const entry: BacklinkEntry = {
        sourcePath: path,
        targetPath,
        link,
        context: contextLine.trim(),
      };

      outgoingLinks.push(entry);

      // Add to incoming index
      const incomingList = this.incoming.get(targetPath) ?? [];
      incomingList.push(entry);
      this.incoming.set(targetPath, incomingList);
    }

    this.outgoing.set(path, outgoingLinks);
  }

  /**
   * Remove a document from the index
   */
  removeDocument(path: string): void {
    const outgoingLinks = this.outgoing.get(path);
    if (outgoingLinks) {
      // Remove this document's links from incoming indexes
      for (const entry of outgoingLinks) {
        const incomingList = this.incoming.get(entry.targetPath);
        if (incomingList) {
          const filtered = incomingList.filter((e) => e.sourcePath !== path);
          if (filtered.length > 0) {
            this.incoming.set(entry.targetPath, filtered);
          } else {
            this.incoming.delete(entry.targetPath);
          }
        }
      }
      this.outgoing.delete(path);
    }
  }

  /**
   * Get all links for a document (both incoming and outgoing)
   */
  getDocumentLinks(path: string): DocumentLinks {
    return {
      path,
      outgoingLinks: this.outgoing.get(path) ?? [],
      incomingLinks: this.incoming.get(path) ?? [],
    };
  }

  /**
   * Get backlinks to a document (documents that link to this one)
   */
  getBacklinks(path: string): BacklinkEntry[] {
    return this.incoming.get(path) ?? [];
  }

  /**
   * Get outgoing links from a document
   */
  getOutgoingLinks(path: string): BacklinkEntry[] {
    return this.outgoing.get(path) ?? [];
  }

  /**
   * Check if a document has any backlinks
   */
  hasBacklinks(path: string): boolean {
    const backlinks = this.incoming.get(path);
    return backlinks !== undefined && backlinks.length > 0;
  }

  /**
   * Get all documents that have been indexed
   */
  getIndexedDocuments(): string[] {
    return Array.from(this.outgoing.keys());
  }

  /**
   * Get all target documents that have backlinks
   */
  getLinkedDocuments(): string[] {
    return Array.from(this.incoming.keys());
  }

  /**
   * Check if a link target exists in the workspace
   */
  hasDocument(path: string): boolean {
    return this.outgoing.has(path);
  }

  /**
   * Get all orphan documents (documents with no incoming links)
   */
  getOrphanDocuments(): string[] {
    const indexed = new Set(this.outgoing.keys());
    const linked = new Set(this.incoming.keys());

    return Array.from(indexed).filter((path) => !linked.has(path));
  }

  /**
   * Get all broken links (links to non-existent documents)
   */
  getBrokenLinks(): BacklinkEntry[] {
    const broken: BacklinkEntry[] = [];
    const indexed = new Set(this.outgoing.keys());

    for (const [_targetPath, entries] of this.incoming) {
      // Check if target exists in indexed documents
      for (const entry of entries) {
        if (!indexed.has(entry.targetPath)) {
          broken.push(entry);
        }
      }
    }

    return broken;
  }

  /**
   * Clear the entire index
   */
  clear(): void {
    this.outgoing.clear();
    this.incoming.clear();
  }

  /**
   * Get statistics about the index
   */
  getStats(): {
    documentCount: number;
    totalLinks: number;
    brokenLinkCount: number;
    orphanCount: number;
  } {
    let totalLinks = 0;
    for (const links of this.outgoing.values()) {
      totalLinks += links.length;
    }

    return {
      documentCount: this.outgoing.size,
      totalLinks,
      brokenLinkCount: this.getBrokenLinks().length,
      orphanCount: this.getOrphanDocuments().length,
    };
  }
}

/**
 * Create a new backlink index instance
 */
export function createBacklinkIndex(): BacklinkIndex {
  return new BacklinkIndex();
}
