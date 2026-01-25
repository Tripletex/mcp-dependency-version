/**
 * Go go.mod dependency parser
 */

import type { DependencyParser, ParsedDependency } from "./types.ts";

/**
 * Parse go.mod dependencies
 */
function parse(content: string): ParsedDependency[] {
  const deps: ParsedDependency[] = [];
  const lines = content.split("\n");

  let inRequireBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Single line require
    const singleMatch = trimmed.match(/^require\s+(\S+)\s+(v[^\s]+)/);
    if (singleMatch) {
      deps.push({ name: singleMatch[1], version: singleMatch[2] });
      continue;
    }

    // Block require start
    if (trimmed === "require (") {
      inRequireBlock = true;
      continue;
    }

    // Block require end
    if (trimmed === ")" && inRequireBlock) {
      inRequireBlock = false;
      continue;
    }

    // Inside require block
    if (inRequireBlock) {
      const blockMatch = trimmed.match(/^(\S+)\s+(v[^\s]+)/);
      if (blockMatch) {
        deps.push({ name: blockMatch[1], version: blockMatch[2] });
      }
    }
  }

  return deps;
}

export const goParser: DependencyParser = {
  fileType: "go.mod",
  registry: "go",
  parse,
};
