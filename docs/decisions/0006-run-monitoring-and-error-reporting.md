# Run monitoring and error-reporting UX

This is the decision the rewrite exists for: `action-tower-launch` could launch a run but not explain what went wrong, which is what [action-tower-launch#28](https://github.com/seqeralabs/action-tower-launch/issues/28) asked for.

## Waiting

`wait` is an enum — `running | completion | none` — defaulting to **`running`**. This replaces v2's boolean, which was already ambiguous between truthiness and a mode, so renaming the values is more honest than quietly redefining `wait: true`.

Defaulting to `running` is the substantive choice. Most launch failures — a bad compute environment, invalid parameters, a revision that doesn't exist, a malformed config — happen at submit or validation time, before a pipeline does any work. Waiting for the run to leave `SUBMITTED` catches all of those while the job is still cheap, without holding a runner open for a multi-hour pipeline. Waiting for `completion` is a deliberate opt-in for callers who want the run's result to gate the workflow.

When `wait: running` exits green, the step log says so explicitly: the run was still executing when the action returned, here is the URL. Green means *launched*, not *succeeded*, and the log must not let anyone infer otherwise.

A run stuck in `SUBMITTED` fails after a bounded wait, with an error naming the compute environment and the run URL. An unstartable compute environment is the classic silent hang, and turning it into a sentence is exactly the point of this action.

`timeout` is an input that, when unset, polls until GitHub kills the job. A finite default would eventually cut short somebody's legitimately long pipeline, and the runner's own limit is the real bound anyway.

Polling uses exponential backoff from roughly 5s to a ~60s cap — fast feedback on short runs, few requests on long ones, and `Schedule` from ADR 0004 already expresses this.

## Terminal status

Only `SUCCEEDED` passes. `FAILED`, `CANCELLED` and `UNKNOWN` all call `core.setFailed`. A run we did not get an explicit success for must never green a workflow; treating `CANCELLED` as a pass to avoid red on manual cancels would also hide genuine aborts.

An unrecognised status — the API gaining a seventh enum value — fails loudly and prints the literal value alongside the run URL. Schema decoding makes this a clear action error rather than a crash, and continuing to poll an unknown state risks looping forever on something that was actually terminal.

## Failure reporting

On failure the step log carries `errorMessage`, `errorReport` and `exitStatus`, the list of failed tasks, and a bounded tail of each failed task's `.command.err`. The task-level error is nearly always the thing the user actually needs, and putting it inline means not having to click through to Seqera to read it. Tails are truncated because a full dump of several failed tasks can bury the signal in megabytes of log.

A job summary is always written, carrying status, URL and any failure detail. Summaries render on the run page, survive log truncation, and are readable without expanding a step.

Log files are **not** uploaded as artifacts; callers compose `upload-artifact` as they did with v2. Owning retention, naming and size limits — plus an `@actions/artifact` dependency — is not worth it for something the caller can do in three lines.

PR commenting stays out of the action, as in v2. Doing it here would mean requiring `pull-requests: write` and owning comment de-duplication; callers can feed our outputs to `thollander/actions-comment-pull-request`.

## Inputs and outputs

`status` and `error-message` become outputs, resolving what [ADR 0005](0005-input-output-contract-for-v1.md) deferred. Callers can branch on the result or build their own PR comment without re-querying the API — which matters precisely because PR commenting is out of scope here.

Input-validation failures are translated into a single sentence naming the offending input, e.g. `api-endpoint must be a valid URL, got 'foo'`. The raw Effect form — `ConfigError(SchemaError(Expected a valid URL string at ["api-endpoint"]))` — does name the input, but shipping it leaks Effect internals to Nextflow users who have no idea what a `SchemaError` is. The full error is available under debug.

Verbosity uses the runner's own `ACTIONS_STEP_DEBUG` via `core.debug`/`core.isDebug`, dropping v2's `verbose` input. It is the standard mechanism, and it lets someone re-run an existing job with debug logging from the UI rather than editing the workflow file and pushing.

## Consequences

`wait` defaulting to `running` means a migrated v2 workflow that relied on `wait: false`'s fire-and-forget now blocks until the run starts, and one that passed `wait: true` must change to `wait: completion`. Both belong in the release notes with the ADR 0005 rename table.

Fetching failed-task logs means extra requests after a failure — bounded by the number of failed tasks, and only on the failure path, so the 20 req/s token limit is not at risk.
