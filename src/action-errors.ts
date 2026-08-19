import {
  ApiDecodeError,
  ComputeEnvAmbiguousError,
  ComputeEnvNotFoundError,
  HttpResponseError,
  HttpTransientError,
  InputValidationError,
  LaunchValidationError,
  UnknownWorkflowStatusError,
  WorkflowStuckSubmittedError,
  WorkflowTerminalFailureError,
  type ActionError,
} from "./errors.js";

export function asActionError(error: Error): ActionError | undefined {
  if (error instanceof InputValidationError) {
    return error;
  }
  if (error instanceof ApiDecodeError) {
    return error;
  }
  if (error instanceof LaunchValidationError) {
    return error;
  }
  if (error instanceof ComputeEnvNotFoundError) {
    return error;
  }
  if (error instanceof ComputeEnvAmbiguousError) {
    return error;
  }
  if (error instanceof HttpTransientError) {
    return error;
  }
  if (error instanceof HttpResponseError) {
    return error;
  }
  if (error instanceof WorkflowTerminalFailureError) {
    return error;
  }
  if (error instanceof WorkflowStuckSubmittedError) {
    return error;
  }
  if (error instanceof UnknownWorkflowStatusError) {
    return error;
  }
  return undefined;
}
