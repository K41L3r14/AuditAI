import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { selectFindings, loadRegistry } from "../security/registry";
import OpenAI from "openai";
import { normalizeFindings } from "../security/helpers";

export const runtime = "nodejs"; // needed for fs and env access

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const ModelFinding = z.object({
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

const ModelResponse = z.object({
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

export async function POST(req: NextRequest) {
  try {
    console.log("=== /api/GPT request started ===");

    const body = await req.json();
    console.log("Incoming body keys:", Object.keys(body));
    const { file } = body as { file: { path: string; language: string; content: string } };
    console.log("File path:", file?.path);
    console.log("Language:", file?.language);
    console.log("Content length:", file?.content?.length ?? 0);

    const allowed = await selectFindings({ language: file.language, max: 12 });
    console.log("Allowed findings loaded:", allowed.length);

    await loadRegistry();
    console.log("Registry loaded.");

    console.log("OpenAI key loaded?", !!process.env.OPENAI_API_KEY);

    const system = [
      "You are a security code auditor.",
      "Only report findings whose 'id' exists in allowed_findings.",
      "If nothing matches, return an empty 'findings' array.",
      "Always include exact line numbers and a verbatim snippet.",
      "Prefer high precision over recall. If unsure, lower confidence or skip.",
      "Return ONLY a single JSON object.",
      "The JSON MUST match this exact TypeScript type:",
      "{",
      '  "findings": {',
      '    "id": string,',
      '    "severity": "Low" | "Medium" | "High" | "Critical",',
      '    "confidence": number,  // between 0 and 1',
      '    "cwe"?: string,',
      '    "owasp"?: string,',
      '    "evidence": { "lines": number[]; "snippet": string },',
      '    "explanation": string,',
      '    "fix": {',
      '      "patch": { "line"?: number; "insert_before"?: string; "replace_with"?: string }[],',
      '      "notes"?: string',
      '    }',
      "  }[],",
      '  "summary": {',
      '    "file": string,',
      '    "counts": {',
      '      "total": number,',
      '      "high": number,',
      '      "medium": number,',
      '      "low": number',
      "    }",
      "  }",
      "}",
      "",
    ].join(" ");

    const user = {
      task: "Analyze the following code file for ONLY the allowed findings.",
      file,
      allowed_findings: allowed.map(({ id, title, cwe, owasp, severity, description }) => ({
          id,
          title,
          cwe,
          owasp,
          severity,
          description,
        })),
      output_contract: "ModelResponse JSON with { findings:[], summary:{...} }",
    };

    console.log("Sending prompt to OpenAI...");
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(user) },
      ],
      temperature: 0.1,
    });

    console.log("OpenAI response received.");
    const raw = completion.choices[0]?.message?.content ?? "";
    console.log("Raw model output (first 500 chars):", raw.slice(0, 500));

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
      console.log("Parsed model output successfully.");
    } catch (parseErr) {
      console.error("Failed to parse JSON. Parse error:", parseErr);
      console.error("Raw content:", raw);
      const match = raw.match(/\{[\s\S]*\}$/);
      if (!match) {
        console.error("No valid JSON object found in raw output.");
        return NextResponse.json(
          { ok: false, error: "Model did not return valid JSON." },
          { status: 502 }
        );
      }
      parsed = JSON.parse(match[0]);
    }

    console.log("Validating model response...");
    const validated = ModelResponse.parse(parsed);
    const normalizedFindings = normalizeFindings( file.content,
      validated.findings
    );
    const normalizedResponse: z.infer<typeof ModelResponse> = {
      ...validated,
      findings: normalizedFindings,
    };
    return NextResponse.json({ ok: true, ...normalizedResponse });
  } catch (err: unknown) {
    console.error("=== ERROR in /api/GPT === 127");
    console.error(err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
