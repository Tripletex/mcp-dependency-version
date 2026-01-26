/**
 * NuGet .csproj dependency parser
 * Parses PackageReference elements from .csproj files
 */

import type { DependencyParser, ParsedDependency } from "./types.ts";

/**
 * Parse .csproj PackageReference dependencies
 *
 * Supports formats:
 * - <PackageReference Include="Package.Name" Version="1.0.0" />
 * - <PackageReference Include="Package.Name" Version="1.0.0"></PackageReference>
 * - <PackageReference Include="Package.Name">
 *     <Version>1.0.0</Version>
 *   </PackageReference>
 */
function parse(content: string): ParsedDependency[] {
  const deps: ParsedDependency[] = [];

  // Match PackageReference with Version as attribute
  // <PackageReference Include="Name" Version="1.0.0" />
  const attrRegex =
    /<PackageReference\s+[^>]*Include\s*=\s*["']([^"']+)["'][^>]*Version\s*=\s*["']([^"']+)["'][^>]*\/?>/gi;

  // Also match when Version comes before Include
  const attrRegex2 =
    /<PackageReference\s+[^>]*Version\s*=\s*["']([^"']+)["'][^>]*Include\s*=\s*["']([^"']+)["'][^>]*\/?>/gi;

  // Match PackageReference with Version as child element
  // <PackageReference Include="Name">
  //   <Version>1.0.0</Version>
  // </PackageReference>
  const elementRegex =
    /<PackageReference\s+[^>]*Include\s*=\s*["']([^"']+)["'][^>]*>[\s\S]*?<Version>([^<]+)<\/Version>[\s\S]*?<\/PackageReference>/gi;

  let match: RegExpExecArray | null;

  // Parse attribute format (Include before Version)
  while ((match = attrRegex.exec(content)) !== null) {
    const name = match[1];
    const version = match[2].trim();

    // Skip variable references like $(Version) or *
    if (!version.includes("$") && !version.includes("*")) {
      deps.push({ name, version });
    }
  }

  // Parse attribute format (Version before Include)
  while ((match = attrRegex2.exec(content)) !== null) {
    const version = match[1].trim();
    const name = match[2];

    // Skip variable references and check for duplicates
    if (!version.includes("$") && !version.includes("*")) {
      if (!deps.some((d) => d.name === name)) {
        deps.push({ name, version });
      }
    }
  }

  // Parse element format
  while ((match = elementRegex.exec(content)) !== null) {
    const name = match[1];
    const version = match[2].trim();

    // Skip variable references and check for duplicates
    if (!version.includes("$") && !version.includes("*")) {
      if (!deps.some((d) => d.name === name)) {
        deps.push({ name, version });
      }
    }
  }

  return deps;
}

export const nugetParser: DependencyParser = {
  fileType: ".csproj",
  registry: "nuget",
  parse,
};
