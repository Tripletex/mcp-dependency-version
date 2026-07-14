import { assertEquals, assertThrows } from "@std/assert";
import { matchGitHubRepository } from "./github.ts";
import type { RegistryRepositories } from "./types.ts";

const DEFAULT_ONLY: RegistryRepositories = {
  github: {
    name: "GitHub",
    url: "https://api.github.com",
    default: true,
  },
};

Deno.test("matchGitHubRepository - legacy api.github.com default is used as fallback", () => {
  const resolved = matchGitHubRepository(DEFAULT_ONLY, "actions/checkout");
  assertEquals(resolved.key, "github");
  assertEquals(resolved.apiUrl, "https://api.github.com");
  assertEquals(resolved.auth, undefined);
});

Deno.test("matchGitHubRepository - owner entry matches its org", () => {
  const repos: RegistryRepositories = {
    ...DEFAULT_ONLY,
    tripletex: {
      name: "Tripletex",
      url: "https://github.com/Tripletex",
      auth: { token: "ghp_private" },
    },
  };
  const resolved = matchGitHubRepository(repos, "Tripletex/deploy-action");
  assertEquals(resolved.key, "tripletex");
  assertEquals(resolved.apiUrl, "https://api.github.com");
  assertEquals(resolved.auth?.token, "ghp_private");
});

Deno.test("matchGitHubRepository - owner match is case-insensitive", () => {
  const repos: RegistryRepositories = {
    ...DEFAULT_ONLY,
    tripletex: {
      name: "Tripletex",
      url: "https://github.com/Tripletex",
      auth: { token: "ghp_private" },
    },
  };
  const resolved = matchGitHubRepository(repos, "tripletex/deploy-action");
  assertEquals(resolved.key, "tripletex");
});

Deno.test("matchGitHubRepository - non-matching owner falls back to default", () => {
  const repos: RegistryRepositories = {
    ...DEFAULT_ONLY,
    tripletex: {
      name: "Tripletex",
      url: "https://github.com/Tripletex",
      auth: { token: "ghp_private" },
    },
  };
  const resolved = matchGitHubRepository(repos, "actions/checkout");
  assertEquals(resolved.key, "github");
  assertEquals(resolved.auth, undefined);
});

Deno.test("matchGitHubRepository - bare github.com entry matches all owners", () => {
  const repos: RegistryRepositories = {
    github: {
      name: "GitHub public (authenticated)",
      url: "https://github.com/",
      default: true,
      auth: { token: "ghp_public" },
    },
  };
  const resolved = matchGitHubRepository(repos, "actions/checkout");
  assertEquals(resolved.key, "github");
  assertEquals(resolved.apiUrl, "https://api.github.com");
  assertEquals(resolved.auth?.token, "ghp_public");
});

Deno.test("matchGitHubRepository - longest prefix wins over bare host", () => {
  const repos: RegistryRepositories = {
    github: {
      name: "GitHub public",
      url: "https://github.com/",
      default: true,
      auth: { token: "ghp_public" },
    },
    tripletex: {
      name: "Tripletex",
      url: "https://github.com/Tripletex",
      auth: { token: "ghp_private" },
    },
  };
  assertEquals(
    matchGitHubRepository(repos, "Tripletex/deploy-action").auth?.token,
    "ghp_private",
  );
  assertEquals(
    matchGitHubRepository(repos, "actions/checkout").auth?.token,
    "ghp_public",
  );
});

Deno.test("matchGitHubRepository - repo-specific entry beats owner entry", () => {
  const repos: RegistryRepositories = {
    tripletex: {
      name: "Tripletex",
      url: "https://github.com/Tripletex",
      auth: { token: "ghp_org" },
    },
    special: {
      name: "Special repo",
      url: "https://github.com/Tripletex/special-action",
      auth: { token: "ghp_repo" },
    },
  };
  assertEquals(
    matchGitHubRepository(repos, "Tripletex/special-action").auth?.token,
    "ghp_repo",
  );
  assertEquals(
    matchGitHubRepository(repos, "Tripletex/other-action").auth?.token,
    "ghp_org",
  );
});

Deno.test("matchGitHubRepository - trailing wildcard segment is tolerated", () => {
  const repos: RegistryRepositories = {
    tripletex: {
      name: "Tripletex",
      url: "https://github.com/Tripletex/*",
      auth: { token: "ghp_private" },
    },
  };
  const resolved = matchGitHubRepository(repos, "Tripletex/deploy-action");
  assertEquals(resolved.key, "tripletex");
});

Deno.test("matchGitHubRepository - GitHub Enterprise host derives /api/v3 base", () => {
  const repos: RegistryRepositories = {
    ghe: {
      name: "Company GHE",
      url: "https://github.example.com/Platform",
      auth: { token: "ghe_token" },
    },
  };
  const resolved = matchGitHubRepository(repos, "Platform/build-action");
  assertEquals(resolved.apiUrl, "https://github.example.com/api/v3");
});

Deno.test("matchGitHubRepository - explicit API base with path is used verbatim", () => {
  const repos: RegistryRepositories = {
    ghe: {
      name: "Company GHE API",
      url: "https://github.example.com/api/v3",
      default: true,
    },
  };
  const resolved = matchGitHubRepository(repos, "anything/repo");
  assertEquals(resolved.apiUrl, "https://github.example.com/api/v3");
});

Deno.test("matchGitHubRepository - default GHE entry receives unmatched lookups", () => {
  const repos: RegistryRepositories = {
    tripletex: {
      name: "Tripletex on github.com",
      url: "https://github.com/Tripletex",
      auth: { token: "ghp_private" },
    },
    ghe: {
      name: "Company GHE",
      url: "https://github.example.com/api/v3",
      default: true,
      auth: { token: "ghe_token" },
    },
  };
  const resolved = matchGitHubRepository(repos, "internal/some-action");
  assertEquals(resolved.key, "ghe");
  assertEquals(resolved.auth?.token, "ghe_token");
});

Deno.test("matchGitHubRepository - api.github.com entry never matches by URL", () => {
  const repos: RegistryRepositories = {
    legacy: {
      name: "Legacy API entry",
      url: "https://api.github.com",
      auth: { token: "ghp_legacy" },
    },
    tripletex: {
      name: "Tripletex",
      url: "https://github.com/Tripletex",
      auth: { token: "ghp_private" },
    },
  };
  const matched = matchGitHubRepository(repos, "Tripletex/deploy-action");
  assertEquals(matched.key, "tripletex");
  // Unmatched packages fall through to the first entry (no default set),
  // not to the legacy entry via URL matching.
  const fallback = matchGitHubRepository(repos, "actions/checkout");
  assertEquals(fallback.key, "legacy");
  assertEquals(fallback.apiUrl, "https://api.github.com");
});

Deno.test("matchGitHubRepository - tie between equal prefixes prefers default", () => {
  const repos: RegistryRepositories = {
    first: {
      name: "First bare host",
      url: "https://github.com/",
      auth: { token: "ghp_first" },
    },
    second: {
      name: "Second bare host (default)",
      url: "https://github.com/",
      default: true,
      auth: { token: "ghp_second" },
    },
  };
  const resolved = matchGitHubRepository(repos, "actions/checkout");
  assertEquals(resolved.key, "second");
});

Deno.test("matchGitHubRepository - explicit repository name overrides matching", () => {
  const repos: RegistryRepositories = {
    ...DEFAULT_ONLY,
    tripletex: {
      name: "Tripletex",
      url: "https://github.com/Tripletex",
      auth: { token: "ghp_private" },
    },
  };
  const resolved = matchGitHubRepository(
    repos,
    "actions/checkout",
    "tripletex",
  );
  assertEquals(resolved.key, "tripletex");
});

Deno.test("matchGitHubRepository - unknown explicit repository name throws", () => {
  assertThrows(
    () => matchGitHubRepository(DEFAULT_ONLY, "actions/checkout", "nope"),
    Error,
    "Repository 'nope' not found",
  );
});

Deno.test("matchGitHubRepository - empty repository map throws", () => {
  assertThrows(
    () => matchGitHubRepository({}, "actions/checkout"),
    Error,
    "No repositories configured",
  );
});
