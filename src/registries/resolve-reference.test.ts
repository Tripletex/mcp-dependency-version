import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { GitHubActionsClient } from "./github-actions.ts";
import { NpmClient } from "./npm.ts";
import { DockerClient } from "./docker.ts";
import { MavenClient } from "./maven.ts";
import { SwiftClient } from "./swift.ts";
import type { RegistryClient } from "./types.ts";

const originalFetch = globalThis.fetch;

/** Replace global fetch with a handler that returns a Response for a URL. */
function mockFetch(handler: (url: string) => Response): void {
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    return Promise.resolve(handler(url));
  }) as typeof fetch;
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

Deno.test("github-actions resolveReference - resolves branch to commit SHA", async () => {
  const sha = "a".repeat(40);
  mockFetch((url) => {
    assertStringIncludes(url, "/repos/actions/checkout/commits/main");
    return new Response(sha, { status: 200 });
  });
  try {
    const result = await new GitHubActionsClient().resolveReference(
      "actions/checkout",
      "main",
    );
    assertEquals(result.digest, sha);
    assertEquals(result.isMutable, true);
    assertEquals(result.resolvedReference, "main");
    assertEquals(result.latestStable, "main");
    assertEquals(result.secureReference, `actions/checkout@${sha} # main`);
    assertStringIncludes(result.securityNotes!.join(" "), "branch 'main'");
  } finally {
    restoreFetch();
  }
});

Deno.test("github-actions resolveReference - tag ref uses tag wording", async () => {
  const sha = "b".repeat(40);
  mockFetch(() => new Response(sha, { status: 200 }));
  try {
    const result = await new GitHubActionsClient().resolveReference(
      "actions/setup-node",
      "v4.2.0",
    );
    assertEquals(result.digest, sha);
    assertStringIncludes(result.securityNotes!.join(" "), "Tag 'v4.2.0'");
  } finally {
    restoreFetch();
  }
});

Deno.test("github-actions resolveReference - 404 throws not found", async () => {
  mockFetch(() => new Response("Not Found", { status: 404 }));
  try {
    await assertRejects(
      () =>
        new GitHubActionsClient().resolveReference("actions/missing", "nope"),
      Error,
      "Reference 'nope' not found",
    );
  } finally {
    restoreFetch();
  }
});

Deno.test("npm resolveReference - resolves dist-tag to concrete version", async () => {
  const body = JSON.stringify({
    name: "pkg",
    "dist-tags": { latest: "1.0.0", next: "2.0.0-beta.1" },
    versions: { "2.0.0-beta.1": { version: "2.0.0-beta.1" } },
    time: { "2.0.0-beta.1": "2024-01-01T00:00:00Z" },
  });
  mockFetch(() => new Response(body, { status: 200 }));
  try {
    const result = await new NpmClient().resolveReference("pkg-npm-a", "next");
    assertEquals(result.latestStable, "2.0.0-beta.1");
    assertEquals(result.isMutable, true);
    assertEquals(result.resolvedReference, "next");
  } finally {
    restoreFetch();
  }
});

Deno.test("npm resolveReference - unknown dist-tag throws", async () => {
  const body = JSON.stringify({
    name: "pkg",
    "dist-tags": { latest: "1.0.0" },
    versions: { "1.0.0": { version: "1.0.0" } },
    time: {},
  });
  mockFetch(() => new Response(body, { status: 200 }));
  try {
    await assertRejects(
      () => new NpmClient().resolveReference("pkg-npm-b", "missing"),
      Error,
      "Dist-tag 'missing' not found",
    );
  } finally {
    restoreFetch();
  }
});

Deno.test("docker resolveReference - resolves tag to sha256 digest", async () => {
  const body = JSON.stringify({
    count: 1,
    next: null,
    previous: null,
    results: [{
      name: "latest",
      digest: "sha256:abc123",
      last_updated: "2024-01-01T00:00:00Z",
    }],
  });
  mockFetch(() => new Response(body, { status: 200 }));
  try {
    const result = await new DockerClient().resolveReference(
      "nginx-docker-a",
      "latest",
    );
    assertEquals(result.digest, "sha256:abc123");
    assertEquals(result.secureReference, "nginx-docker-a@sha256:abc123");
    assertEquals(result.isMutable, true);
    assertEquals(result.resolvedReference, "latest");
  } finally {
    restoreFetch();
  }
});

Deno.test("docker resolveReference - unknown tag throws", async () => {
  const body = JSON.stringify({
    count: 0,
    next: null,
    previous: null,
    results: [],
  });
  mockFetch(() => new Response(body, { status: 200 }));
  try {
    await assertRejects(
      () => new DockerClient().resolveReference("nginx-docker-b", "missing"),
      Error,
      "Tag 'missing' not found",
    );
  } finally {
    restoreFetch();
  }
});

Deno.test("swift resolveReference - resolves branch to commit SHA with revision pin", async () => {
  const sha = "c".repeat(40);
  mockFetch((url) => {
    assertStringIncludes(url, "/repos/apple/swift-nio/commits/main");
    return new Response(sha, { status: 200 });
  });
  try {
    const result = await new SwiftClient().resolveReference(
      "apple/swift-nio",
      "main",
    );
    assertEquals(result.digest, sha);
    assertEquals(result.isMutable, true);
    assertEquals(result.resolvedReference, "main");
    assertEquals(
      result.secureReference,
      `.package(url: "https://github.com/apple/swift-nio.git", revision: "${sha}")`,
    );
    assertStringIncludes(result.securityNotes!.join(" "), "Package.resolved");
    assertStringIncludes(result.securityNotes!.join(" "), "branch 'main'");
  } finally {
    restoreFetch();
  }
});

Deno.test("swift resolveReference - 404 throws not found", async () => {
  mockFetch(() => new Response("Not Found", { status: 404 }));
  try {
    await assertRejects(
      () => new SwiftClient().resolveReference("apple/missing", "nope"),
      Error,
      "Reference 'nope' not found for Swift package",
    );
  } finally {
    restoreFetch();
  }
});

Deno.test("registries without floating refs do not implement resolveReference", () => {
  const maven: RegistryClient = new MavenClient();
  assertEquals(typeof maven.resolveReference, "undefined");
});
