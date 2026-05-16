/**
 * Loader for the baked-in license dataset at data/licenses.json.
 *
 * The dataset merges the SPDX License List with ScanCode LicenseDB categories.
 * It is rebuilt manually via `deno task update-licenses`.
 */

import { dirname, fromFileUrl, join } from "@std/path";

export interface LicenseSource {
  name: string;
  url: string;
  version?: string;
  license: string;
  attribution: string;
  fetchedAt: string;
}

export interface LicenseEntry {
  licenseId: string;
  name: string;
  reference?: string;
  isOsiApproved: boolean;
  isDeprecated: boolean;
  seeAlso: string[];
  category?: string;
  isCopyleft?: boolean;
  scancodeKey?: string;
}

export interface LicenseDataset {
  generatedAt: string;
  sources: LicenseSource[];
  licenses: Record<string, LicenseEntry>;
}

/**
 * Looks up SPDX licenses from the baked dataset. Tolerant to free-form strings
 * by splitting common separators (" OR ", " AND ", ",", "/") and matching each
 * token. Matching is case-insensitive against `licenseId`.
 */
export class LicenseRegistry {
  private readonly byIdLower: Map<string, LicenseEntry>;
  private readonly byNameLower: Map<string, LicenseEntry>;

  constructor(private readonly dataset: LicenseDataset) {
    this.byIdLower = new Map();
    this.byNameLower = new Map();
    for (const entry of Object.values(dataset.licenses)) {
      this.byIdLower.set(entry.licenseId.toLowerCase(), entry);
      // Index by full name too, so registries that return the name ("MIT License")
      // rather than the SPDX ID ("MIT") still resolve.
      this.byNameLower.set(entry.name.toLowerCase(), entry);
    }
  }

  get sources(): readonly LicenseSource[] {
    return this.dataset.sources;
  }

  get generatedAt(): string {
    return this.dataset.generatedAt;
  }

  /** Exact SPDX ID lookup (case-insensitive). */
  lookupById(licenseId: string): LicenseEntry | undefined {
    return this.byIdLower.get(licenseId.trim().toLowerCase());
  }

  /**
   * Parse a registry-reported license string into SPDX entries.
   * Handles common multi-license patterns:
   *   "MIT"                       -> [MIT]
   *   "MIT, Apache-2.0"           -> [MIT, Apache-2.0]
   *   "(MIT OR Apache-2.0)"       -> [MIT, Apache-2.0]
   *   "MIT AND Apache-2.0"        -> [MIT, Apache-2.0]
   *   "Apache License 2.0"        -> [Apache-2.0]  (by name)
   *   "Some Custom License"       -> []            (unresolved)
   */
  parse(raw: string): LicenseEntry[] {
    const cleaned = raw.replace(/[()]/g, " ").trim();
    if (!cleaned) return [];

    const tokens = cleaned
      .split(/\s+(?:OR|AND|or|and)\s+|[,/]|\sWITH\s/i)
      .map((t) => t.trim())
      .filter(Boolean);

    const seen = new Set<string>();
    const results: LicenseEntry[] = [];
    for (const token of tokens) {
      const entry = this.byIdLower.get(token.toLowerCase()) ??
        this.byNameLower.get(token.toLowerCase());
      if (entry && !seen.has(entry.licenseId)) {
        seen.add(entry.licenseId);
        results.push(entry);
      }
    }
    return results;
  }
}

let cached: LicenseRegistry | undefined;

/**
 * Load the baked dataset and return a shared LicenseRegistry.
 * The dataset is read once per process.
 */
export async function getLicenseRegistry(): Promise<LicenseRegistry> {
  if (cached) return cached;

  const here = dirname(fromFileUrl(import.meta.url));
  const dataPath = join(here, "..", "..", "data", "licenses.json");
  const text = await Deno.readTextFile(dataPath);
  const dataset = JSON.parse(text) as LicenseDataset;
  cached = new LicenseRegistry(dataset);
  return cached;
}

/** Only for tests: reset the in-process cache. */
export function resetLicenseRegistryCache(): void {
  cached = undefined;
}
