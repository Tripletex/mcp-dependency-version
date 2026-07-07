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
  VersionDependency,
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
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
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

    const resolved = resolveLatestVersions(versions, {
      includePrerelease: options?.includePrerelease,
      // Use npm dist-tag "latest" as fallback when no stable in version list
      // (only when no prefix filter is applied)
      fallbackStable: !options?.versionPrefix
        ? data["dist-tags"].latest
        : undefined,
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

    const versionData = data.versions[resolved.latestStable];
    const publishedAt = data.time[resolved.latestStable];

    const result: VersionInfo = {
      packageName,
      registry: "npm",
      latestStable: resolved.latestStable,
      publishedAt: publishedAt ? new Date(publishedAt) : undefined,
      deprecated: !!versionData?.deprecated,
      deprecationMessage: versionData?.deprecated,
    };

    if (resolved.latestPrerelease) {
      result.latestPrerelease = resolved.latestPrerelease;
    }

    return result;
  }

  /**
   * Resolve an npm dist-tag (channel) such as "latest", "next", or "beta" to
   * the concrete version it currently points to. dist-tags are mutable
   * pointers, so the result is flagged `isMutable`.
   */
  async resolveReference(
    packageName: string,
    reference: string,
    options?: LookupOptions & { repository?: string },
  ): Promise<VersionInfo> {
    const data = await this.fetchPackage(packageName, options?.repository);
    const distTags = data["dist-tags"] ?? {};
    const version = distTags[reference];

    if (!version) {
      const available = Object.keys(distTags).sort().join(", ") || "none";
      throw new Error(
        `Dist-tag '${reference}' not found for '${packageName}'. Available tags: ${available}`,
      );
    }

    const versionData = data.versions[version];
    const publishedAt = data.time?.[version];

    return {
      packageName,
      registry: "npm",
      latestStable: version,
      publishedAt: publishedAt ? new Date(publishedAt) : undefined,
      deprecated: !!versionData?.deprecated,
      deprecationMessage: versionData?.deprecated,
      isMutable: true,
      resolvedReference: reference,
      securityNotes: [
        `npm dist-tags are mutable pointers. '${reference}' currently resolves to ${version} but can be reassigned at any time.`,
        `Pin to the exact version '${version}' instead of the '${reference}' tag for reproducible installs.`,
      ],
    };
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

  async getVersionDependencies(
    packageName: string,
    version: string,
    options?: { repository?: string },
  ): Promise<VersionDependency[] | undefined> {
    const data = await this.fetchPackage(packageName, options?.repository);
    const versionData = data.versions[version];
    if (!versionData) {
      return undefined;
    }

    const out: VersionDependency[] = [];
    const groups: Array<[VersionDependency["scope"], Record<string, string>]> =
      [
        ["runtime", versionData.dependencies ?? {}],
        ["peer", versionData.peerDependencies ?? {}],
        ["optional", versionData.optionalDependencies ?? {}],
      ];
    for (const [scope, deps] of groups) {
      for (const [name, constraint] of Object.entries(deps)) {
        out.push({ name, registry: "npm", constraint, scope });
      }
    }
    return out;
  }
}

export const npmClient = new NpmClient();
