/**
 * Knowledge/Memory types
 */

export interface KnowledgeChunk {
  id: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  content: string;
  tags?: string[];
  createdAt?: number;
  updatedAt?: number;
}

export interface SearchResult {
  chunk: KnowledgeChunk;
  score: number;
  matchType: 'keyword' | 'semantic' | 'hybrid';
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  semantic?: boolean;
  keywordOnly?: boolean;
}

export interface PaginatedSearchResult {
  items: SearchResult[];
  total: number;
  page: number;
  perPage: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface ContentRange {
  file: string;
  lineStart: number;
  lineEnd: number;
}
