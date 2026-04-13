/**
 * Swift Package Manager Registry Client
 * Uses the GitHub API for version lookups since SPM packages are GitHub repositories
 * Package format: owner/repo (e.g., apple/swift-nio, Alamofire/Alamofire)
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
 * Matches patterns: 1.0.0, v1.0.0, 1.0, v1.0, etc.
 */
function isSemverTag(tag: string): boolean {
  return /^v?\d+\.\d+(\.\d+)?(-[\w.]+)?(\+[\w.]+)?$/.test(tag);
}

/**
 * Strip the "v" prefix from a tag for version comparison
 */
function stripVPrefix(tag: string): string {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

export class SwiftClient implements RegistryClient {
  readonly registry = "swift" as const satisfies Registry;

  private getApiUrl(repositoryName?: string): string {
    const repoConfig = getRepositoryConfig("swift", repositoryName);
    return repoConfig.url;
  }

  private async fetchTags(
    packageName: string,
    repositoryName?: string,
  ): Promise<GitHubTag[]> {
    const apiUrl = this.getApiUrl(repositoryName);
    const repoConfig = getRepositoryConfig("swift", repositoryName);
    const cacheKey = `swift:${apiUrl}:${packageName}:tags`;
    const cached = versionCache.get(cacheKey);
    if (cached) {
      return cached as GitHubTag[];
    }

    const url = `${apiUrl}/repos/${packageName}/tags?per_page=100`;
    const response = await fetchWithHeaders(url, { auth: repoConfig.auth });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(
          `Repository '${packageName}' not found on GitHub`,
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
    const repoConfig = getRepositoryConfig("swift", repositoryName);
    const cacheKey = `swift:${apiUrl}:${packageName}:releases`;
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
    const repoConfig = getRepositoryConfig("swift", repositoryName);
    const cacheKey = `swift:${apiUrl}:${packageName}:repo`;
    const cached = versionCache.get(cacheKey);
    if (cached) {
      return cached as GitHubRepo;
    }

    const url = `${apiUrl}/repos/${packageName}`;
    const response = await fetchWithHeaders(url, { auth: repoConfig.auth });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(
          `Repository '${packageName}' not found on GitHub`,
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

    // Find release data for publish date
    const release = releases.find(
      (r) => stripVPrefix(r.tag_name) === resolved.latestStable,
    );

    const result: VersionInfo = {
      packageName,
      registry: "swift",
      latestStable: resolved.latestStable,
      publishedAt: release?.published_at
        ? new Date(release.published_at)
        : undefined,
    };

    if (resolved.latestPrerelease) {
      result.latestPrerelease = resolved.latestPrerelease;
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
      registry: "swift",
      description: repo.description,
      license: repo.license?.spdx_id || repo.license?.name,
      homepage: repo.homepage || repo.html_url,
      repository: repo.html_url,
    };
  }
}

export const swiftClient = new SwiftClient();
