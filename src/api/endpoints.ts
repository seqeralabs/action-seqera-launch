import { Effect, Schema } from "effect";
import { ApiDecodeError, HttpResponseError, LaunchValidationError } from "../errors.js";
import type { SeqeraClient } from "./client.js";
import {
  ErrorResponseSchema,
  WorkflowLaunchValidationErrorResponseSchema,
} from "./schemas/common.js";
import type { LaunchErrorResponse } from "./schemas/common.js";
import type { JsonValue } from "../json.js";
import { ListComputeEnvsResponseSchema } from "./schemas/compute-env.js";
import { ListTasksResponseSchema, WorkflowLogResponseSchema } from "./schemas/tasks.js";
import {
  DescribeWorkflowResponseSchema,
  SubmitWorkflowLaunchResponseSchema,
} from "./schemas/workflow.js";
import type { ApiWorkflowLaunchRequest } from "./types.js";

const SavedPipelineSchema = Schema.Struct({
  pipeline: Schema.Struct({
    pipelineId: Schema.Number,
    version: Schema.Struct({ id: Schema.String }),
  }),
});

const SavedLaunchSchema = Schema.Struct({ launch: Schema.Struct({ id: Schema.String }) });

const ListPipelinesSchema = Schema.Struct({
  pipelines: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        name: Schema.optionalKey(Schema.String),
        pipelineId: Schema.optionalKey(Schema.Number),
        labels: Schema.optionalKey(
          Schema.NullOr(Schema.Array(Schema.Struct({ id: Schema.Number }))),
        ),
      }),
    ),
  ),
  totalSize: Schema.optionalKey(Schema.Number),
});

function isValidationErrorBody(
  body: LaunchErrorResponse,
): body is Schema.Schema.Type<typeof WorkflowLaunchValidationErrorResponseSchema> {
  return "errors" in body && Array.isArray(body.errors) && body.errors.length > 0;
}

function formatLaunchError(body: LaunchErrorResponse): LaunchValidationError {
  if (isValidationErrorBody(body)) {
    const details = (body.errors ?? [])
      .map((entry) => {
        const code = entry.code === undefined ? "" : `[${entry.code}] `;
        return `${code}${entry.message ?? "validation error"}`;
      })
      .join("; ");
    return new LaunchValidationError({
      message: `${body.message} (${details})`,
    });
  }
  return new LaunchValidationError({ message: body.message });
}

function decodeLaunchError(body: JsonValue): LaunchValidationError {
  const validation = Schema.decodeUnknownOption(WorkflowLaunchValidationErrorResponseSchema)(body);
  if (
    validation._tag === "Some" &&
    validation.value.errors !== undefined &&
    validation.value.errors.length > 0
  ) {
    return formatLaunchError(validation.value);
  }
  const error = Schema.decodeUnknownSync(ErrorResponseSchema)(body);
  return new LaunchValidationError({ message: error.message });
}

function launchQuery(workspaceId: number | undefined) {
  return workspaceId === undefined ? undefined : { workspaceId: String(workspaceId) };
}

function findLaunchpadPipeline(
  client: SeqeraClient,
  workspaceId: number | undefined,
  name: string,
) {
  return Effect.gen(function* () {
    let offset = 0;
    while (true) {
      const listed = yield* client.requestJson(
        {
          method: "GET",
          path: "/pipelines",
          query: {
            ...workspaceQuery(workspaceId),
            attributes: "labels",
            search: name,
            max: 100,
            offset,
          },
        },
        ListPipelinesSchema,
      );
      const entries = listed.pipelines ?? [];
      const existing = entries.find((entry) => entry.name === name);
      if (existing !== undefined) {
        return existing;
      }
      offset += entries.length;
      if (
        entries.length === 0 ||
        (listed.totalSize === undefined ? entries.length < 100 : offset >= listed.totalSize)
      ) {
        break;
      }
    }
    return undefined;
  });
}

export function saveLaunchpadPipeline(
  client: SeqeraClient,
  workspaceId: number | undefined,
  name: string,
  launch: ApiWorkflowLaunchRequest,
) {
  return Effect.gen(function* () {
    let existing = yield* findLaunchpadPipeline(client, workspaceId, name);
    if (existing === undefined) {
      const created = yield* client
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
                existing = yield* findLaunchpadPipeline(client, workspaceId, name);
                return existing === undefined ? yield* Effect.fail(error) : undefined;
              }),
          ),
        );
      if (created !== undefined) {
        return yield* describeSavedLaunchId(
          client,
          workspaceId,
          created.pipeline.pipelineId,
          created.pipeline.version.id,
        );
      }
    }
    if (
      existing === undefined ||
      existing.pipelineId === undefined ||
      existing.labels === undefined
    ) {
      return yield* Effect.fail(
        new ApiDecodeError({
          endpoint: "GET /pipelines",
          detail: `Pipeline '${name}' is missing its ID or labels`,
        }),
      );
    }
    const updated = yield* client.requestJson(
      {
        method: "PUT",
        path: `/pipelines/${existing.pipelineId}`,
        query: workspaceQuery(workspaceId),
        body: { launch, labelIds: (existing.labels ?? []).map((label) => label.id) },
        retryTransient: false,
      },
      SavedPipelineSchema,
    );
    return yield* describeSavedLaunchId(
      client,
      workspaceId,
      updated.pipeline.pipelineId,
      updated.pipeline.version.id,
    );
  });
}

function describeSavedLaunchId(
  client: SeqeraClient,
  workspaceId: number | undefined,
  pipelineId: number,
  versionId: string,
) {
  return client
    .requestJson(
      {
        method: "GET",
        path: `/pipelines/${pipelineId}/launch`,
        query: { ...workspaceQuery(workspaceId), versionId },
      },
      SavedLaunchSchema,
    )
    .pipe(Effect.map((response) => response.launch.id));
}

function workspaceQuery(workspaceId: number | undefined) {
  return workspaceId === undefined ? undefined : { workspaceId };
}

function tasksQuery(workspaceId: number | undefined) {
  if (workspaceId === undefined) {
    return { search: "status:failed" };
  }
  return { search: "status:failed", workspaceId };
}

function taskLogQuery(taskId: number, workspaceId: number | undefined, maxLength: number) {
  if (workspaceId === undefined) {
    return { maxLength };
  }
  return { maxLength, workspaceId };
}

export function createWorkflowLaunch(
  client: SeqeraClient,
  workspaceId: number | undefined,
  launch: ApiWorkflowLaunchRequest,
) {
  return client
    .requestJson(
      {
        method: "POST",
        path: "/workflow/launch",
        query: launchQuery(workspaceId),
        body: { launch },
      },
      SubmitWorkflowLaunchResponseSchema,
    )
    .pipe(
      Effect.catchIf(
        (error): error is HttpResponseError & { body: JsonValue } =>
          error._tag === "HttpResponseError" &&
          error.statusCode === 400 &&
          error.body !== undefined,
        (error) => Effect.fail(decodeLaunchError(error.body)),
      ),
    );
}

export function describeWorkflow(
  client: SeqeraClient,
  workflowId: string,
  workspaceId: number | undefined,
) {
  return client.requestJson(
    {
      method: "GET",
      path: `/workflow/${workflowId}`,
      query: workspaceQuery(workspaceId),
    },
    DescribeWorkflowResponseSchema,
  );
}

export function listComputeEnvs(client: SeqeraClient, workspaceId: number | undefined) {
  return client.requestJson(
    {
      method: "GET",
      path: "/compute-envs",
      query: workspaceQuery(workspaceId),
    },
    ListComputeEnvsResponseSchema,
  );
}

export function listFailedWorkflowTasks(
  client: SeqeraClient,
  workflowId: string,
  workspaceId: number | undefined,
) {
  return client.requestJson(
    {
      method: "GET",
      path: `/workflow/${workflowId}/tasks`,
      query: tasksQuery(workspaceId),
    },
    ListTasksResponseSchema,
  );
}

export function getWorkflowTaskLog(
  client: SeqeraClient,
  workflowId: string,
  taskId: number,
  workspaceId: number | undefined,
  maxLength = 8192,
) {
  return client.requestJson(
    {
      method: "GET",
      path: `/workflow/${workflowId}/log/${String(taskId)}`,
      query: taskLogQuery(taskId, workspaceId, maxLength),
    },
    WorkflowLogResponseSchema,
  );
}
