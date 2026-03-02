/**
 * composer.json dependency parser for PHP projects
 */

import type { DependencyParser, ParsedDependency } from "./types.ts";

/**
 * Parse composer.json dependencies
 * Extracts from "require" and "require-dev" sections
 * Skips "php" and "ext-*" entries
 */
function parse(content: string): ParsedDependency[] {
  try {
    const composer = JSON.parse(content);
    const deps: ParsedDependency[] = [];

    for (const section of ["require", "require-dev"]) {
      const packages = composer[section];
      if (packages && typeof packages === "object") {
        for (const [name, version] of Object.entries(packages)) {
          if (typeof version !== "string") continue;

          // Skip PHP itself and extensions
          if (name === "php" || name.startsWith("ext-")) continue;

          // Strip version constraint operators (^, ~, >=, <=, >, <, ||, etc.)
          // Handle compound constraints like "^1.0 || ^2.0" - take the first
          const firstConstraint = version.split("||")[0].split("|")[0].trim();
          const cleanVersion = firstConstraint.replace(
            /^(?:\^|~|>=|<=|!=|>|<|=|v)/,
            "",
          ).trim();

          // Skip wildcard versions and stability flags
          if (
            !cleanVersion || cleanVersion === "*" ||
            cleanVersion.includes("*") ||
            cleanVersion.startsWith("dev-") ||
            cleanVersion.endsWith("@dev")
          ) {
            continue;
          }

          // Skip if no actual version number
          if (/^\d/.test(cleanVersion)) {
            deps.push({ name, version: cleanVersion });
          }
        }
      }
    }

    return deps;
  } catch {
    throw new Error("Failed to parse composer.json");
  }
}

export const packagistParser: DependencyParser = {
  fileType: "composer.json",
  registry: "packagist",
  parse,
};
