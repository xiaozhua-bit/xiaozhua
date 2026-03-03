/**
 * xz history CLI commands
 */

import { Command } from 'commander';
import { listSessions, getSession, listMessages, searchHistory } from '../history/index.js';
import type { PaginatedSessions, PaginatedMessages, PaginatedSearchResults } from '../history/index.js';

export function createHistoryCommand(): Command {
  const history = new Command('history')
    .description('Chat history operations');

  // Search command
  history
    .command('search')
    .description('Search chat history')
    .argument('<query>', 'Search query')
    .option('-l, --limit <n>', 'Results per page', '10')
    .option('-p, --page <n>', 'Page number', '1')
    .option('--date-from <date>', 'Start date (YYYY-MM-DD)')
    .option('--date-to <date>', 'End date (YYYY-MM-DD)')
    .action(async (query, options) => {
      try {
        const limit = parseInt(options.limit);
        const page = parseInt(options.page);
        const offset = (page - 1) * limit;

        const results = searchHistory(query, {
          limit,
          offset,
          dateFrom: options.dateFrom,
          dateTo: options.dateTo,
        });

        printSearchResults(results, query);
      } catch (error) {
        console.error('Search failed:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Session command
  history
    .command('session')
    .description('Get messages from a session')
    .argument('<session-id>', 'Session ID')
    .option('-l, --limit <n>', 'Messages per page', '20')
    .option('-o, --offset <n>', 'Offset', '0')
    .action(async (sessionId, options) => {
      try {
        // First verify session exists
        const session = getSession(sessionId);
        if (!session) {
          console.error(`Session not found: ${sessionId}`);
          process.exit(1);
        }

        const limit = parseInt(options.limit);
        const offset = parseInt(options.offset);

        const result = listMessages(sessionId, { limit, offset });

        printSessionMessages(result, sessionId, session.title);
      } catch (error) {
        console.error('Get session failed:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // List command
  history
    .command('list')
    .description('List sessions')
    .option('-l, --limit <n>', 'Sessions per page', '10')
    .option('-p, --page <n>', 'Page number', '1')
    .action(async (options) => {
      try {
        const limit = parseInt(options.limit);
        const page = parseInt(options.page);
        const offset = (page - 1) * limit;

        const result = listSessions({ limit, offset });

        printSessions(result);
      } catch (error) {
        console.error('List failed:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  return history;
}

function printSearchResults(results: PaginatedSearchResults, query: string): void {
  if (results.results.length === 0) {
    console.log(`No results found for: "${query}"`);
    return;
  }

  console.log(`Results for: "${query}" (${results.total} total)\n`);

  results.results.forEach((item, i) => {
    const date = new Date(item.timestamp).toLocaleString();
    const role = item.role.charAt(0).toUpperCase() + item.role.slice(1);
    
    console.log(`[${i + 1}] ${role} - ${date}`);
    console.log(`    Session: ${item.sessionId.slice(0, 20)}...`);
    
    // Print content snippet
    const content = item.content.length > 150 
      ? item.content.slice(0, 150) + '...' 
      : item.content;
    console.log(`    ${content}\n`);
  });

  console.log(`Page ${results.page} (${results.results.length}/${results.total} shown)`);
  if (results.hasNext) {
    console.log(`Use --page ${results.page + 1} for more results`);
  }
}

function printSessionMessages(result: PaginatedMessages, sessionId: string, title?: string): void {
  console.log(`Session: ${title || sessionId.slice(0, 16)}... (${result.total} messages)\n`);

  result.messages.forEach(msg => {
    const date = new Date(msg.createdAt).toLocaleString();
    const role = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
    
    console.log(`[${role}] ${date}`);
    console.log(`${msg.content}\n`);
  });

  console.log(`Showing ${result.messages.length}/${result.total} messages`);
  if (result.hasNext) {
    console.log(`Use --offset ${(result.page) * result.perPage} for more`);
  }
}

function printSessions(result: PaginatedSessions): void {
  if (result.sessions.length === 0) {
    console.log('No sessions found.');
    return;
  }

  console.log(`Sessions (${result.total} total):\n`);

  result.sessions.forEach((session, i) => {
    const date = new Date(session.updatedAt).toLocaleString();
    const title = session.title || session.id.slice(0, 16) + '...';
    
    console.log(`${i + 1}. ${title}`);
    console.log(`   ID: ${session.id}`);
    console.log(`   Messages: ${session.messageCount} | Updated: ${date}\n`);
  });

  console.log(`Page ${result.page} (${result.sessions.length}/${result.total} shown)`);
  if (result.hasNext) {
    console.log(`Use --page ${result.page + 1} for more`);
  }
}
