/**
 * Parser exports and factory
 */

export * from "./types.ts";
export { npmParser } from "./npm.ts";
export { pypiParser } from "./pypi.ts";
export { cargoParser } from "./cargo.ts";
export { goParser } from "./go.ts";
export { mavenParser } from "./maven.ts";
export { gradleGroovyParser } from "./gradle-groovy.ts";
export { gradleKotlinParser } from "./gradle-kotlin.ts";
export { denoParser } from "./deno.ts";
export { nugetParser } from "./nuget.ts";
export { dockerParser } from "./docker.ts";

import type { Registry } from "../registries/types.ts";
import type { DependencyParser, ParsedDependency } from "./types.ts";
import { npmParser } from "./npm.ts";
import { pypiParser } from "./pypi.ts";
import { cargoParser } from "./cargo.ts";
import { goParser } from "./go.ts";
import { mavenParser } from "./maven.ts";
import { gradleGroovyParser } from "./gradle-groovy.ts";
import { gradleKotlinParser } from "./gradle-kotlin.ts";
import { denoParser } from "./deno.ts";
import { nugetParser } from "./nuget.ts";
import { dockerParser } from "./docker.ts";

const parsers: Record<Registry, DependencyParser> = {
  npm: npmParser,
  pypi: pypiParser,
  cargo: cargoParser,
  go: goParser,
  maven: mavenParser,
  jsr: denoParser,
  nuget: nugetParser,
  docker: dockerParser,
};

/**
 * Get the appropriate parser for a registry
 */
export function getParser(registry: Registry): DependencyParser {
  const parser = parsers[registry];
  if (!parser) {
    throw new Error(`Unsupported registry: ${registry}`);
  }
  return parser;
}

/**
 * Detect file type and parse Maven/Gradle dependencies
 * Auto-detects between pom.xml, build.gradle (Groovy), and build.gradle.kts (Kotlin)
 */
function parseMavenDependencies(content: string): ParsedDependency[] {
  const trimmed = content.trim();

  // Check for pom.xml (XML format)
  if (trimmed.includes("<project") || trimmed.includes("<dependency>")) {
    return mavenParser.parse(content);
  }

  // Check for Kotlin DSL (build.gradle.kts patterns)
  // Kotlin uses function call syntax: implementation("...")
  if (/(?:implementation|api|testImplementation)\s*\(\s*"/.test(content)) {
    return gradleKotlinParser.parse(content);
  }

  // Check for Groovy DSL (build.gradle patterns)
  // Groovy can use: implementation 'group:artifact:version' or implementation "..."
  if (
    /(?:implementation|api|testImplementation|compile)\s+['"]/.test(content) ||
    /(?:implementation|api|testImplementation)\s+group:/.test(content)
  ) {
    return gradleGroovyParser.parse(content);
  }

  // Default to pom.xml parsing
  return mavenParser.parse(content);
}

/**
 * Parse dependencies from file content based on registry
 * For maven registry, auto-detects between pom.xml, build.gradle, and build.gradle.kts
 */
export function parseDependencies(
  content: string,
  registry: Registry,
): ParsedDependency[] {
  switch (registry) {
    case "npm":
      return npmParser.parse(content);
    case "pypi":
      return pypiParser.parse(content);
    case "cargo":
      return cargoParser.parse(content);
    case "go":
      return goParser.parse(content);
    case "maven":
      return parseMavenDependencies(content);
    case "jsr":
      return denoParser.parse(content);
    case "nuget":
      return nugetParser.parse(content);
    case "docker":
      return dockerParser.parse(content);
    default:
      throw new Error(`Unsupported registry: ${registry}`);
  }
}
