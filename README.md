# Seqera Platform Launch

Launch and monitor a Nextflow pipeline run on [Seqera Platform](https://seqera.io/) from a GitHub Actions workflow.

This action talks to the Seqera Platform REST API directly. There is no Docker image and no `tw` CLI, so a launch step starts in about a second instead of waiting on a container pull.

Migrating from `seqeralabs/action-tower-launch`? Read [Migrating from action-tower-launch](docs/migrating-from-action-tower-launch.md) first — every input and output name has changed.

## Usage

```yaml
- uses: seqeralabs/action-seqera-launch@v1
  with:
    access-token: ${{ secrets.SEQERA_ACCESS_TOKEN }}
    compute-env: my-compute-env
    workspace-id: "123456789"
```

That launches the current repository, waits until the run reaches `RUNNING`, and then finishes green.

To save the launch configuration in the workspace Launchpad, set `launchpad-name`:

```yaml
- uses: seqeralabs/action-seqera-launch@v1
  with:
    access-token: ${{ secrets.SEQERA_ACCESS_TOKEN }}
    workspace-id: "123456789"
    compute-env: my-compute-env
    launchpad-name: my-pipeline
```

The action creates the named pipeline if absent, or updates its default version if present, then launches that saved version. It matches the name exactly within the workspace. Omit the input to launch directly without changing the Launchpad. The token needs permission to create or update pipelines in the workspace.

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
| `launchpad-name`     | —                             | Save or update this named Launchpad pipeline, then launch its version.    |
| `revision`           | —                             | Pipeline revision, branch, tag, or commit.                                |
| `work-dir`           | compute env's work directory  | Pipeline work directory.                                                  |
| `parameters`         | —                             | Pipeline parameters, as YAML or JSON.                                     |
| `profiles`           | —                             | Nextflow config profiles, one per line or comma-separated.                |
| `run-name`           | —                             | Name for the run.                                                         |
| `nextflow-config`    | —                             | Additional Nextflow configuration.                                        |
| `pre-run-script`     | —                             | Script to run before the pipeline.                                        |
| `post-run-script`    | —                             | Script to run after the pipeline.                                         |
| `label-ids`          | —                             | Label IDs to attach to the run, one per line or comma-separated.          |
| `output-dir`         | —                             | Pipeline output directory.                                                |
| `stub-run`           | —                             | Run the pipeline in stub mode.                                            |
| `pull-latest`        | —                             | Pull the latest pipeline revision before launching.                       |
| `nextflow-version`   | —                             | Nextflow version to use.                                                  |
| `syntax-parser`      | —                             | Nextflow syntax parser, `v1` or `v2`. Omit to use the default.            |
| `head-job-cpus`      | —                             | CPUs for the Nextflow head job.                                           |
| `head-job-memory-mb` | —                             | Memory in MB for the Nextflow head job.                                   |
| `wait`               | `running`                     | `running`, `completion`, or `none`. See [Waiting](#waiting).              |
| `timeout`            | —                             | Max time to wait, e.g. `90m`. Unset polls until the job's own time limit. |

`resume` and `session-id` are deliberately not exposed. Resuming a run from CI needs a session id carried between workflow runs, which is a design question in its own right.

### Nextflow v2 parser

Set `syntax-parser: v2` to enable Nextflow's [strict syntax](https://www.nextflow.io/docs/latest/strict-syntax.html):

```yaml
- uses: seqeralabs/action-seqera-launch@v1
  with:
    access-token: ${{ secrets.SEQERA_ACCESS_TOKEN }}
    compute-env: my-compute-env
    syntax-parser: v2
    nextflow-version: "25.10.0"
```

The action sends the selection as the Platform API's `syntaxParser` launch field, so the Platform endpoint must support that field. No `pre-run-script` export is needed. Strict syntax requires Nextflow 25.04.0 or later and is the default from 26.04.0. Use `syntax-parser: v1` to explicitly select the legacy parser. Leaving the input unset preserves the existing launch defaults; the action does not select or upgrade the Nextflow version for you.

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

Four things will break an existing workflow: inputs are `kebab-case`, outputs are too (`workflowId` is now `workflow-id`), the `json` output is gone, and `wait` is an enum whose default no longer means fire-and-forget.

**[Migrating from action-tower-launch](docs/migrating-from-action-tower-launch.md)** has the complete input and output mapping, a copy-paste diff, and what happened to `verbose` and the `tower_action_*.log`/`.json` files.

## Development

```bash
npm ci
npm run all      # format:check, lint, lint:types, typecheck, test, build
```

`dist/` is committed — GitHub runs the bundled output directly. CI fails if it does not match a fresh build, so run `npm run build` and commit `dist/` with any source change.

Run `npm run verify` after building to execute the bundled action against local HTTP fixtures, without Seqera credentials or cloud jobs. It checks launch payloads, compute selection, wait modes, failure diagnostics, and Actions output files. Use `npm run verify -- doctor` to inspect the bundle and runtime, or `npm run verify -- primary` for one scenario.

The project-local [verification skill](.agents/skills/verifying-seqera-launch/SKILL.md) includes setup, cleanup, and a feature map. Evidence is saved under `.amp/in/artifacts/verify-seqera-*/`; locally, exclude `/.amp/in/` in the file returned by `git rev-parse --git-path info/exclude`. CI runs the same command against the committed bundle and uploads evidence for seven days. The existing live integration workflow remains separate.

Design decisions live in [`docs/decisions/`](docs/decisions/).

## License

[MPL-2.0](LICENSE), matching `action-tower-launch`.
