/**
 * Packagist Registry Client
 * Uses the Packagist API at packagist.org for PHP/Composer packages
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

interface PackagistVersionData {
  version: string;
  version_normalized: string;
  time?: string;
  abandoned?: boolean | string;
  license?: string[];
  description?: string;
  homepage?: string;
  source?: { url?: string };
}

interface PackagistP2Response {
  packages: Record<string, PackagistVersionData[]>;
}

interface PackagistFullResponse {
  package: {
    name: string;
    description?: string;
    time?: string;
    type?: string;
    repository?: string;
    abandoned?: boolean | string;
    versions: Record<string, PackagistVersionData>;
  };
}

export class PackagistClient implements RegistryClient {
  readonly registry = "packagist" as const satisfies Registry;

  private async fetchP2(
    packageName: string,
    repositoryName?: string,
  ): Promise<PackagistVersionData[]> {
    const repoConfig = getRepositoryConfig("packagist", repositoryName);
    const cacheKey = `packagist:${repoConfig.url}:${packageName}:p2`;
    const cached = versionCache.get(cacheKey);
    if (cached) {
      return cached as PackagistVersionData[];
    }

    const url = `${repoConfig.url}/p2/${packageName}.json`;
    const response = await fetchWithHeaders(url, { auth: repoConfig.auth });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(
          `Package '${packageName}' not found on ${repoConfig.name}`,
        );
      }
      throw new Error(
        `${repoConfig.name} error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as PackagistP2Response;
    const versions = data.packages[packageName] || [];
    versionCache.set(cacheKey, versions);
    return versions;
  }

  private async fetchFullMetadata(
    packageName: string,
  ): Promise<PackagistFullResponse> {
    const cacheKey = `packagist:full:${packageName}`;
    const cached = versionCache.get(cacheKey);
    if (cached) {
      return cached as PackagistFullResponse;
    }

    const url = `https://packagist.org/packages/${packageName}.json`;
    const response = await fetchWithHeaders(url);

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Package '${packageName}' not found on Packagist`);
      }
      throw new Error(
        `Packagist error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as PackagistFullResponse;
    versionCache.set(cacheKey, data);
    return data;
  }

  /**
   * Extract clean version string from Packagist version.
   * Packagist versions are prefixed with "v" sometimes, and dev branches
   * use patterns like "dev-main" or "1.0.x-dev".
   */
  private cleanVersion(version: string): string {
    return version.replace(/^v/, "");
  }

  /**
   * Check if a version string represents a dev/branch version
   */
  private isDevVersion(version: string): boolean {
    return version.startsWith("dev-") || version.endsWith("-dev");
  }

  async lookupVersion(
    packageName: string,
    options?: LookupOptions & { repository?: string },
  ): Promise<VersionInfo> {
    const versions = await this.fetchP2(packageName, options?.repository);

    // Filter out dev versions and extract clean version strings
    let versionStrings = versions
      .filter((v) => !this.isDevVersion(v.version))
      .map((v) => this.cleanVersion(v.version));

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

    // Find matching version data
    const versionData = versions.find(
      (v) => this.cleanVersion(v.version) === resolved.latestStable,
    );

    const result: VersionInfo = {
      packageName,
      registry: "packagist",
      latestStable: resolved.latestStable,
      publishedAt: versionData?.time ? new Date(versionData.time) : undefined,
      deprecated: !!versionData?.abandoned,
      deprecationMessage: typeof versionData?.abandoned === "string"
        ? versionData.abandoned
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
    const versions = await this.fetchP2(packageName, options?.repository);

    // Filter out dev versions
    const releaseVersions = versions.filter(
      (v) => !this.isDevVersion(v.version),
    );

    return sortVersionsDescending(
      releaseVersions.map((v) => this.cleanVersion(v.version)),
    ).map((version) => {
      const versionData = releaseVersions.find(
        (v) => this.cleanVersion(v.version) === version,
      );
      return {
        version,
        publishedAt: versionData?.time ? new Date(versionData.time) : undefined,
        isPrerelease: isPrerelease(version),
        isDeprecated: !!versionData?.abandoned,
      };
    });
  }

  async getMetadata(
    packageName: string,
    _version?: string,
  ): Promise<PackageMetadata> {
    const data = await this.fetchFullMetadata(packageName);
    const pkg = data.package;

    // Find a version to get license info from
    const versionEntries = Object.values(pkg.versions);
    const firstVersion = versionEntries[0];

    return {
      name: pkg.name,
      registry: "packagist",
      description: pkg.description || firstVersion?.description,
      license: firstVersion?.license?.join(", "),
      homepage: firstVersion?.homepage,
      repository: pkg.repository,
    };
  }
}

export const packagistClient = new PackagistClient();
