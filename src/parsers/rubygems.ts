/**
 * Gemfile dependency parser for Ruby projects
 */

import type { DependencyParser, ParsedDependency } from "./types.ts";

/**
 * Parse Gemfile dependencies
 * Handles patterns like:
 *   gem 'name', '~> 1.0'
 *   gem "name", ">= 2.0", "< 3.0"
 *   gem 'name', '1.0.0'
 */
function parse(content: string): ParsedDependency[] {
  const deps: ParsedDependency[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    // Match: gem 'name', 'version' or gem "name", "version"
    const match = trimmed.match(
      /^gem\s+['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/,
    );
    if (match) {
      const name = match[1];
      const versionConstraint = match[2];

      // Strip version constraint operators (~>, >=, <=, >, <, =, !=)
      const cleanVersion = versionConstraint.replace(
        /^(?:~>|>=|<=|!=|>|<|=)\s*/,
        "",
      );

      // Skip if no actual version number remains
      if (/^\d/.test(cleanVersion)) {
        deps.push({ name, version: cleanVersion });
      }
    }
  }

  return deps;
}

export const rubygemsParser: DependencyParser = {
  fileType: "Gemfile",
  registry: "rubygems",
  parse,
};
