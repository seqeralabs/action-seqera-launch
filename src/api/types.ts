import type { components } from "./schema.js";

export type ApiWorkflowLaunchRequest = components["schemas"]["WorkflowLaunchRequest"];
export type ApiSubmitWorkflowLaunchResponse = components["schemas"]["SubmitWorkflowLaunchResponse"];
export type ApiDescribeWorkflowResponse = components["schemas"]["DescribeWorkflowResponse"];
export type ApiWorkflowStatus = components["schemas"]["WorkflowStatus"];
export type ApiListComputeEnvsResponse = components["schemas"]["ListComputeEnvsResponse"];
export type ApiListTasksResponse = components["schemas"]["ListTasksResponse"];
export type ApiWorkflowLogResponse = components["schemas"]["WorkflowLogResponse"];
export type ApiErrorResponse = components["schemas"]["ErrorResponse"];
export type ApiWorkflowLaunchValidationErrorResponse =
  components["schemas"]["WorkflowLaunchValidationErrorResponse"];
export type ApiLaunchValidationError = components["schemas"]["LaunchValidationError"];

export const KNOWN_WORKFLOW_STATUSES = [
  "SUBMITTED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "UNKNOWN",
] as const satisfies readonly ApiWorkflowStatus[];

export type KnownWorkflowStatus = (typeof KNOWN_WORKFLOW_STATUSES)[number];

export function isKnownWorkflowStatus(status: string): status is KnownWorkflowStatus {
  // SAFETY: membership in KNOWN_WORKFLOW_STATUSES is the contract for known statuses.
  return (KNOWN_WORKFLOW_STATUSES as readonly string[]).includes(status);
}
