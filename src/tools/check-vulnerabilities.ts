/**
 * check_vulnerabilities MCP tool
 * Check a package version for known vulnerabilities using OSV database
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Registry, Severity } from "../registries/types.ts";
import {
  checkVulnerabilities,
  getVulnerabilitySummary,
} from "../utils/vulnerability.ts";

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
    "github-actions",
  ]).describe(
    "Package registry (npm, maven, pypi, cargo, go, jsr, nuget, docker, rubygems, packagist, pub, swift, github-actions)",
  ),
  package: z.string().describe(
    "Package name. Maven uses groupId:artifactId format, Go uses full module path, JSR uses @scope/name, Docker uses image name (nginx, user/repo), GitHub Actions uses owner/repo (actions/checkout)",
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

Queries two databases in parallel for comprehensive coverage:
- OSV (Open Source Vulnerabilities): aggregates GitHub Security Advisories, PyPI, RustSec, Go, and more
- NVD (National Vulnerability Database): authoritative CVSS v3.1 scores and CWE classifications

Results are deduplicated by CVE ID. When a vulnerability appears in both databases,
NVD's CVSS score is used as the authoritative severity rating.

Set the NVD_API_KEY environment variable for higher NVD rate limits (50 vs 5 requests/30s).

Returns CVE IDs, CVSS scores, CWE IDs, severity ratings, affected version ranges, and available fixes.`,
    inputSchema.shape,
    async ({ registry, package: packageName, version, severityThreshold }) => {
      try {
        const vulns = await checkVulnerabilities(
          packageName,
          version,
          registry as Registry,
          { severityThreshold: severityThreshold as Severity | undefined },
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
            cvss: v.cvss,
            cveIds: v.cveIds,
            cweIds: v.cweIds,
            affectedVersions: v.affectedVersions,
            fixedVersions: v.fixedVersions,
            publishedAt: v.publishedAt?.toISOString(),
            references: v.references,
            source: v.source,
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
    },
  );
}
