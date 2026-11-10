import { Option, Schema, SchemaGetter } from "effect";
import type {
  ApiErrorResponse,
  ApiLaunchValidationError,
  ApiWorkflowLaunchValidationErrorResponse,
} from "../types.js";

// The one way to declare an optional response field. Platform sends null for
// unset fields that the spec types as plain optionals (seen on workflow describe
// and saved launches), so decoding drops the null and the field is simply absent.
export function optionalNullable<S extends Schema.Top>(schema: S) {
  return Schema.optionalKey(Schema.NullOr(schema)).pipe(
    Schema.decodeTo(Schema.optionalKey(schema), {
      decode: SchemaGetter.transformOptional((value) =>
        Option.filter(value, (field) => field !== null),
      ),
      encode: SchemaGetter.passthrough(),
    }),
  );
}

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
  code: optionalNullable(Schema.String),
  message: optionalNullable(Schema.String),
});

export type LaunchValidationErrorRecord = Schema.Schema.Type<typeof LaunchValidationErrorSchema>;

type _AssertLaunchValidationError = LaunchValidationErrorRecord extends ApiLaunchValidationError
  ? true
  : never;

export const WorkflowLaunchValidationErrorResponseSchema = Schema.Struct({
  message: Schema.String,
  errors: optionalNullable(Schema.Array(LaunchValidationErrorSchema)),
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

export type LaunchErrorResponse = ErrorResponse | WorkflowLaunchValidationErrorResponse;
