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

const SavedLaunchSchema = Schema.Struct({ launch: Schema.Struct({ id: Schema.String }) });

const ListPipelinesSchema = Schema.Struct({
  pipelines: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        name: Schema.optionalKey(Schema.String),
        pipelineId: Schema.optionalKey(Schema.Finite),
        labels: Schema.optionalKey(
          Schema.NullOr(Schema.Array(Schema.Struct({ id: Schema.Finite }))),
        ),
      }),
    ),
  ),
  totalSize: Schema.optionalKey(Schema.Finite),
});

type ListedPipelines = Schema.Schema.Type<typeof ListPipelinesSchema>;
type ListedPipeline = NonNullable<ListedPipelines["pipelines"]>[number];
type SavedPipeline = Schema.Schema.Type<typeof SavedPipelineSchema>;

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
        attributes: "labels",
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

function describeSavedLaunchId(
  client: SeqeraClient,
  workspaceId: number | undefined,
  saved: SavedPipeline,
) {
  return client
    .requestJson(
      {
        method: "GET",
        path: `/pipelines/${saved.pipeline.pipelineId}/launch`,
        query: { ...workspaceQuery(workspaceId), versionId: saved.pipeline.version.id },
      },
      SavedLaunchSchema,
    )
    .pipe(Effect.map((response) => response.launch.id));
}

function updatePipeline(
  client: SeqeraClient,
  workspaceId: number | undefined,
  existing: ListedPipeline,
  launch: ApiWorkflowLaunchRequest,
) {
  return Effect.gen(function* () {
    if (existing.pipelineId === undefined || existing.labels === undefined) {
      return yield* new ApiDecodeError({
        endpoint: "GET /pipelines",
        detail: `Pipeline '${existing.name ?? ""}' is missing its ID or labels`,
      });
    }
    return yield* client.requestJson(
      {
        method: "PUT",
        path: `/pipelines/${existing.pipelineId}`,
        query: workspaceQuery(workspaceId),
        body: { launch, labelIds: (existing.labels ?? []).map((label) => label.id) },
        retryTransient: false,
      },
      SavedPipelineSchema,
    );
  });
}

function createPipeline(
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
      Effect.catchIf(
        (error): error is HttpResponseError =>
          error._tag === "HttpResponseError" && error.statusCode === 409,
        (error) =>
          Effect.gen(function* () {
            // Another job created the pipeline between our lookup and our POST: update the winner.
            const winner = yield* findLaunchpadPipeline(client, workspaceId, name);
            if (winner === undefined) {
              return yield* error;
            }
            return yield* updatePipeline(client, workspaceId, winner, launch);
          }),
      ),
    );
}

export function saveLaunchpadPipeline(
  client: SeqeraClient,
  workspaceId: number | undefined,
  name: string,
  launch: ApiWorkflowLaunchRequest,
) {
  return Effect.gen(function* () {
    const existing = yield* findLaunchpadPipeline(client, workspaceId, name);
    const saved =
      existing === undefined
        ? yield* createPipeline(client, workspaceId, name, launch)
        : yield* updatePipeline(client, workspaceId, existing, launch);
    return yield* describeSavedLaunchId(client, workspaceId, saved);
  });
}
