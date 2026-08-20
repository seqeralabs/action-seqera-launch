import { Schema } from "effect";
import type { ApiListTasksResponse, ApiWorkflowLogResponse } from "../types.js";

export const TaskSchema = Schema.Struct({
  taskId: Schema.optionalKey(Schema.Number),
  name: Schema.optionalKey(Schema.String),
  process: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.String),
  errorMessage: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

export type Task = Schema.Schema.Type<typeof TaskSchema>;

export const DescribeTaskResponseSchema = Schema.Struct({
  task: Schema.optionalKey(TaskSchema),
});

export type DescribeTaskResponse = Schema.Schema.Type<typeof DescribeTaskResponseSchema>;

export const ListTasksResponseSchema = Schema.Struct({
  tasks: Schema.optionalKey(Schema.Array(DescribeTaskResponseSchema)),
  total: Schema.optionalKey(Schema.Number),
});

export type ListTasksResponse = Schema.Schema.Type<typeof ListTasksResponseSchema>;

type _AssertListTasksResponse = ListTasksResponse extends ApiListTasksResponse ? true : never;

export const LogEntrySchema = Schema.Struct({
  stderr: Schema.optionalKey(Schema.String),
  stdout: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
});

export type LogEntry = Schema.Schema.Type<typeof LogEntrySchema>;

export const WorkflowLogResponseSchema = Schema.Struct({
  log: Schema.optionalKey(
    Schema.Struct({
      entries: Schema.optionalKey(Schema.Json),
      message: Schema.optionalKey(Schema.String),
      truncated: Schema.optionalKey(Schema.Boolean),
    }),
  ),
});

export type WorkflowLogResponse = Schema.Schema.Type<typeof WorkflowLogResponseSchema>;

type _AssertWorkflowLogResponse = WorkflowLogResponse extends ApiWorkflowLogResponse ? true : never;
