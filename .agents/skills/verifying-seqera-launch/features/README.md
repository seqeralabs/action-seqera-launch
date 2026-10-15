# Verification feature map

| Feature | Scenarios | Observable proof |
| --- | --- | --- |
| [Launch and compute selection](launch.md) | `primary`, `named`, `completion` | One launch POST with the selected compute ID, work directory, parsed parameters and profiles |
| [Waiting](waiting.md) | `primary`, `running`, `completion` | Correct describe count, status output, and exit code |
| [Failure reporting](failures.md) | `failure` | Nonzero exit, task stderr, error output, failure summary |
| [Input validation](validation.md) | `invalid` | Nonzero exit with no HTTP requests or workflow outputs |

Run `npm run verify -- <scenario>` after the launch and doctor steps in the parent skill. `npm run verify` covers the full seed map. This is not exhaustive coverage of every optional input or Platform failure mode.
