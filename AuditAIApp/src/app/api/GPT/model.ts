import { z } from "zod";

export const ModelFinding = z.object({
  id: z.string(),
  severity: z.enum(["Low", "Medium", "High", "Critical"]),
  confidence: z.number().min(0).max(1),
  cwe: z.string().optional(),
  owasp: z.string().optional(),
  evidence: z.object({
    lines: z.array(z.number()),
    snippet: z.string(),
  }),
  explanation: z.string(),
  fix: z.object({
    patch: z.array(
      z.object({
        line: z.number().optional(),
        insert_before: z.string().optional(),
        replace_with: z.string().optional(),
      })
    ),
    notes: z.string().optional(),
  }),
});

export const ModelResponse = z.object({
  findings: z.array(ModelFinding),
  summary: z.object({
    file: z.string(),
    counts: z.object({
      total: z.number(),
      high: z.number(),
      medium: z.number(),
      low: z.number(),
    }),
  }),
});

export type TModelFinding = z.infer<typeof ModelFinding>;
export type TModelResponse = z.infer<typeof ModelResponse>;
