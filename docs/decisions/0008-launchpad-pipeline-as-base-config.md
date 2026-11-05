# Launchpad pipeline as base configuration

`launchpad-name` was first built as "save, then launch" (unreleased; no tag contains it): every run PUT the action's inputs over the named pipeline. Early PoC feedback showed the cost. Configuration kept in the Launchpad, such as an nf-snapshot plugin block, was wiped on the next push, so it had to move into the pipeline repository or the workflow file.

## Decision

An existing Launchpad pipeline is read, never written. The action fetches its default version's launch, overlays its own inputs, and submits that with the saved launch id, so the run stays linked to the pipeline. This matches how `tw launch <name>` treats a saved pipeline.

Overlay rules:

- `nextflow-config` is appended after the saved `configText`. Nextflow applies later settings last, so the action wins on conflicts and saved settings it does not mention survive.
- `parameters` are merged into the saved `paramsText` by top-level key; the action's keys win. Either side may be YAML or JSON, and the result is sent as JSON. If either side is not a key-value map, the action warns and sends its own parameters.
- Every other input replaces the saved field when set and leaves it alone when unset.
- Run-specific fields (`commitId`, `sessionId`, `resume*`) are never copied from the saved launch, so a template cannot pin or resume every run.
- With no compute environment input, the saved one is used instead of the workspace primary, along with the saved work directory (or that environment's default).
- A `compute-env` or `compute-env-id` input replaces the saved compute environment and drops the saved work directory, which belongs to it. Unless `work-dir` is set, `compute-env` brings its own default and `compute-env-id` leaves the choice to Platform.

Fields copied from the saved launch include some ADR 0005 keeps out of the inputs (`optimizationId`, `syntaxParser`, `towerConfig`, `pipelineSchemaId`). They pass through unchanged; this widens what a run carries, not the input contract.

A missing pipeline is created from the inputs, as before.

## Consequences

Unset `revision` now means the saved revision, not the default branch. CI that tests each commit must pass `revision: ${{ github.sha }}`.

`pipeline` always has a value because it defaults to the current repository, so it always overrides the saved repository. The action warns when they differ rather than failing, since URL forms vary.

Changing the workflow file no longer changes the Launchpad. Edit the pipeline in Seqera Platform to change its base configuration.
