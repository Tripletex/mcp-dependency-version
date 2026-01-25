/**
 * check_vulnerabilities MCP tool
 * Check a package version for known vulnerabilities using OSV database
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Registry, Severity } from "../registries/types.ts";
import {
  checkVulnerabilities,
  getVulnerabilitySummary,
} from "../utils/vulnerability.ts";

const inputSchema = z.object({
  registry: z.enum(["npm", "maven", "pypi", "cargo", "go", "jsr", "nuget", "docker"]).describe(
    "Package registry (npm, maven, pypi, cargo, go, jsr, nuget, docker)"
  ),
  package: z.string().describe(
    "Package name. Maven uses groupId:artifactId format, Go uses full module path, JSR uses @scope/name, Docker uses image name (nginx, user/repo)"
  ),
  version: z.string().describe("Version to check for vulnerabilities"),
  severityThreshold: z
    .enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"])
    .optional()
    .describe("Minimum severity to include (default: all)"),
});

export function registerCheckVulnerabilitiesTool(server: McpServer): void {
  server.tool(
    "check_vulnerabilities",
    `Check a package version for known security vulnerabilities.

Uses the Open Source Vulnerabilities (OSV) database which aggregates vulnerabilities from:
- GitHub Security Advisories
- NVD (National Vulnerability Database)
- PyPI Advisory Database
- RustSec Advisory Database
- Go Vulnerability Database
- And more

Returns CVE IDs, severity ratings, affected version ranges, and available fixes.`,
    inputSchema.shape,
    async ({ registry, package: packageName, version, severityThreshold }) => {
      try {
        const vulns = await checkVulnerabilities(
          packageName,
          version,
          registry as Registry,
          { severityThreshold: severityThreshold as Severity | undefined }
        );

        const summary = getVulnerabilitySummary(vulns);

        const output = {
          packageName,
          version,
          registry,
          vulnerabilities: vulns.map((v) => ({
            id: v.id,
            summary: v.summary,
            severity: v.severity,
            cveIds: v.cveIds,
            affectedVersions: v.affectedVersions,
            fixedVersions: v.fixedVersions,
            publishedAt: v.publishedAt?.toISOString(),
            references: v.references,
          })),
          totalCount: vulns.length,
          hasVulnerabilities: vulns.length > 0,
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
    }
  );
}
