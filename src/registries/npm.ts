/**
 * npm Registry Client
 * Uses the official npm registry at registry.npmjs.org by default
 * Supports custom npm registries via configuration
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

interface NpmPackageResponse {
  name: string;
  description?: string;
  readme?: string;
  "dist-tags": Record<string, string>;
  versions: Record<
    string,
    {
      version: string;
      deprecated?: string;
      license?: string | { type: string };
      homepage?: string;
      repository?: { type?: string; url?: string } | string;
    }
  >;
  time: Record<string, string>;
  license?: string;
  homepage?: string;
  repository?: { type?: string; url?: string } | string;
}

export class NpmClient implements RegistryClient {
  readonly registry = "npm" as const satisfies Registry;

  private encodePackageName(name: string): string {
    // Scoped packages need URL encoding: @scope/package -> @scope%2Fpackage
    if (name.startsWith("@")) {
      return name.replace("/", "%2F");
    }
    return name;
  }

  private async fetchPackage(
    packageName: string,
    repositoryName?: string,
  ): Promise<NpmPackageResponse> {
    const repoConfig = getRepositoryConfig("npm", repositoryName);
    const cacheKey = `npm:${repoConfig.url}:${packageName}`;
    const cached = versionCache.get(cacheKey);
    if (cached) {
      return cached as NpmPackageResponse;
    }

    const encodedName = this.encodePackageName(packageName);
    const url = `${repoConfig.url}/${encodedName}`;
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

    const data = (await response.json()) as NpmPackageResponse;
    versionCache.set(cacheKey, data);
    return data;
  }

  async lookupVersion(
    packageName: string,
    options?: LookupOptions & { repository?: string },
  ): Promise<VersionInfo> {
    const data = await this.fetchPackage(packageName, options?.repository);
    let versions = Object.keys(data.versions);

    // Apply version prefix filter if specified
    if (options?.versionPrefix) {
      versions = filterByPrefix(versions, options.versionPrefix);
    }

    // Find latest stable version
    let latestStable = findLatestStable(versions);

    // If no stable found with prefix, fall back to dist-tag
    if (!latestStable && !options?.versionPrefix) {
      latestStable = data["dist-tags"].latest;
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

    const versionData = data.versions[latestStable];
    const publishedAt = data.time[latestStable];

    const result: VersionInfo = {
      packageName,
      registry: "npm",
      latestStable,
      publishedAt: publishedAt ? new Date(publishedAt) : undefined,
      deprecated: !!versionData?.deprecated,
      deprecationMessage: versionData?.deprecated,
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
    const data = await this.fetchPackage(packageName, options?.repository);
    const versions = Object.keys(data.versions);

    return sortVersionsDescending(versions).map((version) => {
      const versionData = data.versions[version];
      const publishedAt = data.time[version];

      return {
        version,
        publishedAt: publishedAt ? new Date(publishedAt) : undefined,
        isPrerelease: isPrerelease(version),
        isDeprecated: !!versionData?.deprecated,
      };
    });
  }

  async getMetadata(
    packageName: string,
    version?: string,
    options?: { repository?: string },
  ): Promise<PackageMetadata> {
    const data = await this.fetchPackage(packageName, options?.repository);

    const targetVersion = version ?? data["dist-tags"].latest;
    const versionData = data.versions[targetVersion];

    const repo = versionData?.repository ?? data.repository;
    let repoUrl: string | undefined;
    if (typeof repo === "string") {
      repoUrl = repo;
    } else if (repo?.url) {
      repoUrl = repo.url.replace(/^git\+/, "").replace(/\.git$/, "");
    }

    const license = versionData?.license ?? data.license;
    const licenseStr = typeof license === "string" ? license : license?.type;

    return {
      name: packageName,
      registry: "npm",
      description: data.description,
      license: licenseStr,
      homepage: versionData?.homepage ?? data.homepage,
      repository: repoUrl,
    };
  }
}

export const npmClient = new NpmClient();
