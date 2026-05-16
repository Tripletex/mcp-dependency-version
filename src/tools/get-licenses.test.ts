import { assertEquals } from "@std/assert";
import {
  lookupLicense,
  REGISTRIES_WITHOUT_LICENSE,
  summarizeLicenseResults,
} from "./get-licenses.ts";

Deno.test("registries without license support are reported without a network call", async () => {
  for (const registry of REGISTRIES_WITHOUT_LICENSE) {
    const result = await lookupLicense({
      registry,
      package: "does-not-matter",
    });
    assertEquals(result.status, "registry-unsupported");
    assertEquals(result.license, null);
    assertEquals(typeof result.note, "string");
    assertEquals(result.registry, registry);
  }
});

Deno.test("summarizeLicenseResults tallies each status", () => {
  const summary = summarizeLicenseResults([
    {
      registry: "npm",
      packageName: "a",
      license: "MIT",
      status: "found",
    },
    {
      registry: "npm",
      packageName: "b",
      license: null,
      status: "not-declared",
    },
    {
      registry: "maven",
      packageName: "c:d",
      license: null,
      status: "registry-unsupported",
    },
    {
      registry: "npm",
      packageName: "e",
      license: null,
      status: "error",
      error: "boom",
    },
  ]);
  assertEquals(summary, {
    total: 4,
    withLicense: 1,
    notDeclared: 1,
    registryUnsupported: 1,
    errors: 1,
    copyleft: 0,
  });
});
