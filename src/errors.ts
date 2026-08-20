import { Data } from "effect";
import type { DescribeWorkflowResponse } from "./api/schemas/workflow.js";
import type { JsonValue } from "./json.js";

export class InputValidationError extends Data.TaggedError("InputValidationError")<{
  readonly input: string;
  readonly message: string;
}> {}

export class ApiDecodeError extends Data.TaggedError("ApiDecodeError")<{
  readonly endpoint: string;
  readonly detail: string;
}> {}

export class LaunchValidationError extends Data.TaggedError("LaunchValidationError")<{
  readonly message: string;
}> {}

export class ComputeEnvNotFoundError extends Data.TaggedError("ComputeEnvNotFoundError")<{
  readonly name: string;
  readonly available: readonly string[];
}> {}

export class ComputeEnvAmbiguousError extends Data.TaggedError("ComputeEnvAmbiguousError")<{
  readonly name: string;
  readonly matches: readonly string[];
}> {}

export class ComputeEnvNoPrimaryError extends Data.TaggedError("ComputeEnvNoPrimaryError")<{
  readonly available: readonly string[];
}> {}

export class ComputeEnvUnavailableError extends Data.TaggedError("ComputeEnvUnavailableError")<{
  readonly name: string;
  readonly status: string;
}> {}

export class WorkDirMissingError extends Data.TaggedError("WorkDirMissingError")<{
  readonly computeEnv: string;
}> {}

export class HttpTransientError extends Data.TaggedError("HttpTransientError")<{
  readonly endpoint: string;
  readonly statusCode: number;
  readonly retryAfterMs?: number;
}> {}

export class HttpResponseError extends Data.TaggedError("HttpResponseError")<{
  readonly endpoint: string;
  readonly statusCode: number;
  readonly message: string;
  readonly body?: JsonValue;
}> {}

export class WorkflowTerminalFailureError extends Data.TaggedError("WorkflowTerminalFailureError")<{
  readonly status: string;
  readonly workflowUrl: string;
  readonly describe: DescribeWorkflowResponse;
  readonly errorMessage?: string;
  readonly errorReport?: string;
  readonly exitStatus?: number;
}> {}

export class WorkflowStuckSubmittedError extends Data.TaggedError("WorkflowStuckSubmittedError")<{
  readonly computeEnv: string;
  readonly workflowUrl: string;
  readonly timeoutMs: number;
}> {}

export class UnknownWorkflowStatusError extends Data.TaggedError("UnknownWorkflowStatusError")<{
  readonly status: string;
  readonly workflowUrl: string;
}> {}

export type ActionError =
  | InputValidationError
  | ApiDecodeError
  | LaunchValidationError
  | ComputeEnvNotFoundError
  | ComputeEnvAmbiguousError
  | ComputeEnvNoPrimaryError
  | ComputeEnvUnavailableError
  | WorkDirMissingError
  | HttpTransientError
  | HttpResponseError
  | WorkflowTerminalFailureError
  | WorkflowStuckSubmittedError
  | UnknownWorkflowStatusError;

type WorkflowTerminalFailurePayload = {
  status: string;
  workflowUrl: string;
  describe: DescribeWorkflowResponse;
  errorMessage?: string;
  errorReport?: string;
  exitStatus?: number;
};

export function workflowTerminalFailure(
  status: string,
  workflowUrl: string,
  describe: DescribeWorkflowResponse,
  errorMessageOverride?: string,
): WorkflowTerminalFailureError {
  const workflow = describe.workflow;
  const errorMessage = errorMessageOverride ?? workflow?.errorMessage ?? undefined;
  const fields: WorkflowTerminalFailurePayload = {
    status,
    workflowUrl,
    describe,
  };
  if (errorMessage !== undefined) {
    fields.errorMessage = errorMessage;
  }
  const errorReport = workflow?.errorReport ?? undefined;
  if (errorReport !== undefined) {
    fields.errorReport = errorReport;
  }
  const exitStatus = workflow?.exitStatus ?? undefined;
  if (exitStatus !== undefined) {
    fields.exitStatus = exitStatus;
  }
  return new WorkflowTerminalFailureError(fields);
}

export function formatActionError(error: ActionError): string {
  switch (error._tag) {
    case "InputValidationError":
      return `${error.input} ${error.message}`;
    case "ApiDecodeError":
      return `Failed to decode response from ${error.endpoint}: ${error.detail}`;
    case "LaunchValidationError":
      return error.message;
    case "ComputeEnvNotFoundError":
      return `Compute environment '${error.name}' was not found. Available: ${error.available.join(", ") || "(none)"}`;
    case "ComputeEnvAmbiguousError":
      return `Compute environment name '${error.name}' matched multiple environments: ${error.matches.join(", ")}`;
    case "ComputeEnvNoPrimaryError":
      return `No compute environment was specified and the workspace has no primary compute environment. Set compute-env or compute-env-id. Available: ${error.available.join(", ") || "(none)"}`;
    case "ComputeEnvUnavailableError":
      return `Compute environment '${error.name}' is not available (status ${error.status}).`;
    case "WorkDirMissingError":
      return `Compute environment '${error.computeEnv}' has no default work directory. Set the work-dir input.`;
    case "HttpResponseError":
      return `${error.endpoint} returned HTTP ${String(error.statusCode)}: ${error.message}`;
    case "WorkflowTerminalFailureError": {
      const parts = [
        `Workflow ${error.status} (${error.workflowUrl})`,
        error.errorMessage,
        error.errorReport,
      ].filter(Boolean);
      return parts.join("\n");
    }
    case "WorkflowStuckSubmittedError":
      return `Workflow remained SUBMITTED for ${String(Math.round(error.timeoutMs / 60_000))} minutes in compute environment '${error.computeEnv}'. See ${error.workflowUrl}`;
    case "UnknownWorkflowStatusError":
      return `Workflow returned unrecognised status '${error.status}'. See ${error.workflowUrl}`;
    case "HttpTransientError":
      return `Transient HTTP error from ${error.endpoint} (HTTP ${String(error.statusCode)})`;
    default: {
      const _exhaustive: never = error;
      return String(_exhaustive);
    }
  }
}
