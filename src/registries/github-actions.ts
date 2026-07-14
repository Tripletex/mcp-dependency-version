/**
 * GitHub Actions Registry Client
 * Uses the GitHub API for version lookups since GitHub Actions are GitHub repositories
 * Package format: owner/repo (e.g., actions/checkout, github/codeql-action)
 *
 * Provides commit SHA-pinned secure references for supply chain security,
 * since action tags/versions are mutable and can be force-pushed.
 */

import type {
  LookupOptions,
  PackageMetadata,
  Registry,
  RegistryClient,
  VersionDetail,
  VersionInfo,
} from "./types.ts";
import {
  filterByPrefix,
  isPrerelease,
  resolveLatestVersions,
  sortVersionsDescending,
} from "../utils/version.ts";
import { versionCache } from "../utils/cache.ts";
import { fetchWithHeaders } from "../utils/http.ts";
import {
  type ResolvedGitHubRepository,
  resolveGitHubRepository,
} from "../config/github.ts";

interface GitHubTag {
  name: string;
  commit: {
    sha: string;
  };
}

interface GitHubRelease {
  tag_name: string;
  published_at: string;
  prerelease: boolean;
  draft: boolean;
}

interface GitHubRepo {
  name: string;
  full_name: string;
  description?: string;
  homepage?: string;
  html_url: string;
  license?: {
    spdx_id?: string;
    name?: string;
  };
}

/**
 * Check if a tag name looks like a semver version
 * GitHub Actions commonly use: v1, v1.0.0, v1.0, etc.
 */
function isSemverTag(tag: string): boolean {
  return /^v?\d+(\.\d+)?(\.\d+)?(-[\w.]+)?(\+[\w.]+)?$/.test(tag);
}

/**
 * Strip the "v" prefix from a tag for version comparison
 */
function stripVPrefix(tag: string): string {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

/**
 * Format a secure SHA-pinned action reference
 * e.g., actions/checkout@abc123def456... # v4.2.0
 */
function formatSecureReference(
  packageName: string,
  commitSha: string,
  version: string,
): string {
  return `${packageName}@${commitSha} # ${version}`;
}

export class GitHubActionsClient implements RegistryClient {
  readonly registry = "github-actions" as const satisfies Registry;

  private resolveRepo(
    packageName: string,
    repositoryName?: string,
  ): ResolvedGitHubRepository {
    return resolveGitHubRepository(
      "github-actions",
      packageName,
      repositoryName,
    );
  }

  private async fetchTags(
    packageName: string,
    repositoryName?: string,
  ): Promise<GitHubTag[]> {
    const repo = this.resolveRepo(packageName, repositoryName);
    const cacheKey =
      `github-actions:${repo.apiUrl}:${repo.key}:${packageName}:tags`;
    const cached = versionCache.get(cacheKey);
    if (cached) {
      return cached as GitHubTag[];
    }

    const url = `${repo.apiUrl}/repos/${packageName}/tags?per_page=100`;
    const response = await fetchWithHeaders(url, { auth: repo.auth });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(
          `Action '${packageName}' not found on GitHub`,
        );
      }
      throw new Error(
        `GitHub API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as GitHubTag[];
    versionCache.set(cacheKey, data);
    return data;
  }

  private async fetchReleases(
    packageName: string,
    repositoryName?: string,
  ): Promise<GitHubRelease[]> {
    const repo = this.resolveRepo(packageName, repositoryName);
    const cacheKey =
      `github-actions:${repo.apiUrl}:${repo.key}:${packageName}:releases`;
    const cached = versionCache.get(cacheKey);
    if (cached) {
      return cached as GitHubRelease[];
    }

    const url = `${repo.apiUrl}/repos/${packageName}/releases?per_page=100`;
    const response = await fetchWithHeaders(url, { auth: repo.auth });

    if (!response.ok) {
      // Releases endpoint might fail for repos without releases, that's OK
      return [];
    }

    const data = (await response.json()) as GitHubRelease[];
    versionCache.set(cacheKey, data);
    return data;
  }

  private async fetchRepo(
    packageName: string,
    repositoryName?: string,
  ): Promise<GitHubRepo> {
    const repo = this.resolveRepo(packageName, repositoryName);
    const cacheKey =
      `github-actions:${repo.apiUrl}:${repo.key}:${packageName}:repo`;
    const cached = versionCache.get(cacheKey);
    if (cached) {
      return cached as GitHubRepo;
    }

    const url = `${repo.apiUrl}/repos/${packageName}`;
    const response = await fetchWithHeaders(url, { auth: repo.auth });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(
          `Action '${packageName}' not found on GitHub`,
        );
      }
      throw new Error(
        `GitHub API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as GitHubRepo;
    versionCache.set(cacheKey, data);
    return data;
  }

  async lookupVersion(
    packageName: string,
    options?: LookupOptions & { repository?: string },
  ): Promise<VersionInfo> {
    const tags = await this.fetchTags(packageName, options?.repository);
    const releases = await this.fetchReleases(
      packageName,
      options?.repository,
    );

    // Filter to semver tags only and strip v prefix for comparison
    const semverTags = tags.filter((t) => isSemverTag(t.name));
    let versionStrings = semverTags.map((t) => stripVPrefix(t.name));

    if (options?.versionPrefix) {
      versionStrings = filterByPrefix(versionStrings, options.versionPrefix);
      if (versionStrings.length === 0) {
        throw new Error(
          `No versions found for '${packageName}' with prefix '${options.versionPrefix}'`,
        );
      }
    }

    const resolved = resolveLatestVersions(versionStrings, {
      includePrerelease: options?.includePrerelease,
    });

    if (!resolved) {
      throw new Error(
        `No version found for '${packageName}'${
          options?.versionPrefix
            ? ` with prefix '${options.versionPrefix}'`
            : ""
        }`,
      );
    }

    // Find the tag with matching version to get commit SHA
    const matchingTag = semverTags.find(
      (t) => stripVPrefix(t.name) === resolved.latestStable,
    );
    const commitSha = matchingTag?.commit.sha;

    // Find release data for publish date
    const release = releases.find(
      (r) => stripVPrefix(r.tag_name) === resolved.latestStable,
    );

    const versionTag = matchingTag?.name ?? `v${resolved.latestStable}`;

    const result: VersionInfo = {
      packageName,
      registry: "github-actions",
      latestStable: resolved.latestStable,
      publishedAt: release?.published_at
        ? new Date(release.published_at)
        : undefined,
      digest: commitSha,
      secureReference: commitSha
        ? formatSecureReference(packageName, commitSha, versionTag)
        : undefined,
      securityNotes: [
        "GitHub Action tags are NOT immutable. Tags can be force-pushed to point to different commits.",
        "The commit SHA for this version is returned in the 'digest' field.",
        "Use commit SHA-pinned references (owner/repo@<digest>) for supply chain security.",
        commitSha
          ? `Secure reference: ${packageName}@${commitSha} # ${versionTag}`
          : "Could not resolve commit SHA for this version.",
      ],
    };

    if (resolved.latestPrerelease) {
      result.latestPrerelease = resolved.latestPrerelease;
    }

    return result;
  }

  /**
   * Resolve a git reference (branch, tag, or short SHA) to its current commit
   * SHA. Uses the GitHub commits endpoint with the `.sha` media type, which
   * returns the full 40-char SHA as plain text in a single request. Works for
   * actions with no releases at all (unlike `lookupVersion`, which requires
   * semver tags).
   */
  async resolveReference(
    packageName: string,
    reference: string,
    options?: LookupOptions & { repository?: string },
  ): Promise<VersionInfo> {
    const repo = this.resolveRepo(packageName, options?.repository);
    const cacheKey =
      `github-actions:${repo.apiUrl}:${repo.key}:${packageName}:commit:${reference}`;
    let commitSha = versionCache.get(cacheKey) as string | undefined;

    if (!commitSha) {
      const url = `${repo.apiUrl}/repos/${packageName}/commits/${
        encodeURIComponent(reference)
      }`;
      const response = await fetchWithHeaders(url, {
        auth: repo.auth,
        headers: { "Accept": "application/vnd.github.sha" },
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(
            `Reference '${reference}' not found for action '${packageName}'`,
          );
        }
        throw new Error(
          `GitHub API error: ${response.status} ${response.statusText}`,
        );
      }

      commitSha = (await response.text()).trim();
      versionCache.set(cacheKey, commitSha);
    }

    // Classify the reference so the security notes use accurate wording.
    // Both branches and tags are mutable on GitHub Actions, but "updating"
    // means something different for each.
    const refKind = isSemverTag(reference) ? "tag" : "branch";

    return {
      packageName,
      registry: "github-actions",
      // A branch has no version; echo the reference in the version slot.
      latestStable: reference,
      digest: commitSha,
      secureReference: formatSecureReference(packageName, commitSha, reference),
      isMutable: true,
      resolvedReference: reference,
      securityNotes: [
        "GitHub Action branches and tags are NOT immutable. Branches move and tags can be force-pushed to point to different commits.",
        `You are tracking the mutable ${refKind} '${reference}'. Its current commit SHA is returned in the 'digest' field.`,
        `Pin to the commit SHA for supply chain security: ${packageName}@${commitSha} # ${reference}`,
        refKind === "branch"
          ? `Updating means re-resolving branch '${reference}' to its latest commit, not moving to a release.`
          : `Tag '${reference}' can be force-pushed; re-resolve it to detect changes.`,
      ],
    };
  }

  async listVersions(
    packageName: string,
    options?: { repository?: string },
  ): Promise<VersionDetail[]> {
    const tags = await this.fetchTags(packageName, options?.repository);
    const releases = await this.fetchReleases(
      packageName,
      options?.repository,
    );

    // Filter to semver tags only
    const semverTags = tags.filter((t) => isSemverTag(t.name));
    const versionStrings = semverTags.map((t) => stripVPrefix(t.name));

    return sortVersionsDescending(versionStrings).map((version) => {
      const tag = semverTags.find((t) => stripVPrefix(t.name) === version);
      const release = releases.find(
        (r) => stripVPrefix(r.tag_name) === version,
      );
      return {
        version,
        publishedAt: release?.published_at
          ? new Date(release.published_at)
          : undefined,
        isPrerelease: release?.prerelease ?? isPrerelease(version),
        isDeprecated: false,
        digest: tag?.commit.sha,
      };
    });
  }

  async getMetadata(
    packageName: string,
    _version?: string,
    options?: { repository?: string },
  ): Promise<PackageMetadata> {
    const repo = await this.fetchRepo(packageName, options?.repository);

    return {
      name: packageName,
      registry: "github-actions",
      description: repo.description,
      license: repo.license?.spdx_id || repo.license?.name,
      homepage: repo.homepage || repo.html_url,
      repository: repo.html_url,
    };
  }
}

export const githubActionsClient = new GitHubActionsClient();
