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

/**
 * Parse an HTTP Retry-After header value into a delay in milliseconds.
 * Accepts the delta-seconds form ("120") and the HTTP-date form
 * ("Wed, 21 Oct 2026 07:28:00 GMT"). Returns null for missing or
 * unparseable values so the caller can fall back to exponential backoff.
 */
export function parseRetryAfter(
  value: string | null,
  now: Date = new Date(),
): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10) * 1000;
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - now.getTime());
  }
  return null;
}

export interface FetchRetryOptions extends FetchOptions {
  /** Maximum number of retries on HTTP 429. Defaults to 3. */
  maxRetries?: number;
  /** Cap on the per-attempt delay in milliseconds. Defaults to 60s. */
  maxBackoffMs?: number;
}

/**
 * Fetch with automatic retry on HTTP 429 Too Many Requests, honoring the
 * Retry-After header. When Retry-After is missing or unparseable, falls back
 * to exponential backoff starting at 500ms (capped by maxBackoffMs). Returns
 * the final response once retries are exhausted so the caller can decide
 * what to do with the 429.
 *
 * Non-429 responses (including 4xx and 5xx) are returned without retry.
 */
export async function fetchWithRetry(
  url: string,
  options?: FetchRetryOptions,
): Promise<Response> {
  const maxRetries = options?.maxRetries ?? 3;
  const maxBackoffMs = options?.maxBackoffMs ?? 60_000;
  let attempt = 0;
  while (true) {
    const response = await fetchWithHeaders(url, options);
    if (response.status !== 429 || attempt >= maxRetries) {
      return response;
    }
    // Drain the body so the underlying connection can be reused.
    await response.body?.cancel();

    const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
    const fallback = 500 * Math.pow(2, attempt);
    const delay = Math.min(maxBackoffMs, retryAfter ?? fallback);
    await new Promise((resolve) => setTimeout(resolve, delay));
    attempt++;
  }
}
