import { z } from "zod";

export const terminalSessionIdSchema = z
  .string()
  .regex(/^term-[0-9]+-[0-9]+$/);

export const terminalDimensionsSchema = z.object({
  rows: z.number().int().min(1).max(500),
  columns: z.number().int().min(1).max(500),
});

export const terminalChunkSchema = z.object({
  sequence: z.number().int().positive(),
  data: z.string(),
});

export const terminalPollSchema = z.object({
  chunks: z.array(terminalChunkSchema),
  nextSequence: z.number().int().positive(),
  exited: z.boolean(),
  exitCode: z.number().int().nullable(),
});

export type TerminalChunk = z.infer<typeof terminalChunkSchema>;
export type TerminalPoll = z.infer<typeof terminalPollSchema>;
