import { Schema } from "effect";
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
  id: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(WorkflowStatusSchema),
  errorMessage: Schema.optionalKey(Schema.String),
  errorReport: Schema.optionalKey(Schema.String),
  exitStatus: Schema.optionalKey(Schema.Number),
  runName: Schema.optionalKey(Schema.String),
});

export type WorkflowDbDto = Schema.Schema.Type<typeof WorkflowDbDtoSchema>;

export const DescribeWorkflowResponseSchema = Schema.Struct({
  orgName: Schema.optionalKey(Schema.String),
  workspaceId: Schema.optionalKey(Schema.Number),
  workspaceName: Schema.optionalKey(Schema.String),
  workflow: Schema.optionalKey(WorkflowDbDtoSchema),
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
