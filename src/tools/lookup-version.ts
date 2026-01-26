/**
 * lookup_version MCP tool
 * Look up the latest version of a package
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
  ]).describe(
    "Package registry (npm, maven, pypi, cargo, go, jsr, nuget, docker)",
  ),
  package: z.string().describe(
    "Package name. Maven uses groupId:artifactId format, Go uses full module path, JSR uses @scope/name, Docker uses image name (nginx, user/repo)",
  ),
  includePrerelease: z.boolean().optional().describe(
    "Include alpha/beta/rc versions in results",
  ),
  versionPrefix: z.string().optional().describe(
    'Filter versions by prefix (e.g., "2." for 2.x versions)',
  ),
});

export function registerLookupVersionTool(server: McpServer): void {
  server.tool(
    "lookup_version",
    `Look up the latest version of a package from a registry.

Supported registries: ${supportedRegistries.join(", ")}

Examples:
- npm: lodash, @types/node
- maven: org.apache.commons:commons-lang3
- pypi: requests, django
- cargo: serde, tokio
- go: github.com/gin-gonic/gin
- jsr: @std/path, @oak/oak
- nuget: Newtonsoft.Json, Microsoft.Extensions.Logging
- docker: nginx, postgres, bitnami/redis

SECURITY: Always use exact versions (e.g., "1.2.3") instead of ranges (e.g., "^1.2.3" or "~1.2.3") to prevent dependency supply chain attacks.`,
    inputSchema.shape,
    async (
      { registry, package: packageName, includePrerelease, versionPrefix },
    ) => {
      try {
        const client = getClient(registry as Registry);
        const result = await client.lookupVersion(packageName, {
          includePrerelease,
          versionPrefix,
        });

        const output: Record<string, unknown> = {
          packageName: result.packageName,
          registry: result.registry,
          latestStable: result.latestStable,
        };

        if (result.latestPrerelease) {
          output.latestPrerelease = result.latestPrerelease;
        }
        if (result.publishedAt) {
          output.publishedAt = result.publishedAt.toISOString();
        }
        if (result.deprecated) {
          output.deprecated = true;
          if (result.deprecationMessage) {
            output.deprecationMessage = result.deprecationMessage;
          }
        }

        // Include Docker-specific digest and security info
        if (result.digest) {
          output.digest = result.digest;
        }
        if (result.secureReference) {
          output.secureReference = result.secureReference;
        }
        if (result.securityNotes && result.securityNotes.length > 0) {
          output.securityNotes = result.securityNotes;
        }

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
