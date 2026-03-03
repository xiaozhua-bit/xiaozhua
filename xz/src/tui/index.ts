/**
 * TUI (Text User Interface) for xz AI Agent
 * Using OpenTUI core renderer
 */

export * from './pi-app.js';

import { runTUI } from './pi-app.js';

export interface TUIOptions {
  theme?: 'dark' | 'light';
}

/**
 * Start the interactive TUI mode
 */
export async function startTUI(options: TUIOptions = {}): Promise<void> {
  await runTUI(options);
}
