/**
 * Configuration loader
 * Loads and merges configuration from file with defaults
 */

import type { Config, RepositoryConfig } from "./types.ts";
import type { Registry } from "../registries/types.ts";
import { DEFAULT_CONFIG } from "./types.ts";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import process from "node:process";

/** Config file path - can be overridden via MCP_DEPENDENCY_VERSION_CONFIG env var */
const DEFAULT_CONFIG_PATH = "~/.config/mcp-dependency-version/config.json";

let loadedConfig: Config | null = null;

/**
 * Expand ~ to home directory
 */
function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    // Resolving the home directory needs env/sys access. When it is not
    // granted (e.g. tests without --allow-env), leave the path unexpanded;
    // the subsequent file read will simply miss and defaults are used.
    let home: string | undefined;
    try {
      home = process.env.HOME || process.env.USERPROFILE || homedir();
    } catch {
      home = undefined;
    }
    if (home) {
      return path.replace("~", home);
    }
  }
  return path;
}

/**
 * Get the config file path
 */
function getConfigPath(): string {
  // Reading the env var is optional: when env access is not granted (e.g. in
  // tests run without --allow-env), fall back to the default path rather than
  // failing.
  let override: string | undefined;
  try {
    override = process.env.MCP_DEPENDENCY_VERSION_CONFIG;
  } catch {
    override = undefined;
  }
  return expandPath(override || DEFAULT_CONFIG_PATH);
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error &&
    error.code === "ENOENT";
}

/**
 * Deep merge two config objects
 */
function mergeConfigs(base: Config, override: Partial<Config>): Config {
  const merged: Config = { repositories: { ...base.repositories } };

  if (override.repositories) {
    for (const [registry, repos] of Object.entries(override.repositories)) {
      const reg = registry as Registry;
      merged.repositories[reg] = {
        ...merged.repositories[reg],
        ...repos,
      };
    }
  }

  return merged;
}

/**
 * Load configuration from file, merging with defaults
 * Returns cached config on subsequent calls
 */
export async function loadConfig(): Promise<Config> {
  if (loadedConfig) {
    return loadedConfig;
  }

  const configPath = getConfigPath();
  let userConfig: Partial<Config> = {};

  try {
    const content = await readFile(configPath, "utf8");
    userConfig = JSON.parse(content) as Partial<Config>;
  } catch (error) {
    if (!isNotFoundError(error)) {
      console.error(
        `Warning: Failed to load config from ${configPath}:`,
        error,
      );
    }
    // Use defaults if no config file exists
  }

  loadedConfig = mergeConfigs(DEFAULT_CONFIG, userConfig);
  return loadedConfig;
}

/**
 * Load configuration synchronously (blocking)
 * Use loadConfig() when possible
 */
export function loadConfigSync(): Config {
  if (loadedConfig) {
    return loadedConfig;
  }

  const configPath = getConfigPath();
  let userConfig: Partial<Config> = {};

  try {
    const content = readFileSync(configPath, "utf8");
    userConfig = JSON.parse(content) as Partial<Config>;
  } catch (error) {
    if (!isNotFoundError(error)) {
      console.error(
        `Warning: Failed to load config from ${configPath}:`,
        error,
      );
    }
  }

  loadedConfig = mergeConfigs(DEFAULT_CONFIG, userConfig);
  return loadedConfig;
}

/**
 * Get repository config for a registry
 * @param registry The registry type
 * @param repository Optional repository name (uses default if not specified)
 */
export function getRepositoryConfig(
  registry: Registry,
  repository?: string,
): RepositoryConfig {
  const config = loadConfigSync();
  const repos = config.repositories[registry];

  if (!repos) {
    throw new Error(`No repositories configured for registry: ${registry}`);
  }

  if (repository) {
    const repo = repos[repository];
    if (!repo) {
      const available = Object.keys(repos).join(", ");
      throw new Error(
        `Repository '${repository}' not found for ${registry}. Available: ${available}`,
      );
    }
    return repo;
  }

  // Find default repository
  const defaultRepo = Object.values(repos).find((r) => r.default);
  if (defaultRepo) {
    return defaultRepo;
  }

  // Fall back to first repository
  const first = Object.values(repos)[0];
  if (first) {
    return first;
  }

  throw new Error(`No repositories configured for registry: ${registry}`);
}

/**
 * List available repositories for a registry
 */
export function listRepositories(registry: Registry): string[] {
  const config = loadConfigSync();
  const repos = config.repositories[registry];
  return repos ? Object.keys(repos) : [];
}

/**
 * Reset loaded config (for testing)
 */
export function resetConfig(): void {
  loadedConfig = null;
}
