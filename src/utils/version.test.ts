import { assert, assertEquals } from "@std/assert";
import {
  compareVersions,
  filterByPrefix,
  findLatestPrerelease,
  findLatestStable,
  getUpdateType,
  isPrerelease,
  parseVersion,
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
