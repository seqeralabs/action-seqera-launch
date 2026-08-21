# Release and versioning process

## Tagging

Releases are SemVer tags `vX.Y.Z`, each with a GitHub Release. A floating **`v1`** tag is maintained and is what the README documents; no `v1.1` or other minor-level floating tags, which would multiply the tags to move on every release without a clear beneficiary.

The floating tag deliberately has **no Release attached**. This is the mechanism `action-tower-launch` already uses — its `v2` is a bare git tag pointing at the same commit as `v2.3.0`, with no Release object — and it is what makes repointing possible at all, since immutable releases freeze only tags attached to a Release. Proven in this org, so no new risk.

Note that consumers inside `seqeralabs` cannot use `@v1` regardless: org policy requires every `uses:` to be pinned to a full-length commit SHA, which this repository's own workflows hit during the scaffold work. The floating tag is for external consumers and for documentation; internal callers pin commits.

## Automation

A workflow triggered by pushing a `vX.Y.Z` tag builds, verifies, creates the Release, and moves the floating `v1` tag. Release logic lives in-repo where it is reviewable, rather than depending on whatever state a maintainer's machine happens to be in — which is precisely how stale-`dist/` bugs ship.

The release workflow **rebuilds `dist/` and refuses to release on any diff**. `check-dist` already proves the build is byte-stable on Linux CI, so a diff at release time means the tagged commit's `dist/` is stale. Publishing a stale bundle is the one failure that would ship broken code to every consumer simultaneously, and it is cheap to make impossible.

Release Please and changesets were rejected: good changelogs, but a heavy dependency plus another pinned action for a repository expected to cut a few releases a year.

## First release

**v1.0.0 is preceded by pre-releases**, starting `v1.0.0-rc.1`. The action depends on `effect@4.0.0-rc.110`, which is itself not GA, and no run has been launched through it in anger. An rc lets nf-core exercise it without `@v1` implying a stability we have not earned.

Marketplace publishing happens at **v1.0.0, not at the rc**. A listing signals readiness, and rc testers can use `v1.0.0-rc.1` directly, which needs no listing. The display name is fixed by [ADR 0001](0001-action-repository-name.md) as `Seqera Platform Launch`, chosen independently of the repository slug.

## Spec bumps

An OpenAPI spec bump implies a release **only when the generated types we actually use change behaviour**. The advisory drift PR otherwise lands as an ordinary commit. This costs a judgement call per bump, but the alternative is either releasing on an upstream spec's schedule or letting shipped types drift from the live API.

## Branding

`icon: play`, `color: green`. The icon carries over from `action-tower-launch`; the colour does not — v2 used `purple`, which the brand guidelines at brand.seqera.net do not support. Seqera's brand is green, and green is the nearest of GitHub's nine permitted colour names to any Seqera green. Branding only surfaces in the Marketplace listing, which happens at v1.0.0, so it does not block the rc.

## Out of scope

`action-tower-launch` deprecation messaging. It is a change to a different repository and should not gate v1's release process; it stays tracked on the map.
