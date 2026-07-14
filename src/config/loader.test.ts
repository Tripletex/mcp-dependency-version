import { assertEquals } from "@std/assert";
import { parseInlineConfig } from "./loader.ts";

Deno.test("parseInlineConfig - parses a valid config object", () => {
  const parsed = parseInlineConfig(
    JSON.stringify({
      repositories: {
        "github-actions": {
          tripletex: {
            name: "Tripletex",
            url: "https://github.com/Tripletex",
            auth: { token: "ghp_x" },
          },
        },
      },
    }),
  );
  assertEquals(
    parsed?.repositories?.["github-actions"]?.tripletex?.url,
    "https://github.com/Tripletex",
  );
});

Deno.test("parseInlineConfig - invalid JSON returns null", () => {
  assertEquals(parseInlineConfig("{not json"), null);
});

Deno.test("parseInlineConfig - non-object JSON returns null", () => {
  assertEquals(parseInlineConfig('"a string"'), null);
  assertEquals(parseInlineConfig("[1, 2]"), null);
  assertEquals(parseInlineConfig("null"), null);
});
