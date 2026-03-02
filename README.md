# MCP Dependency Version

A Model Context Protocol (MCP) server for looking up package versions across
multiple package registries.

## Features

- **Multi-registry support**: npm, Maven Central, PyPI, crates.io, Go proxy,
  JSR, NuGet, Docker Hub, RubyGems, Packagist, pub.dev, Swift PM
- **Version lookup**: Get the latest stable (and optionally prerelease) versions
- **Version listing**: List all available versions with metadata
- **Vulnerability scanning**: Check packages against the OSV (Open Source
  Vulnerabilities) database
- **Dependency analysis**: Analyze dependency files and check for updates
- **Docker support**: Look up image tags and analyze
  Dockerfile/docker-compose.yml dependencies

## Security: Use Exact Versions

**Always use exact versions instead of version ranges to prevent supply chain
attacks.**

| Bad (vulnerable) | Good (secure) |
| ---------------- | ------------- |
| `^1.2.3`         | `1.2.3`       |
| `~1.2.3`         | `1.2.3`       |
| `>=1.2.3`        | `1.2.3`       |
| `1.x`            | `1.2.3`       |

Version ranges (like `^1.2.3` or `~1.2.3`) allow automatic updates when new
minor or patch versions are published. If an attacker compromises a package and
publishes a malicious version, your project could automatically pull it in
without your knowledge.

Using exact versions ensures you control exactly which code runs in your
project. When you want to update, explicitly change the version and review the
changes.

### Docker: Use Digest-Pinned References

**Docker tags are NOT immutable.** Unlike package versions in npm/PyPI/etc., a
Docker tag can be moved to point to a completely different image at any time.

| Bad (vulnerable) | Good (secure)               |
| ---------------- | --------------------------- |
| `nginx:1.27.3`   | `nginx@sha256:1948e0c46...` |
| `postgres:16`    | `postgres@sha256:abc123...` |

When you use `nginx:1.27.3`, the image you pull today may be different from the
one you pull tomorrow if the tag is updated. This creates a supply chain attack
vector.

**Use digest-pinned references** (`image@sha256:...`) to ensure you always pull
the exact same image. The `lookup_version` and `list_versions` tools return the
`digest` and `secureReference` fields for Docker images to make this easy.

## Supported Registries

| Registry  | API Endpoint           | Package Format                   |
| --------- | ---------------------- | -------------------------------- |
| npm       | registry.npmjs.org     | `package-name`, `@scope/package` |
| maven     | repo1.maven.org/maven2 | `groupId:artifactId`             |
| pypi      | pypi.org               | `package-name`                   |
| cargo     | crates.io              | `crate-name`                     |
| go        | proxy.golang.org       | `github.com/user/repo`           |
| jsr       | api.jsr.io             | `@scope/name`                    |
| nuget     | api.nuget.org          | `Package.Name`                   |
| docker    | hub.docker.com         | `image`, `user/image`            |
| rubygems  | rubygems.org           | `gem-name`                       |
| packagist | packagist.org          | `vendor/package`                 |
| pub       | pub.dev                | `package_name`                   |
| swift     | api.github.com         | `owner/repo`                     |

## Installation

### Prerequisites

- [Deno](https://deno.land/) v2.x or later

### Setup with Claude Desktop

Add to your Claude Desktop configuration file
(`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS,
`~/.config/claude-desktop/claude_desktop_config.json` on Linux):

```json
{
  "mcpServers": {
    "mcp-dependency-version": {
      "command": "deno",
      "args": [
        "run",
        "--allow-net",
        "--allow-env",
        "--allow-read",
        "/path/to/mcp-dependency-version/main.ts"
      ]
    }
  }
}
```

### Setup with Claude Code CLI

```bash
claude mcp add mcp-dependency-version -- deno run --allow-net --allow-env --allow-read /path/to/mcp-dependency-version/main.ts
```

### Setup with Docker

The service is available as a Docker image using stdio transport.

**Pull the image:**

```bash
docker pull ghcr.io/tripletex/mcp-dependency-version:latest
```

**Run directly:**

```bash
docker run --rm -i ghcr.io/tripletex/mcp-dependency-version:latest
```

**Claude Desktop configuration:**

```json
{
  "mcpServers": {
    "mcp-dependency-version": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "ghcr.io/tripletex/mcp-dependency-version:latest"
      ]
    }
  }
}
```

### Local Development

1. Clone the repository:
   ```bash
   git clone https://github.com/tripletex/mcp-dependency-version.git
   cd mcp-dependency-version
   ```

2. Run the server:
   ```bash
   deno task start
   ```

## Configuration

The server supports custom repository configurations for each registry type.
This allows you to use private registries, mirrors, or multiple repositories per
registry.

### Configuration File

Create a configuration file at `~/.config/mcp-dependency-version/config.json`:

```json
{
  "repositories": {
    "npm": {
      "npmjs": {
        "name": "npm",
        "url": "https://registry.npmjs.org",
        "default": true
      },
      "github": {
        "name": "GitHub Packages",
        "url": "https://npm.pkg.github.com",
        "auth": {
          "token": "ghp_xxxxxxxxxxxx"
        }
      }
    },
    "maven": {
      "central": {
        "name": "Maven Central",
        "url": "https://repo1.maven.org/maven2",
        "default": true
      },
      "atlassian": {
        "name": "Atlassian Maven",
        "url": "https://packages.atlassian.com/maven/public"
      },
      "jitpack": {
        "name": "JitPack",
        "url": "https://jitpack.io"
      }
    },
    "pypi": {
      "pypi": {
        "name": "PyPI",
        "url": "https://pypi.org/pypi",
        "default": true
      },
      "private": {
        "name": "Private PyPI",
        "url": "https://pypi.example.com/simple",
        "auth": {
          "username": "user",
          "password": "pass"
        }
      }
    }
  }
}
```

### Environment Variable

You can override the config file path using the `MCP_DEPENDENCY_VERSION_CONFIG`
environment variable:

```bash
export MCP_DEPENDENCY_VERSION_CONFIG=/path/to/config.json
```

### Authentication

The configuration supports two authentication methods:

**Bearer Token:**

```json
{
  "auth": {
    "token": "your-token-here"
  }
}
```

**Basic Auth:**

```json
{
  "auth": {
    "username": "user",
    "password": "pass"
  }
}
```

### Default Repositories

If no configuration file exists, the server uses the official public registries:

| Registry  | Default URL                     |
| --------- | ------------------------------- |
| npm       | https://registry.npmjs.org      |
| maven     | https://repo1.maven.org/maven2  |
| pypi      | https://pypi.org/pypi           |
| cargo     | https://crates.io/api/v1/crates |
| go        | https://proxy.golang.org        |
| jsr       | https://api.jsr.io              |
| nuget     | https://api.nuget.org/v3        |
| docker    | https://hub.docker.com          |
| rubygems  | https://rubygems.org            |
| packagist | https://repo.packagist.org      |
| pub       | https://pub.dev/api             |
| swift     | https://api.github.com          |

## Tools

### lookup_version

Look up the latest version of a package.

**Parameters:**

- `registry` (required): Package registry (`npm`, `maven`, `pypi`, `cargo`,
  `go`, `jsr`, `nuget`, `docker`, `rubygems`, `packagist`, `pub`, `swift`)
- `package` (required): Package name
- `includePrerelease` (optional): Include alpha/beta/rc versions
- `versionPrefix` (optional): Filter versions by prefix (e.g., `"2."` for 2.x)

**Example:**

```json
{
  "registry": "npm",
  "package": "lodash"
}
```

**Output:**

```json
{
  "packageName": "lodash",
  "registry": "npm",
  "latestStable": "4.17.21",
  "publishedAt": "2021-02-20T15:42:16.891Z"
}
```

**Docker Output (includes digest for secure pinning):**

```json
{
  "packageName": "nginx",
  "registry": "docker",
  "latestStable": "1.27.3",
  "publishedAt": "2024-12-04T18:51:59.819Z",
  "digest": "sha256:1948e0c46da16a3565a844aa65ab848e1546f85cf47e47d044a567906a3a497f",
  "secureReference": "nginx@sha256:1948e0c46da16a3565a844aa65ab848e1546f85cf47e47d044a567906a3a497f",
  "securityNotes": [
    "WARNING: Docker tags are NOT immutable. A tag can be moved to point to a different image at any time.",
    "Using the digest-pinned reference (image@sha256:...) provides protection against tag tampering.",
    "Digest-pinned references ensure you always pull the exact same image, preventing supply chain attacks.",
    "When updating, explicitly change the digest and verify the new image before deployment."
  ]
}
```

### list_versions

List all available versions of a package.

**Parameters:**

- `registry` (required): Package registry
- `package` (required): Package name
- `limit` (optional): Maximum versions to return (default: 20)

**Example:**

```json
{
  "registry": "pypi",
  "package": "requests",
  "limit": 5
}
```

**Output:**

```json
{
  "packageName": "requests",
  "registry": "pypi",
  "versions": [
    {
      "version": "2.31.0",
      "publishedAt": "2023-05-22T15:12:44.000Z",
      "isPrerelease": false,
      "isDeprecated": false
    }
  ],
  "totalCount": 142,
  "showing": 5
}
```

### check_vulnerabilities

Check a package version for known security vulnerabilities.

**Parameters:**

- `registry` (required): Package registry
- `package` (required): Package name
- `version` (required): Version to check
- `severityThreshold` (optional): Minimum severity (`LOW`, `MEDIUM`, `HIGH`,
  `CRITICAL`)

**Example:**

```json
{
  "registry": "npm",
  "package": "lodash",
  "version": "4.17.20"
}
```

**Output:**

```json
{
  "packageName": "lodash",
  "version": "4.17.20",
  "registry": "npm",
  "vulnerabilities": [
    {
      "id": "GHSA-29mw-wpgm-hmr9",
      "summary": "Prototype Pollution in lodash",
      "severity": "HIGH",
      "cveIds": ["CVE-2021-23337"],
      "fixedVersions": ["4.17.21"]
    }
  ],
  "totalCount": 1,
  "hasVulnerabilities": true,
  "summary": {
    "critical": 0,
    "high": 1,
    "medium": 0,
    "low": 0
  }
}
```

### analyze_dependencies

Analyze a dependency file and check for available updates.

**Parameters:**

- `content` (required): File content (package.json, pom.xml, build.gradle,
  build.gradle.kts, requirements.txt, Cargo.toml, go.mod, deno.json, *.csproj,
  Gemfile, composer.json, pubspec.yaml, Package.swift)
- `registry` (required): Package registry (use `maven` for Gradle files)
- `checkVulnerabilities` (optional): Also scan for vulnerabilities (default:
  false)

**Supported Dependency Files:**

| Registry  | File Formats                                                    |
| --------- | --------------------------------------------------------------- |
| npm       | `package.json`                                                  |
| maven     | `pom.xml`, `build.gradle` (Groovy), `build.gradle.kts` (Kotlin) |
| pypi      | `requirements.txt`                                              |
| cargo     | `Cargo.toml`                                                    |
| go        | `go.mod`                                                        |
| jsr       | `deno.json` (supports jsr: and npm: imports)                    |
| nuget     | `*.csproj` (PackageReference format)                            |
| docker    | `Dockerfile`, `docker-compose.yml`                              |
| rubygems  | `Gemfile`                                                       |
| packagist | `composer.json`                                                 |
| pub       | `pubspec.yaml`                                                  |
| swift     | `Package.swift`                                                 |

**Note:** For Gradle files, variable references (`$version`, `${libs.xxx}`,
version catalogs) are skipped since they can't be resolved without evaluating
the build.

**Example (npm):**

```json
{
  "content": "{\"dependencies\": {\"lodash\": \"^4.17.20\", \"express\": \"^4.18.0\"}}",
  "registry": "npm",
  "checkVulnerabilities": true
}
```

**Example (Gradle Kotlin DSL):**

```json
{
  "content": "dependencies {\n    implementation(\"org.springframework.boot:spring-boot-starter:3.2.0\")\n    testImplementation(\"org.junit.jupiter:junit-jupiter:5.10.0\")\n}",
  "registry": "maven"
}
```

**Output:**

```json
{
  "registry": "npm",
  "dependencies": [
    {
      "name": "lodash",
      "currentVersion": "4.17.20",
      "latestVersion": "4.17.21",
      "updateAvailable": true,
      "updateType": "patch",
      "vulnerabilities": [
        { "id": "GHSA-29mw-wpgm-hmr9", "summary": "Prototype Pollution" }
      ]
    },
    {
      "name": "express",
      "currentVersion": "4.18.0",
      "latestVersion": "4.18.2",
      "updateAvailable": true,
      "updateType": "patch",
      "vulnerabilities": []
    }
  ],
  "summary": {
    "total": 2,
    "outdated": 2,
    "vulnerable": 1,
    "deprecated": 0,
    "majorUpdates": 0,
    "minorUpdates": 0,
    "patchUpdates": 2
  }
}
```

### get_package_docs

Get README documentation for a package.

**Parameters:**

- `registry` (required): Package registry (`npm`, `maven`, `pypi`, `cargo`,
  `go`, `jsr`, `nuget`, `docker`, `rubygems`, `packagist`, `pub`, `swift`)
- `package` (required): Package name
- `version` (optional): Specific version to get documentation for

**Documentation Sources:**

| Registry  | README Source              | Repository URL Source       |
| --------- | -------------------------- | --------------------------- |
| npm       | Registry API               | `repository` field          |
| pypi      | Registry API (description) | `project_urls` field        |
| cargo     | Registry API               | `repository` field          |
| maven     | GitHub (fallback)          | POM `<scm>` section         |
| go        | GitHub (fallback)          | Module path (if github.com) |
| jsr       | GitHub (fallback)          | `githubRepository` field    |
| nuget     | GitHub (fallback)          | Catalog entry               |
| docker    | GitHub (fallback)          | Docker Hub page             |
| rubygems  | Registry API (info)        | `source_code_uri` field     |
| packagist | Registry API (description) | `repository` field          |
| pub       | Registry API (description) | `repository` field          |
| swift     | GitHub (fallback)          | GitHub repository URL       |

**Example:**

```json
{
  "registry": "npm",
  "package": "lodash"
}
```

**Output:**

```
# lodash Documentation
Registry: npm
Source: registry
Documentation: https://www.npmjs.com/package/lodash
Repository: https://github.com/lodash/lodash

---

# lodash

A modern JavaScript utility library delivering modularity, performance & extras.
...
```

## Development

### Commands

```bash
# Type check
deno task check

# Run tests
deno task test

# Start server
deno task start

# Start with file watching
deno task dev

# Lint
deno task lint

# Format
deno task fmt
```

### Project Structure

```
src/
├── config/       # Configuration loading
├── registries/   # Registry client implementations (npm, maven, pypi, etc.)
├── parsers/      # Dependency file parsers (package.json, pom.xml, etc.)
├── tools/        # MCP tool implementations
└── utils/        # Shared utilities (version parsing, caching, HTTP)
```

## API Reference

### Registry APIs

| Registry  | API Endpoint                                     | Documentation                                                            |
| --------- | ------------------------------------------------ | ------------------------------------------------------------------------ |
| npm       | `registry.npmjs.org/{package}`                   | [docs](https://github.com/npm/registry/blob/master/docs/REGISTRY-API.md) |
| Maven     | `repo1.maven.org/maven2`                         | [docs](https://central.sonatype.com/search)                              |
| PyPI      | `pypi.org/pypi/{package}/json`                   | [docs](https://warehouse.pypa.io/api-reference/json.html)                |
| Cargo     | `crates.io/api/v1/crates/{crate}`                | [docs](https://crates.io/data-access)                                    |
| Go        | `proxy.golang.org/{module}/@v/list`              | [docs](https://go.dev/ref/mod#goproxy-protocol)                          |
| JSR       | `api.jsr.io/scopes/{scope}/packages/{name}`      | [docs](https://jsr.io/docs/api)                                          |
| NuGet     | `api.nuget.org/v3-flatcontainer/{id}/index.json` | [docs](https://learn.microsoft.com/en-us/nuget/api/overview)             |
| Docker    | `hub.docker.com/v2/repositories/{image}/tags`    | [docs](https://docs.docker.com/docker-hub/api/latest/)                   |
| RubyGems  | `rubygems.org/api/v1/gems/{gem}.json`            | [docs](https://guides.rubygems.org/rubygems-org-api/)                    |
| Packagist | `repo.packagist.org/p2/{vendor}/{package}.json`  | [docs](https://packagist.org/apidoc)                                     |
| Pub       | `pub.dev/api/packages/{package}`                 | [docs](https://pub.dev/help/api)                                         |
| Swift     | `api.github.com/repos/{owner}/{repo}/tags`       | [docs](https://docs.github.com/en/rest/repos/repos)                      |
| OSV       | `api.osv.dev/v1/query`                           | [docs](https://osv.dev/docs/)                                            |

## License

MIT
