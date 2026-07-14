/**
 * GitHub repository resolution for registries backed by the GitHub API
 * (github-actions and swift).
 *
 * Repository entries for these registries are configured with the web URL
 * users know (e.g. "https://github.com/Tripletex"), not the API endpoint.
 * A package name like "Tripletex/some-action" implies the web URL
 * "https://github.com/Tripletex/some-action", which is matched against the
 * configured entries by longest URL prefix. The matched entry supplies the
 * authentication, and the API base URL is derived from the entry's host:
 *
 * - github.com            -> https://api.github.com
 * - api.github.com        -> https://api.github.com (legacy API-base form)
 * - ghe.example.com       -> https://ghe.example.com/api/v3 (GitHub Enterprise)
 *
 * This lets different GitHub organizations use different tokens, e.g. a
 * fine-grained PAT per private org plus an optional catch-all
 * "https://github.com/" entry for authenticated access to public repos.
 */

import type {
  RegistryRepositories,
  RepositoryAuth,
  RepositoryConfig,
} from "./types.ts";
import type { Registry } from "../registries/types.ts";
import { loadConfigSync } from "./loader.ts";

/**
 * A repository entry resolved for a specific package lookup.
 */
export interface ResolvedGitHubRepository {
  /** Config key of the matched entry (used in cache keys) */
  key: string;
  /** Display name of the matched entry */
  name: string;
  /** API base URL derived from the entry's configured URL */
  apiUrl: string;
  /** Authentication from the matched entry, if any */
  auth?: RepositoryAuth;
}

interface ParsedEntryUrl {
  /** URL origin, e.g. "https://github.com" */
  origin: string;
  /** Lowercased hostname */
  host: string;
  /** Path segments of the URL, "*" and empty segments removed */
  segments: string[];
  /**
   * True when the URL already points at an API endpoint
   * (api.github.com or a path starting with /api), so it cannot be
   * matched against owners and is used verbatim as the API base.
   */
  isApiBase: boolean;
}

function parseEntryUrl(url: string): ParsedEntryUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const segments = parsed.pathname
    .split("/")
    .filter((s) => s.length > 0 && s !== "*");

  const host = parsed.hostname.toLowerCase();
  const isApiBase = host.startsWith("api.") || segments[0] === "api";

  return { origin: parsed.origin, host, segments, isApiBase };
}

/**
 * Derive the GitHub API base URL for a configured entry.
 */
function deriveApiBase(parsed: ParsedEntryUrl): string {
  if (parsed.isApiBase) {
    // Already an API endpoint; use it as-is (minus any trailing slash).
    const path = parsed.segments.length > 0
      ? `/${parsed.segments.join("/")}`
      : "";
    return `${parsed.origin}${path}`;
  }
  if (parsed.host === "github.com" || parsed.host === "www.github.com") {
    return "https://api.github.com";
  }
  // GitHub Enterprise Server exposes its REST API under /api/v3.
  return `${parsed.origin}/api/v3`;
}

/**
 * Score how well an entry's URL matches a package name.
 *
 * The package name (e.g. "Tripletex/some-action") is compared segment by
 * segment against the entry URL's path. Returns the number of matched
 * segments (0 for a bare-host entry, which matches everything), or -1 when
 * the entry does not match. API-base entries never match by URL; they are
 * only reachable as the default/fallback or by explicit name.
 */
function matchScore(parsed: ParsedEntryUrl, packageSegments: string[]): number {
  if (parsed.isApiBase) {
    return -1;
  }
  if (parsed.segments.length > packageSegments.length) {
    return -1;
  }
  for (let i = 0; i < parsed.segments.length; i++) {
    // GitHub owner and repository names are case-insensitive.
    if (parsed.segments[i].toLowerCase() !== packageSegments[i].toLowerCase()) {
      return -1;
    }
  }
  return parsed.segments.length;
}

function toResolved(
  key: string,
  entry: RepositoryConfig,
): ResolvedGitHubRepository {
  const parsed = parseEntryUrl(entry.url);
  const apiUrl = parsed
    ? deriveApiBase(parsed)
    // Unparseable URL: pass it through unchanged rather than failing here;
    // the subsequent fetch will surface the error.
    : entry.url.replace(/\/+$/, "");
  return { key, name: entry.name, apiUrl, auth: entry.auth };
}

/**
 * Match a package name against a repository map. Pure function; see
 * `resolveGitHubRepository` for the selection order.
 */
export function matchGitHubRepository(
  repos: RegistryRepositories,
  packageName: string,
  repositoryName?: string,
): ResolvedGitHubRepository {
  if (Object.keys(repos).length === 0) {
    throw new Error("No repositories configured");
  }

  if (repositoryName) {
    const entry = repos[repositoryName];
    if (!entry) {
      const available = Object.keys(repos).join(", ");
      throw new Error(
        `Repository '${repositoryName}' not found. Available: ${available}`,
      );
    }
    return toResolved(repositoryName, entry);
  }

  const packageSegments = packageName.split("/").filter((s) => s.length > 0);

  let best: { key: string; entry: RepositoryConfig; score: number } | null =
    null;
  for (const [key, entry] of Object.entries(repos)) {
    const parsed = parseEntryUrl(entry.url);
    if (!parsed) continue;
    const score = matchScore(parsed, packageSegments);
    if (score < 0) continue;
    if (
      !best ||
      score > best.score ||
      (score === best.score && entry.default && !best.entry.default)
    ) {
      best = { key, entry, score };
    }
  }

  if (best) {
    return toResolved(best.key, best.entry);
  }

  // No URL match: fall back to the default entry, then the first one.
  const entries = Object.entries(repos);
  const defaultEntry = entries.find(([, e]) => e.default);
  const [key, entry] = defaultEntry ?? entries[0];
  return toResolved(key, entry);
}

/**
 * Resolve the repository entry to use for a GitHub-backed package lookup.
 *
 * Selection order:
 * 1. An explicitly requested entry by config key (throws if unknown).
 * 2. The entry whose URL is the longest prefix of the package's implied
 *    web URL (case-insensitive). Ties go to the default entry, then to
 *    definition order.
 * 3. The entry marked `default: true`.
 * 4. The first configured entry.
 */
export function resolveGitHubRepository(
  registry: Registry,
  packageName: string,
  repositoryName?: string,
): ResolvedGitHubRepository {
  const config = loadConfigSync();
  const repos = config.repositories[registry];

  if (!repos) {
    throw new Error(`No repositories configured for registry: ${registry}`);
  }

  try {
    return matchGitHubRepository(repos, packageName, repositoryName);
  } catch (error) {
    // Re-throw with the registry name for a clearer message.
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message} (registry: ${registry})`);
  }
}
