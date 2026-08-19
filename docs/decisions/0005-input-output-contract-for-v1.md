# Input/output contract for v1

Inputs use `kebab-case`, which breaks every existing `action-tower-launch` caller: `access_token` becomes `access-token`, `workspace_id` becomes `workspace-id`, and so on. GitHub's own actions use `kebab-case` (`setup-node`'s `node-version-file`), the repository is a new one rather than a v3 of the old action, and accepting both conventions would double the input surface and require conflict handling for every alias pair. Callers migrate by editing input names once, and the release notes must lead with that.

`compute-env-id` and `compute-env` are both accepted, with the id winning when both are set. The launch API takes `computeEnvId`, but v2 accepted a compute-environment *name*, and `ListComputeEnvs` has no name filter — resolving a name means listing every environment in the workspace and matching client-side. Supporting the id avoids that request entirely for callers who know it; supporting the name keeps the v2 migration path open. The cost is two code paths, plus owning the not-found and ambiguous-match errors, which must name the environment and list what was found.

v1 exposes v2's ten launch fields plus `postRunScript`, `labelIds`, `outputDir`, `stubRun`, `pullLatest`, `nextflowVersion`, `headJobCpus` and `headJobMemoryMb`. These are plain scalars and arrays that need no extra API calls or resolution logic. `resume`/`sessionId` are deliberately excluded: they interact with each other and change run semantics, so they need their own tests and documentation rather than arriving unexamined. The remaining fields — `optimizationId`, `syntaxParser`, `towerConfig`, `pipelineSchemaId` and friends — look internal and stay out until someone asks.

Outputs are `workflow-id`, `workflow-url`, `workspace-id` and `workspace-ref`. v2's `json` output is dropped: dumping the whole launch response makes our response shape a public contract that we then cannot change without breaking callers, and the API's `SubmitWorkflowLaunchResponse` is only `{ workflowId }` anyway, so the dump was never as useful as it looked. Anyone who relied on `json` as an escape hatch loses it, which is a real regression and belongs in the release notes.

## Consequences

`WorkflowLaunchRequest` declares no required fields at all, so the API will not reject an incoherent combination with a useful message. Requiredness is entirely ours to enforce, and any gap surfaces as a server-side launch failure instead of a clear action error — the exact failure mode this rewrite exists to remove. `access-token` is the only unconditionally required input, matching v2.

Whether `status` and `error-message` also become outputs is left to [#5](https://github.com/seqeralabs/action-seqera-launch/issues/5). `Workflow` carries `errorMessage`, `errorReport` and `exitStatus`, and that ticket owns how failures are reported, so it should decide whether they surface as outputs or only as log output.
