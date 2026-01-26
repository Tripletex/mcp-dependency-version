/**
 * HTTP utilities for registry clients
 */

import type { RepositoryAuth } from "../config/types.ts";

// Read version from deno.json at build time would be ideal,
// but for simplicity we'll keep it in sync manually
const VERSION = "1.0.0";

/**
 * User-Agent header for all registry requests
 * Format follows RFC 7231 conventions
 */
export const USER_AGENT =
  `mcp-dependency-version/${VERSION} (https://github.com/anthropics/mcp-dependency-version)`;

/**
 * Default headers for all registry requests
 */
export const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  "Accept": "application/json",
};

/**
 * Options for fetchWithHeaders
 */
export interface FetchOptions extends RequestInit {
  /** Authentication configuration */
  auth?: RepositoryAuth;
}

/**
 * Build Authorization header from auth config
 */
function buildAuthHeader(auth: RepositoryAuth): string | null {
  if (auth.token) {
    return `Bearer ${auth.token}`;
  }
  if (auth.username && auth.password) {
    const credentials = btoa(`${auth.username}:${auth.password}`);
    return `Basic ${credentials}`;
  }
  return null;
}

/**
 * Fetch with default headers (User-Agent, Accept) and optional authentication
 * Use this instead of raw fetch() for all registry requests
 */
export function fetchWithHeaders(
  url: string,
  options?: FetchOptions,
): Promise<Response> {
  const headers = new Headers(options?.headers);

  // Add default headers if not already set
  for (const [key, value] of Object.entries(DEFAULT_HEADERS)) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }

  // Add authentication if provided
  if (options?.auth && !headers.has("Authorization")) {
    const authHeader = buildAuthHeader(options.auth);
    if (authHeader) {
      headers.set("Authorization", authHeader);
    }
  }

  // Remove auth from options before passing to fetch
  const { auth: _, ...fetchOptions } = options || {};

  return fetch(url, {
    ...fetchOptions,
    headers,
  });
}
