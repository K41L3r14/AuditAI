import fs from "fs/promises";
import path from "node:path";
import process from "node:process";
import { z } from "zod";

const FixtureFindingSchema = z.object({
  id: z.string(),
  lines: z.array(z.number()).optional(),
  severity: z.string().optional(),
});

const FixtureSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  file: z.object({
    path: z.string(),
    language: z.string(),
  }),
  expected_findings: z.array(FixtureFindingSchema),
});

// Claude response schema - similar to GPT but adjusted for Claude's actual response
const ClaudeModelResponse = z.object({
  ok: z.boolean(),
  findings: z.array(z.object({
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
  })),
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

type Fixture = z.infer<typeof FixtureSchema>;
type FixtureFinding = z.infer<typeof FixtureFindingSchema>;
type ClaudeResponse = z.infer<typeof ClaudeModelResponse>;

type Score = {
  tp: number;
  fp: number;
  fn: number;
  matchedPredictionIdx: Set<number>;
  missing: FixtureFinding[];
  extras: ClaudeResponse['findings'];
};

const defaultEndpoint = "http://localhost:3000/api/Claude";
const fixturesPath = path.join(process.cwd(), "evaluations", "fixtures.json");

async function main() {
  const endpoint = process.env.CLAUDE_EVAL_ENDPOINT ?? defaultEndpoint;
  const fixtureFile = process.env.CLAUDE_EVAL_FIXTURES ?? fixturesPath;

  const raw = await fs.readFile(fixtureFile, "utf8");
  const parsed = JSON.parse(raw);
  const fixtures = z.array(FixtureSchema).parse(parsed);

  const totals = { tp: 0, fp: 0, fn: 0 };

  console.log("=== CLAUDE SECURITY ANALYSIS METRICS ===\n");

  for (const fixture of fixtures) {
    console.log(`\n=== Fixture: ${fixture.id} ===`);
    if (fixture.description) console.log(fixture.description);

    const result = await runFixture(endpoint, fixture);
    totals.tp += result.tp;
    totals.fp += result.fp;
    totals.fn += result.fn;

    console.log(
      `TP: ${result.tp} | FP: ${result.fp} | FN: ${result.fn} (expected ${fixture.expected_findings.length}, predicted ${result.predicted})`
    );

    if (result.missing.length) {
      console.log("  Missing findings:");
      for (const miss of result.missing) {
        console.log(`    - ${miss.id} (expected lines: ${miss.lines?.join(", ") ?? "n/a"})`);
      }
    }

    if (result.extras.length) {
      console.log("  Extra findings:");
      for (const extra of result.extras) {
        console.log(`    - ${extra.id} lines [${extra.evidence.lines.join(", ")}]`);
      }
    }
  }

  const precision = calcPrecision(totals.tp, totals.fp);
  const recall = calcRecall(totals.tp, totals.fn);
  const f1 = calcF1(precision, recall);

  console.log("\n=== Claude Aggregate Metrics ===");
  console.log(`TP: ${totals.tp} | FP: ${totals.fp} | FN: ${totals.fn}`);
  console.log(`Precision: ${(precision * 100).toFixed(1)}%`);
  console.log(`Recall: ${(recall * 100).toFixed(1)}%`);
  console.log(`F1: ${(f1 * 100).toFixed(1)}%`);
}

async function runFixture(endpoint: string, fixture: Fixture) {
  const absPath = path.join(process.cwd(), fixture.file.path);
  const content = await fs.readFile(absPath, "utf8");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file: {
        ...fixture.file,
        content,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Request failed for ${fixture.id}: ${response.status} ${response.statusText} -> ${body}`);
  }

  const json = await response.json();
  if (json?.ok === false) {
    throw new Error(`API error for ${fixture.id}: ${json.error ?? "unknown error"}`);
  }

  const validated = ClaudeModelResponse.parse(json);
  console.log(`Model summary: ${JSON.stringify(validated.summary.counts)}`);

  const score = scoreFindings(validated.findings, fixture.expected_findings);

  return {
    ...score,
    predicted: validated.findings.length,
  };
}

function scoreFindings(predictions: ClaudeResponse['findings'], expected: FixtureFinding[]): Score {
  const matchedPredictionIdx = new Set<number>();
  const missing: FixtureFinding[] = [];

  for (const exp of expected) {
    const matchIndex = predictions.findIndex((pred, idx) => {
      if (matchedPredictionIdx.has(idx)) return false;
      if (pred.id !== exp.id) return false;
      return hasLineOverlap(pred.evidence.lines, exp.lines);
    });

    if (matchIndex >= 0) {
      matchedPredictionIdx.add(matchIndex);
    } else {
      missing.push(exp);
    }
  }

  const extras = predictions.filter((_, idx) => !matchedPredictionIdx.has(idx));

  return {
    tp: expected.length - missing.length,
    fn: missing.length,
    fp: extras.length,
    matchedPredictionIdx,
    missing,
    extras,
  };
}

const calcPrecision = (tp: number, fp: number) => (tp + fp === 0 ? 1 : tp / (tp + fp));
const calcRecall = (tp: number, fn: number) => (tp + fn === 0 ? 1 : tp / (tp + fn));
const calcF1 = (precision: number, recall: number) =>
  precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

function hasLineOverlap(a?: number[], b?: number[]) {
  if (!a?.length || !b?.length) return true;
  return a.some((line) => b.includes(line));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});