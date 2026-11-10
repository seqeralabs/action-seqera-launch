# Studio sub-action

Teams want a Seqera Studio for each pull request, built from the repository at the commit under review. Platform's "Import from a Git repository" does the clone and image build from `.seqera/studio-config.yaml`; the action only has to call `POST /studios` with a `remoteConfig` and wait.

## Decision

Studios ship as a sub-action, `seqeralabs/action-seqera-launch/studio@v1`, with its own `studio/action.yml` and bundle (`dist/studio.js`), not as a `mode` input on the root action. The root action's inputs and outputs stay exactly as ADR 0005 fixes them. A Studio needs different inputs (`cpu`, `memory-mb`, `tool-url`, `lifespan-hours`) and returns different outputs (`studio-id`, `studio-url`); a mode input would make half of each action's contract meaningless depending on another input. Both actions share the input readers and compute environment resolution, and follow the same kebab-case convention.

The default name is `<repository name>-<short commit>`. A per-commit name means a Studio never serves code older than the commit that asked for it.

Creation is find-or-create, as for Launchpad pipelines (ADR 0008). The action lists Studios by name and reuses an exact match without creating one. It warns when the match was built from a different commit. A 409 on create means another job won the race, so the action finds that Studio and reuses it. Reruns of the same commit therefore converge on one Studio instead of failing or duplicating it.

## Consequences

Each commit leaves a Studio behind. Cleanup is the workspace's job (lifespan limits, or deleting old Studios); the action never stops or deletes one.

A reused Studio that has stopped, for example after its lifespan expired, is started again when `auto-start` is true, so rerunning a CI job brings the Studio back. An `errored` or `buildFailed` Studio is not retried; set a new `name` or delete it to get a fresh one.
