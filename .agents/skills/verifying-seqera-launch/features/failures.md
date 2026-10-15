# Failure reporting

## Sub-features

- A failed workflow makes the action fail.
- Workflow outputs and a failure summary remain available.
- Failed-task diagnostics include the task name and stderr.

## How to get to it (user POV)

Use `wait: completion` and inspect the failed step's logs, outputs, and job summary.

## Driving it with npm run verify

Run `failure`. Expect exit 1, status FAILED, error-message `Pipeline failed`, and a summary saying `Launch step failed`. `process.json` must contain `Failed task: ALIGN` and `fixture stderr: reference missing`. `requests.json` records the failed-task list and log fetch. A generic nonzero exit without these diagnostics is a failed verification.

## Gotchas

This fixture covers a terminal failure with retrievable task logs. It does not cover unavailable task logs or every terminal status; use the unit suite for those branches.
