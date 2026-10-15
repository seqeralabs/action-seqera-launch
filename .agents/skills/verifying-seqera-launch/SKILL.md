---
name: verifying-seqera-launch
description: Verifies the Seqera Launch GitHub Action through its shipped bundle, HTTP requests, outputs, and job summaries. Use after changing launch inputs, compute resolution, monitoring, reporting, or packaging, and when diagnosing CI failures.
---

# Verify Seqera Launch

Run from the repository root. This drives the real Node entry point with Actions-style environment variables and command files. Only the external Seqera HTTP API is a fixture. No credentials or cloud compute are needed.

## Launch

Use Node 24, matching `.node-version` and the Actions runtime.

```sh
npm ci
npm run build
```

Before writing evidence, add `/.amp/in/` to the file named by `git rev-parse --git-path info/exclude` if absent. Preserve existing rules. A successful build produces `dist/index.js`. Review `git diff -- dist/` rather than discarding bundle changes.

## Doctor

```sh
npm run verify -- doctor
```

This read-only check validates the action runtime, reads the manifest's entry point, and prints its SHA-256, Node version, and scenario names. It does not establish source freshness; build first for local source changes. CI intentionally tests the committed bundle, while `check-dist` independently checks freshness.

## Drive

```sh
npm run verify              # all six scenarios
npm run verify -- primary  # one mapped journey
```

Read [the feature map](features/README.md) and run every scenario relevant to the change. The script exits nonzero if any assertion fails, continues through the remaining scenarios, and prints the evidence directory. Each action process has a 30-second limit. Polling scenarios use the production five-second delay.

The fixture binds an ephemeral port on `127.0.0.1`. Each invocation has unique output files, so runs can coexist. Finish dependency installation/build before parallel drives; those operations share `node_modules` and `dist`.

## Evidence

Evidence survives under `.amp/in/artifacts/verify-seqera-*/`. `report.json` records the bundle hash, runtime, and per-scenario verdict. Each scenario retains inputs, HTTP requests, stdout/stderr and exit code in `process.json`, `github-output.txt`, and `summary.html`.

Inspect the action and its side effects together: request payload, returned outputs, exit status, and summary. A PASS means these assertions passed against local fixtures, not that a cloud pipeline ran. The child receives only synthetic inputs and a minimal environment, without inherited tokens, proxies, or Node preload options. The helper observes requests at the fixture; it is not a network sandbox.

`stub-run: true` still sends a launch POST. Against the real Platform it creates a run and can incur compute costs. The existing `.github/workflows/integration.yml` is the live check; dispatch it only with authorization. Local verification does not prove live authentication, actual compute availability, GitHub runner input injection, or Nextflow execution. Extended timeout, retry, and malformed-response cases remain in the unit suite, not this seed map.

## Cleanup

Each child exits before assertions run. The helper closes its fixture server and connections in `finally`, including assertion failures. It leaves evidence intact and starts no detached services. After completion, read the printed directory's `report.json` to confirm evidence survived cleanup. If interrupted externally, inspect the exact process IDs before stopping only processes from that invocation.

## Helpers

`scripts/verify.mjs` is the executable helper behind `npm run verify`. It accepts `doctor`, `all`, or one scenario from the feature map. It derives defaults and the bundle path from `action.yml`; it does not import application internals.

Run `npm run all` for the existing format, lint, type, unit, and build checks. CI also runs local verification and uploads its evidence on success or failure. Use `/maintain-verification-skill` when inputs or journeys change to keep this map and helper aligned.
