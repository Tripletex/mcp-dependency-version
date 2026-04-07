/**
 * GitHub Actions Workflow Parser
 * Parses GitHub Actions workflow YAML files to extract action references
 *
 * Extracts "uses:" directives from workflow files:
 * - actions/checkout@v4
 * - github/codeql-action/init@v3
 * - docker://alpine:3.8 (skipped - Docker references)
 * - ./.github/actions/my-action (skipped - local actions)
 */

import type { DependencyParser, ParsedDependency } from "./types.ts";

/**
 * Parse an action reference string into owner/repo and version
 * Handles subpath actions like: github/codeql-action/init@v3 -> github/codeql-action@v3
 */
function parseActionReference(
  reference: string,
): { name: string; version: string } | null {
  // Skip local actions (./path, ../path)
  if (reference.startsWith(".")) {
    return null;
  }

  // Skip Docker references (docker://...)
  if (reference.startsWith("docker://")) {
    return null;
  }

  // Match: owner/repo@version or owner/repo/subpath@version
  const match = reference.match(
    /^([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)(?:\/[^@]+)?@(.+)$/,
  );
  if (!match) {
    return null;
  }

  const [, name, version] = match;

  // Skip if version is a 40-char commit SHA (already pinned)
  if (/^[a-f0-9]{40}$/i.test(version)) {
    return null;
  }

  // Strip leading "v" prefix for version normalization
  const normalizedVersion = version.startsWith("v")
    ? version.slice(1)
    : version;

  return { name, version: normalizedVersion };
}

export const githubActionsParser: DependencyParser = {
  fileType: "workflow.yml",
  registry: "github-actions",

  parse(content: string): ParsedDependency[] {
    const deps: ParsedDependency[] = [];
    const seen = new Set<string>();

    // Match all "uses:" directives in the workflow file
    // Handles both quoted and unquoted values
    const usesPattern = /^\s*-?\s*uses:\s*["']?([^"'\s#]+)["']?/gm;
    let match: RegExpExecArray | null;

    while ((match = usesPattern.exec(content)) !== null) {
      const reference = match[1];
      const parsed = parseActionReference(reference);

      if (parsed) {
        // Deduplicate by name+version
        const key = `${parsed.name}@${parsed.version}`;
        if (!seen.has(key)) {
          seen.add(key);
          deps.push(parsed);
        }
      }
    }

    return deps;
  },
};
