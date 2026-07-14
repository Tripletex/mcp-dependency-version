/**
 * Tag conventions for GitHub Actions, including monorepos.
 *
 * A standalone action lives in its own repository and tags plain semver
 * releases (v1, v1.2, v1.2.3). A monorepo hosts several actions as
 * subdirectories (referenced as owner/repo/path@ref) and tags each action's
 * releases by prefixing the version with the action name:
 *
 *   <action>-vX.Y.Z   e.g. deploy-tool-v1.2.3
 *   <action>@vX.Y.Z   e.g. deploy-tool@v1.2.3
 *
 * The action name may itself contain dashes, so tags are matched against the
 * known action path rather than split heuristically. Repo-level tags (plain
 * vNN or vX.Y.Z) are NOT attributed to subpath actions.
 */

/**
 * Check if a tag name looks like a semver version.
 * GitHub Actions commonly use: v1, v1.0, v1.0.0, with optional
 * prerelease/build suffixes.
 */
export function isSemverTag(tag: string): boolean {
  return /^v?\d+(\.\d+)?(\.\d+)?(-[\w.]+)?(\+[\w.]+)?$/.test(tag);
}

/**
 * Strip the "v" prefix from a tag for version comparison
 */
export function stripVPrefix(tag: string): string {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

/**
 * Split an action package name into the GitHub repository slug and the
 * optional action subpath. The GitHub API only addresses owner/repo; the
 * subpath identifies the action within a monorepo.
 *
 *   "actions/checkout"        -> { repoSlug: "actions/checkout" }
 *   "org/actions/deploy"      -> { repoSlug: "org/actions", actionPath: "deploy" }
 *   "org/actions/tools/build" -> { repoSlug: "org/actions", actionPath: "tools/build" }
 */
export function splitActionPackage(
  packageName: string,
): { repoSlug: string; actionPath?: string } {
  const segments = packageName.split("/").filter((s) => s.length > 0);
  if (segments.length <= 2) {
    return { repoSlug: segments.join("/") };
  }
  return {
    repoSlug: segments.slice(0, 2).join("/"),
    actionPath: segments.slice(2).join("/"),
  };
}

/**
 * Candidate tag prefixes for an action subpath: the full subpath and its
 * last segment. Tags almost always use the action's directory name, but a
 * nested action may be tagged with its full path.
 */
function prefixCandidates(actionPath: string): string[] {
  const segments = actionPath.split("/");
  const last = segments[segments.length - 1];
  return segments.length > 1 ? [actionPath, last] : [last];
}

/**
 * Match a tag against a monorepo action's naming convention.
 * Accepts "<action>-vX.Y.Z" and "<action>@vX.Y.Z" (with or without the
 * leading "v"). Returns the version (v-prefix stripped) or null when the
 * tag does not belong to this action.
 */
export function matchActionTag(
  tagName: string,
  actionPath: string,
): { version: string } | null {
  for (const prefix of prefixCandidates(actionPath)) {
    for (const separator of ["-", "@"]) {
      const lead = `${prefix}${separator}`;
      if (tagName.startsWith(lead)) {
        const rest = tagName.slice(lead.length);
        if (isSemverTag(rest)) {
          return { version: stripVPrefix(rest) };
        }
      }
    }
  }
  return null;
}

/**
 * Extract the version from a tag for a given package: plain semver tags for
 * standalone actions, action-prefixed tags for monorepo subpath actions.
 * Returns null for tags that do not version this package.
 */
export function versionFromTag(
  tagName: string,
  actionPath?: string,
): string | null {
  if (actionPath) {
    return matchActionTag(tagName, actionPath)?.version ?? null;
  }
  return isSemverTag(tagName) ? stripVPrefix(tagName) : null;
}

/**
 * Build the version extractor to use for a repository's tag list.
 *
 * Subpath actions come in two flavors and the tag list decides which one
 * applies:
 * - Monorepos with per-action releases use prefixed tags
 *   (<action>-vX.Y.Z / <action>@vX.Y.Z); when any exist for this action,
 *   only they count.
 * - Repositories like github/codeql-action version their subpath actions
 *   (init, analyze, ...) with plain repo-level semver tags; when no
 *   prefixed tags exist, fall back to those.
 *
 * The returned extractor must be applied to release tag names as well, so
 * both sources agree on which tags version the package.
 */
export function tagVersionExtractor(
  tagNames: string[],
  actionPath?: string,
): (tagName: string) => string | null {
  if (
    actionPath &&
    tagNames.some((t) => matchActionTag(t, actionPath) !== null)
  ) {
    return (t) => matchActionTag(t, actionPath)?.version ?? null;
  }
  return (t) => (isSemverTag(t) ? stripVPrefix(t) : null);
}

/**
 * Normalize a workflow "uses:" version reference for comparison against
 * registry versions. Strips a monorepo action prefix when present, then the
 * leading "v": ("deploy-v1.2.3", "deploy") -> "1.2.3", "v4" -> "4".
 */
export function normalizeActionRef(
  reference: string,
  actionPath?: string,
): string {
  if (actionPath) {
    const matched = matchActionTag(reference, actionPath);
    if (matched) {
      return matched.version;
    }
  }
  return stripVPrefix(reference);
}
