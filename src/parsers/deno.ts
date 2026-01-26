/**
 * Deno deno.json dependency parser
 * Supports both JSR (jsr:) and npm (npm:) imports
 */

import type { DependencyParser, ParsedDependency } from "./types.ts";

/**
 * Strip JSON comments for deno.jsonc support
 * Only strips comments that are outside of string values
 */
function stripJsonComments(content: string): string {
  let result = "";
  let inString = false;
  let escape = false;
  let i = 0;

  while (i < content.length) {
    const char = content[i];
    const nextChar = content[i + 1];

    // Handle string state
    if (char === '"' && !escape) {
      inString = !inString;
      result += char;
      i++;
      continue;
    }

    // Handle escape sequences in strings
    if (inString) {
      escape = char === "\\" && !escape;
      result += char;
      i++;
      continue;
    }

    // Outside of string - check for comments
    if (char === "/" && nextChar === "/") {
      // Single-line comment - skip until end of line
      while (i < content.length && content[i] !== "\n") {
        i++;
      }
      continue;
    }

    if (char === "/" && nextChar === "*") {
      // Multi-line comment - skip until */
      i += 2;
      while (i < content.length - 1) {
        if (content[i] === "*" && content[i + 1] === "/") {
          i += 2;
          break;
        }
        i++;
      }
      continue;
    }

    result += char;
    i++;
  }

  return result;
}

/**
 * Parse version from a deno import specifier
 * Examples:
 *   jsr:@std/path@^1.0.0 -> { registry: "jsr", name: "@std/path", version: "1.0.0" }
 *   npm:lodash@^4.17.21 -> { registry: "npm", name: "lodash", version: "4.17.21" }
 *   jsr:@oak/oak@17 -> { registry: "jsr", name: "@oak/oak", version: "17" }
 */
function parseImportSpecifier(
  specifier: string,
): { registry: "jsr" | "npm"; name: string; version: string } | null {
  // Skip URL imports
  if (specifier.startsWith("http://") || specifier.startsWith("https://")) {
    return null;
  }

  // Skip workspace imports
  if (specifier.startsWith("workspace:")) {
    return null;
  }

  // Match jsr: or npm: specifiers
  const match = specifier.match(/^(jsr|npm):(.+)@([^@]+)$/);
  if (!match) {
    return null;
  }

  const [, registry, name, versionWithPrefix] = match;

  // Strip semver prefixes (^, ~, >=, <=, >, <, =)
  const version = versionWithPrefix.replace(/^[\^~>=<]+/, "");

  return {
    registry: registry as "jsr" | "npm",
    name,
    version,
  };
}

/**
 * Parse deno.json imports
 */
function parse(content: string): ParsedDependency[] {
  try {
    // Strip comments for deno.jsonc support
    const cleanContent = stripJsonComments(content);
    const config = JSON.parse(cleanContent);
    const deps: ParsedDependency[] = [];

    const imports = config.imports;
    if (!imports || typeof imports !== "object") {
      return deps;
    }

    for (const [, specifier] of Object.entries(imports)) {
      if (typeof specifier !== "string") {
        continue;
      }

      const parsed = parseImportSpecifier(specifier);
      if (!parsed) {
        continue;
      }

      // For npm: packages, prefix the name to indicate registry routing
      // For jsr: packages, use the name as-is
      const name = parsed.registry === "npm"
        ? `npm:${parsed.name}`
        : parsed.name;

      deps.push({
        name,
        version: parsed.version,
      });
    }

    return deps;
  } catch {
    throw new Error("Failed to parse deno.json");
  }
}

export const denoParser: DependencyParser = {
  fileType: "deno.json",
  registry: "jsr",
  parse,
};
