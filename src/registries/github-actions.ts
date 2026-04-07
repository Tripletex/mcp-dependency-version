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
  findLatestPrerelease,
  findLatestStable,
  isPrerelease,
  sortVersionsDescending,
} from "../utils/version.ts";
import { versionCache } from "../utils/cache.ts";
import { fetchWithHeaders } from "../utils/http.ts";
import { getRepositoryConfig } from "../config/loader.ts";

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

  private getApiUrl(repositoryName?: string): string {
    const repoConfig = getRepositoryConfig("github-actions", repositoryName);
    return repoConfig.url;
  }

  private async fetchTags(
    packageName: string,
    repositoryName?: string,
  ): Promise<GitHubTag[]> {
    const apiUrl = this.getApiUrl(repositoryName);
    const repoConfig = getRepositoryConfig("github-actions", repositoryName);
    const cacheKey = `github-actions:${apiUrl}:${packageName}:tags`;
    const cached = versionCache.get(cacheKey);
    if (cached) {
      return cached as GitHubTag[];
    }

    const url = `${apiUrl}/repos/${packageName}/tags?per_page=100`;
    const response = await fetchWithHeaders(url, { auth: repoConfig.auth });

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
    const apiUrl = this.getApiUrl(repositoryName);
    const repoConfig = getRepositoryConfig("github-actions", repositoryName);
    const cacheKey = `github-actions:${apiUrl}:${packageName}:releases`;
    const cached = versionCache.get(cacheKey);
    if (cached) {
      return cached as GitHubRelease[];
    }

    const url = `${apiUrl}/repos/${packageName}/releases?per_page=100`;
    const response = await fetchWithHeaders(url, { auth: repoConfig.auth });

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
    const apiUrl = this.getApiUrl(repositoryName);
    const repoConfig = getRepositoryConfig("github-actions", repositoryName);
    const cacheKey = `github-actions:${apiUrl}:${packageName}:repo`;
    const cached = versionCache.get(cacheKey);
    if (cached) {
      return cached as GitHubRepo;
    }

    const url = `${apiUrl}/repos/${packageName}`;
    const response = await fetchWithHeaders(url, { auth: repoConfig.auth });

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

    const latestStable = findLatestStable(versionStrings);

    if (!latestStable) {
      throw new Error(
        `No stable version found for '${packageName}'${
          options?.versionPrefix
            ? ` with prefix '${options.versionPrefix}'`
            : ""
        }`,
      );
    }

    // Find the tag with matching version to get commit SHA
    const matchingTag = semverTags.find(
      (t) => stripVPrefix(t.name) === latestStable,
    );
    const commitSha = matchingTag?.commit.sha;

    // Find release data for publish date
    const release = releases.find(
      (r) => stripVPrefix(r.tag_name) === latestStable,
    );

    const versionTag = matchingTag?.name ?? `v${latestStable}`;

    const result: VersionInfo = {
      packageName,
      registry: "github-actions",
      latestStable,
      publishedAt: release?.published_at
        ? new Date(release.published_at)
        : undefined,
      digest: commitSha,
      secureReference: commitSha
        ? formatSecureReference(packageName, commitSha, versionTag)
        : undefined,
      securityNotes: [
        "GitHub Action tags are NOT immutable. Tags can be force-pushed to point to different commits.",
        "Use commit SHA-pinned references (owner/repo@sha) for supply chain security.",
        commitSha
          ? `Secure reference: ${packageName}@${commitSha} # ${versionTag}`
          : "Could not resolve commit SHA for this version.",
      ],
    };

    if (options?.includePrerelease) {
      const latestPre = findLatestPrerelease(versionStrings);
      if (
        latestPre &&
        sortVersionsDescending([latestPre, latestStable])[0] === latestPre
      ) {
        result.latestPrerelease = latestPre;
      }
    }

    return result;
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
