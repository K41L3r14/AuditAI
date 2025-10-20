import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { selectFindings, loadRegistry } from "../security/registry";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const ModelFinding = z.object({
  id: z.string(),
  severity: z.enum(["Low","Medium","High","Critical"]),
  confidence: z.number().min(0).max(1),
  cwe: z.string().optional(),
  owasp: z.string().optional(),
  evidence: z.object({
    lines: z.array(z.number()),
    snippet: z.string()
  }),
  explanation: z.string(),
  fix: z.object({
    patch: z.array(z.object({
      line: z.number().optional(),
      insert_before: z.string().optional(),
      replace_with: z.string().optional()
    })),
    notes: z.string().optional()
  })
});

const ModelResponse = z.object({
  findings: z.array(ModelFinding),
  summary: z.object({
    file: z.string(),
    counts: z.object({
      total: z.number(),
      high: z.number(),
      medium: z.number(),
      low: z.number()
    })
  })
});

export async function POST(req: NextRequest) {

    const body = await req.json();
    const { file } = body as { file: { path: string; language: string; content: string } };

    const allowed = await selectFindings({
      language: file.language,
      max: 12
    });

    // load, but not otherwise used — keeping as-is for your test
    await loadRegistry();

    const system = [
      "You are a security code auditor.",
      "Only report findings whose 'id' exists in allowed_findings.",
      "If nothing matches, return an empty 'findings' array.",
      "Always include exact line numbers and a verbatim snippet.",
      "Prefer high precision over recall. If unsure, lower confidence or skip.",
      "Return ONLY a single JSON object."
    ].join(" ");

    const user = {
      task: "Analyze the following code file for ONLY the allowed findings.",
      file,
      allowed_findings: allowed.map(({ id, title, cwe, owasp, severity, description }) => ({
        id, title, cwe, owasp, severity, description
      })),
      // doc hint for the model; not enforced
      output_contract: "ModelResponse JSON with { findings:[], summary:{...} }"
    };

}
