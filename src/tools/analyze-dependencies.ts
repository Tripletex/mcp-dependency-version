/**
 * analyze_dependencies MCP tool
 * Analyze a dependency file and check for updates/vulnerabilities
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient, getJsrPackageClient } from "../registries/index.ts";
import type { Registry } from "../registries/types.ts";
import { parseDependencies } from "../parsers/index.ts";
import { getUpdateType } from "../utils/version.ts";
import { checkVulnerabilities } from "../utils/vulnerability.ts";

const inputSchema = z.object({
  content: z.string().describe(
    "File content (package.json, pom.xml, build.gradle, build.gradle.kts, requirements.txt, Cargo.toml, go.mod, deno.json, *.csproj, Dockerfile, docker-compose.yml, Gemfile, composer.json, pubspec.yaml, Package.swift, .github/workflows/*.yml)",
  ),
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
    "github-actions",
  ]).describe(
    "Package registry to use. For Gradle files (build.gradle, build.gradle.kts), use 'maven'. For GitHub Actions workflow files, use 'github-actions'",
  ),
  checkVulnerabilities: z.boolean().optional().default(false).describe(
    "Also scan for vulnerabilities (slower)",
  ),
});

export function registerAnalyzeDependenciesTool(server: McpServer): void {
  server.tool(
    "analyze_dependencies",
    `Analyze a dependency file and check for available updates.

Supported file formats:
- npm: package.json
- maven: pom.xml, build.gradle (Groovy), build.gradle.kts (Kotlin)
- pypi: requirements.txt
- cargo: Cargo.toml
- go: go.mod
- jsr: deno.json (supports jsr: and npm: imports)
- nuget: *.csproj (PackageReference format)
- docker: Dockerfile, docker-compose.yml
- rubygems: Gemfile
- packagist: composer.json
- pub: pubspec.yaml
- swift: Package.swift
- github-actions: .github/workflows/*.yml

Note: For Gradle files, use registry='maven'. For GitHub Actions workflow files, use registry='github-actions'. Variable references ($version, libs.xxx) are skipped.

Optionally checks for known vulnerabilities using OSV and NVD databases.

Returns a list of dependencies with:
- Current version
- Latest available version (exact version, not a range)
- Update type (major/minor/patch)
- Vulnerability information (if enabled)

SECURITY: Always use exact versions (e.g., "1.2.3") instead of ranges (e.g., "^1.2.3" or "~1.2.3") to prevent dependency supply chain attacks. Version ranges allow malicious updates to be automatically pulled in.`,
    inputSchema.shape,
    async ({ content, registry, checkVulnerabilities: scanVulns }) => {
      try {
        const deps = parseDependencies(content, registry as Registry);

        if (deps.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    registry,
                    dependencies: [],
                    summary: {
                      total: 0,
                      outdated: 0,
                      vulnerable: 0,
                      deprecated: 0,
                      majorUpdates: 0,
                      minorUpdates: 0,
                      patchUpdates: 0,
                    },
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        const defaultClient = getClient(registry as Registry);
        const results: {
          name: string;
          currentVersion: string;
          latestVersion: string;
          updateAvailable: boolean;
          updateType: string;
          deprecated?: boolean;
          vulnerabilities?: {
            id: string;
            summary?: string;
            severity?: string;
          }[];
        }[] = [];

        const summary = {
          total: deps.length,
          outdated: 0,
          vulnerable: 0,
          deprecated: 0,
          majorUpdates: 0,
          minorUpdates: 0,
          patchUpdates: 0,
        };

        // Process dependencies concurrently with a limit
        const batchSize = 5;
        for (let i = 0; i < deps.length; i += batchSize) {
          const batch = deps.slice(i, i + batchSize);
          const batchResults = await Promise.all(
            batch.map(async (dep) => {
              try {
                // For jsr registry, route npm: packages to npm registry
                let client = defaultClient;
                let lookupName = dep.name;
                let vulnRegistry = registry as Registry;

                if (registry === "jsr") {
                  const routing = getJsrPackageClient(dep.name);
                  client = routing.client;
                  lookupName = routing.resolvedName;
                  // Use npm registry for vulnerability checks on npm packages
                  if (dep.name.startsWith("npm:")) {
                    vulnRegistry = "npm";
                  }
                }

                const versionInfo = await client.lookupVersion(lookupName);
                const updateType = getUpdateType(
                  dep.version,
                  versionInfo.latestStable,
                );
                const updateAvailable = updateType !== "none";

                const result: (typeof results)[0] = {
                  name: dep.name,
                  currentVersion: dep.version,
                  latestVersion: versionInfo.latestStable,
                  updateAvailable,
                  updateType,
                  deprecated: versionInfo.deprecated,
                };

                if (scanVulns) {
                  const vulns = await checkVulnerabilities(
                    lookupName,
                    dep.version,
                    vulnRegistry,
                  );
                  result.vulnerabilities = vulns.map((v) => ({
                    id: v.id,
                    summary: v.summary,
                    severity: v.severity,
                  }));
                }

                return result;
              } catch {
                return {
                  name: dep.name,
                  currentVersion: dep.version,
                  latestVersion: "unknown",
                  updateAvailable: false,
                  updateType: "unknown",
                };
              }
            }),
          );

          results.push(...batchResults);
        }

        // Calculate summary
        for (const result of results) {
          if (result.updateAvailable) {
            summary.outdated++;
            if (result.updateType === "major") summary.majorUpdates++;
            else if (result.updateType === "minor") summary.minorUpdates++;
            else if (result.updateType === "patch") summary.patchUpdates++;
          }
          if (result.deprecated) summary.deprecated++;
          if (result.vulnerabilities && result.vulnerabilities.length > 0) {
            summary.vulnerable++;
          }
        }

        const output = {
          registry,
          dependencies: results,
          summary,
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
