/**
 * Cargo.toml dependency parser for Rust projects
 */

import type { DependencyParser, ParsedDependency } from "./types.ts";

/**
 * Parse Cargo.toml dependencies
 */
function parse(content: string): ParsedDependency[] {
  const deps: ParsedDependency[] = [];

  // Simple TOML parsing for dependencies section
  const depsMatch = content.match(/\[dependencies\]([\s\S]*?)(?=\[|$)/);
  if (depsMatch) {
    const depsSection = depsMatch[1];
    const lines = depsSection.split("\n");

    for (const line of lines) {
      // Match: name = "version" or name = { version = "..." }
      const simpleMatch = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/);
      if (simpleMatch) {
        deps.push({ name: simpleMatch[1], version: simpleMatch[2] });
        continue;
      }

      const complexMatch = line.match(
        /^([a-zA-Z0-9_-]+)\s*=\s*\{.*version\s*=\s*"([^"]+)"/
      );
      if (complexMatch) {
        deps.push({ name: complexMatch[1], version: complexMatch[2] });
      }
    }
  }

  return deps;
}

export const cargoParser: DependencyParser = {
  fileType: "Cargo.toml",
  registry: "cargo",
  parse,
};
