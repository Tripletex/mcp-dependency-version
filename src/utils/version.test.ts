import { assert, assertEquals } from "@std/assert";
import {
  compareVersions,
  filterByPrefix,
  findLatestPrerelease,
  findLatestStable,
  getUpdateType,
  isPrerelease,
  parseVersion,
  resolveLatestVersions,
  satisfiesConstraint,
  sortVersionsDescending,
} from "./version.ts";

Deno.test("parseVersion - parses basic semver", () => {
  const result = parseVersion("1.2.3");
  assertEquals(result?.major, 1);
  assertEquals(result?.minor, 2);
  assertEquals(result?.patch, 3);
  assertEquals(result?.prerelease, []);
});

Deno.test("parseVersion - handles leading v", () => {
  const result = parseVersion("v1.2.3");
  assertEquals(result?.major, 1);
  assertEquals(result?.minor, 2);
  assertEquals(result?.patch, 3);
});

Deno.test("parseVersion - parses prerelease", () => {
  const result = parseVersion("1.2.3-alpha.1");
  assertEquals(result?.prerelease, ["alpha", "1"]);
});

Deno.test("parseVersion - parses build metadata", () => {
  const result = parseVersion("1.2.3+build.123");
  assertEquals(result?.build, ["build", "123"]);
});

Deno.test("parseVersion - handles two-part versions", () => {
  const result = parseVersion("1.2");
  assertEquals(result?.major, 1);
  assertEquals(result?.minor, 2);
  assertEquals(result?.patch, 0);
});

Deno.test("parseVersion - handles single number", () => {
  const result = parseVersion("1");
  assertEquals(result?.major, 1);
  assertEquals(result?.minor, 0);
  assertEquals(result?.patch, 0);
});

Deno.test("isPrerelease - identifies prereleases", () => {
  assert(isPrerelease("1.0.0-alpha"));
  assert(isPrerelease("1.0.0-beta.1"));
  assert(isPrerelease("1.0.0-rc.1"));
  assert(isPrerelease("2.0.0-SNAPSHOT"));
});

Deno.test("isPrerelease - identifies stable versions", () => {
  assert(!isPrerelease("1.0.0"));
  assert(!isPrerelease("2.3.4"));
  assert(!isPrerelease("v1.0.0"));
});

Deno.test("isPrerelease - Spring milestone (-M4) is prerelease", () => {
  assert(isPrerelease("2.0.0-M4"));
  assert(isPrerelease("3.0.0-M1"));
  assert(isPrerelease("1.0.0.M4")); // Maven dot-style
});

Deno.test("isPrerelease - Spring RELEASE / Final / GA are stable", () => {
  assert(!isPrerelease("1.5.22.RELEASE"));
  assert(!isPrerelease("5.6.15.Final"));
  assert(!isPrerelease("6.0.0.GA"));
  assert(!isPrerelease("2021.0.5.SR3")); // Spring Cloud Service Release
});

Deno.test("isPrerelease - Guava variants (-jre, -android) are stable", () => {
  assert(!isPrerelease("33.0.0-jre"));
  assert(!isPrerelease("33.0.0-android"));
  assert(!isPrerelease("31.1-jre"));
});

Deno.test("isPrerelease - PostgreSQL JDBC jre7/jre8 variants are stable", () => {
  // postgresql JDBC uses Maven dot-style with Java version variant
  assert(!isPrerelease("9.4.1212.jre7"));
  assert(!isPrerelease("9.4.1212.jre8"));
  assert(!isPrerelease("9.4.1212.android7"));
});

Deno.test("isPrerelease - jgit OSGi timestamped release marker", () => {
  // Eclipse jgit uses major.minor.patch.<timestamp>-r for stable releases
  assert(!isPrerelease("7.6.0.202603022253-r"));
  assert(!isPrerelease("7.5.0.202402261905-r"));
});

Deno.test("isPrerelease - numeric-only Maven qualifier (timestamp) is prerelease", () => {
  // jackson-bom mirror artifact: 4-part with raw numeric timestamp suffix
  // is NOT a normal release — treat as prerelease/dev artifact
  assert(isPrerelease("2.9.9.20190807"));
  assert(isPrerelease("1.0.0.20240115"));
});

Deno.test("isPrerelease - legacy Guava r09 tag is prerelease", () => {
  // Old Guava versions like r07, r08, r09 (no semver) — exclude from "latest"
  assert(isPrerelease("r09"));
  assert(isPrerelease("r07"));
});

Deno.test("isPrerelease - Apache incubating is stable", () => {
  assert(!isPrerelease("1.0.0-incubating"));
});

Deno.test("isPrerelease - PEP 440 prerelease styles", () => {
  assert(isPrerelease("1.0a1"));
  assert(isPrerelease("1.0b1"));
  assert(isPrerelease("1.0rc1"));
  assert(isPrerelease("1.0.dev1"));
  assert(isPrerelease("1.0.0.dev0"));
});

Deno.test("parseVersion - parses Maven dot-style qualifier", () => {
  const result = parseVersion("1.0.0.RELEASE");
  assertEquals(result?.major, 1);
  assertEquals(result?.minor, 0);
  assertEquals(result?.patch, 0);
  assertEquals(result?.prerelease, ["RELEASE"]);
});

Deno.test("parseVersion - parses Maven dot-style milestone", () => {
  const result = parseVersion("2.0.0.M4");
  assertEquals(result?.major, 2);
  assertEquals(result?.prerelease, ["M4"]);
});

Deno.test("parseVersion - parses Spring Cloud SR version", () => {
  const result = parseVersion("2021.0.5.SR3");
  assertEquals(result?.major, 2021);
  assertEquals(result?.minor, 0);
  assertEquals(result?.patch, 5);
  assertEquals(result?.prerelease, ["SR3"]);
});

Deno.test("parseVersion - parses Maven 4-part numeric qualifier", () => {
  // jackson-bom mirror style: timestamp as qualifier
  const result = parseVersion("2.9.9.20190807");
  assertEquals(result?.major, 2);
  assertEquals(result?.minor, 9);
  assertEquals(result?.patch, 9);
  assertEquals(result?.prerelease, ["20190807"]);
});

Deno.test("parseVersion - parses jgit OSGi-style version", () => {
  const result = parseVersion("7.6.0.202603022253-r");
  assertEquals(result?.major, 7);
  assertEquals(result?.minor, 6);
  assertEquals(result?.patch, 0);
  assertEquals(result?.prerelease, ["202603022253-r"]);
});

Deno.test("compareVersions - parseable beats non-parseable", () => {
  // Guava case: legacy "r09" must NOT sort above modern "33.5.0-jre"
  assert(compareVersions("33.5.0-jre", "r09") > 0);
  assert(compareVersions("r09", "33.5.0-jre") < 0);
});

Deno.test("compareVersions - jackson-bom case (4-part numeric vs semver)", () => {
  // 2.21.0 must sort above 2.9.9.20190807 (mirror artifact)
  assert(compareVersions("2.21.0", "2.9.9.20190807") > 0);
});

Deno.test("findLatestStable - excludes Guava r09 legacy tag", () => {
  const versions = ["r07", "r08", "r09", "33.5.0-jre", "33.4.0-jre"];
  // r09 is classified as prerelease (not in stable variant list);
  // jre is stable variant; latest = 33.5.0-jre
  assertEquals(findLatestStable(versions), "33.5.0-jre");
});

Deno.test("findLatestStable - PostgreSQL JDBC excludes mirror artifacts", () => {
  // Real-world: postgresql 42.7.10 is latest, NOT 9.4.1212.jre7
  const versions = ["42.7.10", "42.7.9", "9.4.1212.jre7", "9.4.1212.jre8"];
  assertEquals(findLatestStable(versions), "42.7.10");
});

Deno.test("findLatestStable - jackson-bom excludes timestamped mirror", () => {
  // 2.9.9.20190807 is a stale mirror artifact; 2.21.1 is real latest
  const versions = ["2.21.1", "2.21.0", "2.20.0", "2.9.9.20190807"];
  assertEquals(findLatestStable(versions), "2.21.1");
});

Deno.test("findLatestStable - jgit picks highest -r release", () => {
  const versions = [
    "7.6.0.202603022253-r",
    "7.5.0.202402261905-r",
    "7.4.0.202401111111-r",
  ];
  assertEquals(findLatestStable(versions), "7.6.0.202603022253-r");
});

Deno.test("findLatestStable - excludes Spring milestones", () => {
  const versions = ["2.0.0-M4", "2.0.0-M3", "1.1.4", "1.1.3"];
  assertEquals(findLatestStable(versions), "1.1.4");
});

Deno.test("findLatestStable - includes Guava jre variant", () => {
  const versions = ["33.0.0-jre", "33.0.0-android", "32.1.3-jre"];
  // jre and android variants are stable, sorted by version descending
  assertEquals(findLatestStable(versions), "33.0.0-jre");
});

// === resolveLatestVersions ===

Deno.test("resolveLatestVersions - returns latest stable when available", () => {
  const result = resolveLatestVersions(["1.0.0", "1.1.0", "2.0.0"]);
  assertEquals(result, { latestStable: "2.0.0" });
});

Deno.test("resolveLatestVersions - returns null when no stable and no prerelease allowed", () => {
  const result = resolveLatestVersions(["1.0.0-alpha", "1.0.0-beta"]);
  assertEquals(result, null);
});

Deno.test("resolveLatestVersions - falls back to prerelease when includePrerelease=true and no stable", () => {
  // Spring AI 2.x case: only milestones in 2.x line
  const result = resolveLatestVersions(["2.0.0-M3", "2.0.0-M4"], {
    includePrerelease: true,
  });
  assertEquals(result?.latestStable, "2.0.0-M4");
  assertEquals(result?.latestPrerelease, "2.0.0-M4");
});

Deno.test("resolveLatestVersions - includes latestPrerelease when newer than stable", () => {
  const result = resolveLatestVersions(["1.0.0", "2.0.0", "3.0.0-rc.1"], {
    includePrerelease: true,
  });
  assertEquals(result?.latestStable, "2.0.0");
  assertEquals(result?.latestPrerelease, "3.0.0-rc.1");
});

Deno.test("resolveLatestVersions - omits latestPrerelease when older than stable", () => {
  const result = resolveLatestVersions(["1.0.0-rc.1", "2.0.0"], {
    includePrerelease: true,
  });
  assertEquals(result?.latestStable, "2.0.0");
  assertEquals(result?.latestPrerelease, undefined);
});

Deno.test("resolveLatestVersions - uses fallbackStable when no stable in versions", () => {
  // npm dist-tag scenario
  const result = resolveLatestVersions(["1.0.0-alpha"], {
    fallbackStable: "1.0.0",
  });
  assertEquals(result?.latestStable, "1.0.0");
});

Deno.test("resolveLatestVersions - prerelease fallback wins over fallbackStable when both exist", () => {
  // When both a fallbackStable and a prerelease (allowed) are available,
  // the fallback is preferred since it represents a stable release
  const result = resolveLatestVersions(["1.0.0-alpha"], {
    includePrerelease: true,
    fallbackStable: "1.0.0",
  });
  assertEquals(result?.latestStable, "1.0.0");
});

Deno.test("compareVersions - basic comparison", () => {
  assert(compareVersions("2.0.0", "1.0.0") > 0);
  assert(compareVersions("1.1.0", "1.0.0") > 0);
  assert(compareVersions("1.0.1", "1.0.0") > 0);
  assert(compareVersions("1.0.0", "1.0.0") === 0);
  assert(compareVersions("1.0.0", "2.0.0") < 0);
});

Deno.test("compareVersions - prerelease ordering", () => {
  // Stable > prerelease
  assert(compareVersions("1.0.0", "1.0.0-alpha") > 0);

  // Alphabetic prerelease comparison
  assert(compareVersions("1.0.0-beta", "1.0.0-alpha") > 0);

  // Numeric prerelease comparison
  assert(compareVersions("1.0.0-alpha.2", "1.0.0-alpha.1") > 0);
});

Deno.test("sortVersionsDescending - sorts correctly", () => {
  const versions = ["1.0.0", "2.1.0", "1.5.0", "2.0.0-alpha", "2.0.0"];
  const sorted = sortVersionsDescending(versions);
  assertEquals(sorted, ["2.1.0", "2.0.0", "2.0.0-alpha", "1.5.0", "1.0.0"]);
});

Deno.test("findLatestStable - finds stable version", () => {
  const versions = ["1.0.0", "2.0.0-alpha", "1.5.0", "2.0.0-beta"];
  assertEquals(findLatestStable(versions), "1.5.0");
});

Deno.test("findLatestStable - returns null when no stable", () => {
  const versions = ["1.0.0-alpha", "1.0.0-beta"];
  assertEquals(findLatestStable(versions), null);
});

Deno.test("findLatestPrerelease - finds prerelease version", () => {
  const versions = ["1.0.0", "2.0.0-alpha", "1.5.0", "2.0.0-beta"];
  assertEquals(findLatestPrerelease(versions), "2.0.0-beta");
});

Deno.test("filterByPrefix - filters versions", () => {
  const versions = ["1.0.0", "1.1.0", "2.0.0", "1.5.0"];
  const filtered = filterByPrefix(versions, "1.");
  assertEquals(filtered, ["1.0.0", "1.1.0", "1.5.0"]);
});

Deno.test("filterByPrefix - handles v prefix", () => {
  const versions = ["v1.0.0", "v1.1.0", "v2.0.0"];
  const filtered = filterByPrefix(versions, "1.");
  assertEquals(filtered, ["v1.0.0", "v1.1.0"]);
});

Deno.test("getUpdateType - identifies major update", () => {
  assertEquals(getUpdateType("1.0.0", "2.0.0"), "major");
});

Deno.test("getUpdateType - identifies minor update", () => {
  assertEquals(getUpdateType("1.0.0", "1.1.0"), "minor");
});

Deno.test("getUpdateType - identifies patch update", () => {
  assertEquals(getUpdateType("1.0.0", "1.0.1"), "patch");
});

Deno.test("getUpdateType - identifies prerelease update", () => {
  assertEquals(getUpdateType("1.0.0-alpha", "1.0.0-beta"), "prerelease");
});

Deno.test("getUpdateType - identifies no update needed", () => {
  assertEquals(getUpdateType("1.0.0", "1.0.0"), "none");
  assertEquals(getUpdateType("2.0.0", "1.0.0"), "none");
});

Deno.test("satisfiesConstraint - exact match", () => {
  assert(satisfiesConstraint("1.0.0", "1.0.0"));
  assert(!satisfiesConstraint("1.0.1", "1.0.0"));
});

Deno.test("satisfiesConstraint - caret range", () => {
  assert(satisfiesConstraint("1.2.3", "^1.0.0"));
  assert(satisfiesConstraint("1.9.0", "^1.0.0"));
  assert(!satisfiesConstraint("2.0.0", "^1.0.0"));
  assert(!satisfiesConstraint("0.9.0", "^1.0.0"));
});

Deno.test("satisfiesConstraint - tilde range", () => {
  assert(satisfiesConstraint("1.2.3", "~1.2.0"));
  assert(satisfiesConstraint("1.2.9", "~1.2.0"));
  assert(!satisfiesConstraint("1.3.0", "~1.2.0"));
});

Deno.test("satisfiesConstraint - comparison operators", () => {
  assert(satisfiesConstraint("1.5.0", ">=1.0.0"));
  assert(satisfiesConstraint("1.0.0", ">=1.0.0"));
  assert(!satisfiesConstraint("0.9.0", ">=1.0.0"));

  assert(satisfiesConstraint("0.9.0", "<1.0.0"));
  assert(!satisfiesConstraint("1.0.0", "<1.0.0"));

  assert(satisfiesConstraint("1.0.0", "<=1.0.0"));
  assert(satisfiesConstraint("0.9.0", "<=1.0.0"));

  assert(satisfiesConstraint("1.0.1", ">1.0.0"));
  assert(!satisfiesConstraint("1.0.0", ">1.0.0"));
});
