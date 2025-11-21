import { NextRequest, NextResponse } from "next/server";
import { analyzeWithGPT, AnalysisError } from "../security/analyzers";

export const runtime = "nodejs"; // needed for fs and env access

export async function POST(req: NextRequest) {
  try {
    console.log("=== /api/GPT request started ===");
    const body = await req.json();
    console.log("Incoming body keys:", Object.keys(body));
    const { file } = body as { file?: { path: string; language: string; content: string } };
    if (!file) {
      throw new AnalysisError("Missing file payload.", 400);
    }
    const result = await analyzeWithGPT(file);
    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    console.error("=== ERROR in /api/GPT ===");
    console.error(err);
    const status = err instanceof AnalysisError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
