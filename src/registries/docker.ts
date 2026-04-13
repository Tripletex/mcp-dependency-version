/**
 * Docker Registry Client
 * Uses Docker Hub API at hub.docker.com
 * Supports both official images (nginx) and user images (user/repo)
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
  parseVersion,
  resolveLatestVersions,
  sortVersionsDescending,
} from "../utils/version.ts";
import { versionCache } from "../utils/cache.ts";
import { fetchWithHeaders } from "../utils/http.ts";
import { getRepositoryConfig } from "../config/loader.ts";

interface DockerHubTagResult {
  name: string;
  full_size?: number;
  last_updated?: string;
  tag_status?: string;
  digest?: string;
}

interface DockerHubTagsResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: DockerHubTagResult[];
}

interface DockerHubRepoResponse {
  user: string;
  name: string;
  namespace: string;
  repository_type?: string;
  status?: number;
  description?: string;
  is_private?: boolean;
  star_count?: number;
  pull_count?: number;
  last_updated?: string;
  full_description?: string;
}

interface ParsedImageName {
  namespace: string;
  repository: string;
  fullName: string;
}

/**
 * Generate security notes for Docker images
 * Explains that Docker tags are NOT immutable and recommends digest-pinned references
 */
function generateDockerSecurityNotes(): string[] {
  return [
    "WARNING: Docker tags are NOT immutable. A tag can be moved to point to a different image at any time.",
    "Using the digest-pinned reference (image@sha256:...) provides protection against tag tampering.",
    "Digest-pinned references ensure you always pull the exact same image, preventing supply chain attacks.",
    "When updating, explicitly change the digest and verify the new image before deployment.",
  ];
}

export class DockerClient implements RegistryClient {
  readonly registry = "docker" as const satisfies Registry;

  /**
   * Parse Docker image name into namespace and repository
   * - "nginx" -> { namespace: "library", repository: "nginx" }
   * - "user/repo" -> { namespace: "user", repository: "repo" }
   * - "registry.com/user/repo" -> treated as "user/repo" for Docker Hub
   */
  private parseImageName(imageName: string): ParsedImageName {
    // Remove any tag or digest suffix
    const cleanName = imageName.split(":")[0].split("@")[0];

    // Handle registry prefixes by stripping them for Docker Hub
    // (custom registries would need different handling)
    const parts = cleanName.split("/");

    if (parts.length === 1) {
      // Official image: "nginx" -> "library/nginx"
      return {
        namespace: "library",
        repository: parts[0],
        fullName: `library/${parts[0]}`,
      };
    } else if (parts.length === 2) {
      // User image: "user/repo"
      return {
        namespace: parts[0],
        repository: parts[1],
        fullName: cleanName,
      };
    } else {
      // Possibly includes registry: "registry.com/user/repo" or "registry.com/org/user/repo"
      // For Docker Hub, use the last two parts
      const namespace = parts[parts.length - 2];
      const repository = parts[parts.length - 1];
      return {
        namespace,
        repository,
        fullName: `${namespace}/${repository}`,
      };
    }
  }

  /**
   * Check if a tag looks like a semantic version
   */
  private isSemverLike(tag: string): boolean {
    // Common version patterns: 1.0.0, v1.0.0, 1.0, 1
    // Also handles variants like 1.0.0-alpine, 1.0.0-slim
    const parsed = parseVersion(tag);
    if (parsed) return true;

    // Check for version-variant patterns like "1.0-alpine"
    const versionPart = tag.split("-")[0];
    return parseVersion(versionPart) !== null ||
      /^\d+(\.\d+)*$/.test(versionPart);
  }

  /**
   * Extract base version from a tag (removes variant suffixes)
   * "1.0.0-alpine" -> "1.0.0"
   * "latest" -> "latest"
   */
  private getBaseVersion(tag: string): string {
    // Common variant suffixes in Docker
    const variants = [
      "-alpine",
      "-slim",
      "-bullseye",
      "-bookworm",
      "-buster",
      "-stretch",
      "-jammy",
      "-focal",
      "-noble",
    ];

    for (const variant of variants) {
      if (tag.includes(variant)) {
        return tag.split(variant)[0];
      }
    }

    return tag;
  }

  private async fetchTags(
    imageName: string,
    repositoryName?: string,
    limit = 100,
  ): Promise<{ tags: DockerHubTagResult[]; total: number }> {
    const repoConfig = getRepositoryConfig("docker", repositoryName);
    const parsed = this.parseImageName(imageName);
    const cacheKey = `docker:${repoConfig.url}:${parsed.fullName}:tags`;

    const cached = versionCache.get(cacheKey);
    if (cached) {
      return cached as { tags: DockerHubTagResult[]; total: number };
    }

    // Docker Hub API for tags
    const url =
      `${repoConfig.url}/v2/repositories/${parsed.fullName}/tags?page_size=${
        Math.min(limit, 100)
      }`;
    const response = await fetchWithHeaders(url, { auth: repoConfig.auth });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Image '${imageName}' not found on ${repoConfig.name}`);
      }
      throw new Error(
        `${repoConfig.name} error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as DockerHubTagsResponse;
    const result = { tags: data.results, total: data.count };
    versionCache.set(cacheKey, result);
    return result;
  }

  private async fetchRepoInfo(
    imageName: string,
    repositoryName?: string,
  ): Promise<DockerHubRepoResponse> {
    const repoConfig = getRepositoryConfig("docker", repositoryName);
    const parsed = this.parseImageName(imageName);
    const cacheKey = `docker:${repoConfig.url}:${parsed.fullName}:info`;

    const cached = versionCache.get(cacheKey);
    if (cached) {
      return cached as DockerHubRepoResponse;
    }

    const url = `${repoConfig.url}/v2/repositories/${parsed.fullName}`;
    const response = await fetchWithHeaders(url, { auth: repoConfig.auth });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Image '${imageName}' not found on ${repoConfig.name}`);
      }
      throw new Error(
        `${repoConfig.name} error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as DockerHubRepoResponse;
    versionCache.set(cacheKey, data);
    return data;
  }

  async lookupVersion(
    imageName: string,
    options?: LookupOptions & { repository?: string },
  ): Promise<VersionInfo> {
    const { tags } = await this.fetchTags(imageName, options?.repository, 100);

    // Extract tag names
    let tagNames = tags.map((t) => t.name);

    // Apply version prefix filter if specified
    if (options?.versionPrefix) {
      tagNames = filterByPrefix(tagNames, options.versionPrefix);
    }

    // Separate semver-like tags from arbitrary tags
    const semverTags = tagNames.filter((t) => this.isSemverLike(t));
    const baseVersionTags = semverTags.map((t) => this.getBaseVersion(t));

    // Find latest stable version from semver tags
    // Compute Docker-specific fallback: "latest" tag, or most recently updated
    let dockerFallback: string | undefined;
    if (!options?.versionPrefix) {
      if (tagNames.includes("latest")) {
        dockerFallback = "latest";
      } else if (tagNames.length > 0) {
        const sortedTags = [...tags].sort((a, b) => {
          const dateA = a.last_updated ? new Date(a.last_updated).getTime() : 0;
          const dateB = b.last_updated ? new Date(b.last_updated).getTime() : 0;
          return dateB - dateA;
        });
        dockerFallback = sortedTags[0].name;
      }
    }

    const resolved = resolveLatestVersions(baseVersionTags, {
      includePrerelease: options?.includePrerelease,
      fallbackStable: dockerFallback,
    });

    if (!resolved) {
      throw new Error(
        `No version found for '${imageName}'${
          options?.versionPrefix
            ? ` with prefix '${options.versionPrefix}'`
            : ""
        }`,
      );
    }
    const latestStable = resolved.latestStable;

    // Find the tag data for the latest stable
    const latestTagData = tags.find(
      (t) =>
        t.name === latestStable || this.getBaseVersion(t.name) === latestStable,
    );

    // Get digest for secure reference
    const digest = latestTagData?.digest;
    const parsed = this.parseImageName(imageName);
    const displayName = parsed.namespace === "library"
      ? parsed.repository
      : `${parsed.namespace}/${parsed.repository}`;

    const result: VersionInfo = {
      packageName: imageName,
      registry: "docker",
      latestStable,
      publishedAt: latestTagData?.last_updated
        ? new Date(latestTagData.last_updated)
        : undefined,
      deprecated: latestTagData?.tag_status === "stale",
      digest,
      secureReference: digest ? `${displayName}@${digest}` : undefined,
      securityNotes: generateDockerSecurityNotes(),
    };

    // Use the resolved prerelease (only valid when latestStable is a real version)
    if (resolved.latestPrerelease && latestStable !== "latest") {
      result.latestPrerelease = resolved.latestPrerelease;
    }

    return result;
  }

  async listVersions(
    imageName: string,
    options?: { repository?: string },
  ): Promise<VersionDetail[]> {
    const { tags } = await this.fetchTags(imageName, options?.repository, 100);

    // Sort by semver where possible, then by date
    const semverTags = tags.filter((t) => this.isSemverLike(t.name));
    const nonSemverTags = tags.filter((t) => !this.isSemverLike(t.name));

    // Sort semver tags by version
    const sortedSemver = sortVersionsDescending(
      semverTags.map((t) => t.name),
    ).map((name) => tags.find((t) => t.name === name)!);

    // Sort non-semver tags by date
    const sortedNonSemver = [...nonSemverTags].sort((a, b) => {
      const dateA = a.last_updated ? new Date(a.last_updated).getTime() : 0;
      const dateB = b.last_updated ? new Date(b.last_updated).getTime() : 0;
      return dateB - dateA;
    });

    // Combine: semver first, then non-semver
    const sortedTags = [...sortedSemver, ...sortedNonSemver];

    return sortedTags.map((tag) => ({
      version: tag.name,
      publishedAt: tag.last_updated ? new Date(tag.last_updated) : undefined,
      isPrerelease: isPrerelease(tag.name),
      isDeprecated: tag.tag_status === "stale",
      digest: tag.digest,
    }));
  }

  async getMetadata(
    imageName: string,
    _version?: string,
    options?: { repository?: string },
  ): Promise<PackageMetadata> {
    const repoInfo = await this.fetchRepoInfo(imageName, options?.repository);
    const parsed = this.parseImageName(imageName);

    return {
      name: imageName,
      registry: "docker",
      description: repoInfo.description || undefined,
      homepage: `https://hub.docker.com/${
        parsed.namespace === "library" ? "_" : "r"
      }/${parsed.fullName}`,
      repository: undefined, // Docker Hub doesn't expose source repository in API
    };
  }
}

export const dockerClient = new DockerClient();
