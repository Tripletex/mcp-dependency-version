/**
 * Parser types for dependency file parsing
 */

import type { Registry } from "../registries/types.ts";

/**
 * A parsed dependency from a dependency file
 */
export interface ParsedDependency {
  name: string;
  version: string;
}

/**
 * Interface for dependency file parsers
 */
export interface DependencyParser {
  /** The file type this parser handles (e.g., "package.json", "build.gradle") */
  readonly fileType: string;
  /** The registry to use for lookups */
  readonly registry: Registry;
  /** Parse file content and return dependencies */
  parse(content: string): ParsedDependency[];
}
