/**
 * RubyGems Registry Client
 * Uses the official RubyGems API at rubygems.org
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

interface RubyGemsGemResponse {
  name: string;
  version: string;
  info?: string;
  licenses?: string[];
  homepage_uri?: string;
  source_code_uri?: string;
  project_uri?: string;
}

interface RubyGemsVersionResponse {
  number: string;
  created_at: string;
  prerelease: boolean;
  yanked?: boolean;
  platform?: string;
}

export class RubyGemsClient implements RegistryClient {
  readonly registry = "rubygems" as const satisfies Registry;

  private async fetchGem(
    gemName: string,
    repositoryName?: string,
  ): Promise<RubyGemsGemResponse> {
    const repoConfig = getRepositoryConfig("rubygems", repositoryName);
    const cacheKey = `rubygems:${repoConfig.url}:${gemName}:gem`;
    const cached = versionCache.get(cacheKey);
    if (cached) {
      return cached as RubyGemsGemResponse;
    }

    const url = `${repoConfig.url}/api/v1/gems/${gemName}.json`;
    const response = await fetchWithHeaders(url, { auth: repoConfig.auth });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(
          `Gem '${gemName}' not found on ${repoConfig.name}`,
        );
      }
      throw new Error(
        `${repoConfig.name} error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as RubyGemsGemResponse;
    versionCache.set(cacheKey, data);
    return data;
  }

  private async fetchVersions(
    gemName: string,
    repositoryName?: string,
  ): Promise<RubyGemsVersionResponse[]> {
    const repoConfig = getRepositoryConfig("rubygems", repositoryName);
    const cacheKey = `rubygems:${repoConfig.url}:${gemName}:versions`;
    const cached = versionCache.get(cacheKey);
    if (cached) {
      return cached as RubyGemsVersionResponse[];
    }

    const url = `${repoConfig.url}/api/v1/versions/${gemName}.json`;
    const response = await fetchWithHeaders(url, { auth: repoConfig.auth });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(
          `Gem '${gemName}' not found on ${repoConfig.name}`,
        );
      }
      throw new Error(
        `${repoConfig.name} error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as RubyGemsVersionResponse[];
    versionCache.set(cacheKey, data);
    return data;
  }

  async lookupVersion(
    packageName: string,
    options?: LookupOptions & { repository?: string },
  ): Promise<VersionInfo> {
    const versions = await this.fetchVersions(
      packageName,
      options?.repository,
    );

    // Filter out yanked versions and get only ruby platform
    let versionNumbers = versions
      .filter((v) => !v.yanked && (!v.platform || v.platform === "ruby"))
      .map((v) => v.number);

    if (options?.versionPrefix) {
      versionNumbers = filterByPrefix(versionNumbers, options.versionPrefix);
      if (versionNumbers.length === 0) {
        throw new Error(
          `No versions found for '${packageName}' with prefix '${options.versionPrefix}'`,
        );
      }
    }

    // Fetch fallback version from gem metadata if no stable in version list
    // (only when no prefix filter, to avoid an extra HTTP call when scoped)
    let fallbackStable: string | undefined;
    if (!options?.versionPrefix && !findLatestStable(versionNumbers)) {
      const gem = await this.fetchGem(packageName, options?.repository);
      fallbackStable = gem.version;
    }

    const resolved = resolveLatestVersions(versionNumbers, {
      includePrerelease: options?.includePrerelease,
      fallbackStable,
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

    const versionData = versions.find((v) =>
      v.number === resolved.latestStable
    );

    const result: VersionInfo = {
      packageName,
      registry: "rubygems",
      latestStable: resolved.latestStable,
      publishedAt: versionData?.created_at
        ? new Date(versionData.created_at)
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
    const versions = await this.fetchVersions(
      packageName,
      options?.repository,
    );

    // Filter to ruby platform only
    const rubyVersions = versions.filter(
      (v) => !v.platform || v.platform === "ruby",
    );

    return sortVersionsDescending(rubyVersions.map((v) => v.number)).map(
      (version) => {
        const versionData = rubyVersions.find((v) => v.number === version);
        return {
          version,
          publishedAt: versionData?.created_at
            ? new Date(versionData.created_at)
            : undefined,
          isPrerelease: versionData?.prerelease ?? isPrerelease(version),
          isDeprecated: false,
          yanked: versionData?.yanked,
        };
      },
    );
  }

  async getMetadata(
    packageName: string,
    _version?: string,
    options?: { repository?: string },
  ): Promise<PackageMetadata> {
    const gem = await this.fetchGem(packageName, options?.repository);

    return {
      name: gem.name,
      registry: "rubygems",
      description: gem.info,
      license: gem.licenses?.join(", "),
      homepage: gem.homepage_uri || gem.project_uri,
      repository: gem.source_code_uri,
    };
  }
}

export const rubygemsClient = new RubyGemsClient();
