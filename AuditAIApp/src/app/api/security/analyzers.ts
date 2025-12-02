import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { selectFindings, loadRegistry } from "./registry";
import { normalizeFindings } from "./helpers";
import { ModelResponse, type TModelFinding } from "../GPT/model";
import type { Finding, Summary } from "./types";
import { InferenceClient } from "@huggingface/inference";  

export type AuditFile = { path: string; language: string; content: string };
export type AnalysisOptions = { logPrefix?: string };

export class AnalysisError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

/* ===================== GPT (OpenAI) ===================== */

const gptClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const GPT_SYSTEM_PROMPT = [
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
  '    "confidence": number,',
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
  '    "counts": { "total": number, "high": number, "medium": number, "low": number }',
  "  }",
  "}",
].join(" ");

const ANALYSIS_GUIDANCE_TEXT = [
  "Treat string interpolation or concatenation in SQL/ORM queries as SQL Injection unless inputs are parameterized.",
  "Dynamic code execution helpers such as eval/Function/exec on user input map to INSECURE_DESERIALIZATION.",
  "Redirects that forward user-controlled URLs without validation map to UNVALIDATED_REDIRECT.",
  "Always include explanation + remediation. If no allowed finding matches, use MODEL_GUESS with full details.",
].join(" ");

const OUTPUT_REQUIREMENTS_TEXT = [
  "Do not leave explanation blank; describe why the code is vulnerable and the risk.",
  "Provide at least one patch entry per finding or add actionable fix notes.",
].join(" ");

const EXAMPLE_FINDING = {
  id: "DEMO_ID",
  severity: "Medium",
  confidence: 0.9,
  evidence: {
    lines: [42],
    snippet: "db.query(`SELECT * FROM users WHERE name = '${user}'`);",
  },
  explanation:
    "User input is concatenated into a SQL query, allowing attackers to inject arbitrary clauses and read or modify data.",
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

const FALLBACK_FINDING = {
  id: "MODEL_GUESS",
  title: "Model proposed finding (fallback)",
  cwe: undefined,
  owasp: undefined,
  severity: "Medium" as const,
  description:
    "Use when the vulnerability does not match any allowed finding. Clearly state the issue in explanation/fix.",
  hints: ["Only use when absolutely necessary."],
};

export async function analyzeWithGPT(file: AuditFile, options: AnalysisOptions = {}) {
  if (!file || typeof file.content !== "string") {
    throw new AnalysisError("Invalid file payload.", 400);
  }

  const { logPrefix = "[GPT]" } = options;
  console.log(`${logPrefix} Starting analysis for`, file.path);
  console.log(`${logPrefix} Language:`, file.language);
  console.log(`${logPrefix} Content length:`, file.content.length);
  console.log(`${logPrefix} OpenAI key loaded?`, !!process.env.OPENAI_API_KEY);

  const allowed = await selectFindings({ language: file.language, max: 12 });
  console.log(`${logPrefix} Allowed findings loaded:`, allowed.length);

  await loadRegistry();
  console.log(`${logPrefix} Registry loaded.`);

  const allowedWithFallback = [...allowed, FALLBACK_FINDING];

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
    analysis_guidance: ANALYSIS_GUIDANCE_TEXT,
    field_requirements: OUTPUT_REQUIREMENTS_TEXT,
    example_finding: EXAMPLE_FINDING,
  };

  console.log(`${logPrefix} Sending prompt to OpenAI...`);
  const completion = await gptClient.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: GPT_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(user) },
    ],
    temperature: 0.1,
  });

  console.log(`${logPrefix} OpenAI response received.`);
  const raw = completion.choices[0]?.message?.content ?? "";
  console.log(`${logPrefix} Raw model output (first 500 chars):`, raw.slice(0, 500));

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
    console.log(`${logPrefix} Parsed model output successfully.`);
  } catch (parseErr) {
    console.error(`${logPrefix} Failed to parse JSON.`, parseErr);
    const match = raw.match(/\{[\s\S]*\}$/);
    if (!match) {
      throw new AnalysisError("Model did not return valid JSON.", 502);
    }
    parsed = JSON.parse(match[0]);
  }

  console.log(`${logPrefix} Normalizing model response...`);
  const normalized = normalizeModelResponse(parsed, file.path);
  console.log(`${logPrefix} Validating model response...`);
  const validated = ModelResponse.parse(normalized);
  console.log(`${logPrefix} Validation success! Realigning with source file...`);
  const alignedFindings = normalizeFindings(file.content, validated.findings);
  console.log(`${logPrefix} Returning normalized findings.`);

  const summary = {
    ...validated.summary,
    file: file.path || validated.summary.file || "unknown",
  };

  return { findings: alignedFindings, summary };
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

/* ===================== Claude (Anthropic) ===================== */

const claudeClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const CLAUDE_SYSTEM_MESSAGE = [
  "You are a security code auditor.",
  "Only report findings whose 'id' exists in allowed_findings.",
  "If nothing matches the allowed list, emit a MODEL_GUESS finding with complete details.",
  "Always include exact line numbers and a verbatim snippet.",
  "Prefer high precision over recall. If unsure, lower confidence or skip.",
  "Return ONLY a single JSON object matching the ModelResponse contract.",
  "Every finding needs an explanation referencing the snippet and remediation guidance.",
].join(" ");

const ClaudeModelFinding = zodModelFinding();
const ClaudeModelResponse = zodModelResponse(ClaudeModelFinding);

export async function analyzeWithClaude(file: AuditFile, options: AnalysisOptions = {}) {
  if (!file || typeof file.content !== "string") {
    throw new AnalysisError("Invalid file payload.", 400);
  }

  const { logPrefix = "[Claude]" } = options;
  console.log(`${logPrefix} Starting analysis for`, file.path);
  console.log(`${logPrefix} Language:`, file.language);
  console.log(`${logPrefix} Content length:`, file.content.length);
  console.log(`${logPrefix} Anthropic key loaded?`, !!process.env.ANTHROPIC_API_KEY);

  const allowed = await selectFindings({ language: file.language, max: 12 });
  console.log(`${logPrefix} Allowed findings loaded:`, allowed.length);

  await loadRegistry();
  console.log(`${logPrefix} Registry loaded.`);

  const allowedForPrompt = [
    ...allowed.map(({ id, title, cwe, owasp, severity, description }) => ({
      id,
      title,
      cwe,
      owasp,
      severity,
      description,
    })),
    {
      id: "MODEL_GUESS",
      title: "Model proposed finding (fallback)",
      cwe: undefined,
      owasp: undefined,
      severity: "Medium",
      description:
        "Use when the observed vulnerability is not in allowed_findings. Provide evidence lines, snippet, explanation, and remediation.",
    },
  ];

  const userContent = {
    task: "Analyze the following code file for ONLY the allowed findings.",
    file,
    allowed_findings: allowedForPrompt,
    output_contract: "ModelResponse JSON with { findings:[], summary:{...} }",
    analysis_guidance: ANALYSIS_GUIDANCE_TEXT,
    field_requirements: OUTPUT_REQUIREMENTS_TEXT,
    example_finding: EXAMPLE_FINDING,
  };

  console.log(`${logPrefix} Sending prompt to Claude...`);
  const completion = await claudeClient.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 4000,
    system: CLAUDE_SYSTEM_MESSAGE,
    messages: [{ role: "user", content: JSON.stringify(userContent) }],
    temperature: 0.1,
  });

  console.log(`${logPrefix} Claude response received.`);
  const raw = completion.content[0]?.type === "text" ? completion.content[0].text : "";
  console.log(`${logPrefix} Raw model output (first 500 chars):`, raw.slice(0, 500));

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(raw));
    console.log(`${logPrefix} Parsed model output successfully.`);
  } catch (parseErr) {
    console.error(`${logPrefix} Failed to parse JSON.`, parseErr);
    const match = raw.match(/\{[\s\S]*\}$/);
    if (!match) {
      throw new AnalysisError("Model did not return valid JSON.", 502);
    }
    parsed = JSON.parse(match[0]);
  }

  console.log(`${logPrefix} Validating model response...`);
  const normalized = normalizeClaudeOutput(parsed as RawFinding);
  const validated = ClaudeModelResponse.parse(normalized);
  console.log(`${logPrefix} Validation success! Realigning with source file...`);
  const alignedFindings = normalizeFindings(file.content, validated.findings as Finding[]);

  const summary: Summary = {
    ...(validated.summary as Summary),
    file: file.path || (validated.summary as Summary).file || "unknown",
  };

  return { findings: alignedFindings, summary };
}

const hfClient = new InferenceClient(process.env.HUGGINGFACE_API_KEY);  // 👈 NEW
export async function analyzeWithCodeBert(
  file: AuditFile,
  options: AnalysisOptions = {}
) {
  if (!file || typeof file.content !== "string") {
    throw new AnalysisError("Invalid file payload.", 400);
  }

  const { logPrefix = "[CodeBert]" } = options;
  console.log(`${logPrefix} Starting analysis for`, file.path);
  console.log(`${logPrefix} Language:`, file.language);
  console.log(`${logPrefix} Content length:`, file.content.length);
  console.log(`${logPrefix} HF key loaded?`, !!process.env.HUGGINGFACE_API_KEY);

  const allowed = await selectFindings({ language: file.language, max: 6 });
  console.log(`${logPrefix} Allowed findings loaded:`, allowed.length);

  await loadRegistry();
  console.log(`${logPrefix} Registry loaded.`);

  let safeContent = file.content;
  if (safeContent.length > 5000) {
    safeContent = safeContent.slice(0, 5000) + "\n// ... [truncated]";
    console.log(`${logPrefix} Code truncated to 5000 chars`);
  }

  const allowedForPrompt = [
    ...allowed.map(({ id, title, cwe, owasp, severity, description }) => ({
      id,
      title,
      cwe,
      owasp,
      severity,
      description,
    })),
    FALLBACK_FINDING,
  ];

  const systemPrompt = [
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
    '    "confidence": number,',
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
    '    "counts": { "total": number, "high": number, "medium": number, "low": number }',
    "  }",
    "}",
    ANALYSIS_GUIDANCE_TEXT,
    OUTPUT_REQUIREMENTS_TEXT,
  ].join(" ");

  const userContent = {
    task: "Analyze this code for security vulnerabilities and return findings in the specified JSON format.",
    file: {
      path: file.path,
      language: file.language,
      content: safeContent,
    },
    allowed_findings: allowedForPrompt,
    output_contract: "ModelResponse JSON with { findings:[], summary:{...} }",
    example_finding: EXAMPLE_FINDING,
  };

  console.log(`${logPrefix} Sending prompt to Hugging Face...`);

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: JSON.stringify(userContent, null, 2) },
  ];

  const chatCompletion = await hfClient.chatCompletion({
    // You can swap this to a real CodeBERT-style model if you want later
    model: "meta-llama/Meta-Llama-3-8B-Instruct",
    messages,
    max_tokens: 800,
    temperature: 0.1,
  });

  console.log(`${logPrefix} Hugging Face response received`);

  const generatedText =
    chatCompletion.choices?.[0]?.message?.content ?? "";
  console.log(`${logPrefix} Generated text length:`, generatedText.length);

  if (!generatedText) {
    console.warn(`${logPrefix} No generated text from HF, returning empty findings.`);
    return {
      findings: [],
      summary: {
        file: file.path,
        counts: { total: 0, high: 0, medium: 0, low: 0 },
      },
    };
  }

  console.log(`${logPrefix} Raw output (first 500 chars):`, generatedText.slice(0, 500));

  let parsed: unknown;
  try {
    const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON object found in model output.");
    }
    parsed = JSON.parse(jsonMatch[0]);
    console.log(`${logPrefix} JSON extraction + parse successful.`);
  } catch (parseErr) {
    console.error(`${logPrefix} Failed to parse JSON.`, parseErr);
    return {
      findings: [],
      summary: {
        file: file.path,
        counts: { total: 0, high: 0, medium: 0, low: 0 },
      },
    };
  }

  console.log(`${logPrefix} Normalizing model response...`);
  const normalized = normalizeModelResponse(parsed, file.path);
  console.log(`${logPrefix} Validating model response...`);
  const validated = ModelResponse.parse(normalized);
  console.log(`${logPrefix} Validation success! Realigning with source file...`);
  const alignedFindings = normalizeFindings(file.content, validated.findings);
  console.log(`${logPrefix} Returning normalized findings.`);

  const summary = {
    ...validated.summary,
    file: file.path || validated.summary.file || "unknown",
  };

  return { findings: alignedFindings, summary };
}


type RawFinding = {
  id?: string;
  severity?: string;
  confidence?: number;
  cwe?: string;
  owasp?: string;
  line?: number;
  snippet?: string;
  evidence?: {
    lines?: number[];
    snippet?: string;
  };
  explanation?: string;
  description?: string;
  findings?: RawFinding[];
  summary?: {
    file?: string;
    total_findings?: number;
    high_severity?: number;
    medium_severity?: number;
    low_severity?: number;
  };
};

function normalizeClaudeOutput(raw: RawFinding) {
  const findings = Array.isArray(raw.findings) ? raw.findings : [];

  const mappedFindings = findings.map((f) => {
    let lines: number[] = [];
    if (Array.isArray(f.evidence?.lines) && f.evidence.lines.length > 0) {
      lines = f.evidence.lines.map(Number);
    } else if (f.line != null) {
      lines = [Number(f.line)];
    }

    const snippet = deriveSnippet(f);
    const severity = mapSeverity(f.severity ?? "Low");
    const confidence = typeof f.confidence === "number" ? f.confidence : 1;

    return {
      id: f.id ?? "UNKNOWN_ID",
      severity,
      confidence,
      cwe: f.cwe,
      owasp: f.owasp,
      evidence: { lines, snippet },
      explanation: f.explanation ?? f.description ?? "",
      fix: { patch: [], notes: undefined },
    };
  });

  const total = mappedFindings.length;
  const high = mappedFindings.filter((f) => f.severity === "High" || f.severity === "Critical").length;
  const medium = mappedFindings.filter((f) => f.severity === "Medium").length;
  const low = mappedFindings.filter((f) => f.severity === "Low").length;

  const summary = raw.summary ?? {};

  return {
    findings: mappedFindings,
    summary: {
      file: summary.file ?? (findings[0] as RawFinding | undefined)?.file ?? "unknown",
      counts: {
        total: summary.total_findings ?? total,
        high: summary.high_severity ?? high,
        medium: summary.medium_severity ?? medium,
        low: summary.low_severity ?? low,
      },
    },
  };
}

function mapSeverity(raw: string) {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "high") return "High";
  if (normalized === "medium") return "Medium";
  if (normalized === "low") return "Low";
  return "Low";
}

function deriveSnippet(f: RawFinding): string {
  const candidate = coerceSnippet(f.evidence?.snippet) ?? coerceSnippet(f.snippet);
  if (candidate) return candidate;
  const fromExplanation = extractSnippetFromText(f.explanation);
  if (fromExplanation) return fromExplanation;
  const fromDescription = extractSnippetFromText(f.description);
  if (fromDescription) return fromDescription;
  return "";
}

function coerceSnippet(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  if (Array.isArray(value)) {
    const joined = value.join("\n").trim();
    return joined.length > 0 ? joined : null;
  }
  return null;
}

function extractSnippetFromText(text?: string): string | null {
  if (typeof text !== "string") return null;
  const block = text.match(/```[a-zA-Z0-9]*\s*([\s\S]*?)```/);
  if (block && block[1].trim().length > 0) {
    return block[1].trim();
  }
  const inline = text.match(/`([^`]+)`/);
  if (inline && inline[1].trim().length > 0) {
    return inline[1].trim();
  }
  return null;
}

function extractJsonObject(raw: string): string {
  return raw.replace(/```json/g, "").replace(/```/g, "").trim();
}

function zodModelFinding() {
  return z.object({
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
}

function zodModelResponse(modelFinding: ReturnType<typeof zodModelFinding>) {
  return z.object({
    findings: z.array(modelFinding),
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
}
