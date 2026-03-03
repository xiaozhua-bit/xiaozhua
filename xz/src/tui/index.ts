/**
 * TUI (Text User Interface) for xz AI Agent
 * Using Ink renderer
 */

export * from './pi-app.js';

import { runTUI } from './pi-app.js';

export interface TUIOptions {
  theme?: 'dark' | 'light';
  mode?: 'normal' | 'init';
}

/**
 * Start the interactive TUI mode
 */
export async function startTUI(options: TUIOptions = {}): Promise<void> {
  await runTUI(options);
}
