/**
 * Kimi Code OAuth integration
 * Reads credentials from ~/.kimi/credentials/kimi-code.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface KimiCredentials {
  access_token: string;
  refresh_token: string;
  expires_at: number | string; // unix seconds (preferred) or ISO date string
  scope?: string;
  token_type: string;
}

const DEFAULT_KIMI_OAUTH_HOST = "https://auth.kimi.com";
const DEFAULT_REFRESH_THRESHOLD_SECONDS = 300;

const KIMI_CREDENTIALS_DIR = join(homedir(), ".kimi", "credentials");
const KIMI_CREDENTIALS_PATH = join(
  homedir(),
  ".kimi",
  "credentials",
  "kimi-code.json",
);
let refreshInFlight: Promise<KimiCredentials | null> | null = null;

function getKimiOauthHost(): string {
  return (
    process.env.KIMI_CODE_OAUTH_HOST ||
    process.env.KIMI_OAUTH_HOST ||
    DEFAULT_KIMI_OAUTH_HOST
  );
}

function normalizeExpiresAtToEpochMs(
  value: number | string | null | undefined,
): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Kimi credentials currently store seconds.
    return value > 1e12 ? value : value * 1000;
  }

  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric > 1e12 ? numeric : numeric * 1000;
    }

    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function toJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }
  return {};
}

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
    const content = readFileSync(KIMI_CREDENTIALS_PATH, "utf-8");
    const parsed = JSON.parse(content) as Partial<KimiCredentials>;
    return {
      access_token: String(parsed.access_token || ""),
      refresh_token: String(parsed.refresh_token || ""),
      expires_at: (parsed.expires_at ?? 0) as number | string,
      scope: parsed.scope ? String(parsed.scope) : undefined,
      token_type: String(parsed.token_type || "Bearer"),
    };
  } catch (error) {
    console.error("Failed to load Kimi credentials:", error);
    return null;
  }
}

/**
 * Persist Kimi credentials to ~/.kimi/credentials/kimi-code.json
 */
export function saveKimiCredentials(creds: KimiCredentials): void {
  try {
    if (!existsSync(KIMI_CREDENTIALS_DIR)) {
      mkdirSync(KIMI_CREDENTIALS_DIR, { recursive: true });
    }
    writeFileSync(KIMI_CREDENTIALS_PATH, JSON.stringify(creds), "utf-8");
  } catch (error) {
    console.error("Failed to save Kimi credentials:", error);
  }
}

/**
 * Check if credentials are expired
 */
export function isKimiTokenExpired(
  creds: KimiCredentials,
  thresholdSeconds = 0,
): boolean {
  const expiresAtMs = normalizeExpiresAtToEpochMs(creds.expires_at);
  if (expiresAtMs <= 0) {
    return true;
  }
  return Date.now() >= expiresAtMs - thresholdSeconds * 1000;
}

/**
 * Refresh Kimi OAuth token using refresh_token grant
 */
export async function refreshKimiCredentials(
  refreshToken: string,
  clientId: string,
): Promise<KimiCredentials> {
  if (!refreshToken) {
    throw new Error("Kimi refresh token is missing. Please run `kimi login`.");
  }
  if (!clientId.trim()) {
    throw new Error(
      "Kimi OAuth client_id is missing in config.auth.oauthClientId.",
    );
  }

  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch(
    `${getKimiOauthHost().replace(/\/+$/, "")}/api/oauth/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
  );

  const raw = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = toJsonObject(JSON.parse(raw));
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const errorDescription =
      typeof payload.error_description === "string"
        ? payload.error_description
        : "";
    const errorMessage = errorDescription || raw || `HTTP ${response.status}`;
    throw new Error(
      `Kimi token refresh failed (${response.status}): ${errorMessage}`,
    );
  }

  const expiresIn = Number(payload.expires_in ?? 0);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error(
      "Kimi token refresh failed: invalid expires_in in response.",
    );
  }

  const refreshed: KimiCredentials = {
    access_token: String(payload.access_token || ""),
    refresh_token: String(payload.refresh_token || refreshToken),
    expires_at: Date.now() / 1000 + expiresIn,
    scope: typeof payload.scope === "string" ? payload.scope : undefined,
    token_type: String(payload.token_type || "Bearer"),
  };

  if (!refreshed.access_token) {
    throw new Error("Kimi token refresh failed: missing access_token.");
  }

  saveKimiCredentials(refreshed);
  return refreshed;
}

/**
 * Ensure credentials are fresh. If close to expiry, refresh and persist them.
 */
export async function ensureFreshKimiCredentials(
  clientId: string,
  thresholdSeconds = DEFAULT_REFRESH_THRESHOLD_SECONDS,
): Promise<KimiCredentials | null> {
  const creds = loadKimiCredentials();
  if (!creds) {
    return null;
  }

  if (!isKimiTokenExpired(creds, thresholdSeconds)) {
    return creds;
  }
  if (!clientId.trim()) {
    throw new Error(
      "Kimi OAuth client_id is missing in config.auth.oauthClientId.",
    );
  }

  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    try {
      return await refreshKimiCredentials(creds.refresh_token, clientId);
    } catch (error) {
      console.error("Failed to refresh Kimi credentials:", error);
      // If refresh fails but current token is not hard-expired yet, keep using it.
      if (!isKimiTokenExpired(creds, 0)) {
        return creds;
      }
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/**
 * Get Kimi API configuration
 */
export function getKimiApiConfig() {
  const creds = loadKimiCredentials();
  if (!creds) {
    throw new Error(
      "Kimi credentials not found. Please run `kimi login` first.",
    );
  }

  if (isKimiTokenExpired(creds)) {
    console.warn("Kimi token expired. Please run `kimi login` to refresh.");
  }

  return {
    baseUrl: "https://api.kimi.com/coding/v1",
    accessToken: creds.access_token,
    refreshToken: creds.refresh_token,
    expiresAt: creds.expires_at,
  };
}
