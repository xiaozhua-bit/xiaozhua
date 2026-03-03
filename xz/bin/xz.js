#!/usr/bin/env node

/**
 * xz CLI entry point
 */

import { main } from '../dist/cli/index.js';

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
