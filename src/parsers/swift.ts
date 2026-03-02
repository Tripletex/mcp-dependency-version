/**
 * Package.swift dependency parser for Swift Package Manager
 * Parses .package(url:..., from:...) patterns
 */

import type { DependencyParser, ParsedDependency } from "./types.ts";

/**
 * Parse Package.swift dependencies
 * Handles patterns:
 *   .package(url: "https://github.com/owner/repo", from: "1.0.0")
 *   .package(url: "https://github.com/owner/repo.git", from: "1.0.0")
 *   .package(url: "https://github.com/owner/repo", exact: "1.0.0")
 *   .package(url: "https://github.com/owner/repo", .upToNextMajor(from: "1.0.0"))
 *   .package(url: "https://github.com/owner/repo", .upToNextMinor(from: "1.0.0"))
 */
function parse(content: string): ParsedDependency[] {
  const deps: ParsedDependency[] = [];

  // Match .package(url: "...", ...) patterns
  const packagePattern =
    /\.package\s*\(\s*url\s*:\s*"([^"]+)"\s*,\s*([^)]+)\)/g;

  let match;
  while ((match = packagePattern.exec(content)) !== null) {
    const url = match[1];
    const versionPart = match[2].trim();

    // Extract owner/repo from GitHub URL
    const ownerRepo = extractOwnerRepo(url);
    if (!ownerRepo) continue;

    // Extract version from various patterns
    const version = extractVersion(versionPart);
    if (!version) continue;

    deps.push({ name: ownerRepo, version });
  }

  return deps;
}

/**
 * Extract owner/repo from a GitHub URL
 */
function extractOwnerRepo(url: string): string | null {
  // Match github.com/owner/repo or github.com/owner/repo.git
  const match = url.match(
    /github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?$/i,
  );
  if (match) {
    return `${match[1]}/${match[2]}`;
  }
  return null;
}

/**
 * Extract version string from various SPM version specification patterns
 */
function extractVersion(versionPart: string): string | null {
  // from: "1.0.0"
  const fromMatch = versionPart.match(/from\s*:\s*"([^"]+)"/);
  if (fromMatch) return fromMatch[1];

  // exact: "1.0.0"
  const exactMatch = versionPart.match(/exact\s*:\s*"([^"]+)"/);
  if (exactMatch) return exactMatch[1];

  // "1.0.0"..<"2.0.0" (range) - take the lower bound
  const rangeMatch = versionPart.match(/"(\d[^"]+)"\s*\.\.\s*[<.]?\s*"/);
  if (rangeMatch) return rangeMatch[1];

  // Standalone version string: "1.0.0"
  const standaloneMatch = versionPart.match(/^"(\d[^"]+)"$/);
  if (standaloneMatch) return standaloneMatch[1];

  return null;
}

export const swiftParser: DependencyParser = {
  fileType: "Package.swift",
  registry: "swift",
  parse,
};
