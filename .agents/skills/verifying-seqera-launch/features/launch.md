# Launch and compute selection

## Sub-features

- Default pipeline uses the caller's repository.
- Primary or named compute resolution supplies the default work directory.
- An explicit ID wins over a conflicting name and skips the compute list.
- YAML parameters, profiles, and stub mode reach the launch request.

## How to get to it (user POV)

Use `seqeralabs/action-seqera-launch` in a workflow with `access-token` and `workspace-id`. Omit compute inputs for the primary environment, set `compute-env` for a name, or set `compute-env-id` and `work-dir` explicitly.

## Driving it with npm run verify

Run `primary`, `named`, and `completion`. Inspect each `requests.json` for exactly one POST. Expect respectively `ce-primary` / `s3://primary/work`, `ce-secondary` / `s3://secondary/work`, and `explicit` / `s3://explicit/work`. The last must make no compute-list request. All launch payloads must contain the default repository URL, parsed parameters `{ "reads": 3, "paired": false }`, profiles `test,docker`, and `stubRun: true`. Outputs identify `wf-local` in `seqera/verification`, and the summary includes that run.

## Gotchas

The primary fixture is deliberately second in the list; choosing the first environment must fail. Stub mode is not a dry run. The HTTP fixture prevents these scenarios from creating cloud runs, not the stub flag.
