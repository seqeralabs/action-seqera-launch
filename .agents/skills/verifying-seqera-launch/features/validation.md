# Input validation

## Sub-features

- Invalid wait modes fail before launching a workflow.

## How to get to it (user POV)

Pass an unsupported `wait` value in the action's `with` block.

## Driving it with npm run verify

Run `invalid`. It supplies `wait: invalid` with otherwise valid synthetic inputs. Expect exit 1, a diagnostic naming `wait`, an empty request list, and an empty output file. No cloud credentials are required.

## Gotchas

This is client-side validation, not a Platform launch rejection. There is currently no job summary on this early failure path. Do not claim that all failure paths write summaries.
