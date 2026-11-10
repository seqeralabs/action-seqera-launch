import { Schema } from "effect";
import { optionalNullable } from "./common.js";
import type { ApiListComputeEnvsResponse } from "../types.js";

export const ListComputeEnvsResponseEntrySchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: optionalNullable(Schema.String),
  workDir: optionalNullable(Schema.String),
  primary: optionalNullable(Schema.Boolean),
});

export type ListComputeEnvsResponseEntry = Schema.Schema.Type<
  typeof ListComputeEnvsResponseEntrySchema
>;

export const ListComputeEnvsResponseSchema = Schema.Struct({
  computeEnvs: optionalNullable(Schema.Array(ListComputeEnvsResponseEntrySchema)),
});

export type ListComputeEnvsResponse = Schema.Schema.Type<typeof ListComputeEnvsResponseSchema>;

type _AssertListComputeEnvsResponse = ListComputeEnvsResponse extends ApiListComputeEnvsResponse
  ? true
  : never;
