# Plan: Resolving floating references to concrete pins

## Problem

`lookup_version` and the registry clients only ever answer "what is the newest
version." There is no way to take a **specific floating reference** a project is
already on -- a git branch (`uses: org/action@main`), a floating major tag
(`@v4`), or a named channel (npm `next`, docker `latest`) -- and resolve it to
its current concrete target (a version, and where applicable a commit SHA /
digest).

This matters most for **GitHub Actions**, where:

- Branch/tag refs are legitimate and common, but tags are mutable and can be
  force-pushed. The recommended supply-chain practice is to pin to a commit SHA
  in the workflow YAML itself.
- There is **no lockfile** to pin the ref out of band (unlike Go's `go.mod`
  pseudo-versions + `go.sum`, or Composer's `composer.lock` reference SHA, which
  already pin floating refs to commits). The workflow YAML is the only source of
  truth, so we must do the resolution.

Today `GitHubActionsClient.lookupVersion` ignores the requested ref entirely: it
scans semver tags and returns the latest tag's SHA. For `@main` this returns the
wrong commit, and for an action with no semver tags it throws.

## Key insight: floating selector, two resolvers

`@v4` and `@main` are both floating pointers, but they resolve by different
mechanisms:

| Selector          | Resolves by                               | Mechanism          |
| ----------------- | ----------------------------------------- | ------------------ |
| `@v4`, `4.1.`     | max of an ordered set (semver ranking)    | `versionPrefix`    |
| `@main`, `latest` | dereference a named pointer (ask the API) | `versionReference` |

`versionPrefix` is built entirely on the first mechanism (`filterByPrefix` is a
string prefix, then `resolveLatestVersions` ranks by semver). A branch has no
set to rank -- it has exactly one answer that comes from asking the registry. So
a branch name cannot ride the `versionPrefix` path.

We do **not** auto-detect semver-vs-ref server-side: `1` could be a semver
prefix or a tag literally named `1`. The caller (which has manifest context)
picks the right field. That is why the two are separate, explicitly-named
inputs.

## Design

### New input: `versionReference` on `lookup_version`

Optional string, sibling to `versionPrefix`, mutually exclusive with it.

- `versionPrefix` -> semver line, return newest match (e.g. `"4."`).
- `versionReference` -> resolve a floating NON-semver target (e.g. `"main"`,
  `"next"`, `"latest"`) to its concrete current version / commit / digest.

The `.describe()` text states the SEMVER-vs-NON-semver routing rule in caps,
gives per-registry examples, and cross-references the other field, so an LLM
routes correctly.

### New capability: `resolveReference?()` on `RegistryClient`

Optional method, mirroring the existing `getVersionDependencies?()`
optional-capability pattern. Registries that have a floating-pointer concept
implement it; the rest do not, and the tool returns a clean "reference
resolution not supported for registry X".

```ts
resolveReference?(
  packageName: string,
  reference: string,
  options?: LookupOptions,
): Promise<VersionInfo>;
```

### Return shape: reuse `VersionInfo`, add signals

The result is still "the concrete pinned identity of a package target," so we
reuse `VersionInfo` and add:

- `isMutable?: boolean` -- true when a floating reference was resolved; signals
  the pin will drift and that "updating" means re-resolving the reference.
- `resolvedReference?: string` -- echoes the reference that was resolved.

For a pure branch (actions `@main`) there is no version, so `latestStable` is
the ref name and `digest` carries the commit SHA. For npm a dist-tag resolves to
a concrete `latestStable` version with no hash.

### Per-registry mapping

| Registry       | `reference` example      | Resolves to      | Data source                                  |
| -------------- | ------------------------ | ---------------- | -------------------------------------------- |
| github-actions | `main`, `v4`             | commit SHA       | `GET /repos/{name}/commits/{ref}` (new call) |
| npm            | `next`, `beta`, `latest` | concrete version | `dist-tags` map (already fetched)            |
| docker         | `latest`, `stable`       | `sha256:` digest | per-tag digest (already fetched)             |
| go             | `latest`, `master`       | pseudo-version   | future                                       |
| packagist      | `dev-main`               | commit reference | future                                       |
| others         | only `latest` meaningful | -                | not implemented -> clear error               |

### Ref-aware security notes (github-actions)

Current notes assume "you are on a tag." When a branch is resolved, the notes
must say: you are tracking mutable branch `<ref>`, its current commit is
`<sha>`, pin to that SHA, and "updating" means re-resolving the branch (not
moving to a release).

## Scope

- **v1 (this change):** interface + types, github-actions (the real need), npm
  and docker (nearly free from data already fetched), tool wiring, tests, docs.
- **Later:** go pseudo-versions, packagist dev branches, and parsing Deno
  `raw.githubusercontent.com` URL imports (would reuse the actions primitive).

## Out of scope

- Go / Packagist do not need this -- their toolchains already pin floating refs
  to hashes via `go.mod`/`go.sum` and `composer.lock`.
- Deno `jsr:`/`npm:` specifiers are semver; Deno GitHub URL imports are not
  parsed today and are a separate feature.

## Task list

1. (done) Clarify github-actions security notes reference the `digest` field.
2. Extend `VersionInfo` (`isMutable`, `resolvedReference`) and add
   `resolveReference?()` to `RegistryClient`.
3. Implement `github-actions.resolveReference` (commit-SHA resolution +
   ref-aware notes).
4. Implement `npm.resolveReference` (dist-tag) and `docker.resolveReference`
   (tag -> digest).
5. Add `versionReference` param to the `lookup_version` tool with LLM-facing
   description and graceful degradation.
6. Tests, README update, run the four CI gates, commit.
