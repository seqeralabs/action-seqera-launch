# Migrating from action-tower-launch

`seqeralabs/action-seqera-launch` replaces [`seqeralabs/action-tower-launch`](https://github.com/seqeralabs/action-tower-launch). It calls the Seqera Platform REST API directly instead of pulling a Docker image and shelling out to the `tw` CLI, so a launch step starts in about a second.

The behaviour is meant to be equivalent. The surface is not: every input and output name changed. This document is the complete mapping.

## Quick diff

```diff
-- uses: seqeralabs/action-tower-launch@v2
+- uses: seqeralabs/action-seqera-launch@v1
   with:
-    access_token: ${{ secrets.TOWER_ACCESS_TOKEN }}
-    workspace_id: ${{ secrets.TOWER_WORKSPACE_ID }}
-    compute_env: ${{ secrets.TOWER_COMPUTE_ENV }}
-    workdir: s3://my-bucket/work
-    run_name: my-run
-    nextflow_config: |
-      process.errorStrategy = 'retry'
-    pre_run_script: echo hello
-    wait: true
-    verbose: true
+    access-token: ${{ secrets.SEQERA_ACCESS_TOKEN }}
+    workspace-id: ${{ secrets.SEQERA_WORKSPACE_ID }}
+    compute-env: ${{ secrets.SEQERA_COMPUTE_ENV }}
+    work-dir: s3://my-bucket/work
+    run-name: my-run
+    nextflow-config: |
+      process.errorStrategy = 'retry'
+    pre-run-script: echo hello
+    wait: completion
```

## Inputs

Underscores became hyphens. `workdir` also gained a hyphen, so it is `work-dir` rather than `workdir`.

| `action-tower-launch` | `action-seqera-launch` |
| --- | --- |
| `access_token` | `access-token` |
| `compute_env` | `compute-env` |
| `workspace_id` | `workspace-id` |
| `api_endpoint` | `api-endpoint` |
| `pipeline` | `pipeline` (unchanged) |
| `revision` | `revision` (unchanged) |
| `workdir` | `work-dir` |
| `parameters` | `parameters` (unchanged) |
| `profiles` | `profiles` (unchanged) |
| `run_name` | `run-name` |
| `nextflow_config` | `nextflow-config` |
| `pre_run_script` | `pre-run-script` |
| `wait` | `wait` — **semantics changed**, see below |
| `verbose` | removed, see below |

### New inputs

Available here and not in v2: `compute-env-id`, `post-run-script`, `label-ids`, `output-dir`, `stub-run`, `pull-latest`, `nextflow-version`, `head-job-cpus`, `head-job-memory-mb`, and `timeout`.

`resume` and `session-id` are deliberately absent. Resuming from CI requires carrying a session id between workflow runs, which is a design question rather than an oversight.

## Outputs

The names changed from `camelCase` to `kebab-case`, and `json` is gone.

| `action-tower-launch` | `action-seqera-launch` |
| --- | --- |
| `workflowId` | `workflow-id` |
| `workflowUrl` | `workflow-url` |
| `workspaceId` | `workspace-id` |
| `workspaceRef` | `workspace-ref` |
| `json` | **removed** |

`json` exposed the raw `tw` response as a public contract, which meant any change in the Platform's response shape was a breaking change for callers. In its place, `status` and `error-message` are first-class outputs, and the failure detail v2 buried in that blob is now printed into the job summary.

If you were parsing `json` for a field that has no equivalent output, please open an issue rather than reaching for the API directly — that is a gap worth closing.

## `wait` changed meaning

v2's `wait` was a boolean defaulting to `false`. Here it is an enum defaulting to `running`.

| v2 | Here |
| --- | --- |
| `wait: true` | `wait: completion` |
| `wait: false` | `wait: none` |
| unset (fire-and-forget) | unset now means `running` |

**The default changed behaviour.** v2 submitted and returned immediately; this action waits for the run to leave `SUBMITTED` before passing. Most launch failures — a bad parameter, a missing work directory, a misconfigured compute environment — surface at submit or validation time, and the old default reported those as green.

If you relied on fire-and-forget, set `wait: none` explicitly.

Note that a green step under the default `wait: running` means the run **launched**, not that it succeeded. Use `wait: completion` when the step should reflect the run's outcome, optionally with `timeout: 90m`.

## `verbose` is gone

Set the `ACTIONS_STEP_DEBUG` repository secret to `true`, which is how GitHub Actions does debug logging generally. This also closes a leak: v2 warned that interpolating a secret into `nextflow_config`, `parameters`, or `pre_run_script` with `verbose: true` wrote it in plain text to a log file, where Actions' `***` masking did not reach.

## The log and JSON files are gone

v2 wrote `tower_action_*.log` and `tower_action_*.json` to the workspace, and its examples fed those to `actions/upload-artifact`. This action writes neither, so remove those upload steps.

Failure detail — `errorMessage`, `errorReport`, `exitStatus`, the failed-task list, and truncated `.command.err` tails — goes to the job summary and the step log instead. A job summary is always written.

Nothing here uploads artifacts or comments on pull requests. v2's README showed PR commenting via a third-party action; that still works, composed from the outputs:

```yaml
- uses: seqeralabs/action-seqera-launch@v1
  id: launch
  with:
    access-token: ${{ secrets.SEQERA_ACCESS_TOKEN }}

- uses: thollander/actions-comment-pull-request@v2
  with:
    message: |
      Pipeline launched, monitor progress [here](${{ steps.launch.outputs.workflow-url }})
        - Workflow ID: ${{ steps.launch.outputs.workflow-id }}
        - Workspace: ${{ steps.launch.outputs.workspace-ref }}
```

## Things that did not change

- `pipeline` still defaults to the current repository.
- `compute-env` is still a name, not an ID, and still falls back to the workspace's primary compute environment.
- `api-endpoint` still defaults to Seqera Cloud.
- `parameters` still accepts JSON — and now YAML as well.
- `profiles` still accepts a comma-separated string — and now one profile per line, which is the usual Actions style for list inputs. Same for `label-ids`.

## Pinning

v2 documented `@v1`/`@v2`. This action maintains a floating `v1` the same way.

Inside the `seqeralabs` organisation, `uses:` must be pinned to a full-length commit SHA, so `@v1` will be rejected there regardless of which action you are calling.
