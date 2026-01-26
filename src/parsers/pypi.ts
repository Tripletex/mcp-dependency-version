/**
 * PyPI requirements.txt dependency parser
 */

import type { DependencyParser, ParsedDependency } from "./types.ts";

/**
 * Parse requirements.txt dependencies
 */
function parse(content: string): ParsedDependency[] {
  const deps: ParsedDependency[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) {
      continue;
    }

    // Match: package==version, package>=version, package~=version, etc.
    const match = trimmed.match(
      /^([a-zA-Z0-9_-]+)\s*[=~><]+\s*([0-9][^\s,;#]*)/,
    );
    if (match) {
      deps.push({ name: match[1], version: match[2] });
    }
  }

  return deps;
}

export const pypiParser: DependencyParser = {
  fileType: "requirements.txt",
  registry: "pypi",
  parse,
};
