/**
 * Pub Registry Client
 * Uses the pub.dev API for Dart/Flutter packages
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

interface PubVersionData {
  version: string;
  retracted?: boolean;
  published?: string;
  pubspec?: {
    name?: string;
    description?: string;
    homepage?: string;
    repository?: string;
    license?: string;
  };
}

interface PubPackageResponse {
  name: string;
  latest: PubVersionData;
  versions: PubVersionData[];
}

export class PubClient implements RegistryClient {
  readonly registry = "pub" as const satisfies Registry;

  private async fetchPackage(
    packageName: string,
    repositoryName?: string,
  ): Promise<PubPackageResponse> {
    const repoConfig = getRepositoryConfig("pub", repositoryName);
    const cacheKey = `pub:${repoConfig.url}:${packageName}`;
    const cached = versionCache.get(cacheKey);
    if (cached) {
      return cached as PubPackageResponse;
    }

    const url = `${repoConfig.url}/packages/${packageName}`;
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

    const data = (await response.json()) as PubPackageResponse;
    versionCache.set(cacheKey, data);
    return data;
  }

  async lookupVersion(
    packageName: string,
    options?: LookupOptions & { repository?: string },
  ): Promise<VersionInfo> {
    const data = await this.fetchPackage(packageName, options?.repository);

    // Filter out retracted versions
    let versionStrings = data.versions
      .filter((v) => !v.retracted)
      .map((v) => v.version);

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
      fallbackStable: !options?.versionPrefix ? data.latest.version : undefined,
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

    const versionData = data.versions.find((v) =>
      v.version === resolved.latestStable
    );

    const result: VersionInfo = {
      packageName,
      registry: "pub",
      latestStable: resolved.latestStable,
      publishedAt: versionData?.published
        ? new Date(versionData.published)
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
    const data = await this.fetchPackage(packageName, options?.repository);

    return sortVersionsDescending(data.versions.map((v) => v.version)).map(
      (version) => {
        const versionData = data.versions.find((v) => v.version === version);
        return {
          version,
          publishedAt: versionData?.published
            ? new Date(versionData.published)
            : undefined,
          isPrerelease: isPrerelease(version),
          isDeprecated: false,
          yanked: versionData?.retracted,
        };
      },
    );
  }

  async getMetadata(
    packageName: string,
    _version?: string,
    options?: { repository?: string },
  ): Promise<PackageMetadata> {
    const data = await this.fetchPackage(packageName, options?.repository);
    const pubspec = data.latest.pubspec;

    return {
      name: data.name,
      registry: "pub",
      description: pubspec?.description,
      license: pubspec?.license,
      homepage: pubspec?.homepage,
      repository: pubspec?.repository,
    };
  }
}

export const pubClient = new PubClient();
