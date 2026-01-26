/**
 * Maven pom.xml dependency parser
 */

import type { DependencyParser, ParsedDependency } from "./types.ts";

/**
 * Parse pom.xml dependencies (basic parsing)
 */
function parse(content: string): ParsedDependency[] {
  const deps: ParsedDependency[] = [];

  // Match dependency blocks - handle various whitespace patterns
  const depRegex =
    /<dependency>[\s\S]*?<groupId>([^<]+)<\/groupId>[\s\S]*?<artifactId>([^<]+)<\/artifactId>[\s\S]*?<version>([^<]+)<\/version>[\s\S]*?<\/dependency>/g;

  let match;
  while ((match = depRegex.exec(content)) !== null) {
    const [, groupId, artifactId, version] = match;
    // Skip property references
    if (!version.includes("${")) {
      deps.push({ name: `${groupId}:${artifactId}`, version });
    }
  }

  return deps;
}

export const mavenParser: DependencyParser = {
  fileType: "pom.xml",
  registry: "maven",
  parse,
};
