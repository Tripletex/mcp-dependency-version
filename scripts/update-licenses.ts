/**
 * Rebuilds data/licenses.json by merging the SPDX License List with
 * category/copyleft data from the ScanCode LicenseDB.
 *
 * Run with:
 *   deno task update-licenses
 *
 * Intentionally not wired into the server — this is a manual refresh because
 * the upstream lists only change a few times per year and we want the check-in
 * to be reviewable.
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
  /** ScanCode LicenseDB category, verbatim (e.g., "Permissive", "Copyleft"). */
  category?: string;
  /**
   * Whether the license imposes copyleft reciprocity. True for ScanCode
   * categories "Copyleft" and "Copyleft Limited". Omitted when no ScanCode
   * mapping was found for the SPDX ID.
   */
  isCopyleft?: boolean;
  /** ScanCode's internal license key, for cross-referencing. */
  scancodeKey?: string;
}

export interface LicenseDataset {
  generatedAt: string;
  sources: LicenseSource[];
  licenses: Record<string, LicenseEntry>;
}

interface SpdxSummaryLicense {
  licenseId: string;
  name: string;
  reference?: string;
  isOsiApproved?: boolean;
  isDeprecatedLicenseId?: boolean;
  seeAlso?: string[];
}

interface SpdxSummaryResponse {
  licenseListVersion: string;
  releaseDate?: string;
  licenses: SpdxSummaryLicense[];
}

interface ScancodeEntry {
  license_key: string;
  category?: string;
  spdx_license_key?: string;
  other_spdx_license_keys?: string[];
  is_deprecated?: boolean;
  is_exception?: boolean;
}

const SPDX_URL = "https://spdx.org/licenses/licenses.json";
const SCANCODE_URL = "https://scancode-licensedb.aboutcode.org/index.json";

const COPYLEFT_CATEGORIES: ReadonlySet<string> = new Set([
  "Copyleft",
  "Copyleft Limited",
]);

export class LicenseDatasetBuilder {
  constructor(
    private readonly spdxUrl: string = SPDX_URL,
    private readonly scancodeUrl: string = SCANCODE_URL,
  ) {}

  async build(): Promise<LicenseDataset> {
    const [spdx, scancode] = await Promise.all([
      this.fetchJson<SpdxSummaryResponse>(this.spdxUrl),
      this.fetchJson<ScancodeEntry[]>(this.scancodeUrl),
    ]);

    const now = new Date().toISOString();
    const scancodeBySpdx = this.indexScancode(scancode);

    const licenses: Record<string, LicenseEntry> = {};
    for (const raw of spdx.licenses) {
      const entry: LicenseEntry = {
        licenseId: raw.licenseId,
        name: raw.name,
        reference: raw.reference,
        isOsiApproved: raw.isOsiApproved ?? false,
        isDeprecated: raw.isDeprecatedLicenseId ?? false,
        seeAlso: raw.seeAlso ?? [],
      };

      const scan = scancodeBySpdx.get(raw.licenseId);
      if (scan) {
        entry.category = scan.category;
        if (scan.category) {
          entry.isCopyleft = COPYLEFT_CATEGORIES.has(scan.category);
        }
        entry.scancodeKey = scan.license_key;
      }

      licenses[raw.licenseId] = entry;
    }

    const sources: LicenseSource[] = [
      {
        name: "SPDX License List",
        url: this.spdxUrl,
        version: spdx.licenseListVersion,
        license: "CC0-1.0",
        attribution:
          "SPDX License List by the SPDX Workgroup, a Linux Foundation Project (https://spdx.org/licenses/). The SPDX License List identifiers and summary metadata are treated as public-domain reference data.",
        fetchedAt: now,
      },
      {
        name: "ScanCode LicenseDB",
        url: this.scancodeUrl,
        license: "CC-BY-4.0",
        attribution:
          "ScanCode LicenseDB by nexB and the AboutCode project (https://scancode-licensedb.aboutcode.org/), licensed under CC-BY-4.0. Category and copyleft classification are derived from the LicenseDB `category` field.",
        fetchedAt: now,
      },
    ];

    return { generatedAt: now, sources, licenses };
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
      );
    }
    return (await response.json()) as T;
  }

  /**
   * Index ScanCode entries by SPDX ID. ScanCode exposes both a primary
   * spdx_license_key and an other_spdx_license_keys array; the primary wins
   * when both reference the same SPDX ID, since that's the canonical mapping.
   */
  private indexScancode(
    entries: ScancodeEntry[],
  ): Map<string, ScancodeEntry> {
    const primary = new Map<string, ScancodeEntry>();
    const secondary = new Map<string, ScancodeEntry>();

    for (const entry of entries) {
      if (entry.spdx_license_key && !primary.has(entry.spdx_license_key)) {
        primary.set(entry.spdx_license_key, entry);
      }
      for (const alt of entry.other_spdx_license_keys ?? []) {
        if (!secondary.has(alt)) {
          secondary.set(alt, entry);
        }
      }
    }

    const merged = new Map(secondary);
    for (const [k, v] of primary) {
      merged.set(k, v);
    }
    return merged;
  }
}

async function writeDataset(dataset: LicenseDataset, path: string) {
  const json = JSON.stringify(dataset, null, 2);
  await Deno.writeTextFile(path, json + "\n");
}

function summary(dataset: LicenseDataset): string {
  const total = Object.keys(dataset.licenses).length;
  const withCategory =
    Object.values(dataset.licenses).filter((l) => l.category).length;
  const copyleft =
    Object.values(dataset.licenses).filter((l) => l.isCopyleft).length;
  return `${total} licenses (${withCategory} with ScanCode category, ${copyleft} copyleft)`;
}

if (import.meta.main) {
  const here = dirname(fromFileUrl(import.meta.url));
  const outPath = join(here, "..", "data", "licenses.json");

  console.log("Fetching SPDX License List and ScanCode LicenseDB...");
  const builder = new LicenseDatasetBuilder();
  const dataset = await builder.build();

  await Deno.mkdir(dirname(outPath), { recursive: true });
  await writeDataset(dataset, outPath);

  const rel = outPath.replace(Deno.cwd() + "/", "");
  console.log(`Wrote ${rel} -- ${summary(dataset)}`);
}
