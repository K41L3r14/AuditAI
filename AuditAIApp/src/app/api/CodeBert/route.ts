import { NextRequest, NextResponse } from "next/server";
import type { AuditFile } from "../security/analyzers";
import { analyzeWithCodeBert, AnalysisError } from "../security/analyzers";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { file } = body as { file?: AuditFile };

    if (!file || typeof file.content !== "string") {
      return NextResponse.json(
        { ok: false, error: "Missing or invalid file payload." },
        { status: 400 }
      );
    }

    const result = await analyzeWithCodeBert(file, { logPrefix: "[CodeBert API]" });
    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    console.error("=== ERROR in /api/CodeBert ===");
    console.error(err);

    const status =
      err instanceof AnalysisError ? err.status : 500;
    const message =
      err instanceof Error ? err.message : "Unknown error";

    return NextResponse.json(
      { ok: false, error: message },
      { status }
    );
  }
}
