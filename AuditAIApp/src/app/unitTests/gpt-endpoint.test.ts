import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

process.env.OPENAI_API_KEY ??= "test-openai-key";
process.env.ANTHROPIC_API_KEY ??= "test-anthropic-key";

type CreateHandler = typeof import("../api/GPT/route").createGPTHandler;
type AnalysisErrorCtor = typeof import("../api/security/analyzers").AnalysisError;

let handlerFactoryPromise: Promise<CreateHandler> | null = null;
const getHandlerFactory = () => {
  if (!handlerFactoryPromise) {
    handlerFactoryPromise = import("../api/GPT/route").then((m) => m.createGPTHandler);
  }
  return handlerFactoryPromise;
};

let analysisErrorPromise: Promise<AnalysisErrorCtor> | null = null;
const getAnalysisError = () => {
  if (!analysisErrorPromise) {
    analysisErrorPromise = import("../api/security/analyzers").then((m) => m.AnalysisError);
  }
  return analysisErrorPromise;
};

const buildRequest = (body: unknown) =>
  new NextRequest("http://localhost/api/GPT", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("returns 400 when file payload is missing", async () => {
  const handler = (await getHandlerFactory())();

  const res = await handler(buildRequest({}));
  const json = await res.json();

  assert.equal(res.status, 400);
  assert.deepEqual(json, { ok: false, error: "Missing file payload." });
});

test("returns analysis result when analyzer succeeds", async () => {
  const mockResult = {
    findings: [
      {
        id: "TEST_FINDING",
        severity: "Low",
        confidence: 0.9,
        cwe: "CWE-000",
        owasp: "A01",
        evidence: { lines: [1], snippet: "console.log('hi');" },
        explanation: "Example finding",
        fix: { patch: [], notes: "No-op" },
      },
    ],
    summary: { file: "src/demo.ts", counts: { total: 1, high: 0, medium: 0, low: 1 } },
  };

  const handler = (await getHandlerFactory())(async (file) => {
    assert.equal(file.path, "src/demo.ts");
    return mockResult;
  });

  const res = await handler(
    buildRequest({ file: { path: "src/demo.ts", language: "ts", content: "console.log('hi');" } })
  );
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.deepEqual(json.findings, mockResult.findings);
  assert.deepEqual(json.summary, mockResult.summary);
});

test("propagates AnalysisError status codes", async () => {
  const AnalysisError = await getAnalysisError();
  const handler = (await getHandlerFactory())(async () => {
    throw new AnalysisError("Upstream failure", 502);
  });

  const res = await handler(
    buildRequest({ file: { path: "src/file.ts", language: "ts", content: "alert('xss');" } })
  );
  const json = await res.json();

  assert.equal(res.status, 502);
  assert.deepEqual(json, { ok: false, error: "Upstream failure" });
});
