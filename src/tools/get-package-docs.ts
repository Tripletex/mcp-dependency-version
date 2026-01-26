/**
 * Implementation of the get_package_docs tool
 * Fetches README/documentation for packages from various registries
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Registry } from "../registries/types.ts";
import { getClient, supportedRegistries } from "../registries/index.ts";
import { fetchReadmeFromRepository } from "../utils/github.ts";
import { fetchWithHeaders } from "../utils/http.ts";
import { getRepositoryConfig } from "../config/loader.ts";

export interface GetPackageDocsInput {
  registry: Registry;
  package: string;
  version?: string;
}

export interface GetPackageDocsResult {
  packageName: string;
  registry: Registry;
  version?: string;
  content: string;
  source: "registry" | "repository" | "none";
  repositoryUrl?: string;
  documentationUrl?: string;
  error?: string;
}

/**
 * Get documentation URLs for a package
 */
function getDocumentationUrls(
  registry: Registry,
  packageName: string,
  version?: string,
): { docs?: string; repository?: string } {
  switch (registry) {
    case "npm":
      return {
        docs: `https://www.npmjs.com/package/${packageName}${
          version ? `/v/${version}` : ""
        }`,
      };
    case "maven": {
      const [groupId, artifactId] = packageName.split(":");
      return {
        docs: `https://javadoc.io/doc/${groupId}/${artifactId}${
          version ? `/${version}` : "/latest"
        }`,
      };
    }
    case "pypi":
      return {
        docs: `https://pypi.org/project/${packageName}/${version || ""}`,
      };
    case "cargo":
      return {
        docs: `https://docs.rs/${packageName}${version ? `/${version}` : ""}`,
      };
    case "go":
      return {
        docs: `https://pkg.go.dev/${packageName}${
          version ? `@${version}` : ""
        }`,
      };
    case "jsr": {
      const [scope, name] = packageName.replace(/^@/, "").split("/");
      return {
        docs: `https://jsr.io/@${scope}/${name}${version ? `@${version}` : ""}`,
      };
    }
    case "nuget":
      return {
        docs: `https://www.nuget.org/packages/${packageName}/${version || ""}`,
      };
    case "docker": {
      // Official images: hub.docker.com/_/nginx
      // User images: hub.docker.com/r/user/repo
      const parts = packageName.split("/");
      if (parts.length === 1) {
        return {
          docs: `https://hub.docker.com/_/${packageName}`,
        };
      }
      return {
        docs: `https://hub.docker.com/r/${packageName}`,
      };
    }
    default:
      return {};
  }
}

/**
 * Fetch README from npm registry (embedded in API response)
 */
async function fetchNpmReadme(packageName: string): Promise<string | null> {
  const repoConfig = getRepositoryConfig("npm");
  const encodedName = packageName.startsWith("@")
    ? packageName.replace("/", "%2F")
    : packageName;

  try {
    const response = await fetchWithHeaders(
      `${repoConfig.url}/${encodedName}`,
      { auth: repoConfig.auth },
    );
    if (response.ok) {
      const data = await response.json();
      return data.readme || null;
    }
  } catch {
    // Fall through
  }
  return null;
}

/**
 * Fetch description from PyPI (often contains README content)
 */
async function fetchPypiDescription(
  packageName: string,
): Promise<string | null> {
  const repoConfig = getRepositoryConfig("pypi");
  const normalized = packageName.toLowerCase().replace(/[-_.]+/g, "-");

  try {
    const response = await fetchWithHeaders(
      `${repoConfig.url}/${normalized}/json`,
      { auth: repoConfig.auth },
    );
    if (response.ok) {
      const data = await response.json();
      // PyPI returns description which is typically the README
      return data.info?.description || null;
    }
  } catch {
    // Fall through
  }
  return null;
}

/**
 * Fetch README from crates.io
 */
async function fetchCargoReadme(packageName: string): Promise<string | null> {
  const repoConfig = getRepositoryConfig("cargo");

  try {
    const response = await fetchWithHeaders(
      `${repoConfig.url}/${packageName}`,
      { auth: repoConfig.auth },
    );
    if (response.ok) {
      const data = await response.json();
      // crates.io has a readme field
      if (data.crate?.readme) {
        return data.crate.readme;
      }
    }
  } catch {
    // Fall through
  }
  return null;
}

/**
 * Format the result as a human-readable string for the MCP response
 */
export function formatDocsResultAsText(result: GetPackageDocsResult): string {
  if (result.error) {
    return `Error: ${result.error}`;
  }

  const lines: string[] = [];

  lines.push(`# ${result.packageName} Documentation`);
  lines.push(`Registry: ${result.registry}`);
  if (result.version) {
    lines.push(`Version: ${result.version}`);
  }
  lines.push(`Source: ${result.source}`);
  if (result.documentationUrl) {
    lines.push(`Documentation: ${result.documentationUrl}`);
  }
  if (result.repositoryUrl) {
    lines.push(`Repository: ${result.repositoryUrl}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  if (result.content) {
    lines.push(result.content);
  } else {
    lines.push("No README content available.");
    if (result.documentationUrl) {
      lines.push(`\nVisit ${result.documentationUrl} for documentation.`);
    }
  }

  return lines.join("\n");
}

/**
 * Get package documentation (README) from a registry
 */
export async function getPackageDocs(
  input: GetPackageDocsInput,
): Promise<GetPackageDocsResult> {
  const { registry, package: packageName, version } = input;
  const urls = getDocumentationUrls(registry, packageName, version);

  const result: GetPackageDocsResult = {
    packageName,
    registry,
    version,
    content: "",
    source: "none",
    documentationUrl: urls.docs,
  };

  try {
    // Get metadata to find repository URL
    const client = getClient(registry);
    let repositoryUrl: string | undefined;

    try {
      const metadata = await client.getMetadata(packageName, version);
      repositoryUrl = metadata.repository;
      result.repositoryUrl = repositoryUrl;
    } catch {
      // Metadata fetch failed, continue without repository URL
    }

    // Try to get README from registry API first (where available)
    let content: string | null = null;

    switch (registry) {
      case "npm":
        content = await fetchNpmReadme(packageName);
        if (content) result.source = "registry";
        break;

      case "pypi":
        content = await fetchPypiDescription(packageName);
        if (content) result.source = "registry";
        break;

      case "cargo":
        content = await fetchCargoReadme(packageName);
        if (content) result.source = "registry";
        break;

      // These registries don't have README in API, skip to repository fetch
      case "maven":
      case "go":
      case "jsr":
      case "nuget":
      case "docker":
        break;
    }

    // If no content from registry and we have a repository URL, try fetching from GitHub
    if (!content && repositoryUrl) {
      content = await fetchReadmeFromRepository(repositoryUrl, version);
      if (content) result.source = "repository";
    }

    result.content = content || "";
    return result;
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Unknown error occurred";
    return {
      ...result,
      error: message,
    };
  }
}

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
  version: z.string().optional().describe(
    "Specific version to get documentation for (optional, defaults to latest)",
  ),
});

export function registerGetPackageDocsTool(server: McpServer): void {
  server.tool(
    "get_package_docs",
    `Get README documentation for a package from a registry.

Supported registries: ${supportedRegistries.join(", ")}

This tool fetches README content to help understand how to use a package.
For npm, PyPI, and Cargo, README is fetched directly from the registry API.
For Maven, Go, JSR, NuGet, and Docker, README is fetched from the package's GitHub repository.

Returns:
- README content (when available)
- Documentation URL for the registry's package page
- Repository URL (when available)

Examples:
- npm: lodash, @types/node
- maven: org.apache.commons:commons-lang3
- pypi: requests, django
- cargo: serde, tokio
- go: github.com/gin-gonic/gin
- jsr: @std/path
- nuget: Newtonsoft.Json
- docker: nginx, postgres, bitnami/redis`,
    inputSchema.shape,
    async ({ registry, package: packageName, version }) => {
      const result = await getPackageDocs({
        registry: registry as Registry,
        package: packageName,
        version,
      });

      return {
        content: [
          {
            type: "text",
            text: formatDocsResultAsText(result),
          },
        ],
        isError: !!result.error,
      };
    },
  );
}
