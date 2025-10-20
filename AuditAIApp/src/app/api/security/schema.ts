// security/schema.ts
import { z } from "zod";

export const FindingItem = z.object({
  id: z.string(),
  title: z.string(),
  cwe: z.string().optional(),
  owasp: z.string().optional(),
  severity: z.enum(["Low", "Medium", "High", "Critical"]),
  languages: z.array(z.string()),
  description: z.string(),
  hints: z.array(z.string()).optional()
});

export const FindingRegistry = z.object({
  version: z.string(),
  items: z.array(FindingItem)
});

export type TFindingItem = z.infer<typeof FindingItem>;
export type TFindingRegistry = z.infer<typeof FindingRegistry>;
