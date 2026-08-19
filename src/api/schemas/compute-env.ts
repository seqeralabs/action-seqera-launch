import { Schema } from "effect";
import type { ApiListComputeEnvsResponse } from "../types.js";

export const ListComputeEnvsResponseEntrySchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});

export type ListComputeEnvsResponseEntry = Schema.Schema.Type<
  typeof ListComputeEnvsResponseEntrySchema
>;

export const ListComputeEnvsResponseSchema = Schema.Struct({
  computeEnvs: Schema.optionalKey(Schema.Array(ListComputeEnvsResponseEntrySchema)),
});

export type ListComputeEnvsResponse = Schema.Schema.Type<typeof ListComputeEnvsResponseSchema>;

type _AssertListComputeEnvsResponse = ListComputeEnvsResponse extends ApiListComputeEnvsResponse
  ? true
  : never;
