import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { selectFindings, loadRegistry } from "../security/registry";

export const runtime = "nodejs";

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

async function callHuggingFaceAPI(prompt: string) {
  const HF_API_KEY = process.env.HUGGINGFACE_API_KEY!;
  const HF_API_URL = 'https://api-inference.huggingface.co/models/microsoft/codebert-base';

  try {
    const response = await fetch(HF_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HF_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          max_length: 800,
          temperature: 0.1,
          do_sample: false,
          return_full_text: false
        }
      }),
    });

    if (!response.ok) {
      throw new Error(`Hugging Face API error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Hugging Face API call failed:', error);
    throw error;
  }
}

export async function POST(req: NextRequest) {
  let body: any = undefined;
  try {
    console.log("=== /api/Codebert request started ===");

    body = await req.json(); // assign to outer-scoped variable so it's accessible in catch block
    console.log("Incoming body keys:", Object.keys(body));
    const { file } = body as { file: { path: string; language: string; content: string } };
    console.log("File path:", file?.path);
    console.log("Language:", file?.language);
    console.log("Content length:", file?.content?.length ?? 0);

    const allowed = await selectFindings({ language: file.language, max: 12 });
    console.log("Allowed findings loaded:", allowed.length);

    await loadRegistry();
    console.log("Registry loaded.");

    console.log("Hugging Face key loaded?", !!process.env.HUGGINGFACE_API_KEY);

    const system = [
      "You are a security code auditor.",
      "Only report findings whose 'id' exists in allowed_findings.",
      "If nothing matches, return an empty 'findings' array.",
      "Always include exact line numbers and a verbatim snippet.",
      "Prefer high precision over recall. If unsure, lower confidence or skip.",
      "Return ONLY a single JSON object.",
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

    const prompt = `SYSTEM: ${system}\n\nUSER: ${JSON.stringify(user, null, 2)}`;

    console.log("Sending prompt to Hugging Face...");
    
    const hfResponse = await callHuggingFaceAPI(prompt);
    console.log("Hugging Face response received:", hfResponse);

    let generatedText;
    if (Array.isArray(hfResponse)) {
      generatedText = hfResponse[0]?.generated_text;
    } else {
      generatedText = hfResponse.generated_text;
    }

    console.log("Generated text length:", generatedText?.length ?? 0);
    console.log("Raw model output (first 500 chars):", generatedText?.slice(0, 500));

    if (!generatedText) {
      console.warn("No generated text from Hugging Face");
      return NextResponse.json({
        ok: true,
        findings: [],
        summary: {
          file: file.path,
          counts: { total: 0, high: 0, medium: 0, low: 0 }
        }
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(generatedText);
      console.log("Direct JSON parse successful");
    } catch (parseErr) {
      console.log("Direct parse failed, trying to extract JSON from text...");
      const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
          console.log("JSON extraction successful");
        } catch (extractErr) {
          console.error("JSON extraction failed:", extractErr);
          parsed = {
            findings: [],
            summary: {
              file: file.path,
              counts: { total: 0, high: 0, medium: 0, low: 0 }
            }
          };
        }
      } else {
        console.error("No JSON object found in response");
        parsed = {
          findings: [],
          summary: {
            file: file.path,
            counts: { total: 0, high: 0, medium: 0, low: 0 }
          }
        };
      }
    }

    console.log("Validating model response...");
    const validated = ModelResponse.parse(parsed);
    console.log("Validation success! Returning response.");

    return NextResponse.json({ ok: true, ...validated });
  } catch (err: unknown) {
    console.error("=== ERROR in /api/GPT ===");
    console.error(err);
    
    // Now body is accessible here
    const filePath = body?.file?.path || "unknown";
    
    return NextResponse.json(
      { 
        ok: false, 
        error: err instanceof Error ? err.message : "Unknown error",
        findings: [],
        summary: {
          file: filePath,
          counts: { total: 0, high: 0, medium: 0, low: 0 }
        }
      },
      { status: 500 }
    );
  }
}