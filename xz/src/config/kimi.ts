/**
 * Kimi Code OAuth integration
 * Reads credentials from ~/.kimi/credentials/kimi-code.json
 */

import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';

export interface KimiCredentials {
  access_token: string;
  refresh_token: string;
  expires_at: string;  // ISO date string
  token_type: string;
}

const KIMI_CREDENTIALS_PATH = join(homedir(), '.kimi', 'credentials', 'kimi-code.json');

/**
 * Check if Kimi credentials exist
 */
export function detectKimiCredentials(): boolean {
  return existsSync(KIMI_CREDENTIALS_PATH);
}

/**
 * Load Kimi credentials from file
 */
export function loadKimiCredentials(): KimiCredentials | null {
  if (!detectKimiCredentials()) {
    return null;
  }

  try {
    const content = readFileSync(KIMI_CREDENTIALS_PATH, 'utf-8');
    return JSON.parse(content) as KimiCredentials;
  } catch (error) {
    console.error('Failed to load Kimi credentials:', error);
    return null;
  }
}

/**
 * Check if credentials are expired
 */
export function isKimiTokenExpired(creds: KimiCredentials): boolean {
  const expiresAt = new Date(creds.expires_at).getTime();
  return Date.now() >= expiresAt;
}

/**
 * Get Kimi API configuration
 */
export function getKimiApiConfig() {
  const creds = loadKimiCredentials();
  if (!creds) {
    throw new Error('Kimi credentials not found. Please run `kimi login` first.');
  }

  if (isKimiTokenExpired(creds)) {
    console.warn('Kimi token expired. Please run `kimi login` to refresh.');
  }

  return {
    baseUrl: 'https://api.kimi.com/coding/v1',
    accessToken: creds.access_token,
    refreshToken: creds.refresh_token,
    expiresAt: creds.expires_at,
  };
}
