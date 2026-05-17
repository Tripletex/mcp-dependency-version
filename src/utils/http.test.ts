import { assertEquals } from "@std/assert";
import { parseRetryAfter } from "./http.ts";

Deno.test("parseRetryAfter - returns null for missing/empty values", () => {
  assertEquals(parseRetryAfter(null), null);
  assertEquals(parseRetryAfter(""), null);
  assertEquals(parseRetryAfter("   "), null);
});

Deno.test("parseRetryAfter - parses delta-seconds form to milliseconds", () => {
  assertEquals(parseRetryAfter("0"), 0);
  assertEquals(parseRetryAfter("1"), 1000);
  assertEquals(parseRetryAfter("120"), 120_000);
  assertEquals(parseRetryAfter("  30  "), 30_000);
});

Deno.test("parseRetryAfter - parses HTTP-date relative to provided now()", () => {
  const now = new Date("2026-10-21T07:28:00Z");
  // 60 seconds in the future
  const future = "Wed, 21 Oct 2026 07:29:00 GMT";
  assertEquals(parseRetryAfter(future, now), 60_000);
});

Deno.test("parseRetryAfter - clamps past HTTP-date to zero", () => {
  const now = new Date("2026-10-21T08:00:00Z");
  const past = "Wed, 21 Oct 2026 07:00:00 GMT";
  assertEquals(parseRetryAfter(past, now), 0);
});

Deno.test("parseRetryAfter - returns null for unparseable garbage", () => {
  assertEquals(parseRetryAfter("not-a-date"), null);
  assertEquals(parseRetryAfter("soon-please"), null);
});
