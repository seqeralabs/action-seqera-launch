# Waiting

## Sub-features

- `none` returns after one describe request.
- The default `running` waits through SUBMITTED and returns at RUNNING.
- `completion` waits through RUNNING and returns at SUCCEEDED.

## How to get to it (user POV)

Set the action's `wait` input, or omit it for the manifest default.

## Driving it with npm run verify

Run `primary`, `running`, and `completion`. Expect one, two, and two describe requests respectively. All exit zero; status outputs must be SUBMITTED, RUNNING, and SUCCEEDED respectively. The same status appears in the summary. Each polling scenario takes at least one real five-second sleep.

## Gotchas

RUNNING is a successful launch, not a successful pipeline. The helper's 30-second process limit detects hangs; it is not a test of the action's `timeout` input. Unit tests cover timeout and stuck-SUBMITTED behavior.
