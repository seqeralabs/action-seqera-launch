# 1. Repository name: `action-seqera-launch`

Date: 2026-05-12

## Status

Accepted

## Context

This repository holds the GitHub Action that launches pipelines on Seqera
Platform, superseding `seqeralabs/action-tower-launch`. We needed a permanent
repository name before creating the remote and publishing to the GitHub
Marketplace. Candidates considered were `seqera-platform-launch`,
`action-seqera-platform-launch`, and `action-seqera-launch`.

## Decision

Name the repository `action-seqera-launch`.

- The `action-` prefix matches the existing convention set by
  `action-tower-launch`, and makes the repository's purpose obvious when
  browsing the `seqeralabs` org listing.
- Dropping `platform` keeps the name short without losing meaning. "Seqera"
  on its own now unambiguously refers to the Platform; "Tower" is the legacy
  name.
- The usage string stays clean:
  `uses: seqeralabs/action-seqera-launch@v1`, versus the noticeably clunkier
  three-word variant.

The Marketplace display name is unaffected: it is set independently to
"Seqera Platform Launch" via the `name:` field in `action.yml`.

## Consequences

- The local working directory was renamed from `seqera-platform-launch` to
  `action-seqera-launch`.
- The Git remote is `https://github.com/seqeralabs/action-seqera-launch`.
- Any planning material that describes creating this repository must use the
  new name; in particular the repo-creation wording in ticket 007 needs
  updating (that ticket is tracked outside this repository).
- `action.yml` keeps `name: Seqera Platform Launch` so the Marketplace entry
  remains descriptive.
