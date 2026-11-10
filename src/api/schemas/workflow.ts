import { Schema } from "effect";
import { optionalNullable } from "./common.js";
import type {
  ApiDescribeWorkflowResponse,
  ApiSubmitWorkflowLaunchResponse,
  ApiWorkflowStatus,
} from "../types.js";

export const WorkflowStatusSchema = Schema.Literals([
  "SUBMITTED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "UNKNOWN",
]);

export type WorkflowStatus = Schema.Schema.Type<typeof WorkflowStatusSchema>;

type _AssertWorkflowStatus = WorkflowStatus extends ApiWorkflowStatus ? true : never;

export const WorkflowDbDtoSchema = Schema.Struct({
  id: optionalNullable(Schema.String),
  status: optionalNullable(WorkflowStatusSchema),
  errorMessage: optionalNullable(Schema.String),
  errorReport: optionalNullable(Schema.String),
  exitStatus: optionalNullable(Schema.Number),
  runName: optionalNullable(Schema.String),
});

export type WorkflowDbDto = Schema.Schema.Type<typeof WorkflowDbDtoSchema>;

export const DescribeWorkflowResponseSchema = Schema.Struct({
  orgName: optionalNullable(Schema.String),
  workspaceId: optionalNullable(Schema.Number),
  workspaceName: optionalNullable(Schema.String),
  workflow: optionalNullable(WorkflowDbDtoSchema),
});

export type DescribeWorkflowResponse = Schema.Schema.Type<typeof DescribeWorkflowResponseSchema>;

type _AssertDescribeWorkflowResponse = DescribeWorkflowResponse extends ApiDescribeWorkflowResponse
  ? true
  : never;

export const SubmitWorkflowLaunchResponseSchema = Schema.Struct({
  workflowId: Schema.String,
});

export type SubmitWorkflowLaunchResponse = Schema.Schema.Type<
  typeof SubmitWorkflowLaunchResponseSchema
>;

type _AssertSubmitWorkflowLaunchResponse =
  SubmitWorkflowLaunchResponse extends ApiSubmitWorkflowLaunchResponse
    ? ApiSubmitWorkflowLaunchResponse extends SubmitWorkflowLaunchResponse
      ? true
      : never
    : never;
