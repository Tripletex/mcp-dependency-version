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
  /**
   * True when this result was produced by resolving a floating reference
   * (a git branch, or a mutable named tag/channel). Signals that the pin
   * will drift over time and that "updating" means re-resolving the
   * reference rather than moving to a newer release.
   */
  isMutable?: boolean;
  /** The floating reference that was resolved (e.g., "main", "next", "latest"). */
  resolvedReference?: string;
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
 * A single dependency declared by a specific version of a package.
 *
 * `registry` is where the dependency itself lives, not the parent — e.g. a JSR
 * package can declare an npm dependency, in which case `registry === "npm"`.
 * `scope` distinguishes npm's dependency kinds; JSR packages flag everything
 * as runtime since the registry does not draw the distinction.
 */
export interface VersionDependency {
  name: string;
  registry: Registry;
  constraint: string;
  scope?: "runtime" | "peer" | "optional" | "dev";
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
  /**
   * List the dependencies declared by a specific published version of the
   * package. Returns `undefined` for registries that do not expose
   * version-level dependency metadata.
   */
  getVersionDependencies?(
    packageName: string,
    version: string,
  ): Promise<VersionDependency[] | undefined>;
  /**
   * Resolve a floating reference -- a git branch/ref, or a mutable named tag or
   * channel -- to its current concrete target. Unlike `lookupVersion` (which
   * finds the newest version), this dereferences a specific named pointer:
   *   - github-actions: a branch/tag/sha -> commit SHA (in `digest`)
   *   - npm: a dist-tag (latest/next/beta) -> concrete version
   *   - docker: a tag (latest/stable) -> sha256 digest
   * Implemented only by registries that have a floating-pointer concept.
   * Results carry `isMutable: true`.
   */
  resolveReference?(
    packageName: string,
    reference: string,
    options?: LookupOptions,
  ): Promise<VersionInfo>;
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
