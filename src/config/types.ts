/**
 * Configuration types for repository settings
 */

import type { Registry } from "../registries/types.ts";

/**
 * Authentication configuration for a repository
 */
export interface RepositoryAuth {
  /** Bearer token for Authorization header */
  token?: string;
  /** Basic auth username */
  username?: string;
  /** Basic auth password */
  password?: string;
}

/**
 * Configuration for a single repository
 */
export interface RepositoryConfig {
  /** Display name for the repository */
  name: string;
  /** Base URL for the repository */
  url: string;
  /** Whether this is the default repository for its registry type */
  default?: boolean;
  /** Authentication configuration */
  auth?: RepositoryAuth;
}

/**
 * Repository configurations grouped by registry type
 */
export type RegistryRepositories = {
  [key: string]: RepositoryConfig;
};

/**
 * Full configuration file structure
 */
export interface Config {
  /** Repository configurations by registry type */
  repositories: {
    [K in Registry]?: RegistryRepositories;
  };
}

/**
 * Default configuration with official repositories
 */
export const DEFAULT_CONFIG: Config = {
  repositories: {
    npm: {
      npmjs: {
        name: "npm",
        url: "https://registry.npmjs.org",
        default: true,
      },
    },
    maven: {
      central: {
        name: "Maven Central",
        url: "https://repo1.maven.org/maven2",
        default: true,
      },
    },
    pypi: {
      pypi: {
        name: "PyPI",
        url: "https://pypi.org/pypi",
        default: true,
      },
    },
    cargo: {
      cratesio: {
        name: "crates.io",
        url: "https://crates.io/api/v1/crates",
        default: true,
      },
    },
    go: {
      proxy: {
        name: "Go Proxy",
        url: "https://proxy.golang.org",
        default: true,
      },
    },
    jsr: {
      jsr: {
        name: "JSR",
        url: "https://api.jsr.io",
        default: true,
      },
    },
    nuget: {
      nugetorg: {
        name: "NuGet.org",
        url: "https://api.nuget.org/v3",
        default: true,
      },
    },
    docker: {
      dockerhub: {
        name: "Docker Hub",
        url: "https://hub.docker.com",
        default: true,
      },
    },
    rubygems: {
      rubygemsorg: {
        name: "RubyGems.org",
        url: "https://rubygems.org",
        default: true,
      },
    },
    packagist: {
      packagistorg: {
        name: "Packagist",
        url: "https://repo.packagist.org",
        default: true,
      },
    },
    pub: {
      pubdev: {
        name: "pub.dev",
        url: "https://pub.dev/api",
        default: true,
      },
    },
    swift: {
      github: {
        name: "GitHub",
        url: "https://api.github.com",
        default: true,
      },
    },
    "github-actions": {
      github: {
        name: "GitHub",
        url: "https://api.github.com",
        default: true,
      },
    },
  },
};
