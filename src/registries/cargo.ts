/**
 * Cargo (crates.io) Registry Client
 * Uses the official crates.io registry by default
 * Supports custom Cargo registries via configuration
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

interface CratesResponse {
  crate: {
    id: string;
    name: string;
    description?: string;
    homepage?: string;
    repository?: string;
    documentation?: string;
    max_version: string;
    max_stable_version?: string;
    newest_version: string;
    downloads: number;
  };
  versions: {
    id: number;
    num: string;
    created_at: string;
    updated_at: string;
    yanked: boolean;
    license?: string;
    crate_size?: number;
    published_by?: {
      login: string;
    };
  }[];
}

export class CargoClient implements RegistryClient {
  readonly registry = "cargo" as const satisfies Registry;

  private async fetchCrate(
    crateName: string,
    repositoryName?: string,
  ): Promise<CratesResponse> {
    const repoConfig = getRepositoryConfig("cargo", repositoryName);
    const cacheKey = `cargo:${repoConfig.url}:${crateName}`;
    const cached = versionCache.get(cacheKey);
    if (cached) {
      return cached as CratesResponse;
    }

    const url = `${repoConfig.url}/${crateName}`;
    const response = await fetchWithHeaders(url, { auth: repoConfig.auth });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Crate '${crateName}' not found on ${repoConfig.name}`);
      }
      throw new Error(
        `${repoConfig.name} error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as CratesResponse;
    versionCache.set(cacheKey, data);
    return data;
  }

  async lookupVersion(
    packageName: string,
    options?: LookupOptions & { repository?: string },
  ): Promise<VersionInfo> {
    const data = await this.fetchCrate(packageName, options?.repository);

    // Filter out yanked versions
    let versions = data.versions
      .filter((v) => !v.yanked)
      .map((v) => v.num);

    // Apply version prefix filter if specified
    if (options?.versionPrefix) {
      versions = filterByPrefix(versions, options.versionPrefix);
      if (versions.length === 0) {
        throw new Error(
          `No versions found for '${packageName}' with prefix '${options.versionPrefix}'`,
        );
      }
    }

    // Find latest stable version
    let latestStable = findLatestStable(versions);

    // Fall back to max_stable_version if available
    if (!latestStable && !options?.versionPrefix) {
      latestStable = data.crate.max_stable_version || data.crate.max_version;
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

    const versionData = data.versions.find((v) => v.num === latestStable);
    const publishedAt = versionData?.created_at;

    const result: VersionInfo = {
      packageName: data.crate.name,
      registry: "cargo",
      latestStable,
      publishedAt: publishedAt ? new Date(publishedAt) : undefined,
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
    const data = await this.fetchCrate(packageName, options?.repository);

    return sortVersionsDescending(data.versions.map((v) => v.num)).map(
      (version) => {
        const versionData = data.versions.find((v) => v.num === version);
        return {
          version,
          publishedAt: versionData?.created_at
            ? new Date(versionData.created_at)
            : undefined,
          isPrerelease: isPrerelease(version),
          isDeprecated: false,
          yanked: versionData?.yanked,
        };
      },
    );
  }

  async getMetadata(
    packageName: string,
    version?: string,
    options?: { repository?: string },
  ): Promise<PackageMetadata> {
    const data = await this.fetchCrate(packageName, options?.repository);

    const targetVersion = version || data.crate.max_version;
    const versionData = data.versions.find((v) => v.num === targetVersion);

    return {
      name: data.crate.name,
      registry: "cargo",
      description: data.crate.description,
      license: versionData?.license,
      homepage: data.crate.homepage || data.crate.documentation,
      repository: data.crate.repository,
    };
  }
}

export const cargoClient = new CargoClient();
