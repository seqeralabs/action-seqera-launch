import { Effect, Schema } from "effect";
import { ApiDecodeError, HttpResponseError } from "../errors.js";
import type { SeqeraClient } from "./client.js";
import { workspaceQuery } from "./endpoints.js";
import { optionalNullable } from "./schemas/common.js";
import type { ApiWorkflowLaunchRequest, ApiWorkflowLaunchResponse } from "./types.js";

const PAGE_SIZE = 100;

const SavedPipelineSchema = Schema.Struct({
  pipeline: Schema.Struct({
    pipelineId: Schema.Finite,
    version: Schema.Struct({ id: Schema.String }),
  }),
});

// Only the fields the action carries into a launch. Run-specific fields such
// as commitId, sessionId and resume are left out on purpose: copying them from
// a saved template would pin or resume every run.
const SavedLaunchSchema = Schema.Struct({
  launch: Schema.Struct({
    id: Schema.String,
    computeEnv: optionalNullable(
      Schema.Struct({
        id: optionalNullable(Schema.String),
        name: optionalNullable(Schema.String),
      }),
    ),
    pipeline: optionalNullable(Schema.String),
    workDir: optionalNullable(Schema.String),
    revision: optionalNullable(Schema.String),
    configText: optionalNullable(Schema.String),
    paramsText: optionalNullable(Schema.String),
    configProfiles: optionalNullable(Schema.mutable(Schema.Array(Schema.String))),
    preRunScript: optionalNullable(Schema.String),
    postRunScript: optionalNullable(Schema.String),
    nextflowVersion: optionalNullable(Schema.String),
    optimizationId: optionalNullable(Schema.String),
    optimizationTargets: optionalNullable(Schema.String),
    pipelineSchemaId: optionalNullable(Schema.Finite),
    syntaxParser: optionalNullable(Schema.Literals(["v1", "v2"])),
    stubRun: optionalNullable(Schema.Boolean),
    pullLatest: optionalNullable(Schema.Boolean),
    headJobCpus: optionalNullable(Schema.Finite),
    headJobMemoryMb: optionalNullable(Schema.Finite),
    outputDir: optionalNullable(Schema.String),
    mainScript: optionalNullable(Schema.String),
    entryName: optionalNullable(Schema.String),
    schemaName: optionalNullable(Schema.String),
    towerConfig: optionalNullable(Schema.String),
    userSecrets: optionalNullable(Schema.mutable(Schema.Array(Schema.String))),
    workspaceSecrets: optionalNullable(Schema.mutable(Schema.Array(Schema.String))),
  }),
});

export type SavedLaunch = Schema.Schema.Type<typeof SavedLaunchSchema>["launch"];

// Fails the build if a field is renamed or dropped upstream (ADR 0004).
type _AssertTrue<T extends true> = T;
type _AssertSavedLaunchFields = _AssertTrue<
  [Exclude<keyof SavedLaunch, keyof ApiWorkflowLaunchResponse>] extends [never] ? true : false
>;

const ListPipelinesSchema = Schema.Struct({
  pipelines: optionalNullable(
    Schema.Array(
      Schema.Struct({
        name: optionalNullable(Schema.String),
        pipelineId: optionalNullable(Schema.Finite),
      }),
    ),
  ),
  totalSize: optionalNullable(Schema.Finite),
});

type ListedPipelines = Schema.Schema.Type<typeof ListPipelinesSchema>;
type ListedPipeline = NonNullable<ListedPipelines["pipelines"]>[number];

function listPipelinePage(
  client: SeqeraClient,
  workspaceId: number | undefined,
  name: string,
  offset: number,
) {
  return client.requestJson(
    {
      method: "GET",
      path: "/pipelines",
      query: {
        ...workspaceQuery(workspaceId),
        search: name,
        max: PAGE_SIZE,
        offset,
      },
    },
    ListPipelinesSchema,
  );
}

function hasMorePages(listed: ListedPipelines, pageLength: number, offset: number): boolean {
  if (pageLength === 0) {
    return false;
  }
  return listed.totalSize === undefined ? pageLength >= PAGE_SIZE : offset < listed.totalSize;
}

function findLaunchpadPipeline(
  client: SeqeraClient,
  workspaceId: number | undefined,
  name: string,
) {
  return Effect.gen(function* () {
    let offset = 0;
    let found: ListedPipeline | undefined;
    let more = true;
    while (found === undefined && more) {
      const listed = yield* listPipelinePage(client, workspaceId, name, offset);
      const entries = listed.pipelines ?? [];
      found = entries.find((entry) => entry.name === name);
      offset += entries.length;
      more = hasMorePages(listed, entries.length, offset);
    }
    return found;
  });
}

function describeSavedLaunch(
  client: SeqeraClient,
  workspaceId: number | undefined,
  pipelineId: number,
  versionId: string | undefined,
) {
  return client
    .requestJson(
      {
        method: "GET",
        path: `/pipelines/${pipelineId}/launch`,
        query:
          versionId === undefined
            ? workspaceQuery(workspaceId)
            : { ...workspaceQuery(workspaceId), versionId },
      },
      SavedLaunchSchema,
    )
    .pipe(Effect.map((response) => response.launch));
}

// Reads the named pipeline's default version, or undefined when absent. The
// action never writes to an existing pipeline (ADR 0008).
export function findLaunchpadLaunch(
  client: SeqeraClient,
  workspaceId: number | undefined,
  name: string,
) {
  return Effect.gen(function* () {
    const existing = yield* findLaunchpadPipeline(client, workspaceId, name);
    if (existing === undefined) {
      return undefined;
    }
    if (existing.pipelineId === undefined) {
      return yield* new ApiDecodeError({
        endpoint: "GET /pipelines",
        detail: `Pipeline '${name}' is missing its ID`,
      });
    }
    return yield* describeSavedLaunch(client, workspaceId, existing.pipelineId, undefined);
  });
}

// Creates the named pipeline from a prepared launch. "Created" means the
// request is already saved, so only its id is needed. "Existing" means another
// job won a 409 race; its launch is a base the caller must overlay.
export type LaunchpadCreateResult =
  | { readonly _tag: "Created"; readonly launchId: string }
  | { readonly _tag: "Existing"; readonly launch: SavedLaunch };

export function createLaunchpadPipeline(
  client: SeqeraClient,
  workspaceId: number | undefined,
  name: string,
  launch: ApiWorkflowLaunchRequest,
) {
  return client
    .requestJson(
      {
        method: "POST",
        path: "/pipelines",
        query: workspaceQuery(workspaceId),
        body: { name, launch },
        retryTransient: false,
      },
      SavedPipelineSchema,
    )
    .pipe(
      Effect.flatMap((created) =>
        describeSavedLaunch(
          client,
          workspaceId,
          created.pipeline.pipelineId,
          created.pipeline.version.id,
        ).pipe(
          Effect.map((savedLaunch): LaunchpadCreateResult => ({
            _tag: "Created",
            launchId: savedLaunch.id,
          })),
        ),
      ),
      Effect.catchIf(
        (error): error is HttpResponseError =>
          error._tag === "HttpResponseError" && error.statusCode === 409,
        (error) =>
          Effect.gen(function* () {
            const winner = yield* findLaunchpadLaunch(client, workspaceId, name);
            if (winner === undefined) {
              return yield* error;
            }
            const existing: LaunchpadCreateResult = { _tag: "Existing", launch: winner };
            return existing;
          }),
      ),
    );
}
