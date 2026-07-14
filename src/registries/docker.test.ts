import { assertEquals } from "@std/assert";
import {
  type DockerHubTagResult,
  matchDockerTagsByDigest,
  normalizeDockerDigest,
} from "./docker.ts";

const MANIFEST_DIGEST = "sha256:" + "a".repeat(64);
const ARM_DIGEST = "sha256:" + "b".repeat(64);
const AMD_DIGEST = "sha256:" + "c".repeat(64);
const OLD_DIGEST = "sha256:" + "d".repeat(64);

const TAGS: DockerHubTagResult[] = [
  {
    name: "1.27.3",
    digest: MANIFEST_DIGEST,
    images: [
      { digest: AMD_DIGEST, architecture: "amd64" },
      { digest: ARM_DIGEST, architecture: "arm64" },
    ],
  },
  {
    name: "latest",
    digest: MANIFEST_DIGEST,
    images: [
      { digest: AMD_DIGEST, architecture: "amd64" },
      { digest: ARM_DIGEST, architecture: "arm64" },
    ],
  },
  {
    name: "1.26.0",
    digest: OLD_DIGEST,
  },
];

Deno.test("normalizeDockerDigest - adds sha256 prefix and lowercases", () => {
  assertEquals(normalizeDockerDigest("A".repeat(64)), MANIFEST_DIGEST);
  assertEquals(normalizeDockerDigest(MANIFEST_DIGEST), MANIFEST_DIGEST);
});

Deno.test("matchDockerTagsByDigest - manifest digest matches all pointing tags", () => {
  const matches = matchDockerTagsByDigest(TAGS, MANIFEST_DIGEST);
  assertEquals(matches.map((m) => m.tag.name), ["1.27.3", "latest"]);
  assertEquals(matches.map((m) => m.architecture), [undefined, undefined]);
});

Deno.test("matchDockerTagsByDigest - per-architecture digest reports architecture", () => {
  const matches = matchDockerTagsByDigest(TAGS, ARM_DIGEST);
  assertEquals(matches.map((m) => m.tag.name), ["1.27.3", "latest"]);
  assertEquals(matches.map((m) => m.architecture), ["arm64", "arm64"]);
});

Deno.test("matchDockerTagsByDigest - accepts digest without sha256 prefix", () => {
  const matches = matchDockerTagsByDigest(TAGS, "d".repeat(64));
  assertEquals(matches.map((m) => m.tag.name), ["1.26.0"]);
});

Deno.test("matchDockerTagsByDigest - unknown digest matches nothing", () => {
  assertEquals(matchDockerTagsByDigest(TAGS, "sha256:" + "e".repeat(64)), []);
});
