/**
 * NuGet Registry Client
 * Uses the official NuGet registry at api.nuget.org by default
 * Supports custom NuGet registries via configuration
 *
 * Endpoints:
 * - Package versions: GET {url}-flatcontainer/{id}/index.json
 * - Package metadata: GET {url}/registration5-gz-semver2/{id}/index.json
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
  findLatestStable,
  isPrerelease,
  resolveLatestVersions,
  sortVersionsDescending,
} from "../utils/version.ts";
import { versionCache } from "../utils/cache.ts";
import { fetchWithHeaders } from "../utils/http.ts";
import { getRepositoryConfig } from "../config/loader.ts";

interface NuGetVersionsResponse {
  versions: string[];
}

interface NuGetCatalogEntry {
  version: string;
  listed?: boolean;
  published?: string;
  deprecation?: {
    message?: string;
    reasons?: string[];
  };
  description?: string;
  authors?: string;
  licenseExpression?: string;
  licenseUrl?: string;
  projectUrl?: string;
  repository?: string;
}

interface NuGetRegistrationPage {
  items: {
    catalogEntry: NuGetCatalogEntry;
  }[];
}

interface NuGetRegistrationResponse {
  items: NuGetRegistrationPage[];
}

export class NuGetClient implements RegistryClient {
  readonly registry = "nuget" as const satisfies Registry;

  private async fetchVersions(
    packageName: string,
    repositoryName?: string,
  ): Promise<string[]> {
    const repoConfig = getRepositoryConfig("nuget", repositoryName);
    const cacheKey =
      `nuget:${repoConfig.url}:versions:${packageName.toLowerCase()}`;
    const cached = versionCache.get(cacheKey);
    if (cached) {
      return cached as string[];
    }

    const url =
      `${repoConfig.url}-flatcontainer/${packageName.toLowerCase()}/index.json`;
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

    const data = (await response.json()) as NuGetVersionsResponse;
    versionCache.set(cacheKey, data.versions);
    return data.versions;
  }

  private async fetchRegistration(
    packageName: string,
    repositoryName?: string,
  ): Promise<NuGetRegistrationResponse> {
    const repoConfig = getRepositoryConfig("nuget", repositoryName);
    const cacheKey = `nuget:${repoConfig.url}:reg:${packageName.toLowerCase()}`;
    const cached = versionCache.get(cacheKey);
    if (cached) {
      return cached as NuGetRegistrationResponse;
    }

    const url =
      `${repoConfig.url}/registration5-gz-semver2/${packageName.toLowerCase()}/index.json`;
    const response = await fetchWithHeaders(url, {
      auth: repoConfig.auth,
      headers: {
        "Accept-Encoding": "gzip",
      },
    });

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

    const data = (await response.json()) as NuGetRegistrationResponse;
    versionCache.set(cacheKey, data);
    return data;
  }

  private getCatalogEntries(
    registration: NuGetRegistrationResponse,
  ): Map<string, NuGetCatalogEntry> {
    const entries = new Map<string, NuGetCatalogEntry>();
    for (const page of registration.items) {
      if (page.items) {
        for (const item of page.items) {
          entries.set(item.catalogEntry.version, item.catalogEntry);
        }
      }
    }
    return entries;
  }

  async lookupVersion(
    packageName: string,
    options?: LookupOptions & { repository?: string },
  ): Promise<VersionInfo> {
    let versions = await this.fetchVersions(packageName, options?.repository);

    // Apply version prefix filter if specified
    if (options?.versionPrefix) {
      versions = filterByPrefix(versions, options.versionPrefix);
    }

    const resolved = resolveLatestVersions(versions, {
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
    const latestStable = resolved.latestStable;

    // Fetch registration to get metadata
    let publishedAt: Date | undefined;
    let deprecated = false;
    let deprecationMessage: string | undefined;

    try {
      const registration = await this.fetchRegistration(
        packageName,
        options?.repository,
      );
      const entries = this.getCatalogEntries(registration);
      const entry = entries.get(latestStable);
      if (entry) {
        publishedAt = entry.published ? new Date(entry.published) : undefined;
        if (entry.deprecation) {
          deprecated = true;
          deprecationMessage = entry.deprecation.message ||
            entry.deprecation.reasons?.join(", ");
        }
      }
    } catch {
      // Registration fetch is optional, continue without metadata
    }

    const result: VersionInfo = {
      packageName,
      registry: "nuget",
      latestStable,
      publishedAt,
      deprecated,
      deprecationMessage,
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
    const versions = await this.fetchVersions(packageName, options?.repository);

    // Try to get metadata from registration
    let entries = new Map<string, NuGetCatalogEntry>();
    try {
      const registration = await this.fetchRegistration(
        packageName,
        options?.repository,
      );
      entries = this.getCatalogEntries(registration);
    } catch {
      // Continue without detailed metadata
    }

    return sortVersionsDescending(versions).map((version) => {
      const entry = entries.get(version);
      return {
        version,
        publishedAt: entry?.published ? new Date(entry.published) : undefined,
        isPrerelease: isPrerelease(version),
        isDeprecated: !!entry?.deprecation,
      };
    });
  }

  async getMetadata(
    packageName: string,
    version?: string,
    options?: { repository?: string },
  ): Promise<PackageMetadata> {
    const registration = await this.fetchRegistration(
      packageName,
      options?.repository,
    );
    const entries = this.getCatalogEntries(registration);

    // Get specific version or latest
    let entry: NuGetCatalogEntry | undefined;
    if (version) {
      entry = entries.get(version);
    } else {
      const versions = await this.fetchVersions(
        packageName,
        options?.repository,
      );
      const latestStable = findLatestStable(versions);
      if (latestStable) {
        entry = entries.get(latestStable);
      }
    }

    return {
      name: packageName,
      registry: "nuget",
      description: entry?.description,
      license: entry?.licenseExpression,
      homepage: entry?.projectUrl,
      repository: entry?.repository,
    };
  }
}

export const nugetClient = new NuGetClient();
