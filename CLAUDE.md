# Project guidance for Claude

## Pre-push checklist

CI (`.github/workflows/pr-check.yml`) runs four gates and **fails the PR if any
gate fails**. Run all four locally before pushing — `deno task check` and
`deno task test` alone are not sufficient.

```bash
deno fmt --check    # CI gate 1 — formatting
deno lint           # CI gate 2 — lint
deno check main.ts  # CI gate 3 — type check
deno test --allow-net  # CI gate 4 — tests
```

Or as a single command:

```bash
deno fmt --check && deno lint && deno check main.ts && deno test --allow-net
```

### Formatting (the most common failure)

`deno fmt --check` is strict about line breaks in import statements, type
unions, and ternaries. The Deno formatter has opinions that don't always match
what an LLM will produce on the first try. **Always** run `deno task fmt` (which
auto-fixes) after writing or editing TypeScript or Markdown files, then verify
with `deno fmt --check`.

If CI fails on formatting after a push, the fix is:

```bash
deno task fmt
git add -u && git commit -m "Apply deno fmt formatting"
git push
```

## Project conventions

- **Runtime**: Deno v2.x. No Node.js or npm install — dependencies are declared
  in `deno.json` `imports` and resolved via JSR/npm specifiers.
- **No emojis** in code, comments, or commits unless explicitly requested.
- **Commit style**: plain imperative ("Add X", "Fix Y") — not conventional
  commits. Subject under 72 chars, explain _why_ in the body when not obvious.
- **No `Co-Authored-By` trailer** on commits unless explicitly requested.

## Architecture cheat sheet

- `main.ts` — entry point; registers all MCP tools on stdio transport
- `src/registries/` — one client per package registry (npm, maven, pypi, etc.)
- `src/parsers/` — one parser per dependency file format
- `src/tools/` — MCP tool implementations
- `src/utils/` — shared utilities (cache, http, version parsing, vulnerability)
- `src/config/` — custom registry/auth configuration loader

When adding a new registry, you typically need: a registry client
(`src/registries/X.ts`), a parser if it has a dependency file format
(`src/parsers/X.ts`), and registration in `src/registries/index.ts` and
`src/parsers/index.ts`. Update the tool input enums in `src/tools/*.ts` and the
registry list in `README.md`.

## Vulnerability checking

Two databases are queried in parallel and merged by CVE ID:

- **OSV** (`api.osv.dev`) — package-native, broad ecosystem coverage
- **NVD** (`services.nvd.nist.gov`) — authoritative CVSS v3.1 + CWE

Both are cached **per-package** (not per-version) — checking different versions
of the same package reuses the cached API responses. Version filtering happens
client-side via `osvAffectsVersion` and `cveAffectsVersion`. When changing
either, update the tests in `src/utils/vulnerability.test.ts`.

Set `NVD_API_KEY` env var for higher NVD rate limits (50 vs 5 requests/30s).
