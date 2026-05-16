import { assert, assertEquals } from "@std/assert";
import { getLicenseRegistry } from "./licenses.ts";

Deno.test("LicenseRegistry - exposes sources with attribution", async () => {
  const registry = await getLicenseRegistry();
  assert(registry.sources.length >= 2);
  const names = registry.sources.map((s) => s.name);
  assert(names.includes("SPDX License List"));
  assert(names.includes("ScanCode LicenseDB"));
  for (const s of registry.sources) {
    assert(s.license, `source ${s.name} should declare a license`);
    assert(s.attribution, `source ${s.name} should declare attribution`);
  }
});

Deno.test("LicenseRegistry - resolves SPDX IDs case-insensitively", async () => {
  const registry = await getLicenseRegistry();
  const mit = registry.lookupById("MIT");
  assertEquals(mit?.licenseId, "MIT");
  assertEquals(mit?.isOsiApproved, true);
  assertEquals(mit?.isCopyleft, false);

  const mitLower = registry.lookupById("mit");
  assertEquals(mitLower?.licenseId, "MIT");
});

Deno.test("LicenseRegistry - flags copyleft licenses", async () => {
  const registry = await getLicenseRegistry();
  assertEquals(registry.lookupById("GPL-3.0-only")?.isCopyleft, true);
  assertEquals(registry.lookupById("AGPL-3.0-only")?.isCopyleft, true);
  assertEquals(registry.lookupById("LGPL-3.0-only")?.isCopyleft, true);
  assertEquals(registry.lookupById("MIT")?.isCopyleft, false);
  assertEquals(registry.lookupById("Apache-2.0")?.isCopyleft, false);
});

Deno.test("LicenseRegistry - surfaces ScanCode category", async () => {
  const registry = await getLicenseRegistry();
  assertEquals(registry.lookupById("MIT")?.category, "Permissive");
  assertEquals(registry.lookupById("GPL-3.0-only")?.category, "Copyleft");
  assertEquals(
    registry.lookupById("LGPL-3.0-only")?.category,
    "Copyleft Limited",
  );
});

Deno.test("LicenseRegistry.parse - single SPDX ID", async () => {
  const registry = await getLicenseRegistry();
  const result = registry.parse("MIT");
  assertEquals(result.map((e) => e.licenseId), ["MIT"]);
});

Deno.test("LicenseRegistry.parse - comma-separated IDs", async () => {
  const registry = await getLicenseRegistry();
  const result = registry.parse("MIT, Apache-2.0");
  assertEquals(result.map((e) => e.licenseId), ["MIT", "Apache-2.0"]);
});

Deno.test("LicenseRegistry.parse - npm-style expression with OR", async () => {
  const registry = await getLicenseRegistry();
  const result = registry.parse("(MIT OR Apache-2.0)");
  assertEquals(result.map((e) => e.licenseId), ["MIT", "Apache-2.0"]);
});

Deno.test("LicenseRegistry.parse - AND expression", async () => {
  const registry = await getLicenseRegistry();
  const result = registry.parse("MIT AND BSD-3-Clause");
  assertEquals(result.map((e) => e.licenseId), ["MIT", "BSD-3-Clause"]);
});

Deno.test("LicenseRegistry.parse - resolves by full name too", async () => {
  const registry = await getLicenseRegistry();
  const result = registry.parse("MIT License");
  assertEquals(result.map((e) => e.licenseId), ["MIT"]);
});

Deno.test("LicenseRegistry.parse - returns empty for unknown strings", async () => {
  const registry = await getLicenseRegistry();
  const result = registry.parse("Some-Proprietary-Blob-2026");
  assertEquals(result, []);
});

Deno.test("LicenseRegistry.parse - deduplicates repeated tokens", async () => {
  const registry = await getLicenseRegistry();
  const result = registry.parse("MIT, MIT, mit");
  assertEquals(result.map((e) => e.licenseId), ["MIT"]);
});
