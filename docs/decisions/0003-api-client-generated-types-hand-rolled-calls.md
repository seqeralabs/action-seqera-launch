# 3. Generated types, hand-rolled calls

Date: 2026-08-18

## Status

Accepted, partly revised by ADR 0004

The codegen decision below — committed spec, `openapi-typescript`, narrow
aliases — stands. The **hand-written narrowing** and **transport retry**
choices are superseded by ADR 0004, which assigns both to Effect's `Schema`
and `Schedule`.

## Context

There is no official Seqera Platform JS/TS SDK. The action needs roughly six
endpoints — launch a workflow, describe it, list its failed tasks, fetch task
logs, and resolve compute environments and pipelines — and something has to
supply the types and make the HTTP calls.

Seqera publishes an OpenAPI spec at
`https://cloud.seqera.io/openapi/seqera-api-latest.yml`. Measured at
`info.version` **1.198.0**: 556 KiB, 20,714 lines, 198 paths, 263 operations,
512 schemas, every operation carrying an `operationId`, no duplicate schema
names. The transitive schema closure of the three endpoints at the core of this
action — `CreateWorkflowLaunch`, `DescribeWorkflow`, `ListWorkflowTasks` — is
**34 schemas, 6.6% of the spec**. The spec declares no `servers` block, so no
generator can supply a base URL. Seqera's own docs suggest openapi-generator or
openapi-typescript-codegen but explicitly decline to guarantee that any
generator works.

The ticket framed this as "generated client versus hand-rolled wrapper" on
bundle-size grounds. Measurement dissolved that framing — see below — so the
decision is really two separable questions: where the *types* come from, and who
writes the *runtime*.

The cautionary example is in-house. `seqeralabs/node-red-seqera` hand-rolls
plain `axios` calls across 13 endpoints with no TypeScript and no types at all.
Its launch node reads `response.data?.workflowId || response.data?.workflow?.id`
— a fallback chain that exists because nobody could say which field the API
returns. Error handling is reimplemented six or more ways in one repo, the
pagination token is guessed as `nextPageToken || nextPage`, and there is no 429
handling anywhere despite a documented 20 req/s limit.

## Decision

**Generate types from the committed spec; hand-roll the calls.**

Bundle size does not discriminate between the options, so it must not drive the
choice. Rolldown 1.2.4, minified, `--platform node`:

| Bundle | Size |
| --- | --- |
| `@actions/core` + global `fetch` | 411.0 kB |
| `@actions/core` + `@actions/http-client` | 422.8 kB |

`@actions/core@3.0.1` statically imports `./oidc-utils.js`, which imports
`@actions/http-client`, which depends on `undici@^6`. Both bundles contain the
same 76 `undici` references: **undici is inlined by the mere use of
`@actions/core`**, and no bundler can shake it out, because `getIDToken` is a
public export. The action therefore uses **`@actions/http-client`**, whose true
marginal cost is 11.8 kB (2.9%) and which brings `http_proxy`/`no_proxy`
handling that Enterprise runners behind a corporate proxy need. Choosing bare
`fetch` to "stay small" would have saved nothing and cost the proxy support.

`openapi-typescript` 7.13.0 emits **zero runtime code** — its output is
`.d.ts` consumed by `import type`, erased at compile time — so generated types
cost 0 bytes regardless of the spec's 512 schemas. With bundle size neutral, the
argument for generating is simply that the spec is the API's own word and a
renamed field should break the build rather than silently produce `undefined`.

Concretely:

| Concern | Choice |
| --- | --- |
| Spec input | `openapi/seqera-api-1.198.0.yml`, committed, versioned filename |
| Types | `openapi-typescript` → `src/api/schema.d.ts`, committed, generated |
| Narrow surface | `src/api/types.ts` — ~10 hand-written aliases into `components["schemas"]` |
| Runtime | Hand-rolled wrapper over `@actions/http-client` |
| Base URL | `api-endpoint` input, default `https://api.cloud.seqera.io` |
| Response handling | Hand-written narrowing of the fields actually read |
| Retry | Transport-level only: 429 + 5xx, bounded exponential backoff, `Retry-After` honoured |

The generated `schema.d.ts` is nobody's reading material; `src/api/types.ts` is
the reviewable contract the rest of the code compiles against:

```ts
type LaunchRequest = components["schemas"]["WorkflowLaunchRequest"];
```

Codegen never touches the network. The spec is committed, so `npm run codegen`
is reproducible and the `check-dist` job from ADR 0002 cannot fail because
Seqera shipped an API release.

**Enterprise self-hosted installs are supported**, via a configurable
`api-endpoint`. This follows `action-tower-launch` v2 and `node-red-seqera`, and
it constrains everything above: an Enterprise install may run an older Platform
than `latest` describes, so the pinned spec version is a statement about which
Platform versions the action is known to work against.

**Responses are narrowed by hand, not trusted.** Types are erased, so the
Platform can return anything; the action checks the handful of fields it reads
and fails naming the endpoint and the missing field. `Cannot read properties of
undefined (reading 'errorReport')` is precisely the unreadable failure ADR 0002
exists to eliminate, and a generated type does nothing to prevent it.

**A launch `400` distinguishes its two shapes.** The spec declares the response
as an anonymous inline `oneOf[ErrorResponse,
WorkflowLaunchValidationErrorResponse]` with no discriminator, so narrowing is
hand-written whichever way the types are produced. Validation errors carry
per-field detail — bad compute environment, bad pipeline, bad params are the
likeliest failures a user hits — and flattening them to "HTTP 400" would
reproduce the complaint that opened action-tower-launch#28.

## Consequences

- **The spec drifts, and refresh is semi-automated.** It moved 1.181.0 → 1.198.0
  while this map was open, unnoticed. A scheduled CI job regenerates against
  `seqera-api-latest.yml` and opens a PR when output differs. That PR is
  **advisory**: it reports drift and proposes a bump, and a human decides. The
  pinned version must not move on a bot's say-so, because bumping it is a claim
  about which Platform versions — including Enterprise installs — the action
  supports. Merging such a PR without considering Enterprise skew is the
  failure mode to watch for.
- **A regenerated `schema.d.ts` is an unreviewable diff.** That is accepted: the
  narrow aliases in `src/api/types.ts` are the review surface, and a breaking
  upstream rename shows up as a compile error there rather than as a line in a
  512-schema file. Review the aliases and the compiler output, not the generated
  file.
- **Two files can disagree about reality.** The committed spec describes cloud at
  1.198.0; a customer's Enterprise install does not. Types will therefore
  sometimes promise fields that a given deployment omits — which is the reason
  responses are narrowed at runtime rather than trusted.
- **`openapi-typescript` needs `moduleResolution` of `Bundler` or `NodeNext`**,
  and deeply generic output can slow `tsserver` on a spec this size. A
  typecheck cost, not a runtime one.
- **Retry is layered deliberately.** This decision owns transport retry — 429
  and 5xx, backoff, `Retry-After`. Poll cadence and the overall run timeout
  belong to the monitoring decision, which inherits a client that already
  survives a transient 502 mid-run. `node-red-seqera` has neither layer.
- **Rejected: `openapi-fetch`** (6 kB, same maintainer). It would replace the
  hand-rolled wrapper wholesale, but it brings its own error model, and this
  action's entire value is the error path — that is the one layer worth owning.
- **Rejected: `openapi-typescript-codegen`**, unmaintained since 2024 and 367 kB
  minified, and **`openapi-generator`**, which requires a JVM (Java 11+) in the
  build and emits one file per model and API. Seqera's docs name both; neither
  suits a bundled Action. Note also four schema names in the spec that are not
  valid identifiers — `Action.ConfigType`, `SchedConfig.Pool`,
  `PipelineMinInfoResponse.PipelineVersionMinInfoResponse`, `Iterator_String_` —
  along with 86 `allOf` and 33 `discriminator` occurrences, which is the kind of
  terrain that breaks stricter generators.
- **Trimming the spec to the 34-schema closure was considered and rejected.** It
  would make the generated file reviewable, but the trim step becomes
  maintenance and the full-spec diff is lost, which is the only API changelog
  Seqera effectively publishes.
