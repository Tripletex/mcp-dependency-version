/**
 * Maven Central Registry Client
 * Uses the official Maven Central repository at repo1.maven.org by default
 * Supports custom Maven repositories via configuration
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

/**
 * Parsed maven-metadata.xml content
 */
interface MavenMetadata {
  groupId: string;
  artifactId: string;
  versions: string[];
  latestVersion?: string;
  releaseVersion?: string;
  lastUpdated?: string;
}

/**
 * Parse maven-metadata.xml content
 * The format is simple and predictable, so we use regex instead of a full XML parser
 */
function parseMavenMetadata(xml: string): MavenMetadata {
  const groupIdMatch = xml.match(/<groupId>([^<]+)<\/groupId>/);
  const artifactIdMatch = xml.match(/<artifactId>([^<]+)<\/artifactId>/);
  const latestMatch = xml.match(/<latest>([^<]+)<\/latest>/);
  const releaseMatch = xml.match(/<release>([^<]+)<\/release>/);
  const lastUpdatedMatch = xml.match(/<lastUpdated>([^<]+)<\/lastUpdated>/);

  // Extract all versions
  const versionsMatch = xml.match(/<versions>([\s\S]*?)<\/versions>/);
  const versions: string[] = [];
  if (versionsMatch) {
    const versionRegex = /<version>([^<]+)<\/version>/g;
    let match;
    while ((match = versionRegex.exec(versionsMatch[1])) !== null) {
      versions.push(match[1]);
    }
  }

  return {
    groupId: groupIdMatch?.[1] ?? "",
    artifactId: artifactIdMatch?.[1] ?? "",
    versions,
    latestVersion: latestMatch?.[1],
    releaseVersion: releaseMatch?.[1],
    lastUpdated: lastUpdatedMatch?.[1],
  };
}

export class MavenClient implements RegistryClient {
  readonly registry = "maven" as const satisfies Registry;

  private parsePackageName(
    name: string,
  ): { groupId: string; artifactId: string } {
    const parts = name.split(":");
    if (parts.length !== 2) {
      throw new Error(
        `Invalid Maven package name '${name}'. Expected format: groupId:artifactId`,
      );
    }
    return { groupId: parts[0], artifactId: parts[1] };
  }

  /**
   * Convert groupId to URL path (dots become slashes)
   * e.g., "org.apache.commons" -> "org/apache/commons"
   */
  private groupIdToPath(groupId: string): string {
    return groupId.replace(/\./g, "/");
  }

  private async fetchMetadata(
    groupId: string,
    artifactId: string,
    repositoryName?: string,
  ): Promise<MavenMetadata> {
    const repoConfig = getRepositoryConfig("maven", repositoryName);
    const cacheKey =
      `maven:${repoConfig.url}:metadata:${groupId}:${artifactId}`;
    const cached = versionCache.get(cacheKey);
    if (cached) {
      return cached as MavenMetadata;
    }

    const groupPath = this.groupIdToPath(groupId);
    const url =
      `${repoConfig.url}/${groupPath}/${artifactId}/maven-metadata.xml`;

    const response = await fetchWithHeaders(url, { auth: repoConfig.auth });
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(
          `Package '${groupId}:${artifactId}' not found on ${repoConfig.name}`,
        );
      }
      throw new Error(
        `${repoConfig.name} error: ${response.status} ${response.statusText}`,
      );
    }

    const xml = await response.text();
    const metadata = parseMavenMetadata(xml);

    versionCache.set(cacheKey, metadata);
    return metadata;
  }

  async lookupVersion(
    packageName: string,
    options?: LookupOptions & { repository?: string },
  ): Promise<VersionInfo> {
    const { groupId, artifactId } = this.parsePackageName(packageName);
    const metadata = await this.fetchMetadata(
      groupId,
      artifactId,
      options?.repository,
    );

    if (metadata.versions.length === 0) {
      throw new Error(
        `Package '${packageName}' not found on Maven Central`,
      );
    }

    let versionStrings = metadata.versions;

    // Apply version prefix filter if specified
    if (options?.versionPrefix) {
      versionStrings = filterByPrefix(versionStrings, options.versionPrefix);
      if (versionStrings.length === 0) {
        throw new Error(
          `No versions found for '${packageName}' with prefix '${options.versionPrefix}'`,
        );
      }
    }

    const latestStable = findLatestStable(versionStrings);

    if (!latestStable) {
      throw new Error(
        `No stable version found for '${packageName}'${
          options?.versionPrefix
            ? ` with prefix '${options.versionPrefix}'`
            : ""
        }`,
      );
    }

    const result: VersionInfo = {
      packageName,
      registry: "maven",
      latestStable,
    };

    // Include latest prerelease if requested
    if (options?.includePrerelease) {
      const latestPre = findLatestPrerelease(versionStrings);
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
    const { groupId, artifactId } = this.parsePackageName(packageName);
    const metadata = await this.fetchMetadata(
      groupId,
      artifactId,
      options?.repository,
    );

    return sortVersionsDescending(metadata.versions).map((version) => ({
      version,
      isPrerelease: isPrerelease(version),
      isDeprecated: false,
    }));
  }

  /**
   * Fetch POM file for a specific version and extract SCM URL
   */
  private async fetchScmUrl(
    groupId: string,
    artifactId: string,
    version: string,
    repositoryName?: string,
  ): Promise<string | undefined> {
    const repoConfig = getRepositoryConfig("maven", repositoryName);
    const groupPath = this.groupIdToPath(groupId);
    const pomUrl =
      `${repoConfig.url}/${groupPath}/${artifactId}/${version}/${artifactId}-${version}.pom`;

    try {
      const response = await fetchWithHeaders(pomUrl, {
        auth: repoConfig.auth,
      });
      if (!response.ok) {
        return undefined;
      }

      const pom = await response.text();

      // Extract SCM URL from POM
      // Try <scm><url> first, then <scm><connection>
      const scmUrlMatch = pom.match(
        /<scm>[\s\S]*?<url>([^<]+)<\/url>[\s\S]*?<\/scm>/,
      );
      if (scmUrlMatch) {
        return scmUrlMatch[1].trim();
      }

      const scmConnMatch = pom.match(
        /<scm>[\s\S]*?<connection>([^<]+)<\/connection>[\s\S]*?<\/scm>/,
      );
      if (scmConnMatch) {
        // Convert scm:git:... format to URL
        const conn = scmConnMatch[1].trim();
        const gitMatch = conn.match(/scm:git:(?:git@|https?:\/\/)(.+)/);
        if (gitMatch) {
          let url = gitMatch[1].replace(/\.git$/, "");
          // Convert git@github.com:user/repo to https://github.com/user/repo
          url = url.replace(/^([^:]+):/, "$1/");
          if (!url.startsWith("http")) {
            url = `https://${url}`;
          }
          return url;
        }
      }
    } catch {
      // Ignore errors fetching POM
    }

    return undefined;
  }

  async getMetadata(
    packageName: string,
    version?: string,
    options?: { repository?: string },
  ): Promise<PackageMetadata> {
    const { groupId, artifactId } = this.parsePackageName(packageName);
    const metadata = await this.fetchMetadata(
      groupId,
      artifactId,
      options?.repository,
    );

    // Get version to fetch POM from
    const targetVersion = version || metadata.releaseVersion ||
      metadata.latestVersion;

    // Try to get source repository from POM
    let sourceRepo: string | undefined;
    if (targetVersion) {
      sourceRepo = await this.fetchScmUrl(
        groupId,
        artifactId,
        targetVersion,
        options?.repository,
      );
    }

    return {
      name: packageName,
      registry: "maven",
      repository: sourceRepo,
      // homepage links to Maven Central for browsing
      homepage:
        `https://central.sonatype.com/artifact/${groupId}/${artifactId}`,
    };
  }
}

export const mavenClient = new MavenClient();
