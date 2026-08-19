# 4. Effect for decoding, retry, and errors

Date: 2026-08-18

## Status

Accepted

Revises ADR 0003: the "hand-written narrowing" and "transport retry" choices
recorded there are superseded by this decision. ADR 0003's codegen choice —
committed spec, `openapi-typescript`, narrow aliases — stands unchanged.

## Context

ADR 0003 decided generated types plus hand-rolled calls, with responses narrowed
by hand and a hand-written 429/5xx backoff loop. It rejected zod on the grounds
that a schema library adds a second source of truth for shapes the generated
types already describe.

The request that reopened this: use Effect throughout the action. The specific
suggestion was `JsonSchema.fromSchemaOpenApi3_1` as a route from Seqera's
OpenAPI spec to types.

**That function does not do that.** Its signature is
`(js: JsonSchema) => Document<"draft-2020-12">` — JSON Schema document in, JSON
Schema document out, normalized to Draft 2020-12 with
`#/components/schemas/...` refs rewritten to `#/$defs/...`. The entire
`JsonSchema` module is dialect plumbing: `Document`, `Definitions`,
`resolve$ref`, and `from*`/`to*` converters between Draft-04, Draft-07,
Draft 2020-12, OpenAPI 3.0 and OpenAPI 3.1. It never yields an Effect `Schema`
and never yields a TypeScript type, so it is not codegen and cannot replace
`openapi-typescript`. Two smaller points: Seqera's spec is OpenAPI **3.0.1**, so
the relevant function would have been `fromSchemaOpenApi3_0` (3.0 carries
`nullable`, singular `example`, and boolean exclusive bounds that the 3.1 path
does not handle); and the module's OpenAPI 3.1 helper is
`toMultiDocumentOpenApi3_1`, aimed at *emitting* a spec, which is the opposite
of this action's direction.

Effect nevertheless belongs here, for reasons unrelated to codegen.

## Decision

**Adopt Effect for response decoding, retry policy, and the error channel.
Keep `openapi-typescript`.**

Three things Effect replaces, each previously hand-rolled:

- **`Schema` supersedes hand-written narrowing.** ADR 0003 rejected zod to avoid
  a second source of truth, then specified hand-written field checks — which is
  also a second source of truth, just a worse one. Decode failures from `Schema`
  arrive as structured, path-aware errors, which is exactly the readable
  diagnostic this action exists to produce. The launch `400` — an anonymous
  inline `oneOf[ErrorResponse, WorkflowLaunchValidationErrorResponse]` with no
  discriminator — becomes a `Schema.Union`, so distinguishing the two shapes
  stops being hand-written narrowing.
- **`Schedule` supersedes the backoff loop.** Transport retry becomes
  declarative: `Schedule.exponential(...)` piped through `Schedule.jittered` and
  `Schedule.upTo({ duration, times })`. A retry policy that reads as data is
  worth more than one buried in a `while`.
- **Tagged errors supersede thrown exceptions.** With
  `Schema.TaggedError`, the compiler enforces that every failure mode is handled
  and reaches `core.setFailed` with a message. That is ADR 0002's thesis —
  failures must be readable — made checkable rather than aspirational.

Generated types stay, in a new role: **Effect Schemas are hand-written for the
~10 shapes the action touches, and the generated types are the compile-time
cross-check.** Asserting a `Schema`'s inferred type against
`components["schemas"]["WorkflowLaunchRequest"]` means a field Seqera renames
breaks the build — the property ADR 0003 was actually buying, preserved.

Scope is deliberately bounded to `Schema`, `Schedule`, and typed errors.
`@effect/platform`'s `HttpClient` and a full `Layer`-based runtime were
considered and rejected for v1: ADR 0003 chose `@actions/http-client` because
`@actions/core` inlines undici regardless, making its true marginal cost 11.8 kB
while bringing `http_proxy`/`no_proxy` handling that Enterprise runners need.
Swapping it out would forfeit that proxy support and enlarge an already large
bet.

**Version: `effect@4.0.0-rc.110`, pinned exact.** npm `latest` is 3.22.1; v4
exists only as a release candidate. v3 stable has `Schema`, `Schedule`, and
typed errors, and was the safer option — pinning the rc is a deliberate choice
to build against the API the action will live on rather than migrate later.

## Consequences

- **This is a bet on an unreleased major, and the API is still moving.**
  Verified against `4.0.0-rc.110` while writing this ADR, three names from the
  v3-era API no longer exist: `Schema.decodeUnknown` is now
  `Schema.decodeUnknownEffect` (alongside `decodeUnknownSync`, `-Option`,
  `-Result`, `-Exit`, `-Promise`); `Schedule.intersect` is gone, with
  `Schedule.upTo` taking `{ duration, times }`; and `Schema.Union` takes an
  array. Any Effect example found online predating v4 will need translating, and
  further rc churn should be expected. The pin is exact so a fresh `npm ci`
  cannot move it.
- **Bundle cost is 73.6 kB, measured.** Rolldown 1.2.4, minified,
  `--platform node`:

  | Bundle | Size |
  | --- | --- |
  | `@actions/core` + global `fetch` | 411.0 kB |
  | `+ @actions/http-client` | 422.8 kB |
  | `+ effect` (`Schema`, `Schedule`, `Effect`) | 496.5 kB |

  +17.4% over the http-client baseline. Accepted: `dist/` is committed and
  fetched once by the runner, not shipped on a hot path, and it is already
  411 kB before any choice of ours because `@actions/core` statically imports
  undici.
- **`JsonSchema` is not part of this decision.** It is dialect conversion
  machinery for schema documents, useful to a service publishing a spec. Nothing
  in this action consumes it. Recorded because the module name invites the
  assumption that it generates schemas, and it does not.
- **Effect is a paradigm, not a library.** Generators, pipes, and a typed error
  channel are a real onboarding cost for contributors who know GitHub Actions
  but not Effect — and this repo is the org's first TypeScript action, so it sets
  the precedent. Mitigated by keeping the scope narrow: no `Layer`, no
  `@effect/platform`, three modules only.
- **Two schema definitions still coexist**, but with distinct jobs: generated
  `schema.d.ts` is what Seqera says, hand-written Effect Schemas are what the
  action validates, and the assertion between them is where drift surfaces. If
  that assertion is dropped for expediency, the value of ADR 0003's codegen
  choice is lost and the pair genuinely does become redundant.
