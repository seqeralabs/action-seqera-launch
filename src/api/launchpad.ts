import { Effect, Schema } from "effect";
import { ApiDecodeError, HttpResponseError } from "../errors.js";
import type { SeqeraClient } from "./client.js";
import { workspaceQuery } from "./endpoints.js";
import type { ApiWorkflowLaunchRequest } from "./types.js";

const PAGE_SIZE = 100;

const SavedPipelineSchema = Schema.Struct({
  pipeline: Schema.Struct({
    pipelineId: Schema.Finite,
    version: Schema.Struct({ id: Schema.String }),
  }),
});

function nullable<S extends Schema.Top>(schema: S) {
  return Schema.optionalKey(Schema.NullOr(schema));
}

// Only the fields the action carries into a launch. Run-specific fields such
// as commitId, sessionId and resume are left out on purpose: copying them from
// a saved template would pin or resume every run.
const SavedLaunchSchema = Schema.Struct({
  launch: Schema.Struct({
    id: Schema.String,
    computeEnv: nullable(
      Schema.Struct({
        id: Schema.optionalKey(Schema.String),
        name: Schema.optionalKey(Schema.String),
      }),
    ),
    pipeline: nullable(Schema.String),
    workDir: nullable(Schema.String),
    revision: nullable(Schema.String),
    configText: nullable(Schema.String),
    paramsText: nullable(Schema.String),
    configProfiles: nullable(Schema.Array(Schema.String)),
    preRunScript: nullable(Schema.String),
    postRunScript: nullable(Schema.String),
    nextflowVersion: nullable(Schema.String),
    launchContainer: nullable(Schema.String),
    optimizationId: nullable(Schema.String),
    optimizationTargets: nullable(Schema.String),
    pipelineSchemaId: nullable(Schema.Finite),
    syntaxParser: nullable(Schema.Literals(["v1", "v2"])),
    stubRun: nullable(Schema.Boolean),
    pullLatest: nullable(Schema.Boolean),
    headJobCpus: nullable(Schema.Finite),
    headJobMemoryMb: nullable(Schema.Finite),
    outputDir: nullable(Schema.String),
    mainScript: nullable(Schema.String),
    entryName: nullable(Schema.String),
    schemaName: nullable(Schema.String),
    towerConfig: nullable(Schema.String),
    userSecrets: nullable(Schema.Array(Schema.String)),
    workspaceSecrets: nullable(Schema.Array(Schema.String)),
  }),
});

export type SavedLaunch = Schema.Schema.Type<typeof SavedLaunchSchema>["launch"];

const ListPipelinesSchema = Schema.Struct({
  pipelines: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        name: Schema.optionalKey(Schema.String),
        pipelineId: Schema.optionalKey(Schema.Finite),
      }),
    ),
  ),
  totalSize: Schema.optionalKey(Schema.Finite),
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

// The caller must overlay a conflict winner, but not append inputs twice to a new launch.
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
        ).pipe(Effect.map((savedLaunch) => ({ launch: savedLaunch, created: true }))),
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
            return { launch: winner, created: false };
          }),
      ),
    );
}
