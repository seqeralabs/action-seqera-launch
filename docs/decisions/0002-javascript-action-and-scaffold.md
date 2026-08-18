# 2. JavaScript action, and the repo scaffold

Date: 2026-08-18

## Status

Accepted

## Context

This action supersedes `seqeralabs/action-tower-launch`, which ran as
`runs.using: docker` and drove the `tw` CLI from `entrypoint.sh`. The whole
reason for a rewrite (action-tower-launch#28) is that the Docker + CLI nesting
made failures unreadable: by the time an error surfaced it had passed through a
container, a CLI, and a shell script, and arrived as an exit code.

GitHub offers two viable shapes — a composite action (YAML steps shelling out)
and a JavaScript action (TypeScript bundled to a single file, declared
`runs.using: node24`) — and this repository is the first JavaScript action in
the `seqeralabs` org, so there is no in-house scaffold to copy. A survey of the
org found `action-tower-launch` (docker) and `setup-seqerakit` (composite) as
the only authored Actions, no org-wide contributing or style guide in
`seqeralabs/.github`, and a weak house pattern of npm + Prettier + pre-commit,
with the test framework varying per repository.

## Decision

Build a **TypeScript JavaScript action**, with a **single `action.yml` at the
repository root**.

**A composite action cannot produce a good error message, which is the entire
reason for the rewrite.** The complaint that opened action-tower-launch#28 was
exactly that, against the Docker + `tw` nesting doll. A composite action is the
same nesting doll one layer up — `curl` and `jq` in bash — and still yields an
exit code and a shrug.

Concretely, what the JavaScript action buys:

- Failure diagnosis reads `errorMessage`, `errorReport`, and `exitStatus` from
  `GET /workflow/{id}` as typed fields, then fetches `?search=status:failed`
  tasks and tails their `.command.err`. In bash that is `jq` gymnastics with no
  error handling; in TypeScript it is a function with unit tests.
- The polling loop is real logic — 5 s interval, a six-value status enum, and a
  requirement to tolerate unknown enum values because Seqera's docs warn they
  will add more. Vitest tests that. Bash does not get tested.
- Secret masking comes from `@actions/core`. v2's `verbose` flag wrote unmasked
  HTTP bodies containing the access token to `tower_action_*.log` — a
  bash-shaped bug that the toolkit prevents by default.

The cost is exactly one thing: a build step and a committed `dist/`. The only
genuine argument for composite is "no build tooling", and it trades away the
capability the action exists to provide.

A single root action is what the Marketplace requires and what callers already
expect from v2, where waiting was an input rather than a separate action. If
the monitoring decision later splits launching from waiting, sibling actions
can be added in subdirectories without moving this one.

The scaffold:

| Concern | Choice |
| --- | --- |
| Runtime | `runs.using: node24`; `.node-version` pinned to 24; ESM (`"type": "module"`) |
| Origin | Hand-rolled. Concepts taken from `actions/typescript-action`, no files copied |
| Bundler | Rolldown 1.2.4 → `dist/index.js`, committed |
| Tests | Vitest |
| Lint | oxlint 1.79.0, configured by `.oxlintrc.json` |
| Type-aware lint | `oxlint-tsgolint` 7.0.2001 — see the consequence below |
| Format | oxfmt 0.64.0, pinned to an exact version |
| Package manager | npm, with `package-lock.json` committed |

Layout:

```
action.yml            # name: Seqera Platform Launch, runs.using: node24, main: dist/index.js
package.json          # type: module, engines.node >=24
tsconfig.json
.oxlintrc.json
rolldown.config.ts
.node-version
src/
  index.ts            # entrypoint: read inputs, run, map errors to core.setFailed
test/                 # vitest
dist/index.js         # committed, built by rolldown
docs/decisions/       # ADRs
.github/workflows/    # ci (lint + typecheck + test), check-dist
```

The contents of `src/` beyond the entrypoint are deliberately unspecified here;
module boundaries follow from the API-client and monitoring decisions.

## Consequences

- **`oxlint --type-aware` is not a flag on the base install.** It requires
  `oxlint-tsgolint` as a second devDependency and a distinct CI invocation from
  plain `oxlint`. This matters because `typescript/no-floating-promises` — the
  rule that justifies keeping a linter at all for a polling loop full of
  `await`ed HTTP calls — is type-aware. Adding `--type-aware` to a plain
  `oxlint` install silently fails to enforce it. CI therefore runs two lint
  commands: fast `oxlint` and a type-aware pass.
- **oxfmt is pre-1.0** (0.64.0). Accepted deliberately: a formatter's blast
  radius is reformatted source, never a broken bundle. The version is pinned
  exactly so a fresh `npm ci` cannot reformat the tree unexpectedly.
- **Rolldown is 1.2.x** and less battle-tested than Rollup for the
  "one ESM file for the Actions runtime" target. It was chosen for a coherent
  all-oxc stack; the output contract is just a single ESM file, so swapping to
  Rollup is cheap if `dist/` ever misbehaves.
- **The scaffold picks are severable from the action-type decision.** Rolldown
  and oxfmt are the two immature choices here, and neither can break the
  shipped bundle in a way that is not a one-line swap back to Rollup or
  Prettier. If either is challenged, concede it on its own merits — it is not
  evidence against the JavaScript action.
- **`dist/` is committed**, so `uses: seqeralabs/action-seqera-launch@main`
  works by construction. A `check-dist` CI job guards staleness by removing
  `dist/`, reinstalling, rebuilding, and failing on a non-empty diff. This
  assumes Rolldown output is byte-stable across runs; if it is not, compare a
  hash of the built output instead of the full diff.
- **Releases are the supported entry point.** The README documents `@v1` only
  and states plainly that `@main` is unsupported and may break without notice.
  No runtime warning is emitted for untagged refs: detecting them reliably is
  awkward, and a warning would fire during exactly the branch-testing workflow
  that committing `dist/` exists to enable.
- The org has no other JavaScript action, so these choices set the precedent
  rather than follow one. The divergences from house style (Vitest over mocha,
  oxlint/oxfmt over Prettier-via-pre-commit) are deliberate, not oversights.
- Tag mechanics — how `v1` floats, and how releases are cut — are out of this
  decision's scope and belong to the release-process decision.
