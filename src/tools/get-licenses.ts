/**
 * get_licenses MCP tool
 * Look up the declared license for one or more package dependencies.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient, supportedRegistries } from "../registries/index.ts";
import type { Registry } from "../registries/types.ts";
import {
  getLicenseRegistry,
  type LicenseEntry,
  type LicenseSource,
} from "../utils/licenses.ts";

/**
 * Registries whose client does not expose license metadata.
 * Keep in sync with the getMetadata implementations in src/registries/.
 */
export const REGISTRIES_WITHOUT_LICENSE: ReadonlySet<Registry> = new Set<
  Registry
>([
  "go",
  "docker",
]);

export type LicenseLookupStatus =
  | "found"
  | "not-declared"
  | "registry-unsupported"
  | "error";

export interface LicenseLookupInput {
  registry: Registry;
  package: string;
  version?: string;
}

/**
 * Enriched SPDX info for a single resolved license. The `spdx` array on a
 * result holds one of these per parsed license (so dual-licensed packages
 * like "MIT OR Apache-2.0" return two entries).
 */
export interface LicenseSpdxInfo {
  licenseId: string;
  name: string;
  isOsiApproved: boolean;
  isDeprecated: boolean;
  category?: string;
  isCopyleft?: boolean;
  reference?: string;
}

export interface LicenseLookupResult {
  registry: Registry;
  packageName: string;
  version?: string;
  license: string | null;
  status: LicenseLookupStatus;
  note?: string;
  error?: string;
  /** One entry per SPDX ID the license string resolved to. Empty if unresolved. */
  spdx?: LicenseSpdxInfo[];
  /** True when at least one resolved SPDX license is copyleft. */
  isCopyleft?: boolean;
}

export interface LicenseLookupSummary {
  total: number;
  withLicense: number;
  notDeclared: number;
  registryUnsupported: number;
  errors: number;
  copyleft: number;
}

function toSpdxInfo(entry: LicenseEntry): LicenseSpdxInfo {
  return {
    licenseId: entry.licenseId,
    name: entry.name,
    isOsiApproved: entry.isOsiApproved,
    isDeprecated: entry.isDeprecated,
    category: entry.category,
    isCopyleft: entry.isCopyleft,
    reference: entry.reference,
  };
}

export async function lookupLicense(
  input: LicenseLookupInput,
): Promise<LicenseLookupResult> {
  const { registry, package: packageName, version } = input;

  if (REGISTRIES_WITHOUT_LICENSE.has(registry)) {
    return {
      registry,
      packageName,
      version,
      license: null,
      status: "registry-unsupported",
      note:
        `The ${registry} registry does not expose license metadata through this tool. ` +
        `Check the package's source repository or documentation.`,
    };
  }

  try {
    const client = getClient(registry);
    const metadata = await client.getMetadata(packageName, version);
    const license = metadata.license?.trim();

    if (license) {
      const spdxRegistry = await getLicenseRegistry();
      const entries = spdxRegistry.parse(license);
      const spdx = entries.map(toSpdxInfo);
      const isCopyleft = spdx.some((s) => s.isCopyleft);
      return {
        registry,
        packageName,
        version,
        license,
        status: "found",
        spdx,
        isCopyleft,
      };
    }

    return {
      registry,
      packageName,
      version,
      license: null,
      status: "not-declared",
      note: "The package did not declare a license in its registry metadata.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      registry,
      packageName,
      version,
      license: null,
      status: "error",
      error: message,
    };
  }
}

export async function lookupLicenses(
  inputs: LicenseLookupInput[],
): Promise<LicenseLookupResult[]> {
  return await Promise.all(inputs.map((i) => lookupLicense(i)));
}

export function summarizeLicenseResults(
  results: LicenseLookupResult[],
): LicenseLookupSummary {
  return {
    total: results.length,
    withLicense: results.filter((r) => r.status === "found").length,
    notDeclared: results.filter((r) => r.status === "not-declared").length,
    registryUnsupported:
      results.filter((r) => r.status === "registry-unsupported").length,
    errors: results.filter((r) => r.status === "error").length,
    copyleft: results.filter((r) => r.isCopyleft).length,
  };
}

export async function getLicenseSources(): Promise<readonly LicenseSource[]> {
  const registry = await getLicenseRegistry();
  return registry.sources;
}

const packageSchema = z.object({
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
    "Package name. Maven uses groupId:artifactId, Go uses full module path, JSR uses @scope/name, Docker uses image name (nginx, user/repo), GitHub Actions uses owner/repo (actions/checkout)",
  ),
  version: z.string().optional().describe(
    "Specific version to inspect (optional, defaults to latest)",
  ),
});

const inputSchema = z.object({
  packages: z.array(packageSchema).min(1).describe(
    "One or more packages to look up. Each entry needs a registry and package name; version is optional. Pass a single-element array to look up a single package.",
  ),
});

export function registerGetLicensesTool(server: McpServer): void {
  server.tool(
    "get_licenses",
    `Look up the declared license for one or more packages.

Supported registries: ${supportedRegistries.join(", ")}

Accepts an array of {registry, package, version?} entries so callers can query
many dependencies in a single request. Results preserve input order.

Each result has a 'status' field:
  - "found"                license string returned in 'license'
  - "not-declared"         the package did not declare a license in its metadata
  - "registry-unsupported" the registry does not expose license metadata
                           (${[...REGISTRIES_WITHOUT_LICENSE].join(", ")})
  - "error"                metadata fetch failed; see 'error' field

A "not-declared" or "registry-unsupported" result does NOT mean the package is
unlicensed. Check the package's source repository or documentation instead.

Licenses are returned verbatim as the registry reports them. Expect SPDX
identifiers (e.g. "MIT", "Apache-2.0") from most registries, but some return
free-form strings or comma-joined lists when multiple licenses apply.

Every result is enriched from a baked-in SPDX + ScanCode LicenseDB dataset:
the 'spdx' array has one entry per resolved SPDX ID with 'isOsiApproved',
'isDeprecated', 'category' (e.g. Permissive, Copyleft, Copyleft Limited) and
'isCopyleft'. Top-level 'isCopyleft' is true if any resolved license is
copyleft. The response also includes the data 'sources' (with attribution)
and 'generatedAt' timestamp.`,
    inputSchema.shape,
    async ({ packages }) => {
      try {
        const results = await lookupLicenses(
          packages.map((p) => ({
            registry: p.registry as Registry,
            package: p.package,
            version: p.version,
          })),
        );

        const summary = summarizeLicenseResults(results);
        const sources = await getLicenseSources();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { results, summary, sources },
                null,
                2,
              ),
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
