import { assertEquals } from "@std/assert";
import {
  isCommitShaLike,
  matchActionTag,
  matchTagsByCommitSha,
  normalizeActionRef,
  splitActionPackage,
  tagVersionExtractor,
  versionFromTag,
} from "./action-tags.ts";

Deno.test("splitActionPackage - standalone action has no action path", () => {
  assertEquals(splitActionPackage("actions/checkout"), {
    repoSlug: "actions/checkout",
  });
});

Deno.test("splitActionPackage - monorepo action splits repo and path", () => {
  assertEquals(splitActionPackage("org/actions/deploy"), {
    repoSlug: "org/actions",
    actionPath: "deploy",
  });
});

Deno.test("splitActionPackage - nested action path is preserved", () => {
  assertEquals(splitActionPackage("org/actions/tools/build"), {
    repoSlug: "org/actions",
    actionPath: "tools/build",
  });
});

Deno.test("matchActionTag - dash separator", () => {
  assertEquals(matchActionTag("deploy-v1.2.3", "deploy"), {
    version: "1.2.3",
  });
});

Deno.test("matchActionTag - at separator", () => {
  assertEquals(matchActionTag("deploy@v1.2.3", "deploy"), {
    version: "1.2.3",
  });
});

Deno.test("matchActionTag - action name containing dashes", () => {
  assertEquals(
    matchActionTag("build-and-push-v1.0.0", "build-and-push"),
    {
      version: "1.0.0",
    },
  );
});

Deno.test("matchActionTag - version without v prefix", () => {
  assertEquals(matchActionTag("deploy-1.2.3", "deploy"), { version: "1.2.3" });
});

Deno.test("matchActionTag - prerelease suffix", () => {
  assertEquals(matchActionTag("deploy-v2.0.0-beta.1", "deploy"), {
    version: "2.0.0-beta.1",
  });
});

Deno.test("matchActionTag - other action's tag does not match", () => {
  assertEquals(matchActionTag("other-v1.2.3", "deploy"), null);
});

Deno.test("matchActionTag - dashed action is not confused with a shorter name", () => {
  // The tag belongs to "build-and-push", not to an action named "build"
  assertEquals(matchActionTag("build-and-push-v1.0.0", "build"), null);
});

Deno.test("matchActionTag - plain repo-level tag does not match", () => {
  assertEquals(matchActionTag("v54", "deploy"), null);
  assertEquals(matchActionTag("v1.2.3", "deploy"), null);
});

Deno.test("matchActionTag - nested path matches full path and last segment", () => {
  assertEquals(matchActionTag("tools/build-v1.0.0", "tools/build"), {
    version: "1.0.0",
  });
  assertEquals(matchActionTag("build-v1.0.0", "tools/build"), {
    version: "1.0.0",
  });
});

Deno.test("versionFromTag - standalone action uses plain semver tags", () => {
  assertEquals(versionFromTag("v4.2.0"), "4.2.0");
  assertEquals(versionFromTag("v4"), "4");
  assertEquals(versionFromTag("not-a-version"), null);
});

Deno.test("versionFromTag - subpath action requires prefixed tags", () => {
  assertEquals(versionFromTag("deploy-v1.2.3", "deploy"), "1.2.3");
  assertEquals(versionFromTag("v1.2.3", "deploy"), null);
});

Deno.test("tagVersionExtractor - prefixed tags win when present", () => {
  const tagNames = ["v54", "v53", "deploy-v1.2.0", "deploy-v1.1.0"];
  const versionOf = tagVersionExtractor(tagNames, "deploy");
  assertEquals(versionOf("deploy-v1.2.0"), "1.2.0");
  // Repo-level tags are not attributed to the action
  assertEquals(versionOf("v54"), null);
});

Deno.test("tagVersionExtractor - falls back to repo-level tags for subpath actions", () => {
  // The github/codeql-action pattern: subpath actions (init, analyze)
  // versioned by plain repo-level semver tags
  const tagNames = ["v3.28.0", "v3.27.9", "codeql-bundle-v2.20.0"];
  const versionOf = tagVersionExtractor(tagNames, "init");
  assertEquals(versionOf("v3.28.0"), "3.28.0");
  assertEquals(versionOf("codeql-bundle-v2.20.0"), null);
});

Deno.test("tagVersionExtractor - standalone action uses plain semver", () => {
  const versionOf = tagVersionExtractor(["v4.2.0", "v4"], undefined);
  assertEquals(versionOf("v4.2.0"), "4.2.0");
  assertEquals(versionOf("latest"), null);
});

Deno.test("normalizeActionRef - strips monorepo prefix and v", () => {
  assertEquals(normalizeActionRef("deploy-v1.2.3", "deploy"), "1.2.3");
  assertEquals(normalizeActionRef("deploy@v1.2.3", "deploy"), "1.2.3");
});

Deno.test("normalizeActionRef - subpath action with repo-level ref", () => {
  // codeql-action/init@v3 -> "3"
  assertEquals(normalizeActionRef("v3", "init"), "3");
});

Deno.test("normalizeActionRef - standalone action strips v only", () => {
  assertEquals(normalizeActionRef("v4.2.0"), "4.2.0");
  assertEquals(normalizeActionRef("main"), "main");
});

Deno.test("isCommitShaLike - accepts full and abbreviated SHAs", () => {
  assertEquals(
    isCommitShaLike("b4ffde65f46336ab88eb53be808477a3936bae11"),
    true,
  );
  assertEquals(isCommitShaLike("b4ffde6"), true);
  assertEquals(isCommitShaLike("B4FFDE6"), true);
});

Deno.test("isCommitShaLike - rejects short, long, and non-hex values", () => {
  assertEquals(isCommitShaLike("b4ffde"), false); // 6 chars
  assertEquals(
    isCommitShaLike("b4ffde65f46336ab88eb53be808477a3936bae11a"),
    false,
  ); // 41 chars
  assertEquals(isCommitShaLike("v4.2.0"), false);
  assertEquals(isCommitShaLike("main"), false);
});

const COMMIT_TAGS = [
  { name: "v4", commit: { sha: "b4ffde65f46336ab88eb53be808477a3936bae11" } },
  {
    name: "v4.2.0",
    commit: { sha: "b4ffde65f46336ab88eb53be808477a3936bae11" },
  },
  {
    name: "v4.1.0",
    commit: { sha: "1e31de5234b9f8995739874a8ce0492dc87873e2" },
  },
];

Deno.test("matchTagsByCommitSha - full SHA matches every pointing tag", () => {
  const matched = matchTagsByCommitSha(
    COMMIT_TAGS,
    "b4ffde65f46336ab88eb53be808477a3936bae11",
  );
  assertEquals(matched.map((t) => t.name), ["v4", "v4.2.0"]);
});

Deno.test("matchTagsByCommitSha - short SHA prefix matches", () => {
  const matched = matchTagsByCommitSha(COMMIT_TAGS, "1e31de5");
  assertEquals(matched.map((t) => t.name), ["v4.1.0"]);
});

Deno.test("matchTagsByCommitSha - comparison is case-insensitive", () => {
  const matched = matchTagsByCommitSha(COMMIT_TAGS, "B4FFDE65");
  assertEquals(matched.length, 2);
});

Deno.test("matchTagsByCommitSha - unknown SHA matches nothing", () => {
  assertEquals(matchTagsByCommitSha(COMMIT_TAGS, "deadbeef"), []);
});
