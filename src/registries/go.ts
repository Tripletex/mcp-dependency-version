/**
 * Go Proxy Registry Client
 * Uses the official Go proxy at proxy.golang.org by default
 * Supports custom Go proxies via configuration
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

interface GoModInfo {
  Version: string;
  Time: string;
}

export class GoClient implements RegistryClient {
  readonly registry = "go" as const satisfies Registry;

  /**
   * Encode module path for Go proxy
   * Uppercase letters are escaped: A -> !a
   */
  private encodeModulePath(modulePath: string): string {
    return modulePath.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);
  }

  private async fetchVersionList(
    modulePath: string,
    repositoryName?: string,
  ): Promise<string[]> {
    const repoConfig = getRepositoryConfig("go", repositoryName);
    const cacheKey = `go:${repoConfig.url}:versions:${modulePath}`;
    const cached = versionCache.get(cacheKey);
    if (cached) {
      return cached as string[];
    }

    const encodedPath = this.encodeModulePath(modulePath);
    const url = `${repoConfig.url}/${encodedPath}/@v/list`;
    const response = await fetchWithHeaders(url, { auth: repoConfig.auth });

    if (!response.ok) {
      if (response.status === 404 || response.status === 410) {
        throw new Error(
          `Module '${modulePath}' not found on ${repoConfig.name}`,
        );
      }
      throw new Error(
        `${repoConfig.name} error: ${response.status} ${response.statusText}`,
      );
    }

    const text = await response.text();
    const versions = text
      .trim()
      .split("\n")
      .filter((v) => v.length > 0);

    versionCache.set(cacheKey, versions);
    return versions;
  }

  private async fetchVersionInfo(
    modulePath: string,
    version: string,
    repositoryName?: string,
  ): Promise<GoModInfo> {
    const repoConfig = getRepositoryConfig("go", repositoryName);
    const cacheKey = `go:${repoConfig.url}:info:${modulePath}:${version}`;
    const cached = versionCache.get(cacheKey);
    if (cached) {
      return cached as GoModInfo;
    }

    const encodedPath = this.encodeModulePath(modulePath);
    const url = `${repoConfig.url}/${encodedPath}/@v/${version}.info`;
    const response = await fetchWithHeaders(url, { auth: repoConfig.auth });

    if (!response.ok) {
      throw new Error(
        `${repoConfig.name} error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as GoModInfo;
    versionCache.set(cacheKey, data);
    return data;
  }

  async lookupVersion(
    packageName: string,
    options?: LookupOptions & { repository?: string },
  ): Promise<VersionInfo> {
    let versions = await this.fetchVersionList(
      packageName,
      options?.repository,
    );

    // Apply version prefix filter if specified
    if (options?.versionPrefix) {
      versions = filterByPrefix(versions, options.versionPrefix);
      if (versions.length === 0) {
        throw new Error(
          `No versions found for '${packageName}' with prefix '${options.versionPrefix}'`,
        );
      }
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

    // Fetch version info to get timestamp
    let publishedAt: Date | undefined;
    try {
      const info = await this.fetchVersionInfo(
        packageName,
        resolved.latestStable,
        options?.repository,
      );
      publishedAt = new Date(info.Time);
    } catch {
      // Ignore errors fetching version info
    }

    const result: VersionInfo = {
      packageName,
      registry: "go",
      latestStable: resolved.latestStable,
      publishedAt,
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
    const versions = await this.fetchVersionList(
      packageName,
      options?.repository,
    );

    const details: VersionDetail[] = [];
    for (const version of sortVersionsDescending(versions)) {
      let publishedAt: Date | undefined;
      try {
        const info = await this.fetchVersionInfo(
          packageName,
          version,
          options?.repository,
        );
        publishedAt = new Date(info.Time);
      } catch {
        // Ignore errors fetching version info
      }

      details.push({
        version,
        publishedAt,
        isPrerelease: isPrerelease(version),
        isDeprecated: false,
      });
    }

    return details;
  }

  getMetadata(
    packageName: string,
    _version?: string,
    _options?: { repository?: string },
  ): Promise<PackageMetadata> {
    // Go proxy doesn't provide metadata - just return basic info
    // Full metadata would require fetching from pkg.go.dev or parsing go.mod
    return Promise.resolve({
      name: packageName,
      registry: "go",
      homepage: `https://pkg.go.dev/${packageName}`,
      repository: packageName.startsWith("github.com")
        ? `https://${packageName}`
        : undefined,
    });
  }
}

export const goClient = new GoClient();
