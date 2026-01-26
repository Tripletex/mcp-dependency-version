/**
 * Supported package registries
 */
export type Registry =
  | "npm"
  | "maven"
  | "pypi"
  | "cargo"
  | "go"
  | "jsr"
  | "nuget"
  | "docker";

/**
 * Version information for a package
 */
export interface VersionInfo {
  packageName: string;
  registry: Registry;
  latestStable: string;
  latestPrerelease?: string;
  publishedAt?: Date;
  deprecated?: boolean;
  deprecationMessage?: string;
  /** SHA256 digest for Docker images - provides immutable reference */
  digest?: string;
  /** Secure reference using digest (e.g., nginx@sha256:abc123...) */
  secureReference?: string;
  /** Security notes about tag mutability and recommended practices */
  securityNotes?: string[];
}

/**
 * Detailed information about a specific version
 */
export interface VersionDetail {
  version: string;
  publishedAt?: Date;
  isPrerelease: boolean;
  isDeprecated: boolean;
  yanked?: boolean;
  /** SHA256 digest for Docker images - provides immutable reference */
  digest?: string;
}

/**
 * Package metadata
 */
export interface PackageMetadata {
  name: string;
  registry: Registry;
  description?: string;
  license?: string;
  homepage?: string;
  repository?: string;
}

/**
 * Options for version lookup
 */
export interface LookupOptions {
  includePrerelease?: boolean;
  versionPrefix?: string;
}

/**
 * Interface for registry clients
 */
export interface RegistryClient {
  readonly registry: Registry;
  lookupVersion(
    packageName: string,
    options?: LookupOptions,
  ): Promise<VersionInfo>;
  listVersions(packageName: string): Promise<VersionDetail[]>;
  getMetadata(packageName: string, version?: string): Promise<PackageMetadata>;
}

/**
 * Vulnerability severity levels
 */
export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/**
 * Vulnerability information from OSV
 */
export interface Vulnerability {
  id: string;
  summary?: string;
  details?: string;
  severity?: Severity;
  cvss?: number;
  cveIds?: string[];
  affectedVersions?: string;
  fixedVersions?: string[];
  publishedAt?: Date;
  references?: string[];
}

/**
 * Result of vulnerability check
 */
export interface VulnerabilityCheckResult {
  packageName: string;
  version: string;
  registry: Registry;
  vulnerabilities: Vulnerability[];
  hasVulnerabilities: boolean;
}

/**
 * Dependency information for analysis
 */
export interface DependencyInfo {
  name: string;
  currentVersion: string;
  latestVersion?: string;
  updateType?: "major" | "minor" | "patch" | "prerelease" | "none";
  vulnerabilities?: Vulnerability[];
  deprecated?: boolean;
}

/**
 * Result of dependency analysis
 */
export interface DependencyAnalysisResult {
  registry: Registry;
  dependencies: DependencyInfo[];
  totalDependencies: number;
  outdatedCount: number;
  vulnerableCount: number;
}
