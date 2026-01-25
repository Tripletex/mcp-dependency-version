/**
 * PyPI Registry Client
 * Uses the official PyPI registry at pypi.org by default
 * Supports custom PyPI registries via configuration
 */

import type {
  Registry,
  RegistryClient,
  VersionInfo,
  VersionDetail,
  PackageMetadata,
  LookupOptions,
} from "./types.ts";
import {
  isPrerelease,
  sortVersionsDescending,
  findLatestStable,
  findLatestPrerelease,
  filterByPrefix,
} from "../utils/version.ts";
import { versionCache } from "../utils/cache.ts";
import { fetchWithHeaders } from "../utils/http.ts";
import { getRepositoryConfig } from "../config/loader.ts";

interface PyPIResponse {
  info: {
    name: string;
    version: string;
    summary?: string;
    license?: string;
    home_page?: string;
    project_url?: string;
    project_urls?: Record<string, string>;
    author?: string;
    yanked?: boolean;
    yanked_reason?: string;
  };
  releases: Record<
    string,
    {
      upload_time_iso_8601?: string;
      yanked?: boolean;
    }[]
  >;
}

export class PyPIClient implements RegistryClient {
  readonly registry = "pypi" as const satisfies Registry;

  /**
   * Normalize package name according to PEP 503
   * https://peps.python.org/pep-0503/#normalized-names
   */
  private normalizePackageName(name: string): string {
    return name.toLowerCase().replace(/[-_.]+/g, "-");
  }

  private async fetchPackage(
    packageName: string,
    repositoryName?: string
  ): Promise<PyPIResponse> {
    const repoConfig = getRepositoryConfig("pypi", repositoryName);
    const normalized = this.normalizePackageName(packageName);
    const cacheKey = `pypi:${repoConfig.url}:${normalized}`;
    const cached = versionCache.get(cacheKey);
    if (cached) {
      return cached as PyPIResponse;
    }

    const url = `${repoConfig.url}/${normalized}/json`;
    const response = await fetchWithHeaders(url, { auth: repoConfig.auth });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Package '${packageName}' not found on ${repoConfig.name}`);
      }
      throw new Error(
        `${repoConfig.name} error: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as PyPIResponse;
    versionCache.set(cacheKey, data);
    return data;
  }

  /**
   * Check if a Python version string represents a prerelease
   * Follows PEP 440: https://peps.python.org/pep-0440/
   */
  private isPythonPrerelease(version: string): boolean {
    // PEP 440 prerelease identifiers
    const prereleasePattern = /\.(dev|a|alpha|b|beta|c|rc|pre|preview)\d*$/i;
    const suffixPattern = /(dev|a|alpha|b|beta|c|rc|pre|preview)\d*$/i;

    return (
      prereleasePattern.test(version) ||
      suffixPattern.test(version) ||
      isPrerelease(version)
    );
  }

  async lookupVersion(
    packageName: string,
    options?: LookupOptions & { repository?: string }
  ): Promise<VersionInfo> {
    const data = await this.fetchPackage(packageName, options?.repository);
    let versions = Object.keys(data.releases).filter((v) => {
      const releases = data.releases[v];
      // Filter out empty releases and yanked versions
      return releases.length > 0 && !releases.some((r) => r.yanked);
    });

    // Apply version prefix filter if specified
    if (options?.versionPrefix) {
      versions = filterByPrefix(versions, options.versionPrefix);
    }

    // Find latest stable version
    const stableVersions = versions.filter(
      (v) => !this.isPythonPrerelease(v)
    );
    let latestStable = findLatestStable(stableVersions);

    // Fall back to info.version if no stable found without prefix
    if (!latestStable && !options?.versionPrefix) {
      latestStable = data.info.version;
    }

    if (!latestStable) {
      throw new Error(
        `No stable version found for '${packageName}'${options?.versionPrefix ? ` with prefix '${options.versionPrefix}'` : ""}`
      );
    }

    const releases = data.releases[latestStable];
    const publishedAt = releases?.[0]?.upload_time_iso_8601;

    const result: VersionInfo = {
      packageName: data.info.name,
      registry: "pypi",
      latestStable,
      publishedAt: publishedAt ? new Date(publishedAt) : undefined,
    };

    // Include latest prerelease if requested
    if (options?.includePrerelease) {
      const prereleaseVersions = versions.filter((v) =>
        this.isPythonPrerelease(v)
      );
      const latestPre = findLatestPrerelease(prereleaseVersions);
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
    options?: { repository?: string }
  ): Promise<VersionDetail[]> {
    const data = await this.fetchPackage(packageName, options?.repository);
    const versions = Object.keys(data.releases);

    return sortVersionsDescending(versions).map((version) => {
      const releases = data.releases[version];
      const publishedAt = releases?.[0]?.upload_time_iso_8601;
      const yanked = releases?.some((r) => r.yanked);

      return {
        version,
        publishedAt: publishedAt ? new Date(publishedAt) : undefined,
        isPrerelease: this.isPythonPrerelease(version),
        isDeprecated: false,
        yanked,
      };
    });
  }

  async getMetadata(
    packageName: string,
    _version?: string,
    options?: { repository?: string }
  ): Promise<PackageMetadata> {
    const data = await this.fetchPackage(packageName, options?.repository);

    // Try to find repository URL from project_urls
    let repository: string | undefined;
    if (data.info.project_urls) {
      repository =
        data.info.project_urls["Source"] ||
        data.info.project_urls["Repository"] ||
        data.info.project_urls["GitHub"] ||
        data.info.project_urls["Code"];
    }

    return {
      name: data.info.name,
      registry: "pypi",
      description: data.info.summary,
      license: data.info.license,
      homepage: data.info.home_page || data.info.project_url,
      repository,
    };
  }
}

export const pypiClient = new PyPIClient();
