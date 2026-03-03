#!/usr/bin/env node
/**
 * CLI entry point for jiti (development mode)
 * Usage: jiti src/cli/run.ts [command]
 */

import { main } from './index.js';

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
