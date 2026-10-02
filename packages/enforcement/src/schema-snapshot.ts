import { createHash } from "node:crypto";

import { canonicalJson } from "@conduit/observability";

import type { ToolDescriptor } from "./types.js";

export function toolSchemaHash(descriptor: ToolDescriptor): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        providerId: descriptor.providerId,
        name: descriptor.name,
        inputSchema: descriptor.inputSchema,
        outputSchema: descriptor.outputSchema,
      }),
      "utf8",
    )
    .digest("hex");
}
