import { describe, expect, it } from "vitest";
import {
  ApiDecodeError,
  ComputeEnvAmbiguousError,
  ComputeEnvNotFoundError,
  formatActionError,
  HttpResponseError,
  HttpTransientError,
  InputValidationError,
  LaunchValidationError,
  UnknownWorkflowStatusError,
  WorkflowStuckSubmittedError,
  WorkflowTerminalFailureError,
} from "../src/errors.js";

describe("formatActionError", () => {
  it.each([
    [
      new InputValidationError({
        input: "api-endpoint",
        message: "must be a valid URL, got 'foo'",
      }),
      "api-endpoint must be a valid URL, got 'foo'",
    ],
    [
      new ApiDecodeError({ endpoint: "GET /workflow/1", detail: "missing field status" }),
      "Failed to decode response from GET /workflow/1: missing field status",
    ],
    [new LaunchValidationError({ message: "Bad compute env" }), "Bad compute env"],
    [
      new ComputeEnvNotFoundError({ name: "missing", available: ["alpha", "beta"] }),
      "Compute environment 'missing' was not found. Available: alpha, beta",
    ],
    [
      new ComputeEnvNotFoundError({ name: "missing", available: [] }),
      "Compute environment 'missing' was not found. Available: (none)",
    ],
    [
      new ComputeEnvAmbiguousError({ name: "dup", matches: ["dup (1)", "dup (2)"] }),
      "Compute environment name 'dup' matched multiple environments: dup (1), dup (2)",
    ],
    [
      new HttpResponseError({
        endpoint: "POST /workflow/launch",
        statusCode: 403,
        message: "Forbidden",
      }),
      "POST /workflow/launch returned HTTP 403: Forbidden",
    ],
    [
      new WorkflowTerminalFailureError({
        status: "FAILED",
        workflowUrl: "https://cloud.seqera.io/orgs/o/workspaces/w/watch/42",
        describe: {},
        errorMessage: "Pipeline error",
        errorReport: "Detailed report",
      }),
      "Workflow FAILED (https://cloud.seqera.io/orgs/o/workspaces/w/watch/42)\nPipeline error\nDetailed report",
    ],
    [
      new WorkflowStuckSubmittedError({
        computeEnv: "batch",
        workflowUrl: "https://cloud.seqera.io/orgs/o/workspaces/w/watch/99",
        timeoutMs: 600_000,
      }),
      "Workflow remained SUBMITTED for 10 minutes in compute environment 'batch'. See https://cloud.seqera.io/orgs/o/workspaces/w/watch/99",
    ],
    [
      new UnknownWorkflowStatusError({
        status: "MYSTERY",
        workflowUrl: "https://cloud.seqera.io/orgs/o/workspaces/w/watch/7",
      }),
      "Workflow returned unrecognised status 'MYSTERY'. See https://cloud.seqera.io/orgs/o/workspaces/w/watch/7",
    ],
    [
      new HttpTransientError({ endpoint: "GET /workflow/1", statusCode: 502 }),
      "Transient HTTP error from GET /workflow/1 (HTTP 502)",
    ],
  ] as const)("formats %s", (error, expected) => {
    expect(formatActionError(error)).toBe(expected);
  });
});
