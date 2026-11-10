import { Schema } from "effect";
import { optionalNullable } from "./common.js";
import type { ApiListTasksResponse, ApiWorkflowLogResponse } from "../types.js";

export const TaskSchema = Schema.Struct({
  taskId: optionalNullable(Schema.Number),
  name: optionalNullable(Schema.String),
  process: optionalNullable(Schema.String),
  status: optionalNullable(Schema.String),
  errorMessage: optionalNullable(Schema.String),
});

export type Task = Schema.Schema.Type<typeof TaskSchema>;

export const DescribeTaskResponseSchema = Schema.Struct({
  task: optionalNullable(TaskSchema),
});

export type DescribeTaskResponse = Schema.Schema.Type<typeof DescribeTaskResponseSchema>;

export const ListTasksResponseSchema = Schema.Struct({
  tasks: optionalNullable(Schema.Array(DescribeTaskResponseSchema)),
  total: optionalNullable(Schema.Number),
});

export type ListTasksResponse = Schema.Schema.Type<typeof ListTasksResponseSchema>;

type _AssertListTasksResponse = ListTasksResponse extends ApiListTasksResponse ? true : never;

export const LogEntrySchema = Schema.Struct({
  stderr: optionalNullable(Schema.String),
  stdout: optionalNullable(Schema.String),
  name: optionalNullable(Schema.String),
});

export type LogEntry = Schema.Schema.Type<typeof LogEntrySchema>;

export const WorkflowLogResponseSchema = Schema.Struct({
  log: optionalNullable(
    Schema.Struct({
      entries: optionalNullable(Schema.Json),
      message: optionalNullable(Schema.String),
      truncated: optionalNullable(Schema.Boolean),
    }),
  ),
});

export type WorkflowLogResponse = Schema.Schema.Type<typeof WorkflowLogResponseSchema>;

type _AssertWorkflowLogResponse = WorkflowLogResponse extends ApiWorkflowLogResponse ? true : never;
