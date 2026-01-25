/**
 * Docker dependency parser
 * Parses Dockerfile (FROM statements) and docker-compose.yml (image fields)
 */

import type { DependencyParser, ParsedDependency } from "./types.ts";

/**
 * Parse Docker image reference into name and version
 * Examples:
 * - "nginx" -> { name: "nginx", version: "latest" }
 * - "nginx:1.25" -> { name: "nginx", version: "1.25" }
 * - "nginx:1.25-alpine" -> { name: "nginx", version: "1.25-alpine" }
 * - "nginx@sha256:abc123" -> null (digest references skipped)
 * - "user/repo:tag" -> { name: "user/repo", version: "tag" }
 */
function parseImageReference(ref: string): ParsedDependency | null {
  const trimmed = ref.trim();

  // Skip empty references
  if (!trimmed) return null;

  // Skip digest references (image@sha256:...)
  if (trimmed.includes("@sha256:") || trimmed.includes("@")) {
    return null;
  }

  // Skip scratch base image
  if (trimmed === "scratch") return null;

  // Split by colon to get image name and tag
  const colonIndex = trimmed.lastIndexOf(":");

  if (colonIndex === -1) {
    // No tag specified, defaults to "latest"
    return { name: trimmed, version: "latest" };
  }

  // Handle port numbers in registry URLs (e.g., localhost:5000/image:tag)
  // If there's a slash after the colon, it's likely a port number
  const afterColon = trimmed.slice(colonIndex + 1);
  if (afterColon.includes("/")) {
    // The colon is part of a registry URL, extract the actual tag
    const lastColonIndex = trimmed.lastIndexOf(":");
    const beforeLastColon = trimmed.slice(0, lastColonIndex);
    const tag = trimmed.slice(lastColonIndex + 1);

    if (tag.includes("/")) {
      // No tag, just registry with port
      return { name: trimmed, version: "latest" };
    }

    return { name: beforeLastColon, version: tag };
  }

  const name = trimmed.slice(0, colonIndex);
  const version = afterColon;

  return { name, version };
}

/**
 * Parse Dockerfile content
 * Extracts images from FROM statements
 */
function parseDockerfile(content: string): ParsedDependency[] {
  const deps: ParsedDependency[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (trimmed.startsWith("#") || !trimmed) continue;

    // Match FROM statements
    // FROM [--platform=...] image[:tag|@digest] [AS name]
    const fromMatch = trimmed.match(
      /^FROM\s+(?:--platform=[^\s]+\s+)?([^\s]+)(?:\s+AS\s+\w+)?$/i
    );

    if (fromMatch) {
      const imageRef = fromMatch[1];
      const parsed = parseImageReference(imageRef);
      if (parsed) {
        // Avoid duplicates
        if (!deps.some((d) => d.name === parsed.name && d.version === parsed.version)) {
          deps.push(parsed);
        }
      }
    }
  }

  return deps;
}

/**
 * Simple YAML-like parser for docker-compose image fields
 * Note: This is a basic parser that handles common patterns
 */
function parseDockerCompose(content: string): ParsedDependency[] {
  const deps: ParsedDependency[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (trimmed.startsWith("#") || !trimmed) continue;

    // Match image: fields
    // image: nginx:1.25
    // image: "nginx:1.25"
    // image: 'nginx:1.25'
    const imageMatch = trimmed.match(/^image:\s*["']?([^"'\s]+)["']?\s*$/);

    if (imageMatch) {
      const imageRef = imageMatch[1];
      const parsed = parseImageReference(imageRef);
      if (parsed) {
        // Avoid duplicates
        if (!deps.some((d) => d.name === parsed.name && d.version === parsed.version)) {
          deps.push(parsed);
        }
      }
    }
  }

  return deps;
}

/**
 * Parse Docker dependency files
 * Auto-detects between Dockerfile and docker-compose.yml format
 */
function parse(content: string): ParsedDependency[] {
  const trimmed = content.trim();

  // Detect format based on content
  // Dockerfile typically starts with FROM, comments, or ARG
  // docker-compose.yml has version:, services:, etc.

  if (
    trimmed.match(/^(FROM|ARG|#)/im) ||
    trimmed.includes("\nFROM ") ||
    trimmed.includes("\nfrom ")
  ) {
    return parseDockerfile(content);
  }

  if (
    trimmed.includes("services:") ||
    trimmed.includes("image:") ||
    trimmed.match(/^version:\s*["']?[0-9.]+["']?/m)
  ) {
    return parseDockerCompose(content);
  }

  // Default to Dockerfile parsing
  return parseDockerfile(content);
}

export const dockerParser: DependencyParser = {
  fileType: "Dockerfile/docker-compose.yml",
  registry: "docker",
  parse,
};
