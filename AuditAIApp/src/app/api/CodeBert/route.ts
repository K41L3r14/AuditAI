import { NextRequest, NextResponse } from "next/server";
import { selectFindings, loadRegistry } from "../security/registry";
import { InferenceClient } from '@huggingface/inference';

export const runtime = "nodejs";

// Initialize Hugging Face client
const client = new InferenceClient(process.env.HUGGINGFACE_API_KEY);

export async function POST(req: NextRequest) {
  let body: any;

  try {
    console.log("=== /api/CodeBert request started ===");

    body = await req.json();
    const { file } = body as { file: { path: string; language: string; content: string } };
    
    // Truncate code content to stay within limits
    let safeContent = file.content;
    if (safeContent.length > 500) {
      safeContent = safeContent.substring(0, 500) + "\n// ... [truncated]";
      console.log("Code truncated from", file.content.length, "to 500 chars");
    }

    const allowed = await selectFindings({ 
      language: file.language, 
      max: 6
    });
    console.log("Allowed findings loaded:", allowed.length);

    await loadRegistry();

    // System prompt
    const systemPrompt = [
      "You are a security code auditor.",
      "Only report findings whose 'id' exists in allowed_findings.",
      "If nothing matches, return an empty 'findings' array.",
      "Always include exact line numbers and a verbatim snippet.",
      "Prefer high precision over recall. If unsure, lower confidence or skip.",
      "Return ONLY a single JSON object.",
    ].join(" ");

    // User message with code and findings
    const userContent = {
      task: "Analyze this code for security vulnerabilities and return findings in the specified JSON format.",
      file: {
        path: file.path,
        language: file.language,
        content: safeContent
      },
      allowed_findings: allowed.map(({ id, title, severity }) => ({
        id, title, severity
      })),
      output_format: {
        findings: [{
          id: "string",
          severity: "Low|Medium|High|Critical", 
          confidence: "number 0-1",
          evidence: {
            lines: "number[]",
            snippet: "string"
          },
          explanation: "string",
          fix: {
            patch: [{
              line: "number",
              replace_with: "string"
            }]
          }
        }],
        summary: {
          file: "string",
          counts: {
            total: "number",
            high: "number",
            medium: "number", 
            low: "number"
          }
        }
      }
    };

    console.log("Sending to Hugging Face...");
    
    // Use InferenceClient for chat completion
    const messages = [
      {
        role: "system" as const,
        content: systemPrompt
      },
      {
        role: "user" as const, 
        content: JSON.stringify(userContent, null, 2)
      }
    ];

    const chatCompletion = await client.chatCompletion({
      model: "meta-llama/Meta-Llama-3-8B-Instruct",
      messages: messages,
      max_tokens: 500,
      temperature: 0.1,
    });

    console.log("Hugging Face response received");
    
    // Extract the content
    const generatedText = chatCompletion.choices[0]?.message?.content || '';
    console.log("Generated text length:", generatedText.length);

    let responseData: any;

    if (!generatedText) {
      console.warn("No generated text from Hugging Face");
      responseData = {
        findings: [],
        summary: {
          file: file.path,
          counts: { total: 0, high: 0, medium: 0, low: 0 }
        }
      };
    } else {
      console.log("Raw output (first 200 chars):", generatedText.substring(0, 200));
      
      try {
        // Try to extract JSON from the response
        const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          responseData = JSON.parse(jsonMatch[0]);
          console.log("JSON extraction successful");
        } else {
          throw new Error("No JSON found in response");
        }
      } catch (parseError) {
        console.error("JSON parsing failed, using empty findings");
        responseData = {
          findings: [],
          summary: {
            file: file.path,
            counts: { total: 0, high: 0, medium: 0, low: 0 }
          }
        };
      }
    }

    console.log("Findings count:", responseData.findings?.length || 0);

    return NextResponse.json({ ok: true, ...responseData });

  } catch (err: unknown) {
    console.error("=== ERROR in /api/CodeBert ===");
    console.error(err);
    
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