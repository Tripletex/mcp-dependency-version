/**
 * NVD (National Vulnerability Database) API v2.0 client
 *
 * Queries the NVD for CVEs by keyword, then filters results using
 * CPE configuration data to verify the package and version are affected.
 *
 * Raw responses are cached per-package so that checking multiple versions
 * of the same package (e.g. lodash@4.17.20 then lodash@4.17.21) only
 * requires one API call.
 *
 * API docs: https://nvd.nist.gov/developers/vulnerabilities
 * Rate limits: 5 req/30s without API key, 50 req/30s with API key
 */

import type { Registry, Severity, Vulnerability } from "../registries/types.ts";
import { vulnerabilityCache } from "./cache.ts";
import { fetchWithHeaders } from "./http.ts";
import { compareVersions } from "./version.ts";

const NVD_API_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0";

// === NVD API response types ===

interface NvdCvssMetricV31 {
  source: string;
  type: string;
  cvssData: {
    version: string;
    vectorString: string;
    baseScore: number;
    baseSeverity: string;
  };
}

interface NvdCvssMetricV2 {
  source: string;
  type: string;
  cvssData: {
    version: string;
    vectorString: string;
    baseScore: number;
  };
}

/** @internal Exported for testing. */
export interface NvdCpeMatch {
  vulnerable: boolean;
  criteria: string;
  versionStartIncluding?: string;
  versionStartExcluding?: string;
  versionEndIncluding?: string;
  versionEndExcluding?: string;
  matchCriteriaId: string;
}

interface NvdCveItem {
  cve: {
    id: string;
    published: string;
    lastModified: string;
    descriptions: { lang: string; value: string }[];
    metrics?: {
      cvssMetricV31?: NvdCvssMetricV31[];
      cvssMetricV2?: NvdCvssMetricV2[];
    };
    weaknesses?: {
      source: string;
      type: string;
      description: { lang: string; value: string }[];
    }[];
    configurations?: {
      nodes: {
        operator: string;
        negate: boolean;
        cpeMatch: NvdCpeMatch[];
      }[];
    }[];
    references?: { url: string; source?: string }[];
  };
}

interface NvdResponse {
  totalResults: number;
  vulnerabilities: NvdCveItem[];
}

// === Package name to NVD keyword mapping ===

/**
 * Extract the search keyword from a package name based on registry.
 * Returns a term suitable for NVD keyword search.
 */
function getSearchKeyword(
  packageName: string,
  registry: Registry,
): string {
  switch (registry) {
    case "maven": {
      // Use artifactId (groupId:artifactId)
      const parts = packageName.split(":");
      return parts.length > 1 ? parts[1] : packageName;
    }
    case "go": {
      // Use last path segment (github.com/gin-gonic/gin -> gin)
      const segments = packageName.split("/");
      return segments[segments.length - 1];
    }
    case "npm": {
      // Remove @ scope prefix (@angular/core -> core)
      return packageName.replace(/^@[^/]+\//, "");
    }
    case "packagist": {
      // Use package part (vendor/package -> package)
      const parts = packageName.split("/");
      return parts.length > 1 ? parts[1] : packageName;
    }
    default:
      return packageName;
  }
}

// === CPE matching utilities ===

/**
 * Normalize a name for CPE comparison: lowercase, strip separators.
 */
function normalizeCpeName(name: string): string {
  return name.toLowerCase().replace(/[._-]+/g, "");
}

/**
 * Check if a CPE criteria string references the given package.
 *
 * CPE 2.3 format:
 *   cpe:2.3:part:vendor:product:version:update:edition:language:sw_edition:target_sw:target_hw:other
 * Indices:  0    1    2     3      4       5      6       7        8          9          10       11
 *
 * @internal Exported for testing.
 */
export function cpeMatchesPackage(
  cpeCriteria: string,
  packageName: string,
  registry: Registry,
): boolean {
  const parts = cpeCriteria.split(":");
  if (parts.length < 5) return false;

  const cpeProduct = parts[4];
  if (cpeProduct === "*") return false; // Wildcard product is too broad

  const keyword = getSearchKeyword(packageName, registry);
  const normalizedProduct = normalizeCpeName(cpeProduct);
  const normalizedKeyword = normalizeCpeName(keyword);

  return (
    normalizedProduct === normalizedKeyword ||
    normalizedProduct.includes(normalizedKeyword) ||
    normalizedKeyword.includes(normalizedProduct)
  );
}

/**
 * Check if a specific version falls within a CPE version range.
 *
 * @internal Exported for testing.
 */
export function versionInRange(version: string, match: NvdCpeMatch): boolean {
  const hasRangeConstraint = match.versionStartIncluding !== undefined ||
    match.versionStartExcluding !== undefined ||
    match.versionEndIncluding !== undefined ||
    match.versionEndExcluding !== undefined;

  if (hasRangeConstraint) {
    if (
      match.versionStartIncluding &&
      compareVersions(version, match.versionStartIncluding) < 0
    ) {
      return false;
    }
    if (
      match.versionStartExcluding &&
      compareVersions(version, match.versionStartExcluding) <= 0
    ) {
      return false;
    }
    if (
      match.versionEndIncluding &&
      compareVersions(version, match.versionEndIncluding) > 0
    ) {
      return false;
    }
    if (
      match.versionEndExcluding &&
      compareVersions(version, match.versionEndExcluding) >= 0
    ) {
      return false;
    }
    return true;
  }

  // No range constraints — check for exact version in CPE string
  const cpeParts = match.criteria.split(":");
  const cpeVersion = cpeParts.length > 5 ? cpeParts[5] : "*";

  if (cpeVersion !== "*" && cpeVersion !== "-") {
    return compareVersions(version, cpeVersion) === 0;
  }

  // Wildcard version with no range constraints — all versions affected
  return true;
}

/**
 * Check if a CVE affects a specific package and version by examining
 * its CPE configuration data.
 */
function cveAffectsVersion(
  cve: NvdCveItem,
  packageName: string,
  version: string,
  registry: Registry,
): boolean {
  // Require CPE configuration data to avoid false positives
  if (!cve.cve.configurations?.length) {
    return false;
  }

  for (const config of cve.cve.configurations) {
    for (const node of config.nodes) {
      for (const match of node.cpeMatch) {
        if (!match.vulnerable) continue;
        if (
          cpeMatchesPackage(match.criteria, packageName, registry) &&
          versionInRange(version, match)
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

// === NVD response parsing ===

/**
 * Parse severity from NVD CVSS metrics, preferring v3.1 Primary scores.
 */
function parseNvdSeverity(
  cve: NvdCveItem,
): { severity: Severity | undefined; cvss: number | undefined } {
  // Prefer CVSS v3.1
  if (cve.cve.metrics?.cvssMetricV31?.length) {
    const metric = cve.cve.metrics.cvssMetricV31.find((m) =>
      m.type === "Primary"
    ) ||
      cve.cve.metrics.cvssMetricV31[0];

    const baseSeverity = metric.cvssData.baseSeverity.toUpperCase();
    const severity: Severity | undefined = baseSeverity === "LOW" ||
        baseSeverity === "MEDIUM" ||
        baseSeverity === "HIGH" ||
        baseSeverity === "CRITICAL"
      ? baseSeverity
      : undefined;

    return { severity, cvss: metric.cvssData.baseScore };
  }

  // Fall back to CVSS v2
  if (cve.cve.metrics?.cvssMetricV2?.length) {
    const metric = cve.cve.metrics.cvssMetricV2.find((m) =>
      m.type === "Primary"
    ) ||
      cve.cve.metrics.cvssMetricV2[0];
    const score = metric.cvssData.baseScore;

    let severity: Severity;
    if (score >= 9.0) severity = "CRITICAL";
    else if (score >= 7.0) severity = "HIGH";
    else if (score >= 4.0) severity = "MEDIUM";
    else severity = "LOW";

    return { severity, cvss: score };
  }

  return { severity: undefined, cvss: undefined };
}

/**
 * Parse an NVD CVE item into our Vulnerability type.
 */
function parseNvdVulnerability(cve: NvdCveItem): Vulnerability {
  const { severity, cvss } = parseNvdSeverity(cve);

  const description = cve.cve.descriptions.find((d) => d.lang === "en")?.value;

  // Extract CWE IDs
  const cweIds: string[] = [];
  if (cve.cve.weaknesses) {
    for (const weakness of cve.cve.weaknesses) {
      for (const desc of weakness.description) {
        if (desc.lang === "en" && desc.value.startsWith("CWE-")) {
          cweIds.push(desc.value);
        }
      }
    }
  }

  // Extract fixed versions and affected ranges from CPE configurations
  const fixedVersions: string[] = [];
  const rangeParts: string[] = [];

  if (cve.cve.configurations) {
    for (const config of cve.cve.configurations) {
      for (const node of config.nodes) {
        for (const match of node.cpeMatch) {
          if (!match.vulnerable) continue;
          if (match.versionEndExcluding) {
            fixedVersions.push(match.versionEndExcluding);
          }
          // Build affected range description from first matching entry
          if (rangeParts.length === 0) {
            if (match.versionStartIncluding) {
              rangeParts.push(`>=${match.versionStartIncluding}`);
            }
            if (match.versionStartExcluding) {
              rangeParts.push(`>${match.versionStartExcluding}`);
            }
            if (match.versionEndIncluding) {
              rangeParts.push(`<=${match.versionEndIncluding}`);
            }
            if (match.versionEndExcluding) {
              rangeParts.push(`<${match.versionEndExcluding}`);
            }
          }
        }
      }
    }
  }

  const uniqueFixed = [...new Set(fixedVersions)];

  return {
    id: cve.cve.id,
    summary: description
      ? description.length > 200
        ? description.substring(0, 200) + "..."
        : description
      : undefined,
    details: description,
    severity,
    cvss,
    cveIds: [cve.cve.id],
    fixedVersions: uniqueFixed.length > 0 ? uniqueFixed : undefined,
    affectedVersions: rangeParts.length > 0 ? rangeParts.join(", ") : undefined,
    publishedAt: cve.cve.published ? new Date(cve.cve.published) : undefined,
    references: cve.cve.references?.map((r) => r.url),
    source: "nvd",
    cweIds: cweIds.length > 0 ? cweIds : undefined,
  };
}

// === Per-package fetch with caching ===

/**
 * Fetch all NVD CVE items for a package (cached per-package).
 * The raw response is cached so that checking different versions
 * of the same package reuses the same API call.
 */
async function fetchNvdForPackage(
  packageName: string,
  registry: Registry,
): Promise<NvdCveItem[]> {
  const keyword = getSearchKeyword(packageName, registry);

  // Skip very short keywords that would produce too many false positives
  if (keyword.length < 3) {
    return [];
  }

  const cacheKey = `nvd:pkg:${registry}:${packageName}`;

  return await vulnerabilityCache.getOrSet(cacheKey, async () => {
    const params = new URLSearchParams({
      keywordSearch: keyword,
      keywordExactMatch: "",
      resultsPerPage: "50",
    });

    const url = `${NVD_API_URL}?${params.toString()}`;

    const headers: Record<string, string> = {};
    try {
      const apiKey = Deno.env.get("NVD_API_KEY");
      if (apiKey) {
        headers["apiKey"] = apiKey;
      }
    } catch {
      // Env access not available, continue without API key
    }

    try {
      const response = await fetchWithHeaders(url, { headers });
      if (!response.ok) return [];
      const data = (await response.json()) as NvdResponse;
      return data.vulnerabilities ?? [];
    } catch {
      return [];
    }
  }) as NvdCveItem[];
}

// === Public API ===

/**
 * Query NVD for vulnerabilities affecting a specific package and version.
 *
 * Fetches all CVEs for the package (cached per-package), then filters
 * by CPE configuration data to find those affecting the given version.
 *
 * Returns an empty array on API errors (NVD is a supplementary source).
 */
export async function queryNvd(
  packageName: string,
  version: string,
  registry: Registry,
): Promise<Vulnerability[]> {
  const items = await fetchNvdForPackage(packageName, registry);

  return items
    .filter((item) => cveAffectsVersion(item, packageName, version, registry))
    .map(parseNvdVulnerability);
}

/**
 * Look up a specific CVE by ID from NVD.
 * Used to enrich OSV results with authoritative CVSS scores.
 */
export async function lookupCve(
  cveId: string,
): Promise<Vulnerability | null> {
  const params = new URLSearchParams({ cveId });
  const url = `${NVD_API_URL}?${params.toString()}`;

  const headers: Record<string, string> = {};
  try {
    const apiKey = Deno.env.get("NVD_API_KEY");
    if (apiKey) {
      headers["apiKey"] = apiKey;
    }
  } catch {
    // Continue without API key
  }

  try {
    const response = await fetchWithHeaders(url, { headers });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as NvdResponse;

    if (!data.vulnerabilities?.length) {
      return null;
    }

    return parseNvdVulnerability(data.vulnerabilities[0]);
  } catch {
    return null;
  }
}
