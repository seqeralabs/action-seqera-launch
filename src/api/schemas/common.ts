import { Schema } from "effect";
import type {
  ApiErrorResponse,
  ApiLaunchValidationError,
  ApiWorkflowLaunchValidationErrorResponse,
} from "../types.js";

export const ErrorResponseSchema = Schema.Struct({
  message: Schema.String,
});

export type ErrorResponse = Schema.Schema.Type<typeof ErrorResponseSchema>;

type _AssertErrorResponse = ErrorResponse extends ApiErrorResponse
  ? ApiErrorResponse extends ErrorResponse
    ? true
    : never
  : never;

export const LaunchValidationErrorSchema = Schema.Struct({
  code: Schema.optionalKey(Schema.String),
  message: Schema.optionalKey(Schema.String),
});

export type LaunchValidationErrorRecord = Schema.Schema.Type<typeof LaunchValidationErrorSchema>;

type _AssertLaunchValidationError = LaunchValidationErrorRecord extends ApiLaunchValidationError
  ? true
  : never;

export const WorkflowLaunchValidationErrorResponseSchema = Schema.Struct({
  message: Schema.String,
  errors: Schema.optionalKey(Schema.Array(LaunchValidationErrorSchema)),
});

export type WorkflowLaunchValidationErrorResponse = Schema.Schema.Type<
  typeof WorkflowLaunchValidationErrorResponseSchema
>;

type _AssertWorkflowLaunchValidationErrorResponse =
  WorkflowLaunchValidationErrorResponse extends ApiWorkflowLaunchValidationErrorResponse
    ? ApiWorkflowLaunchValidationErrorResponse extends WorkflowLaunchValidationErrorResponse
      ? true
      : never
    : never;

export const LaunchErrorResponseSchema = Schema.Union([
  ErrorResponseSchema,
  WorkflowLaunchValidationErrorResponseSchema,
]);

export type LaunchErrorResponse = Schema.Schema.Type<typeof LaunchErrorResponseSchema>;
