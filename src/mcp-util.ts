import { z } from "zod";
import { BticketApiError } from "./bticket/errors.js";

export const booleanish = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined;
    }
    if (typeof value === "boolean") {
      return value;
    }
    return value === "true" || value === "1";
  });

export const idList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .describe("ID único ou lista (OR dentro do mesmo filtro)");

export const stringList = z
  .union([z.string().min(1), z.array(z.string().min(1))])
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined;
    }
    return Array.isArray(value) ? value : [value];
  });

export function jsonResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function errorResult(error: unknown) {
  if (error instanceof BticketApiError) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: error.message,
        },
      ],
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

export const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export const writeOnce = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

export const destructive = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const;
