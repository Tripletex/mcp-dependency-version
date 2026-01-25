/**
 * NPM package.json dependency parser
 */

import type { DependencyParser, ParsedDependency } from "./types.ts";

/**
 * Parse package.json dependencies
 */
function parse(content: string): ParsedDependency[] {
  try {
    const pkg = JSON.parse(content);
    const deps: ParsedDependency[] = [];

    for (const depType of ["dependencies", "devDependencies", "peerDependencies"]) {
      const section = pkg[depType];
      if (section && typeof section === "object") {
        for (const [name, version] of Object.entries(section)) {
          if (typeof version === "string") {
            // Remove semver prefixes (^, ~, >=, etc.)
            const cleanVersion = version.replace(/^[\^~>=<]+/, "");
            deps.push({ name, version: cleanVersion });
          }
        }
      }
    }

    return deps;
  } catch {
    throw new Error("Failed to parse package.json");
  }
}

export const npmParser: DependencyParser = {
  fileType: "package.json",
  registry: "npm",
  parse,
};
