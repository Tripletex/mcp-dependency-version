/**
 * Gradle Groovy DSL (build.gradle) dependency parser
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
  "compile", // deprecated but still used
  "testCompile", // deprecated but still used
  "runtime", // deprecated but still used
];

/**
 * Parse Gradle Groovy DSL (build.gradle) dependencies
 */
function parse(content: string): ParsedDependency[] {
  const deps: ParsedDependency[] = [];
  const configPattern = configurations.join("|");

  // Pattern 1: String notation - implementation 'group:artifact:version' or "group:artifact:version"
  // Handles both single and double quotes
  const stringNotationRegex = new RegExp(
    `(?:${configPattern})\\s*[("']([a-zA-Z0-9._-]+):([a-zA-Z0-9._-]+):([^'"\\s:]+)[)'"]`,
    "g",
  );

  let match;
  while ((match = stringNotationRegex.exec(content)) !== null) {
    const [, groupId, artifactId, version] = match;
    // Skip variable references ($version, ${version}, etc.)
    if (!version.includes("$") && !version.includes("{")) {
      deps.push({ name: `${groupId}:${artifactId}`, version });
    }
  }

  // Pattern 2: Map notation - implementation group: 'com.example', name: 'lib', version: '1.0'
  const mapNotationRegex = new RegExp(
    `(?:${configPattern})\\s+group:\\s*['"]([^'"]+)['"]\\s*,\\s*name:\\s*['"]([^'"]+)['"]\\s*,\\s*version:\\s*['"]([^'"]+)['"]`,
    "g",
  );

  while ((match = mapNotationRegex.exec(content)) !== null) {
    const [, groupId, artifactId, version] = match;
    if (!version.includes("$") && !version.includes("{")) {
      deps.push({ name: `${groupId}:${artifactId}`, version });
    }
  }

  return deps;
}

export const gradleGroovyParser: DependencyParser = {
  fileType: "build.gradle",
  registry: "maven",
  parse,
};
