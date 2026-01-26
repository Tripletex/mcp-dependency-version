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
 * Parse a semver version string into components
 */
export function parseVersion(version: string): ParsedVersion | null {
  // Remove leading 'v' if present
  const normalized = version.startsWith("v") ? version.slice(1) : version;

  // Match semver pattern: major.minor.patch[-prerelease][+build]
  const match = normalized.match(
    /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([a-zA-Z0-9.-]+))?(?:\+([a-zA-Z0-9.-]+))?$/,
  );

  if (!match) {
    return null;
  }

  const [, major, minor, patch, prerelease, build] = match;

  return {
    major: parseInt(major, 10),
    minor: minor !== undefined ? parseInt(minor, 10) : 0,
    patch: patch !== undefined ? parseInt(patch, 10) : 0,
    prerelease: prerelease ? prerelease.split(".") : [],
    build: build ? build.split(".") : [],
    original: version,
  };
}

/**
 * Check if a version string represents a prerelease
 */
export function isPrerelease(version: string): boolean {
  const parsed = parseVersion(version);
  if (!parsed) {
    // Fall back to heuristic check for non-standard versions
    const lower = version.toLowerCase();
    return (
      lower.includes("alpha") ||
      lower.includes("beta") ||
      lower.includes("rc") ||
      lower.includes("pre") ||
      lower.includes("dev") ||
      lower.includes("snapshot") ||
      lower.includes("canary") ||
      lower.includes("next") ||
      /-[a-zA-Z]/.test(version)
    );
  }
  return parsed.prerelease.length > 0;
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

  // If either fails to parse, fall back to string comparison
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
