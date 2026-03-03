/**
 * xz memory CLI commands
 */

import { Command } from 'commander';
import { searchKnowledge, getFileContent, listFiles } from '../knowledge/index.js';
import type { PaginatedSearchResult } from '../knowledge/types.js';

export function createMemoryCommand(): Command {
  const memory = new Command('memory')
    .description('Knowledge memory operations');

  // Search command
  memory
    .command('search')
    .description('Search knowledge memory')
    .argument('<query>', 'Search query')
    .option('-l, --limit <n>', 'Results per page', '10')
    .option('-p, --page <n>', 'Page number', '1')
    .option('--semantic', 'Use semantic search only')
    .option('--keyword', 'Use keyword search only')
    .action(async (query, options) => {
      try {
        const limit = parseInt(options.limit);
        const page = parseInt(options.page);
        const offset = (page - 1) * limit;

        const results = searchKnowledge(query, {
          limit,
          offset,
          semantic: options.semantic,
          keywordOnly: options.keyword,
        });

        printSearchResults(results, query);
      } catch (error) {
        console.error('Search failed:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Get command
  memory
    .command('get')
    .description('Get content from a file')
    .argument('<file>', 'Memory file path')
    .option('-s, --start-line <n>', 'Start line', '1')
    .option('-e, --end-line <n>', 'End line')
    .action(async (file, options) => {
      try {
        const content = getFileContent(file, {
          startLine: parseInt(options.startLine),
          endLine: options.endLine ? parseInt(options.endLine) : undefined,
        });

        if (content === null) {
          console.error(`File not found: ${file}`);
          process.exit(1);
        }

        console.log(content);
      } catch (error) {
        console.error('Get failed:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // List command
  memory
    .command('list')
    .description('List memory files')
    .option('-d, --date <date>', 'Filter by date (YYYY-MM-DD)')
    .action(async (options) => {
      try {
        const files = listFiles();
        
        if (files.length === 0) {
          console.log('No memory files indexed.');
          return;
        }

        // Filter by date if provided
        let filtered = files;
        if (options.date) {
          filtered = files.filter(f => f.includes(options.date));
        }

        console.log(`Found ${filtered.length} file(s):\n`);
        filtered.forEach(f => console.log(`  - ${f}`));
      } catch (error) {
        console.error('List failed:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  return memory;
}

function printSearchResults(results: PaginatedSearchResult, query: string): void {
  if (results.items.length === 0) {
    console.log(`No results found for: "${query}"`);
    return;
  }

  console.log(`Results for: "${query}" (${results.total} total)\n`);

  results.items.forEach((item, i) => {
    const { chunk, score, matchType } = item;
    console.log(`[${i + 1}] ${chunk.file}:${chunk.lineStart}-${chunk.lineEnd}`);
    console.log(`    Score: ${(score * 100).toFixed(1)}% (${matchType})`);
    
    // Print snippet (first 3 lines)
    const lines = chunk.content.split('\n').slice(0, 3);
    const snippet = lines.join('\\n');
    const trimmed = snippet.length > 200 ? snippet.slice(0, 200) + '...' : snippet;
    console.log(`    ${trimmed}\n`);
  });

  console.log(`Page ${results.page} (${results.items.length}/${results.total} shown)`);
  if (results.hasNext) {
    console.log(`Use --page ${results.page + 1} for more results`);
  }
}
