/**
 * find_parent_version MCP tool
 *
 * Answers a single hop of "to update transitive D@target, which version of its
 * direct parent C do I need?". Iterates C's published versions ascending and
 * returns the first one whose declared range for D includes target.
 *
 * Intended for ecosystems (Deno, Go modules) where you cannot override a
 * transitive dependency from the top level — a target version of D requires
 * lifting every parent in the chain. The caller chains this tool to walk the
 * chain hop by hop.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../registries/index.ts";
import type { Registry, VersionDependency } from "../registries/types.ts";
import {
  compareVersions,
  isPrerelease,
  satisfiesConstraint,
} from "../utils/version.ts";

const SUPPORTED_PARENT_REGISTRIES = ["npm", "jsr"] as const;
const SUPPORTED_CHILD_REGISTRIES = ["npm", "jsr"] as const;

export type FindParentVersionParentRegistry =
  (typeof SUPPORTED_PARENT_REGISTRIES)[number];
export type FindParentVersionChildRegistry =
  (typeof SUPPORTED_CHILD_REGISTRIES)[number];

export type FindParentVersionStatus =
  | "found"
  | "none-compatible"
  | "child-never-declared"
  | "error";

export interface PackageRef<R extends Registry = Registry> {
  registry: R;
  name: string;
}

export interface FindParentVersionInput {
  parent: PackageRef<FindParentVersionParentRegistry>;
  child: PackageRef<FindParentVersionChildRegistry>;
  childVersion: string;
  fromParentVersion?: string;
  includePrerelease?: boolean;
}

export interface FindParentVersionResult {
  parent: PackageRef<FindParentVersionParentRegistry>;
  child: PackageRef<FindParentVersionChildRegistry>;
  childVersion: string;
  status: FindParentVersionStatus;
  parentVersion?: string;
  declaredConstraint?: string;
  scope?: VersionDependency["scope"];
  versionsScanned: number;
  versionsConsidered: number;
  note?: string;
  error?: string;
}

/**
 * Pure algorithm: scan `versions` ascending and return the first one whose
 * dependency list contains `child` declared at a range that includes
 * `childVersion`.
 *
 * `versions` is expected to already be sorted ascending and filtered
 * (prerelease handling, fromParentVersion, deprecated/yanked) — this helper
 * does no filtering itself so it stays trivially testable.
 *
 * `getDeps(version)` should return `undefined` when the version has no
 * extractable dependency manifest (treated as "no info"); an empty array
 * means "no declared deps".
 */
export async function scanForCompatibleParentVersion(
  versions: string[],
  child: PackageRef,
  childVersion: string,
  getDeps: (version: string) => Promise<VersionDependency[] | undefined>,
): Promise<
  Omit<
    FindParentVersionResult,
    "parent" | "child" | "childVersion" | "versionsConsidered"
  >
> {
  let everSawChild = false;
  let scanned = 0;

  for (const version of versions) {
    scanned++;
    const deps = await getDeps(version);
    if (!deps) continue;

    const match = deps.find(
      (d) => d.registry === child.registry && d.name === child.name,
    );
    if (!match) continue;
    everSawChild = true;

    if (satisfiesConstraint(childVersion, match.constraint)) {
      return {
        status: "found",
        parentVersion: version,
        declaredConstraint: match.constraint,
        scope: match.scope,
        versionsScanned: scanned,
      };
    }
  }

  if (everSawChild) {
    return {
      status: "none-compatible",
      versionsScanned: scanned,
      note:
        `No scanned parent version declares the child at a range that includes ${childVersion}.`,
    };
  }
  return {
    status: "child-never-declared",
    versionsScanned: scanned,
    note:
      `The child package was not declared as a dependency in any scanned parent version.`,
  };
}

export async function findParentVersion(
  input: FindParentVersionInput,
): Promise<FindParentVersionResult> {
  const { parent, child, childVersion, fromParentVersion, includePrerelease } =
    input;

  try {
    const client = getClient(parent.registry);
    if (!client.getVersionDependencies) {
      return {
        parent,
        child,
        childVersion,
        status: "error",
        error:
          `Registry '${parent.registry}' does not expose version-level dependency metadata.`,
        versionsScanned: 0,
        versionsConsidered: 0,
      };
    }

    const all = await client.listVersions(parent.name);
    let versions = all
      .filter((v) => !v.yanked)
      .map((v) => v.version);

    if (!includePrerelease) {
      versions = versions.filter((v) => !isPrerelease(v));
    }

    if (fromParentVersion) {
      versions = versions.filter(
        (v) => compareVersions(v, fromParentVersion) >= 0,
      );
    }

    versions.sort(compareVersions);
    const considered = versions.length;

    const partial = await scanForCompatibleParentVersion(
      versions,
      child,
      childVersion,
      (v) => client.getVersionDependencies!(parent.name, v),
    );

    return {
      parent,
      child,
      childVersion,
      versionsConsidered: considered,
      ...partial,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      parent,
      child,
      childVersion,
      status: "error",
      error: message,
      versionsScanned: 0,
      versionsConsidered: 0,
    };
  }
}

const packageRefSchema = (
  registries: readonly string[],
  description: string,
) =>
  z.object({
    registry: z.enum(registries as [string, ...string[]]).describe(description),
    name: z.string().describe(
      "Package name. npm: 'foo' or '@scope/foo'. jsr: '@scope/name'.",
    ),
  });

const inputSchema = z.object({
  parent: packageRefSchema(
    SUPPORTED_PARENT_REGISTRIES,
    "Registry hosting the parent package (npm or jsr)",
  ),
  child: packageRefSchema(
    SUPPORTED_CHILD_REGISTRIES,
    "Registry hosting the child dependency (npm or jsr)",
  ),
  childVersion: z.string().describe(
    "Concrete target version of the child (e.g. '1.5.4'). The tool returns the minimum parent version whose declared range for the child includes this version.",
  ),
  fromParentVersion: z.string().optional().describe(
    "Optional: only consider parent versions >= this one. Use when you already know the current parent version and only care about upgrade candidates.",
  ),
  includePrerelease: z.boolean().optional().describe(
    "Include prerelease parent versions in the scan (default: false).",
  ),
});

export function registerFindParentVersionTool(server: McpServer): void {
  server.tool(
    "find_parent_version",
    `Find the minimum parent version whose declared dependency range includes a
given target version of a child package.

Use case: dependency systems like Deno pin transitive dependencies, so
updating a transitive D to a specific version requires also updating every
parent in the chain that brought it in. This tool answers one hop at a time:
"what is the lowest version of C whose declared range for D includes
D@<childVersion>?". Chain the tool to walk a full A -> B -> C -> D upgrade.

Supported parent registries: npm, jsr. The child can live on either npm or
jsr (JSR packages can declare npm packages as transitives).

How the match works:
- Lists all parent versions, ascending, filtered to non-yanked and non-
  prerelease (unless includePrerelease is set).
- For each version, fetches its declared dependencies and looks for one whose
  (registry, name) match the child.
- Uses semver range matching ('^1.4.0', '~1.4.0', '>=1.4.0', exact, etc.) to
  test whether the declared range includes childVersion.
- Returns the first (= lowest) parent version that satisfies.

Status values:
  - "found"                a matching parent version was located; see
                           'parentVersion' and 'declaredConstraint'
  - "none-compatible"      the child was declared in some scanned parent
                           versions, but none at a range covering childVersion
  - "child-never-declared" the child was not declared in any scanned version
  - "error"                see 'error' field

The tool reports only the manifest-level match — your downstream tooling owns
the actual lockfile rewrite or 'install' step.`,
    inputSchema.shape,
    async ({
      parent,
      child,
      childVersion,
      fromParentVersion,
      includePrerelease,
    }) => {
      try {
        const result = await findParentVersion({
          parent: {
            registry: parent.registry as FindParentVersionParentRegistry,
            name: parent.name,
          },
          child: {
            registry: child.registry as FindParentVersionChildRegistry,
            name: child.name,
          },
          childVersion,
          fromParentVersion,
          includePrerelease,
        });
        return {
          content: [
            { type: "text", text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            { type: "text", text: JSON.stringify({ error: message }, null, 2) },
          ],
          isError: true,
        };
      }
    },
  );
}
