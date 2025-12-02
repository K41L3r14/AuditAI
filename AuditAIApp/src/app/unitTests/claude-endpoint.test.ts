import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

process.env.OPENAI_API_KEY ??= "test-openai-key";
process.env.ANTHROPIC_API_KEY ??= "test-anthropic-key";

type ClaudeHandler = typeof import("../api/Claude/route").POST;
type AnalysisErrorCtor = typeof import("../api/security/analyzers").AnalysisError;

let claudeHandlerPromise: Promise<ClaudeHandler> | null = null;
const getClaudeHandler = () => {
  if (!claudeHandlerPromise) {
    claudeHandlerPromise = import("../api/Claude/route").then((m) => m.POST);
  }
  return claudeHandlerPromise;
};

let analysisErrorPromise: Promise<AnalysisErrorCtor> | null = null;
const getAnalysisError = () => {
  if (!analysisErrorPromise) {
    analysisErrorPromise = import("../api/security/analyzers").then((m) => m.AnalysisError);
  }
  return analysisErrorPromise;
};

const buildClaudeRequest = (body: unknown) =>
  new NextRequest("http://localhost/api/Claude", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("returns 400 when file payload is missing", async () => {
  const handler = await getClaudeHandler();

  const res = await handler(buildClaudeRequest({}));
  const json = await res.json();

  assert.equal(res.status, 400);
  assert.deepEqual(json, { ok: false, error: "Missing file payload." });
});

test("handles valid file payload", async () => {
  const handler = await getClaudeHandler();

  const res = await handler(
    buildClaudeRequest({ file: { path: "src/demo.ts", language: "ts", content: "console.log('hi');" } })
  );
  const json = await res.json();

  assert.notEqual(res.status, 400);
  assert.equal(typeof json.ok, "boolean");
});

test("handles missing file path", async () => {
  const handler = await getClaudeHandler();

  const res = await handler(
    buildClaudeRequest({ file: { language: "ts", content: "console.log('test');" } })
  );
  const json = await res.json();

  assert.equal(json.ok, false);
  assert.equal(typeof json.error, "string");
  assert.ok(res.status === 400 || res.status === 500);
});