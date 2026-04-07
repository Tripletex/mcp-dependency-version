/**
 * JSR Registry Client
 * Uses the official JSR registry at api.jsr.io by default
 * Supports custom JSR registries via configuration
 *
 * Endpoints:
 * - Package info: GET {url}/scopes/{scope}/packages/{name}
 * - Versions list: GET {url}/scopes/{scope}/packages/{name}/versions
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

interface JsrPackageResponse {
  scope: string;
  name: string;
  description?: string;
  latestVersion?: string;
  runtimeCompat?: {
    jsr?: boolean;
    node?: boolean;
    bun?: boolean;
    browser?: boolean;
  };
  isArchived?: boolean;
  githubRepository?: {
    owner: string;
    name: string;
  };
}

interface JsrVersionResponse {
  scope: string;
  name: string;
  version: string;
  yanked?: boolean;
  createdAt?: string;
}

/**
 * Parse a JSR package name into scope and name
 * @param packageName Format: "@scope/name" (e.g., "@std/path")
 */
function parseJsrPackageName(
  packageName: string,
): { scope: string; name: string } {
  const match = packageName.match(/^@([^/]+)\/(.+)$/);
  if (!match) {
    throw new Error(
      `Invalid JSR package name: '${packageName}'. Expected format: @scope/name`,
    );
  }
  return { scope: match[1], name: match[2] };
}

export class JsrClient implements RegistryClient {
  readonly registry = "jsr" as const satisfies Registry;

  private async fetchPackage(
    packageName: string,
    repositoryName?: string,
  ): Promise<JsrPackageResponse> {
    const repoConfig = getRepositoryConfig("jsr", repositoryName);
    const cacheKey = `jsr:${repoConfig.url}:${packageName}`;
    const cached = versionCache.get(cacheKey);
    if (cached) {
      return cached as JsrPackageResponse;
    }

    const { scope, name } = parseJsrPackageName(packageName);
    const url = `${repoConfig.url}/scopes/${scope}/packages/${name}`;
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

    const data = (await response.json()) as JsrPackageResponse;
    versionCache.set(cacheKey, data);
    return data;
  }

  private async fetchVersions(
    packageName: string,
    repositoryName?: string,
  ): Promise<JsrVersionResponse[]> {
    const repoConfig = getRepositoryConfig("jsr", repositoryName);
    const cacheKey = `jsr:${repoConfig.url}:versions:${packageName}`;
    const cached = versionCache.get(cacheKey);
    if (cached) {
      return cached as JsrVersionResponse[];
    }

    const { scope, name } = parseJsrPackageName(packageName);
    const url = `${repoConfig.url}/scopes/${scope}/packages/${name}/versions`;
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

    const data = (await response.json()) as
      | JsrVersionResponse[]
      | { items: JsrVersionResponse[] };
    // JSR API returns { items: [...] } for paginated responses
    const versions = Array.isArray(data) ? data : data.items;
    versionCache.set(cacheKey, versions);
    return versions;
  }

  async lookupVersion(
    packageName: string,
    options?: LookupOptions & { repository?: string },
  ): Promise<VersionInfo> {
    const [packageData, versionsData] = await Promise.all([
      this.fetchPackage(packageName, options?.repository),
      this.fetchVersions(packageName, options?.repository),
    ]);

    let versions = versionsData
      .filter((v) => !v.yanked)
      .map((v) => v.version);

    // Apply version prefix filter if specified
    if (options?.versionPrefix) {
      versions = filterByPrefix(versions, options.versionPrefix);
    }

    // Find latest stable version
    let latestStable = findLatestStable(versions);

    // If no stable found with prefix, fall back to package metadata
    if (!latestStable && !options?.versionPrefix) {
      latestStable = packageData.latestVersion ?? null;
    }

    if (!latestStable) {
      throw new Error(
        `No stable version found for '${packageName}'${
          options?.versionPrefix
            ? ` with prefix '${options.versionPrefix}'`
            : ""
        }`,
      );
    }

    // Find publish date for the latest version
    const latestVersionData = versionsData.find((v) =>
      v.version === latestStable
    );

    const result: VersionInfo = {
      packageName,
      registry: "jsr",
      latestStable,
      publishedAt: latestVersionData?.createdAt
        ? new Date(latestVersionData.createdAt)
        : undefined,
      deprecated: packageData.isArchived ?? false,
    };

    // Include latest prerelease if requested
    if (options?.includePrerelease) {
      const latestPre = findLatestPrerelease(versions);
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
    const versionsData = await this.fetchVersions(
      packageName,
      options?.repository,
    );
    const versions = versionsData.map((v) => v.version);

    return sortVersionsDescending(versions).map((version) => {
      const versionData = versionsData.find((v) => v.version === version);

      return {
        version,
        publishedAt: versionData?.createdAt
          ? new Date(versionData.createdAt)
          : undefined,
        isPrerelease: isPrerelease(version),
        isDeprecated: false,
        yanked: versionData?.yanked,
      };
    });
  }

  async getMetadata(
    packageName: string,
    _version?: string,
    options?: { repository?: string },
  ): Promise<PackageMetadata> {
    const packageData = await this.fetchPackage(
      packageName,
      options?.repository,
    );

    // Build GitHub repository URL if available
    let repository: string | undefined;
    if (packageData.githubRepository) {
      repository =
        `https://github.com/${packageData.githubRepository.owner}/${packageData.githubRepository.name}`;
    }

    return {
      name: packageName,
      registry: "jsr",
      description: packageData.description,
      repository,
      homepage: `https://jsr.io/${packageName}`,
    };
  }
}

export const jsrClient = new JsrClient();
