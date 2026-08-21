# Seqera Platform Launch

Launch and monitor a Nextflow pipeline run on [Seqera Platform](https://seqera.io/) from a GitHub Actions workflow.

This action talks to the Seqera Platform REST API directly. There is no Docker image and no `tw` CLI, so a launch step starts in about a second instead of waiting on a container pull.

Migrating from `seqeralabs/action-tower-launch`? Read [Migrating from action-tower-launch](#migrating-from-action-tower-launch) first — the input names have all changed.

## Usage

```yaml
- uses: seqeralabs/action-seqera-launch@v1
  with:
    access-token: ${{ secrets.SEQERA_ACCESS_TOKEN }}
    compute-env: my-compute-env
    workspace-id: "123456789"
```

That launches the current repository, waits until the run reaches `RUNNING`, and then finishes green.

A fuller example, pinning a revision and passing parameters:

```yaml
jobs:
  launch:
    runs-on: ubuntu-latest
    steps:
      - uses: seqeralabs/action-seqera-launch@v1
        id: launch
        with:
          access-token: ${{ secrets.SEQERA_ACCESS_TOKEN }}
          workspace-id: "123456789"
          compute-env: my-compute-env
          pipeline: https://github.com/nf-core/rnaseq
          revision: "3.14.0"
          profiles: test,docker
          parameters: |
            outdir: s3://my-bucket/results
            input: s3://my-bucket/samplesheet.csv
          wait: completion

      - run: echo "Run finished as ${{ steps.launch.outputs.status }}"
```

> [!NOTE]
> Inside the `seqeralabs` organisation, `uses:` must be pinned to a full-length commit SHA rather than `@v1`.

## Waiting

The `wait` input decides how long the step stays alive. It replaces the boolean `wait` from `action-tower-launch`.

| Value               | Behaviour                                                                            |
| ------------------- | ------------------------------------------------------------------------------------ |
| `running` (default) | Poll until the run leaves `SUBMITTED`, then pass. Confirms the run actually started. |
| `completion`        | Poll until the run reaches a terminal status. Only `SUCCEEDED` passes.               |
| `none`              | Submit, read the run once, and return.                                               |

`running` is the default because most launch failures — a bad parameter, a missing work directory, a misconfigured compute environment — surface at submit or validation time. Waiting for the run to start catches those without holding a runner for the length of the pipeline.

**A green step with `wait: running` means the run launched, not that it succeeded.** The log says so explicitly, and `workflow-url` is where the outcome lives. Use `wait: completion` if you need the step to reflect the run's result.

Polling backs off exponentially from 5s to a 60s ceiling. `timeout` (for example `90m`) bounds the total wait; bare numbers are read as minutes, and `ms`/`s`/`m`/`h`/`d` suffixes all work. Left unset, the action polls until the job's own time limit kills it.

A run stuck in `SUBMITTED` for more than 10 minutes fails with a message naming the compute environment, since that usually means nothing is picking the job up.

With `wait: completion`, only `SUCCEEDED` passes. `FAILED`, `CANCELLED`, `UNKNOWN`, and any status this action does not recognise all fail loudly, printing the literal status and the run URL. On failure the action reports the run's `errorMessage`, `errorReport`, and `exitStatus`, lists failed tasks, and prints truncated tails of their `.command.err`.

A job summary is always written, pass or fail.

## Compute environment

Give `compute-env` (a name) or `compute-env-id`. When both are set, **the id wins** — the Platform API's compute-environment listing has no name filter, so an id is the unambiguous choice.

Supplying neither uses the workspace's **primary** compute environment. If the workspace has none, the action says so rather than surfacing the API's empty `403`.

`work-dir` is optional. Left unset, the action uses the resolved compute environment's own work directory. An explicit `compute-env-id` is taken on trust and skips that lookup, so pair it with `work-dir` if the environment has no default.

## Inputs

Only `access-token` is required.

| Input                | Default                       | Description                                                               |
| -------------------- | ----------------------------- | ------------------------------------------------------------------------- |
| `access-token`       | —                             | **Required.** Seqera Platform access token.                               |
| `api-endpoint`       | `https://api.cloud.seqera.io` | Seqera Platform API endpoint.                                             |
| `workspace-id`       | —                             | Workspace ID. Defaults to the user workspace.                             |
| `compute-env-id`     | —                             | Compute environment ID to launch into.                                    |
| `compute-env`        | —                             | Compute environment name. Ignored when `compute-env-id` is set.           |
| `pipeline`           | current repository            | Pipeline to launch.                                                       |
| `revision`           | —                             | Pipeline revision, branch, tag, or commit.                                |
| `work-dir`           | compute env's work directory  | Pipeline work directory.                                                  |
| `parameters`         | —                             | Pipeline parameters as JSON or YAML; sent as `paramsText`.                |
| `profiles`           | —                             | Comma-separated Nextflow config profiles.                                 |
| `run-name`           | —                             | Name for the run.                                                         |
| `nextflow-config`    | —                             | Additional Nextflow config; sent as `configText`.                         |
| `pre-run-script`     | —                             | Script to run before the pipeline.                                        |
| `post-run-script`    | —                             | Script to run after the pipeline.                                         |
| `label-ids`          | —                             | Comma-separated label IDs to attach to the run.                           |
| `output-dir`         | —                             | Pipeline output directory.                                                |
| `stub-run`           | —                             | Run the pipeline in stub mode.                                            |
| `pull-latest`        | —                             | Pull the latest pipeline revision before launching.                       |
| `nextflow-version`   | —                             | Nextflow version to use.                                                  |
| `head-job-cpus`      | —                             | CPUs for the Nextflow head job.                                           |
| `head-job-memory-mb` | —                             | Memory in MB for the Nextflow head job.                                   |
| `wait`               | `running`                     | `running`, `completion`, or `none`. See [Waiting](#waiting).              |
| `timeout`            | —                             | Max time to wait, e.g. `90m`. Unset polls until the job's own time limit. |

`resume` and `session-id` are deliberately not exposed. Resuming a run from CI needs a session id carried between workflow runs, which is a design question in its own right.

## Outputs

| Output          | Description                                      |
| --------------- | ------------------------------------------------ |
| `workflow-id`   | The ID of the launched workflow.                 |
| `workflow-url`  | URL of the launched workflow in Seqera Platform. |
| `workspace-id`  | The workspace the run was launched into.         |
| `workspace-ref` | The workspace reference, as `org/workspace`.     |
| `status`        | Terminal workflow status, when waited for.       |
| `error-message` | Failure message from the run, when it failed.    |

## Migrating from action-tower-launch

Three changes will break an existing workflow.

**1. Inputs are `kebab-case`.** Every underscore becomes a hyphen:

| `action-tower-launch` | This action       |
| --------------------- | ----------------- |
| `access_token`        | `access-token`    |
| `compute_env`         | `compute-env`     |
| `workspace_id`        | `workspace-id`    |
| `api_endpoint`        | `api-endpoint`    |
| `nextflow_config`     | `nextflow-config` |
| `pre_run_script`      | `pre-run-script`  |
| `run_name`            | `run-name`        |
| `workdir`             | `work-dir`        |

`pipeline`, `revision`, `parameters`, and `profiles` keep their names.

**2. The `json` output is gone.** It exposed the raw API response as a public contract, which pinned us to the Platform's response shape. Use `workflow-id`, `workflow-url`, `status`, and `error-message` instead.

**3. `wait` is an enum, and the default changed.** `wait: true` becomes `wait: completion`. The old default was `false` — fire-and-forget — and the new default is `running`, which waits for the run to start. For the old behaviour, set `wait: none`.

Also removed: the `verbose` input. Set the `ACTIONS_STEP_DEBUG` repository secret to `true` for debug logging, which is how Actions does this generally.

## Development

```bash
npm ci
npm run all      # format:check, lint, lint:types, typecheck, test, build
```

`dist/` is committed — GitHub runs the bundled output directly. CI fails if it does not match a fresh build, so run `npm run build` and commit `dist/` with any source change.

Design decisions live in [`docs/decisions/`](docs/decisions/).
