/**
 * Tool input/output types
 */

import type {
  Registry,
  Severity,
  Vulnerability,
  DependencyInfo,
} from "../registries/types.ts";

// === lookup_version ===

export interface LookupVersionInput {
  registry: Registry;
  package: string;
  includePrerelease?: boolean;
  versionPrefix?: string;
}

export interface LookupVersionOutput {
  packageName: string;
  registry: Registry;
  latestStable: string;
  latestPrerelease?: string;
  publishedAt?: string;
  deprecated?: boolean;
  deprecationMessage?: string;
}

// === list_versions ===

export interface ListVersionsInput {
  registry: Registry;
  package: string;
  limit?: number;
}

export interface ListVersionsOutput {
  packageName: string;
  registry: Registry;
  versions: {
    version: string;
    publishedAt?: string;
    isPrerelease: boolean;
    isDeprecated: boolean;
    yanked?: boolean;
  }[];
  totalCount: number;
}

// === check_vulnerabilities ===

export interface CheckVulnerabilitiesInput {
  registry: Registry;
  package: string;
  version: string;
  severityThreshold?: Severity;
}

export interface CheckVulnerabilitiesOutput {
  packageName: string;
  version: string;
  registry: Registry;
  vulnerabilities: Vulnerability[];
  totalCount: number;
  hasVulnerabilities: boolean;
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

// === analyze_dependencies ===

export interface AnalyzeDependenciesInput {
  content: string;
  registry: Registry;
  checkVulnerabilities?: boolean;
}

export interface AnalyzeDependenciesOutput {
  registry: Registry;
  dependencies: (DependencyInfo & {
    latestVersion: string;
    updateAvailable: boolean;
  })[];
  summary: {
    total: number;
    outdated: number;
    vulnerable: number;
    deprecated: number;
    majorUpdates: number;
    minorUpdates: number;
    patchUpdates: number;
  };
}
