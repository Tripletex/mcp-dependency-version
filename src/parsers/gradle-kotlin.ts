/**
 * Gradle Kotlin DSL (build.gradle.kts) dependency parser
 */

import type { DependencyParser, ParsedDependency } from "./types.ts";

// Common Gradle configurations
const configurations = [
  "implementation",
  "api",
  "compileOnly",
  "runtimeOnly",
  "testImplementation",
  "testCompileOnly",
  "testRuntimeOnly",
  "annotationProcessor",
  "kapt",
  "ksp",
];

/**
 * Parse Gradle Kotlin DSL (build.gradle.kts) dependencies
 */
function parse(content: string): ParsedDependency[] {
  const deps: ParsedDependency[] = [];
  const configPattern = configurations.join("|");

  // Pattern: implementation("group:artifact:version")
  const funcNotationRegex = new RegExp(
    `(?:${configPattern})\\s*\\(\\s*["']([a-zA-Z0-9._-]+):([a-zA-Z0-9._-]+):([^"'\\s:]+)["']\\s*\\)`,
    "g"
  );

  let match;
  while ((match = funcNotationRegex.exec(content)) !== null) {
    const [, groupId, artifactId, version] = match;
    // Skip variable references ($version, ${version}, etc.)
    if (!version.includes("$") && !version.includes("{")) {
      deps.push({ name: `${groupId}:${artifactId}`, version });
    }
  }

  return deps;
}

export const gradleKotlinParser: DependencyParser = {
  fileType: "build.gradle.kts",
  registry: "maven",
  parse,
};
