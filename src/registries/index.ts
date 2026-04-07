/**
 * Registry client exports and factory
 */

export * from "./types.ts";
export { npmClient } from "./npm.ts";
export { mavenClient } from "./maven.ts";
export { pypiClient } from "./pypi.ts";
export { cargoClient } from "./cargo.ts";
export { goClient } from "./go.ts";
export { jsrClient } from "./jsr.ts";
export { nugetClient } from "./nuget.ts";
export { dockerClient } from "./docker.ts";
export { rubygemsClient } from "./rubygems.ts";
export { packagistClient } from "./packagist.ts";
export { pubClient } from "./pub.ts";
export { swiftClient } from "./swift.ts";
export { githubActionsClient } from "./github-actions.ts";

import type { Registry, RegistryClient } from "./types.ts";
import { npmClient } from "./npm.ts";
import { mavenClient } from "./maven.ts";
import { pypiClient } from "./pypi.ts";
import { cargoClient } from "./cargo.ts";
import { goClient } from "./go.ts";
import { jsrClient } from "./jsr.ts";
import { nugetClient } from "./nuget.ts";
import { dockerClient } from "./docker.ts";
import { rubygemsClient } from "./rubygems.ts";
import { packagistClient } from "./packagist.ts";
import { pubClient } from "./pub.ts";
import { swiftClient } from "./swift.ts";
import { githubActionsClient } from "./github-actions.ts";

const clients: Record<Registry, RegistryClient> = {
  npm: npmClient,
  maven: mavenClient,
  pypi: pypiClient,
  cargo: cargoClient,
  go: goClient,
  jsr: jsrClient,
  nuget: nugetClient,
  docker: dockerClient,
  rubygems: rubygemsClient,
  packagist: packagistClient,
  pub: pubClient,
  swift: swiftClient,
  "github-actions": githubActionsClient,
};

/**
 * Get the appropriate registry client for a registry
 */
export function getClient(registry: Registry): RegistryClient {
  const client = clients[registry];
  if (!client) {
    throw new Error(`Unsupported registry: ${registry}`);
  }
  return client;
}

/**
 * Get the appropriate client for a JSR package
 * Routes npm: prefixed packages to npm registry, others to JSR
 */
export function getJsrPackageClient(packageName: string): {
  client: RegistryClient;
  resolvedName: string;
} {
  if (packageName.startsWith("npm:")) {
    return {
      client: npmClient,
      resolvedName: packageName.slice(4), // Remove "npm:" prefix
    };
  }
  return {
    client: jsrClient,
    resolvedName: packageName,
  };
}

/**
 * List of all supported registries
 */
export const supportedRegistries: Registry[] = [
  "npm",
  "maven",
  "pypi",
  "cargo",
  "go",
  "jsr",
  "nuget",
  "docker",
  "rubygems",
  "packagist",
  "pub",
  "swift",
  "github-actions",
];
