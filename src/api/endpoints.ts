import { Effect, Schema } from "effect";
import { HttpResponseError, LaunchValidationError } from "../errors.js";
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
