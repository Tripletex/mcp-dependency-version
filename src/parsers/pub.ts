/**
 * pubspec.yaml dependency parser for Dart/Flutter projects
 * Uses regex-based YAML parsing (no external YAML library needed)
 */

import type { DependencyParser, ParsedDependency } from "./types.ts";

/**
 * Parse pubspec.yaml dependencies
 * Handles formats:
 *   dependencies:
 *     http: ^0.13.0
 *     provider: ">=4.0.0 <7.0.0"
 *     some_package: 1.0.0
 *
 * Skips:
 *   - SDK dependencies (sdk: flutter)
 *   - Path dependencies (path: ../foo)
 *   - Git dependencies (git: ...)
 *   - Hosted dependencies with complex config
 */
function parse(content: string): ParsedDependency[] {
  const deps: ParsedDependency[] = [];
  const lines = content.split("\n");

  let inDepsSection = false;
  let sectionIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimEnd();

    // Skip comments and empty lines
    if (!trimmed || trimmed.trim().startsWith("#")) {
      continue;
    }

    // Check for section headers (no leading whitespace)
    const sectionMatch = trimmed.match(/^(\w[\w_]*):\s*$/);
    if (sectionMatch) {
      const sectionName = sectionMatch[1];
      inDepsSection = sectionName === "dependencies" ||
        sectionName === "dev_dependencies";
      sectionIndent = -1;
      continue;
    }

    if (!inDepsSection) continue;

    // Get the indentation level
    const indent = line.length - line.trimStart().length;

    // Detect the base indent level of package entries
    if (sectionIndent === -1 && indent > 0) {
      sectionIndent = indent;
    }

    // If we've returned to a lower indentation, we've left the section
    if (indent === 0) {
      inDepsSection = false;
      continue;
    }

    // Only process lines at the section's base indent level
    if (indent !== sectionIndent) continue;

    // Match: "  package_name: ^version" or "  package_name: version"
    const depMatch = trimmed.trim().match(
      /^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*['"]?([^^~>=<!\s][^'"]*?)['"]?\s*$/,
    );
    if (depMatch) {
      const name = depMatch[1];
      const versionStr = depMatch[2].trim();

      // Skip non-version values
      if (
        versionStr === "any" || versionStr.startsWith("path:") ||
        versionStr.startsWith("git:") || versionStr.startsWith("sdk:")
      ) {
        continue;
      }

      // Check if it's a plain version number
      if (/^\d/.test(versionStr)) {
        deps.push({ name, version: versionStr });
        continue;
      }
    }

    // Match: "  package_name: ^version" with constraint prefix
    const constraintMatch = trimmed.trim().match(
      /^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*['"]?[\^~>=<]+\s*(\d[^'"]*?)['"]?\s*$/,
    );
    if (constraintMatch) {
      const name = constraintMatch[1];
      const version = constraintMatch[2].trim();
      deps.push({ name, version });
      continue;
    }

    // Match: "  package_name:" (might be a complex dependency on next lines - skip)
    const complexMatch = trimmed.trim().match(
      /^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*$/,
    );
    if (complexMatch) {
      // This is a complex dependency (git, path, hosted) - skip
      continue;
    }
  }

  return deps;
}

export const pubParser: DependencyParser = {
  fileType: "pubspec.yaml",
  registry: "pub",
  parse,
};
