/**
 * list_versions MCP tool
 * List all available versions of a package
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient, supportedRegistries } from "../registries/index.ts";
import type { Registry } from "../registries/types.ts";

const inputSchema = z.object({
  registry: z.enum([
    "npm",
    "maven",
    "pypi",
    "cargo",
    "go",
    "jsr",
    "nuget",
    "docker",
    "rubygems",
    "packagist",
    "pub",
    "swift",
  ]).describe(
    "Package registry (npm, maven, pypi, cargo, go, jsr, nuget, docker, rubygems, packagist, pub, swift)",
  ),
  package: z.string().describe(
    "Package name. Maven uses groupId:artifactId format, Go uses full module path, JSR uses @scope/name, Docker uses image name (nginx, user/repo)",
  ),
  limit: z.number().optional().default(20).describe(
    "Maximum number of versions to return (default: 20)",
  ),
});

export function registerListVersionsTool(server: McpServer): void {
  server.tool(
    "list_versions",
    `List all available versions of a package from a registry.

Returns versions sorted by version number (newest first), with metadata including:
- Version number
- Publish date (when available)
- Prerelease status
- Deprecation status
- Yanked status (for cargo/pypi)

Supported registries: ${supportedRegistries.join(", ")}`,
    inputSchema.shape,
    async ({ registry, package: packageName, limit }) => {
      try {
        const client = getClient(registry as Registry);
        const versions = await client.listVersions(packageName);

        // Apply limit
        const limitedVersions = versions.slice(0, limit);

        const output = {
          packageName,
          registry,
          versions: limitedVersions.map((v) => ({
            version: v.version,
            publishedAt: v.publishedAt?.toISOString(),
            isPrerelease: v.isPrerelease,
            isDeprecated: v.isDeprecated,
            ...(v.yanked !== undefined && { yanked: v.yanked }),
            ...(v.digest !== undefined && { digest: v.digest }),
          })),
          totalCount: versions.length,
          showing: limitedVersions.length,
          // Add security note for Docker registry
          ...(registry === "docker" && {
            securityNote:
              "Docker tags are NOT immutable. Use digest-pinned references (image@sha256:...) for supply chain security.",
          }),
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: message }, null, 2),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
