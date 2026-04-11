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
  | "docker"
  | "rubygems"
  | "packagist"
  | "pub"
  | "swift"
  | "github-actions";

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
  /** Immutable identifier: SHA256 digest for Docker images, commit SHA for GitHub Actions */
  digest?: string;
  /** Secure pinned reference (e.g., nginx@sha256:abc123... or actions/checkout@abc123 # v4.2.0) */
  secureReference?: string;
  /** Security notes about tag/version mutability and recommended practices */
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
  /** Immutable identifier: SHA256 digest for Docker images, commit SHA for GitHub Actions */
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
 * Vulnerability information from OSV and/or NVD
 */
export interface Vulnerability {
  id: string;
  summary?: string;
  details?: string;
  severity?: Severity;
  cvss?: number;
  cveIds?: string[];
  cweIds?: string[];
  affectedVersions?: string;
  fixedVersions?: string[];
  publishedAt?: Date;
  references?: string[];
  /** Which database(s) reported this vulnerability */
  source?: "osv" | "nvd" | "osv+nvd";
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
