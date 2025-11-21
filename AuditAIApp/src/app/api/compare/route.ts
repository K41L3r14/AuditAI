import { NextRequest, NextResponse } from "next/server";
import type { CompareModel, ModelRunResult } from "../security/types";
import { analyzeWithGPT, analyzeWithClaude } from "../security/analyzers";

type AuditFile = { path: string; language: string; content: string };

const MODEL_SEQUENCE: CompareModel[] = ["OpenAI", "Claude"];

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { file } = body as { file?: AuditFile };
    if (!file || typeof file.content !== "string") {
      return NextResponse.json({ ok: false, error: "Missing file payload." }, { status: 400 });
    }

    const entries = await Promise.all(
      MODEL_SEQUENCE.map(async (model): Promise<[CompareModel, ModelRunResult]> => {
        const result = await runModel(model, file);
        return [model, result];
      })
    );

    const models = Object.fromEntries(entries) as Record<CompareModel, ModelRunResult>;
    return NextResponse.json({ ok: true, models });
  } catch (err: unknown) {
    console.error("=== ERROR in /api/compare ===");
    console.error(err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

async function runModel(model: CompareModel, file: AuditFile): Promise<ModelRunResult> {
  try {
    const logPrefix = `[Compare:${model}]`;
    const data =
      model === "Claude"
        ? await analyzeWithClaude(file, { logPrefix })
        : await analyzeWithGPT(file, { logPrefix });
    return { ok: true, ...data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: message };
  }
}
