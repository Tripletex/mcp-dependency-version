import { assertEquals } from "@std/assert";
import {
  findParentVersion,
  scanForCompatibleParentVersion,
} from "./find-parent-version.ts";
import type { VersionDependency } from "../registries/types.ts";

function depsTable(
  table: Record<string, VersionDependency[] | undefined>,
): (v: string) => Promise<VersionDependency[] | undefined> {
  return (v) => Promise.resolve(table[v]);
}

Deno.test("scan - returns the first ascending version with a compatible range", async () => {
  // Tilde ranges pin the minor: ~1.4.0 = [1.4.0, 1.5.0). So only 1.2.0's
  // ~1.5.0 covers 1.5.4 — earlier versions declare ranges that exclude it.
  const result = await scanForCompatibleParentVersion(
    ["1.0.0", "1.1.0", "1.2.0", "1.3.0"],
    { registry: "npm", name: "d" },
    "1.5.4",
    depsTable({
      "1.0.0": [{
        name: "d",
        registry: "npm",
        constraint: "~1.2.0",
        scope: "runtime",
      }],
      "1.1.0": [{
        name: "d",
        registry: "npm",
        constraint: "~1.4.0",
        scope: "runtime",
      }],
      "1.2.0": [{
        name: "d",
        registry: "npm",
        constraint: "~1.5.0",
        scope: "runtime",
      }],
      "1.3.0": [{
        name: "d",
        registry: "npm",
        constraint: "~1.6.0",
        scope: "runtime",
      }],
    }),
  );
  assertEquals(result.status, "found");
  assertEquals(result.parentVersion, "1.2.0");
  assertEquals(result.declaredConstraint, "~1.5.0");
  assertEquals(result.scope, "runtime");
  assertEquals(result.versionsScanned, 3);
});

Deno.test("scan - returns 'none-compatible' when child is declared but no range covers target", async () => {
  const result = await scanForCompatibleParentVersion(
    ["1.0.0", "1.1.0"],
    { registry: "npm", name: "d" },
    "2.0.0",
    depsTable({
      "1.0.0": [{
        name: "d",
        registry: "npm",
        constraint: "^1.0.0",
        scope: "runtime",
      }],
      "1.1.0": [{
        name: "d",
        registry: "npm",
        constraint: "~1.5.0",
        scope: "runtime",
      }],
    }),
  );
  assertEquals(result.status, "none-compatible");
  assertEquals(result.parentVersion, undefined);
  assertEquals(result.versionsScanned, 2);
});

Deno.test("scan - returns 'child-never-declared' when no version lists the child", async () => {
  const result = await scanForCompatibleParentVersion(
    ["1.0.0", "1.1.0"],
    { registry: "npm", name: "d" },
    "1.0.0",
    depsTable({
      "1.0.0": [{
        name: "other",
        registry: "npm",
        constraint: "^1.0.0",
        scope: "runtime",
      }],
      "1.1.0": [],
    }),
  );
  assertEquals(result.status, "child-never-declared");
});

Deno.test("scan - distinguishes children with same name on different registries", async () => {
  // A parent might declare both an npm:zod and a jsr:@x/zod. The match must
  // require BOTH registry and name to agree.
  const result = await scanForCompatibleParentVersion(
    ["1.0.0", "1.1.0"],
    { registry: "jsr", name: "zod" },
    "4.0.0",
    depsTable({
      "1.0.0": [
        {
          name: "zod",
          registry: "npm",
          constraint: "^4.0.0",
          scope: "runtime",
        },
      ],
      "1.1.0": [
        {
          name: "zod",
          registry: "npm",
          constraint: "^4.0.0",
          scope: "runtime",
        },
        {
          name: "zod",
          registry: "jsr",
          constraint: "^4.0.0",
          scope: "runtime",
        },
      ],
    }),
  );
  assertEquals(result.status, "found");
  assertEquals(result.parentVersion, "1.1.0");
});

Deno.test("scan - skips versions whose deps are unavailable (undefined)", async () => {
  const result = await scanForCompatibleParentVersion(
    ["1.0.0", "1.1.0", "1.2.0"],
    { registry: "npm", name: "d" },
    "1.0.0",
    depsTable({
      "1.0.0": undefined,
      "1.1.0": undefined,
      "1.2.0": [{
        name: "d",
        registry: "npm",
        constraint: "^1.0.0",
        scope: "runtime",
      }],
    }),
  );
  assertEquals(result.status, "found");
  assertEquals(result.parentVersion, "1.2.0");
  assertEquals(result.versionsScanned, 3);
});

Deno.test("scan - reports 'child-never-declared' when every version's deps are undefined", async () => {
  const result = await scanForCompatibleParentVersion(
    ["1.0.0"],
    { registry: "npm", name: "d" },
    "1.0.0",
    depsTable({ "1.0.0": undefined }),
  );
  assertEquals(result.status, "child-never-declared");
});

Deno.test("findParentVersion - reports 'error' for a registry without dependency support", async () => {
  // `go` does not implement getVersionDependencies and never will (it's not in
  // the SUPPORTED_PARENT_REGISTRIES list either, but the runtime guard exists
  // to defend against future drift).
  const result = await findParentVersion({
    // deliberately bypass the typed enum to cover the runtime guard
    parent: { registry: "go" as unknown as "npm", name: "example.com/foo" },
    child: { registry: "npm", name: "d" },
    childVersion: "1.0.0",
  });
  assertEquals(result.status, "error");
  assertEquals(typeof result.error, "string");
});
