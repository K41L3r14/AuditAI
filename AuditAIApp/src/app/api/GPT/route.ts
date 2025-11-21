import { NextRequest, NextResponse } from "next/server";
import { selectFindings, loadRegistry } from "../security/registry";
import OpenAI from "openai";
import { ModelResponse, type TModelFinding } from "./model";

export const runtime = "nodejs"; // needed for fs and env access

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

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

    const analysisGuidance = [
      "Treat string interpolation or concatenation in SQL/ORM queries as SQL Injection unless inputs are parameterized (use binding placeholders).",
      "Dynamic code execution helpers such as eval/Function/exec on user input map to INSECURE_DESERIALIZATION.",
      "Redirects that forward user-controlled URLs without whitelisting/validation map to UNVALIDATED_REDIRECT.",
      "If you see user input forwarded to filesystem, network, template rendering, or authentication paths without validation, identify the relevant finding id.",
      "Every finding MUST include a plain-language explanation (at least one sentence referencing the snippet and its impact) and a remediation section (patch array with concrete edits and/or fix notes). Empty strings are not allowed.",
      "If no allowed finding matches the issue, use MODEL_GUESS and describe the vulnerability precisely (still provide explanation, evidence, and remediation).",
    ].join(" ");

    const outputRequirements = [
      "Do not leave explanation blank; describe why the code is vulnerable and the risk.",
      "Provide at least one patch entry per finding (line + replace_with or insert_before). If a patch is not possible, add actionable fix notes describing safe patterns.",
    ].join(" ");

    const exampleFinding = {
      id: "DEMO_ID",
      severity: "Medium",
      confidence: 0.9,
      evidence: {
        lines: [42],
        snippet: "db.query(`SELECT * FROM users WHERE name = '${user}'`);",
      },
      explanation: "User input is concatenated into a SQL query, allowing attackers to inject arbitrary clauses and read or modify data.",
      fix: {
        patch: [
          {
            line: 42,
            replace_with: "db.query('SELECT * FROM users WHERE name = $1', [user]);",
          },
        ],
        notes: "Always use parameterized queries / placeholders so the database driver can safely escape values.",
      },
    };

    const fallbackFinding = {
      id: "MODEL_GUESS",
      title: "Model proposed finding (fallback)",
      cwe: undefined,
      owasp: undefined,
      severity: "Medium" as const,
      description:
        "Use when the vulnerability does not match any allowed finding. Clearly state the issue in explanation/fix.",
      hints: ["Only use when absolutely necessary."],
    };

    const allowedWithFallback = [...allowed, fallbackFinding];

    const user = {
      task: "Analyze the following code file for ONLY the allowed findings.",
      file,
      allowed_findings: allowedWithFallback.map(
        ({ id, title, cwe, owasp, severity, description, hints }) => ({
          id,
          title,
          cwe,
          owasp,
          severity,
          description,
          hints,
        })
      ),
      output_contract: "ModelResponse JSON with { findings:[], summary:{...} }",
      analysis_guidance: analysisGuidance,
      field_requirements: outputRequirements,
      example_finding: exampleFinding,
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

    console.log("Normalizing model response...");
    const normalized = normalizeModelResponse(parsed, file.path);
    console.log("Validating model response...");
    const validated = ModelResponse.parse(normalized);
    console.log("Validation success! Returning response.");

    return NextResponse.json({ ok: true, ...validated });
  } catch (err: unknown) {
    console.error("=== ERROR in /api/GPT === 127");
    console.error(err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

function normalizeModelResponse(payload: unknown, fallbackFilePath: string) {
  const raw = isRecord(payload) ? payload : {};
  const rawFindings = Array.isArray(raw.findings) ? raw.findings : [];
  const findings = rawFindings.map((finding, idx) => normalizeFinding(finding, idx));
  const summary = normalizeSummary(raw.summary, fallbackFilePath, findings);

  return { findings, summary };
}

function normalizeFinding(finding: unknown, idx: number): TModelFinding {
  const record = isRecord(finding) ? finding : {};
  const evidence = isRecord(record.evidence) ? record.evidence : {};
  const fix = isRecord(record.fix) ? record.fix : {};

  const linesSource =
    evidence.lines ?? record.lines ?? record.line ?? record.locations ?? record.line_numbers;

  return {
    id: String(record.id ?? `finding-${idx + 1}`),
    severity: normalizeSeverity(record.severity),
    confidence: normalizeConfidence(record.confidence),
    cwe: typeof record.cwe === "string" ? record.cwe : undefined,
    owasp: typeof record.owasp === "string" ? record.owasp : undefined,
    evidence: {
      lines: normalizeLines(linesSource),
      snippet: normalizeSnippet(evidence.snippet ?? record.snippet ?? record.code ?? ""),
    },
    explanation: normalizeText(record.explanation ?? record.details ?? record.summary ?? ""),
    fix: {
      patch: normalizePatch(fix.patch ?? record.patch ?? record.remediation),
      notes: normalizeOptionalText(fix.notes ?? record.fix_notes ?? record.remediation_notes),
    },
  };
}

function normalizeSummary(summary: unknown, fallbackFilePath: string, findings: TModelFinding[]) {
  const base = isRecord(summary) ? summary : {};
  const file = typeof base.file === "string" && base.file.length > 0 ? base.file : fallbackFilePath;
  const counts = countBySeverity(findings);

  const providedCounts = isRecord(base.counts) ? base.counts : {};

  return {
    file,
    counts: {
      total: typeof providedCounts.total === "number" ? providedCounts.total : counts.total,
      high: typeof providedCounts.high === "number" ? providedCounts.high : counts.high,
      medium: typeof providedCounts.medium === "number" ? providedCounts.medium : counts.medium,
      low: typeof providedCounts.low === "number" ? providedCounts.low : counts.low,
    },
  };
}

function normalizeSeverity(value: unknown): TModelFinding["severity"] {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "critical") return "Critical";
    if (normalized === "high") return "High";
    if (normalized === "medium") return "Medium";
    if (normalized === "low") return "Low";
  }
  return "Medium";
}

function normalizeConfidence(value: unknown): number {
  const num =
    typeof value === "number"
      ? value
      : typeof value === "string"
      ? Number.parseFloat(value)
      : Number.NaN;
  if (!Number.isFinite(num)) return 0.5;
  return Math.min(1, Math.max(0, num));
}

function normalizeLines(value: unknown): number[] {
  const numbers: number[] = [];

  const pushNumber = (num: unknown) => {
    if (typeof num === "number" && Number.isFinite(num)) {
      numbers.push(Math.trunc(num));
    } else if (typeof num === "string") {
      const parsed = Number.parseInt(num, 10);
      if (Number.isFinite(parsed)) numbers.push(parsed);
    }
  };

  if (Array.isArray(value)) {
    value.forEach(pushNumber);
  } else if (typeof value === "number" || typeof value === "string") {
    pushNumber(value);
  }

  return numbers;
}

function normalizeSnippet(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join("\n");
  return "";
}

function normalizePatch(value: unknown): TModelFinding["fix"]["patch"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!isRecord(entry)) return null;
      const line = normalizeLineNumber(entry.line);
      const insert_before =
        typeof entry.insert_before === "string" ? entry.insert_before : undefined;
      const replace_with =
        typeof entry.replace_with === "string" ? entry.replace_with : undefined;

      if (line === undefined && insert_before === undefined && replace_with === undefined) {
        return null;
      }

      return { line, insert_before, replace_with };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

function normalizeLineNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function countBySeverity(findings: TModelFinding[]) {
  const counts = { total: findings.length, high: 0, medium: 0, low: 0 };
  for (const finding of findings) {
    if (finding.severity === "Low") {
      counts.low += 1;
    } else if (finding.severity === "Medium") {
      counts.medium += 1;
    } else {
      counts.high += 1; // includes both High and Critical
    }
  }
  return counts;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeOptionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
