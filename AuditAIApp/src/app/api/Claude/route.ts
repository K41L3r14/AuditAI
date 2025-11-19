import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { selectFindings, loadRegistry } from "../security/registry";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs"; // needed for fs and env access

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

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

interface RawFinding {
  id?: string;
  severity?: string;
  confidence?: number;
  cwe?: string;
  owasp?: string;
  line?: number;
  snippet?: string;
  explanation?: string;
  description?: string;
  file?: string;
  findings?: RawFinding[];
  summary?: {
    file?: string;
    total_findings?: number;
    high_severity?: number;
    medium_severity?: number;
    low_severity?: number;
  };
}

function mapSeverity(raw: string): z.infer<typeof ModelFinding>["severity"] {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "high") return "High";
  if (normalized === "medium") return "Medium";
  if (normalized === "low") return "Low";
  return "Low";
}

function normalizeModelOutput(raw: RawFinding): z.infer<typeof ModelResponse> {
  const findings = Array.isArray(raw.findings) ? raw.findings : [];

  const mappedFindings = findings.map((f: RawFinding) => ({
    id: f.id ?? "UNKNOWN_ID",
    severity: mapSeverity(f.severity ?? "Low"),
    confidence: typeof f.confidence === "number" ? f.confidence : 1,
    cwe: f.cwe,
    owasp: f.owasp,
    evidence: {
      lines: f.line != null ? [Number(f.line)] : [],
      snippet: f.snippet ?? "",
    },
    explanation: f.explanation ?? f.description ?? "",
    fix: {
      patch: [],
      notes: undefined,
    },
  }));

  const summary = raw.summary ?? {};

  return {
    findings: mappedFindings,
    summary: {
      file:
        summary.file ??
        (findings[0]?.file as string | undefined) ??
        "unknown",
      counts: {
        total:
          summary.total_findings ??
          (Array.isArray(findings) ? findings.length : 0),
        high: summary.high_severity ?? 0,
        medium: summary.medium_severity ?? 0,
        low: summary.low_severity ?? 0,
      },
    },
  };
}

function extractJsonObject(raw: string): string {
  return raw.replace(/```json/g, "").replace(/```/g, "").trim();
}


export async function POST(req: NextRequest) {
  try {
    console.log("=== /api/Claude request started ===");

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

    console.log("Anthropic key loaded?", !!process.env.ANTHROPIC_API_KEY);

    const systemMessage = [
      "You are a security code auditor.",
      "Only report findings whose 'id' exists in allowed_findings.",
      "If nothing matches, return an empty 'findings' array.",
      "Always include exact line numbers and a verbatim snippet.",
      "Prefer high precision over recall. If unsure, lower confidence or skip.",
      "Return ONLY a single JSON object.",
    ].join(" ");

    const userContent = {
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

    console.log("Sending prompt to Claude...");
    const completion = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4000,
      system: systemMessage,
      messages: [
        { role: "user", content: JSON.stringify(userContent) },
      ],
      temperature: 0.1,
    });

    console.log("Claude response received.");
    const raw = completion.content[0]?.type === 'text' ? completion.content[0].text : "";
    console.log("Raw model output (first 500 chars):", raw.slice(0, 500));

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonObject(raw));
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
    const normalized = normalizeModelOutput(parsed as RawFinding);  
    const validated = ModelResponse.parse(normalized); //needs fixing
    console.log("Validation success! Returning response.");

    console.log(NextResponse.json({ ok: true, ...validated }));

    return NextResponse.json({ ok: true, ...validated });
  } catch (err: unknown) {
    console.error("=== ERROR in /api/Claude ===");
    console.error(err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
