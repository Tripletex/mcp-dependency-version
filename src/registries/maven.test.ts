import { assertEquals } from "@std/assert";
import { MavenClient } from "./maven.ts";

Deno.test("parseLicensesFromPom - extracts single license name", () => {
  const pom = `<project>
    <licenses>
      <license>
        <name>Apache License, Version 2.0</name>
        <url>https://www.apache.org/licenses/LICENSE-2.0.txt</url>
        <distribution>repo</distribution>
      </license>
    </licenses>
  </project>`;
  assertEquals(MavenClient.parseLicensesFromPom(pom), [
    "Apache License, Version 2.0",
  ]);
});

Deno.test("parseLicensesFromPom - extracts multiple licenses in order", () => {
  const pom = `<project>
    <licenses>
      <license>
        <name>MIT License</name>
      </license>
      <license>
        <name>Apache-2.0</name>
      </license>
    </licenses>
  </project>`;
  assertEquals(MavenClient.parseLicensesFromPom(pom), [
    "MIT License",
    "Apache-2.0",
  ]);
});

Deno.test("parseLicensesFromPom - falls back to url when name is missing", () => {
  const pom = `<project>
    <licenses>
      <license>
        <url>https://example.com/license.txt</url>
      </license>
    </licenses>
  </project>`;
  assertEquals(MavenClient.parseLicensesFromPom(pom), [
    "https://example.com/license.txt",
  ]);
});

Deno.test("parseLicensesFromPom - returns undefined when block is missing", () => {
  const pom = `<project><artifactId>foo</artifactId></project>`;
  assertEquals(MavenClient.parseLicensesFromPom(pom), undefined);
});

Deno.test("parseLicensesFromPom - returns undefined for empty block", () => {
  const pom = `<project><licenses></licenses></project>`;
  assertEquals(MavenClient.parseLicensesFromPom(pom), undefined);
});
