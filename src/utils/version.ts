/**
 * Semver parsing and comparison utilities
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
  build: string[];
  original: string;
}

/**
 * Parse a version string into components.
 *
 * Supports two formats:
 * 1. Standard semver: `1.2.3`, `1.2.3-alpha.1`, `1.2.3+build.123`
 * 2. Maven dot-style qualifiers: `1.2.3.RELEASE`, `1.2.3.Final`, `1.2.3.M4`
 *    (the dot-separated tag is treated as a prerelease component)
 */
export function parseVersion(version: string): ParsedVersion | null {
  // Remove leading 'v' if present
  const normalized = version.startsWith("v") ? version.slice(1) : version;

  // Match semver pattern: major.minor.patch[-prerelease][+build]
  const semverMatch = normalized.match(
    /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([a-zA-Z0-9.-]+))?(?:\+([a-zA-Z0-9.-]+))?$/,
  );

  if (semverMatch) {
    const [, major, minor, patch, prerelease, build] = semverMatch;
    return {
      major: parseInt(major, 10),
      minor: minor !== undefined ? parseInt(minor, 10) : 0,
      patch: patch !== undefined ? parseInt(patch, 10) : 0,
      prerelease: prerelease ? prerelease.split(".") : [],
      build: build ? build.split(".") : [],
      original: version,
    };
  }

  // Match Maven dot-style: major.minor.patch.qualifier
  // The qualifier may start with a letter or digit:
  //   - Letter: "1.0.0.RELEASE", "1.0.0.Final", "1.0.0.M4", "2021.0.5.SR3"
  //   - Digit:  "2.9.9.20190807" (timestamp), "7.6.0.202603022253-r" (OSGi)
  const mavenMatch = normalized.match(
    /^(\d+)(?:\.(\d+))?(?:\.(\d+))?\.([a-zA-Z0-9][a-zA-Z0-9.-]*)$/,
  );

  if (mavenMatch) {
    const [, major, minor, patch, qualifier] = mavenMatch;
    return {
      major: parseInt(major, 10),
      minor: minor !== undefined ? parseInt(minor, 10) : 0,
      patch: patch !== undefined ? parseInt(patch, 10) : 0,
      prerelease: qualifier.split("."),
      build: [],
      original: version,
    };
  }

  return null;
}

/**
 * Stable variant tags that look like semver prerelease components
 * but actually denote stable releases of a variant.
 *
 * - `jre`, `jre7`, `jre8`, `android`, `android7`: Guava and PostgreSQL JDBC
 *   Java-version variants (e.g., `33.0.0-jre`, `9.4.1212.jre7`)
 * - `incubating`: Apache projects' stable releases under the Incubator
 * - `final`, `release`, `ga`: Maven/Spring/JBoss "final release" markers
 *   (e.g., `5.6.15.Final`, `1.5.22.RELEASE`, `6.0.0.GA`)
 * - `sr\d+`: Spring Cloud "Service Release" updates (e.g., `2021.0.5.SR3`)
 * - `\d{6,}-r`: OSGi/Eclipse "release" qualifier with timestamp
 *   (e.g., jgit's `7.6.0.202603022253-r`)
 */
const STABLE_VARIANT_PATTERN =
  /^(?:sr\d+|jre\d*|android\d*|incubating|final|release|ga|\d{6,}-r)$/i;

/**
 * Check if a tag (e.g., the prerelease component of a semver string) is
 * actually a stable variant marker, not a true prerelease.
 */
function isStableVariantTag(tag: string): boolean {
  return STABLE_VARIANT_PATTERN.test(tag);
}

/**
 * Check if a version string represents a prerelease.
 *
 * Recognizes:
 * - Standard semver prerelease suffixes (`-alpha`, `-beta`, `-rc`, etc.)
 * - Spring milestones (`-M4`, `.M4`)
 * - Snapshots (`-SNAPSHOT`)
 * - PEP 440 styles (`1.0a1`, `1.0.dev1`)
 * - Other dot/dash-separated alphabetic suffixes
 *
 * Does NOT classify these as prerelease:
 * - Plain numeric semver (`1.2.3`)
 * - Stable variant tags: `-jre`, `-android`, `-incubating`,
 *   `.RELEASE`, `.Final`, `.GA`, `.SR3`
 */
export function isPrerelease(version: string): boolean {
  const parsed = parseVersion(version);

  if (parsed) {
    if (parsed.prerelease.length === 0) return false;
    // Has a prerelease component — check if it's actually a stable variant
    return !isStableVariantTag(parsed.prerelease[0]);
  }

  // Non-standard format — find the first alphabetic tag in the version string
  const v = version.startsWith("v") ? version.slice(1) : version;
  const tagMatch = v.match(/[a-zA-Z]+\d*/);
  if (!tagMatch) return false;

  return !isStableVariantTag(tagMatch[0]);
}

/**
 * Compare two prerelease arrays
 */
function comparePrereleaseArrays(a: string[], b: string[]): number {
  // No prerelease > has prerelease (1.0.0 > 1.0.0-alpha)
  if (a.length === 0 && b.length > 0) return 1;
  if (a.length > 0 && b.length === 0) return -1;
  if (a.length === 0 && b.length === 0) return 0;

  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i++) {
    const partA = a[i];
    const partB = b[i];

    // Missing part is less
    if (partA === undefined) return -1;
    if (partB === undefined) return 1;

    const numA = parseInt(partA, 10);
    const numB = parseInt(partB, 10);

    // Both numeric - compare numerically
    if (!isNaN(numA) && !isNaN(numB)) {
      if (numA !== numB) return numA - numB;
      continue;
    }

    // Numeric < string
    if (!isNaN(numA)) return -1;
    if (!isNaN(numB)) return 1;

    // Both strings - compare lexically
    if (partA !== partB) return partA.localeCompare(partB);
  }

  return 0;
}

/**
 * Compare two version strings
 * Returns: positive if a > b, negative if a < b, 0 if equal
 */
export function compareVersions(a: string, b: string): number {
  const parsedA = parseVersion(a);
  const parsedB = parseVersion(b);

  // When one parses and the other doesn't, prefer the parseable one.
  // Non-parseable versions are typically legacy formats (e.g., Guava's `r09`
  // or `r07`) that should not be considered "newer" than modern semver.
  if (parsedA && !parsedB) return 1;
  if (!parsedA && parsedB) return -1;

  // Both fail to parse — fall back to lexical comparison
  if (!parsedA || !parsedB) {
    return a.localeCompare(b);
  }

  // Compare major.minor.patch
  if (parsedA.major !== parsedB.major) {
    return parsedA.major - parsedB.major;
  }
  if (parsedA.minor !== parsedB.minor) {
    return parsedA.minor - parsedB.minor;
  }
  if (parsedA.patch !== parsedB.patch) {
    return parsedA.patch - parsedB.patch;
  }

  // Compare prerelease
  return comparePrereleaseArrays(parsedA.prerelease, parsedB.prerelease);
}

/**
 * Sort versions in descending order (newest first)
 */
export function sortVersionsDescending(versions: string[]): string[] {
  return [...versions].sort((a, b) => compareVersions(b, a));
}

/**
 * Sort versions in ascending order (oldest first)
 */
export function sortVersionsAscending(versions: string[]): string[] {
  return [...versions].sort(compareVersions);
}

/**
 * Find the latest stable version from a list
 */
export function findLatestStable(versions: string[]): string | null {
  const stable = versions.filter((v) => !isPrerelease(v));
  if (stable.length === 0) return null;
  return sortVersionsDescending(stable)[0];
}

/**
 * Result of resolving "latest" versions from a candidate set.
 */
export interface ResolvedLatest {
  /**
   * The version to advertise as "latest". Stable preferred. When
   * `includePrerelease` is true and no stable exists, this falls back to
   * the latest prerelease.
   */
  latestStable: string;
  /**
   * Latest prerelease version, only set when newer than `latestStable`.
   * (When `latestStable` is itself a prerelease fallback, this is the
   * same value.)
   */
  latestPrerelease?: string;
}

/**
 * Resolve a "latest" version pair from a candidate list, honoring prerelease
 * preferences. Centralizes the logic shared by all registry clients.
 *
 * - When `includePrerelease` is false: returns latest stable only.
 *   Returns null if no stable version exists.
 * - When `includePrerelease` is true: returns latest stable, plus
 *   `latestPrerelease` if a newer prerelease exists.
 *   When no stable version exists, falls back to using the latest prerelease
 *   as `latestStable` (for users intentionally tracking a prerelease line
 *   like `2.0.0-M4` where stable hasn't shipped yet).
 *
 * `fallbackStable` allows registries to supply a registry-specific stable
 * version (e.g., npm dist-tag `latest`) when none can be derived from the
 * version list.
 */
export function resolveLatestVersions(
  versions: string[],
  options?: {
    includePrerelease?: boolean;
    fallbackStable?: string;
  },
): ResolvedLatest | null {
  let latestStable: string | null = findLatestStable(versions);

  // Apply registry-specific stable fallback if available
  if (!latestStable && options?.fallbackStable) {
    latestStable = options.fallbackStable;
  }

  const latestPrerelease = options?.includePrerelease
    ? findLatestPrerelease(versions)
    : null;

  // When prereleases are allowed and no stable exists, advertise the
  // latest prerelease in the `latestStable` slot
  if (!latestStable && latestPrerelease) {
    latestStable = latestPrerelease;
  }

  if (!latestStable) return null;

  const result: ResolvedLatest = { latestStable };

  // Include `latestPrerelease` only when it's newer than `latestStable`
  // (or identical, meaning the prerelease IS the fallback)
  if (latestPrerelease) {
    if (latestPrerelease === latestStable) {
      result.latestPrerelease = latestPrerelease;
    } else if (compareVersions(latestPrerelease, latestStable) > 0) {
      result.latestPrerelease = latestPrerelease;
    }
  }

  return result;
}

/**
 * Find the latest prerelease version from a list
 */
export function findLatestPrerelease(versions: string[]): string | null {
  const prereleases = versions.filter((v) => isPrerelease(v));
  if (prereleases.length === 0) return null;
  return sortVersionsDescending(prereleases)[0];
}

/**
 * Filter versions by prefix
 */
export function filterByPrefix(versions: string[], prefix: string): string[] {
  return versions.filter((v) => {
    const normalized = v.startsWith("v") ? v.slice(1) : v;
    return normalized.startsWith(prefix);
  });
}

/**
 * Determine the update type between two versions
 */
export function getUpdateType(
  currentVersion: string,
  newVersion: string,
): "major" | "minor" | "patch" | "prerelease" | "none" {
  const current = parseVersion(currentVersion);
  const next = parseVersion(newVersion);

  if (!current || !next) {
    return compareVersions(currentVersion, newVersion) > 0 ? "none" : "patch";
  }

  if (compareVersions(currentVersion, newVersion) >= 0) {
    return "none";
  }

  if (next.major > current.major) {
    return "major";
  }
  if (next.minor > current.minor) {
    return "minor";
  }
  if (next.patch > current.patch) {
    return "patch";
  }
  if (next.prerelease.length > 0 || current.prerelease.length > 0) {
    return "prerelease";
  }

  return "none";
}

/**
 * Check if a version satisfies a version range/constraint
 * Supports basic constraints: exact, ^, ~, >=, <=, >, <
 */
export function satisfiesConstraint(
  version: string,
  constraint: string,
): boolean {
  const parsed = parseVersion(version);
  if (!parsed) return false;

  // Handle exact version
  if (!constraint.match(/^[~^<>=]/)) {
    const constraintParsed = parseVersion(constraint);
    if (!constraintParsed) return false;
    return compareVersions(version, constraint) === 0;
  }

  // Handle ^ (compatible with version)
  if (constraint.startsWith("^")) {
    const base = parseVersion(constraint.slice(1));
    if (!base) return false;

    // Must be >= base and < next major (or next minor if major is 0)
    if (compareVersions(version, constraint.slice(1)) < 0) return false;

    if (base.major === 0) {
      // ^0.x.y allows changes to patch only
      return parsed.major === 0 && parsed.minor === base.minor;
    }
    return parsed.major === base.major;
  }

  // Handle ~ (approximately equivalent)
  if (constraint.startsWith("~")) {
    const base = parseVersion(constraint.slice(1));
    if (!base) return false;

    if (compareVersions(version, constraint.slice(1)) < 0) return false;
    return parsed.major === base.major && parsed.minor === base.minor;
  }

  // Handle >= <= > <
  const rangeMatch = constraint.match(/^(>=|<=|>|<)(.+)$/);
  if (rangeMatch) {
    const [, op, baseVersion] = rangeMatch;
    const cmp = compareVersions(version, baseVersion);

    switch (op) {
      case ">=":
        return cmp >= 0;
      case "<=":
        return cmp <= 0;
      case ">":
        return cmp > 0;
      case "<":
        return cmp < 0;
    }
  }

  return false;
}
