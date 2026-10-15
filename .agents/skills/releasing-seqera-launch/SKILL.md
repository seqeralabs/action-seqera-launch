---
name: releasing-seqera-launch
description: Cuts and verifies releases of action-seqera-launch using its tag-triggered GitHub workflow. Use when asked to cut a release, publish a version, or finish a failed release.
---

# Release Seqera Launch

Run from the repository root with authenticated `gh` and Git push access. A request to cut a release authorizes pushing its version tag and publishing that release, not unrelated commits or deployments.

## Choose the target and version

Read [ADR 0007](../../../docs/decisions/0007-release-and-versioning.md) for versioning policy and [release.yml](../../../.github/workflows/release.yml) for the executable release process.

```sh
git status --short --branch
gh repo view --json nameWithOwner,defaultBranchRef
git remote -v
gh release list
git ls-remote --heads --tags origin
```

Confirm `origin` is the intended repository. Fetch its actual default branch and tags, then inspect commits since the last release. Select the fetched default-branch commit unless the user names another target. Local HEAD can be detached or behind the remote; leave the user's checkout and unrelated work unchanged.

Choose the next SemVer version from the changes and existing releases. While the project remains in its release-candidate phase, increment the rc number rather than implicitly promoting it to stable. State the selected version and commit before publishing. Stable releases move the floating major tag; prereleases leave it untouched. Follow ADR 0007 for Marketplace scope.

## Verify before tagging

Inspect `ci`, `check-dist`, and `Integration` runs for the exact target SHA:

```sh
gh run list --commit "$sha" --json databaseId,headSha,workflowName,status,conclusion,url
```

Require successful applicable checks. Investigate failed, missing, or skipped checks rather than treating them as passes. The release workflow repeats static checks, unit tests, and bundle freshness verification, but does not run live integration. Dispatching integration creates a real Platform run and requires authorization for that operation.

Release the committed bundle, not a local rebuild. If checks require a source or bundle fix, land it through the normal repository process before choosing a new target SHA. The private package version is not the release trigger; the Git tag is.

## Publish through the workflow

Set `version` to the chosen tag and `sha` to the full verified commit SHA. Confirm the version does not already exist locally or remotely, then:

```sh
git tag -a "$version" "$sha" -m "Release $version"
git push origin "refs/tags/$version"
gh run list --workflow release.yml --branch "$version" --limit 1 \
  --json databaseId,headSha,status,conclusion,url
gh run watch "$run_id" --exit-status
```

Use the returned run ID and verify its `headSha` matches the target. If the run has not appeared yet, query again after a short wait. The workflow owns Release creation and floating-major-tag updates. Avoid creating a competing Release manually while it runs.

If publication fails or a connection drops, inspect the remote tag, workflow, and Release before retrying. An immutable version tag must keep its original commit. Fix defective code in a new commit and cut a new version; rerun a failed workflow only when the failure is transient and existing publication state makes the retry safe.

## Check notes and publication

```sh
gh release view "$version" --json url,tagName,isDraft,isPrerelease,publishedAt,body
git ls-remote --tags origin "refs/tags/$version" "refs/tags/$version^{}"
```

Confirm the tag resolves to the intended SHA and the Release is published with the correct prerelease status. For a stable release, also confirm the floating major tag resolves to that SHA and has no Release attached. For a prerelease, confirm the floating tag was not moved.

Review the generated notes against the actual commits. GitHub's generated notes can contain only a comparison link when changes landed directly rather than through PRs. In that case, use `gh release edit "$version" --notes-file <file>` to add a short change summary, relevant usage, and a changelog link. Preserve the prerelease designation. Include the full commit pin for internal `seqeralabs` callers, which cannot use version tags in `uses:`.

Judge validation by step conclusions, test totals, and bundle comparison, not log annotation counts alone. Tests of error reporting intentionally print GitHub error commands; these can create red annotations in a successful run. Investigate unexpected errors, but do not call passing tests failures solely because of those annotations.

Finish with the Release URL, consumer reference, internal commit pin, verification outcome, and whether the floating tag or Marketplace listing changed. Report partial publication explicitly. Keep existing published versions intact; a defective release is normally superseded by a new version rather than silently retagged.
