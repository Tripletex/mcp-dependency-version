/**
 * GitHub utilities for fetching repository content
 */

import { fetchWithHeaders } from "./http.ts";

const GITHUB_API_BASE = "https://api.github.com";

/**
 * Parse a GitHub repository URL to extract owner and repo
 * Handles various formats:
 * - https://github.com/owner/repo
 * - git://github.com/owner/repo.git
 * - git+https://github.com/owner/repo.git
 * - github:owner/repo
 */
export function parseGitHubUrl(
  url: string,
): { owner: string; repo: string } | null {
  // Handle github: shorthand
  if (url.startsWith("github:")) {
    const parts = url.slice(7).split("/");
    if (parts.length >= 2) {
      return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
    }
    return null;
  }

  // Handle various URL formats
  const patterns = [
    /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
    }
  }

  return null;
}

/**
 * Fetch README content from a GitHub repository
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param ref - Optional branch/tag/commit (defaults to default branch)
 */
export async function fetchGitHubReadme(
  owner: string,
  repo: string,
  ref?: string,
): Promise<string | null> {
  // Try common README filenames
  const readmeFiles = [
    "README.md",
    "readme.md",
    "README",
    "readme.txt",
    "README.rst",
  ];

  for (const filename of readmeFiles) {
    try {
      let url =
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${filename}`;
      if (ref) {
        url += `?ref=${encodeURIComponent(ref)}`;
      }

      const response = await fetchWithHeaders(url, {
        headers: {
          Accept: "application/vnd.github.raw",
        },
      });

      if (response.ok) {
        return await response.text();
      }
    } catch {
      // Try next filename
    }
  }

  return null;
}

/**
 * Fetch README from a repository URL
 * @param repositoryUrl - Full repository URL (GitHub, GitLab, etc.)
 * @param ref - Optional branch/tag/commit
 */
export function fetchReadmeFromRepository(
  repositoryUrl: string,
  ref?: string,
): Promise<string | null> {
  const parsed = parseGitHubUrl(repositoryUrl);
  if (!parsed) {
    return Promise.resolve(null); // Not a GitHub URL or unsupported format
  }

  return fetchGitHubReadme(parsed.owner, parsed.repo, ref);
}
