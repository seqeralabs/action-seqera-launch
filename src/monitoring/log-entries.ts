import { Schema } from "effect";
import { LogEntrySchema } from "../api/schemas/tasks.js";
import type { JsonValue } from "../json.js";

function decodeString(value: JsonValue): string | undefined {
  const decoded = Schema.decodeUnknownOption(Schema.String)(value);
  if (decoded._tag === "Some") {
    return decoded.value;
  }
  return undefined;
}

export function extractStderr(entries: JsonValue | undefined): string {
  if (entries === undefined) {
    return "";
  }
  const asString = decodeString(entries);
  if (asString !== undefined) {
    return asString;
  }
  if (Array.isArray(entries)) {
    const parts: string[] = [];
    for (const entry of entries) {
      const decoded = Schema.decodeUnknownOption(LogEntrySchema)(entry);
      if (decoded._tag === "Some") {
        if (decoded.value.stderr !== undefined && decoded.value.stderr.length > 0) {
          parts.push(decoded.value.stderr);
        } else if (decoded.value.stdout !== undefined && decoded.value.stdout.length > 0) {
          parts.push(decoded.value.stdout);
        }
      } else {
        const entryString = decodeString(entry);
        if (entryString !== undefined) {
          parts.push(entryString);
        }
      }
    }
    return parts.join("\n");
  }
  return "";
}
