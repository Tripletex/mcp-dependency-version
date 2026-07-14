/**
 * Swift Package Manager Registry Client
 * Uses the GitHub API for version lookups since SPM packages are GitHub repositories
 * Package format: owner/repo (e.g., apple/swift-nio, Alamofire/Alamofire)
 */

import type {
  DigestResolution,
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
import { isCommitShaLike, matchTagsByCommitSha } from "../utils/action-tags.ts";
import {
  type ResolvedGitHubRepository,
  resolveGitHubRepository,
} from "../config/github.ts";

interface GitHubTag {
  name: string;
  commit: {
    sha: string;
  };
}

interface GitHubRelease {
  tag_name: string;
  published_at: string;
  prerelease: boolean;
  draft: boolean;
}

interface GitHubRepo {
  name: string;
  full_name: string;
  description?: string;
  homepage?: string;
  html_url: string;
  license?: {
    spdx_id?: string;
    name?: string;
  };
}

/**
 * Check if a tag name looks like a semver version
 * Matches patterns: 1.0.0, v1.0.0, 1.0, v1.0, etc.
 */
function isSemverTag(tag: string): boolean {
  return /^v?\d+\.\d+(\.\d+)?(-[\w.]+)?(\+[\w.]+)?$/.test(tag);
}

/**
 * Strip the "v" prefix from a tag for version comparison
 */
function stripVPrefix(tag: string): string {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

/**
 * Format a commit-pinned Package.swift dependency line.
 * e.g., .package(url: "https://github.com/apple/swift-nio.git", revision: "<sha>")
 */
function formatRevisionReference(
  packageName: string,
  commitSha: string,
): string {
  return `.package(url: "https://github.com/${packageName}.git", revision: "${commitSha}")`;
}

export class SwiftClient implements RegistryClient {
  readonly registry = "swift" as const satisfies Registry;

  private resolveRepo(
    packageName: string,
    repositoryName?: string,
  ): ResolvedGitHubRepository {
    return resolveGitHubRepository("swift", packageName, repositoryName);
  }

  private async fetchTags(
    packageName: string,
    repositoryName?: string,
  ): Promise<GitHubTag[]> {
    const repo = this.resolveRepo(packageName, repositoryName);
    const cacheKey = `swift:${repo.apiUrl}:${repo.key}:${packageName}:tags`;
    const cached = versionCache.get(cacheKey);
    if (cached) {
      return cached as GitHubTag[];
    }

    const url = `${repo.apiUrl}/repos/${packageName}/tags?per_page=100`;
    const response = await fetchWithHeaders(url, { auth: repo.auth });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(
          `Repository '${packageName}' not found on GitHub`,
        );
      }
      throw new Error(
        `GitHub API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as GitHubTag[];
    versionCache.set(cacheKey, data);
    return data;
  }

  private async fetchReleases(
    packageName: string,
    repositoryName?: string,
  ): Promise<GitHubRelease[]> {
    const repo = this.resolveRepo(packageName, repositoryName);
    const cacheKey = `swift:${repo.apiUrl}:${repo.key}:${packageName}:releases`;
    const cached = versionCache.get(cacheKey);
    if (cached) {
      return cached as GitHubRelease[];
    }

    const url = `${repo.apiUrl}/repos/${packageName}/releases?per_page=100`;
    const response = await fetchWithHeaders(url, { auth: repo.auth });

    if (!response.ok) {
      // Releases endpoint might fail for repos without releases, that's OK
      return [];
    }

    const data = (await response.json()) as GitHubRelease[];
    versionCache.set(cacheKey, data);
    return data;
  }

  private async fetchRepo(
    packageName: string,
    repositoryName?: string,
  ): Promise<GitHubRepo> {
    const repo = this.resolveRepo(packageName, repositoryName);
    const cacheKey = `swift:${repo.apiUrl}:${repo.key}:${packageName}:repo`;
    const cached = versionCache.get(cacheKey);
    if (cached) {
      return cached as GitHubRepo;
    }

    const url = `${repo.apiUrl}/repos/${packageName}`;
    const response = await fetchWithHeaders(url, { auth: repo.auth });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(
          `Repository '${packageName}' not found on GitHub`,
        );
      }
      throw new Error(
        `GitHub API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as GitHubRepo;
    versionCache.set(cacheKey, data);
    return data;
  }

  async lookupVersion(
    packageName: string,
    options?: LookupOptions & { repository?: string },
  ): Promise<VersionInfo> {
    const tags = await this.fetchTags(packageName, options?.repository);
    const releases = await this.fetchReleases(
      packageName,
      options?.repository,
    );

    // Filter to semver tags only and strip v prefix for comparison
    const semverTags = tags.filter((t) => isSemverTag(t.name));
    let versionStrings = semverTags.map((t) => stripVPrefix(t.name));

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

    // Find the tag with matching version to get its commit SHA
    const matchingTag = semverTags.find(
      (t) => stripVPrefix(t.name) === resolved.latestStable,
    );
    const commitSha = matchingTag?.commit.sha;

    // Find release data for publish date
    const release = releases.find(
      (r) => stripVPrefix(r.tag_name) === resolved.latestStable,
    );

    const result: VersionInfo = {
      packageName,
      registry: "swift",
      latestStable: resolved.latestStable,
      publishedAt: release?.published_at
        ? new Date(release.published_at)
        : undefined,
      digest: commitSha,
      secureReference: commitSha
        ? formatRevisionReference(packageName, commitSha)
        : undefined,
      securityNotes: [
        "Swift Package Manager version tags are git tags, which are mutable and can be moved to a different commit.",
        commitSha
          ? "The commit SHA for this version is returned in the 'digest' field."
          : "Could not resolve a commit SHA for this version.",
        "Commit 'Package.resolved' to lock the resolved revision for reproducible builds.",
      ],
    };

    if (resolved.latestPrerelease) {
      result.latestPrerelease = resolved.latestPrerelease;
    }

    return result;
  }

  /**
   * Resolve a git reference (branch, tag, or short SHA) to its current commit
   * SHA for a Swift Package Manager dependency. SPM supports `.branch(...)` and
   * `.revision(...)` dependencies, and records the resolved revision in
   * `Package.resolved`.
   */
  async resolveReference(
    packageName: string,
    reference: string,
    options?: LookupOptions & { repository?: string },
  ): Promise<VersionInfo> {
    const repo = this.resolveRepo(packageName, options?.repository);
    const cacheKey =
      `swift:${repo.apiUrl}:${repo.key}:${packageName}:commit:${reference}`;
    let commitSha = versionCache.get(cacheKey) as string | undefined;

    if (!commitSha) {
      const url = `${repo.apiUrl}/repos/${packageName}/commits/${
        encodeURIComponent(reference)
      }`;
      const response = await fetchWithHeaders(url, {
        auth: repo.auth,
        headers: { "Accept": "application/vnd.github.sha" },
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(
            `Reference '${reference}' not found for Swift package '${packageName}'`,
          );
        }
        throw new Error(
          `GitHub API error: ${response.status} ${response.statusText}`,
        );
      }

      commitSha = (await response.text()).trim();
      versionCache.set(cacheKey, commitSha);
    }

    const refKind = isSemverTag(reference) ? "tag" : "branch";

    return {
      packageName,
      registry: "swift",
      // A branch has no version; echo the reference in the version slot.
      latestStable: reference,
      digest: commitSha,
      secureReference: formatRevisionReference(packageName, commitSha),
      isMutable: true,
      resolvedReference: reference,
      securityNotes: [
        `A Swift Package Manager dependency on ${refKind} '${reference}' is mutable; its resolved commit SHA is returned in the 'digest' field.`,
        "Commit 'Package.resolved' to lock the resolved revision for reproducible builds.",
        `For a hard pin in Package.swift, use .revision("${commitSha}").`,
        refKind === "branch"
          ? `Updating means re-resolving branch '${reference}' to its latest commit, not moving to a release.`
          : `Tag '${reference}' can be moved to a different commit; re-resolve it to detect changes.`,
      ],
    };
  }

  /**
   * Reverse-resolve a revision pin (full or >= 7-char commit SHA prefix)
   * to the version tag(s) pointing at that commit. This makes a
   * `.revision("...")` pin in Package.swift self-describing.
   */
  async resolveDigest(
    packageName: string,
    digest: string,
    options?: { repository?: string },
  ): Promise<DigestResolution> {
    if (!isCommitShaLike(digest)) {
      throw new Error(
        `'${digest}' is not a commit SHA. Provide the full 40-character ` +
          "SHA or a prefix of at least 7 characters.",
      );
    }

    const tags = await this.fetchTags(packageName, options?.repository);

    const matches = matchTagsByCommitSha(tags, digest).map((tag) => ({
      reference: tag.name,
      version: isSemverTag(tag.name) ? stripVPrefix(tag.name) : undefined,
    }));

    const versions = sortVersionsDescending(
      matches.flatMap((m) => (m.version ? [m.version] : [])),
    );

    return {
      packageName,
      registry: "swift",
      digest,
      matches,
      pinnedVersion: versions[0],
      notes: matches.length === 0
        ? [
          `No tag among the repository's ${tags.length} most recent tags ` +
          `points at commit '${digest}'. The pin may reference an untagged ` +
          "commit (e.g. from a branch) or a tag older than the fetched page.",
        ]
        : undefined,
    };
  }

  async listVersions(
    packageName: string,
    options?: { repository?: string },
  ): Promise<VersionDetail[]> {
    const tags = await this.fetchTags(packageName, options?.repository);
    const releases = await this.fetchReleases(
      packageName,
      options?.repository,
    );

    // Filter to semver tags only
    const semverTags = tags.filter((t) => isSemverTag(t.name));
    const versionStrings = semverTags.map((t) => stripVPrefix(t.name));

    return sortVersionsDescending(versionStrings).map((version) => {
      const release = releases.find(
        (r) => stripVPrefix(r.tag_name) === version,
      );
      return {
        version,
        publishedAt: release?.published_at
          ? new Date(release.published_at)
          : undefined,
        isPrerelease: release?.prerelease ?? isPrerelease(version),
        isDeprecated: false,
      };
    });
  }

  async getMetadata(
    packageName: string,
    _version?: string,
    options?: { repository?: string },
  ): Promise<PackageMetadata> {
    const repo = await this.fetchRepo(packageName, options?.repository);

    return {
      name: packageName,
      registry: "swift",
      description: repo.description,
      license: repo.license?.spdx_id || repo.license?.name,
      homepage: repo.homepage || repo.html_url,
      repository: repo.html_url,
    };
  }
}

export const swiftClient = new SwiftClient();
