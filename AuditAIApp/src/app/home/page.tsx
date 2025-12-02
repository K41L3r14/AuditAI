"use client";
import React, { useState } from "react";
import { Card, CardContent } from "../components/card";
import { Button } from "../components/button";
import { Upload, FileCode } from "../components/icons";
import { ApiResponse, ApiSuccess, ModelChoice, CompareModel } from "../api/security/types";
import { guessLanguageFromName, normalizeFindings } from "../api/security/helpers";
import { CodePanel, SummaryPanel } from "./panels";
import { exportReportPdf } from "./report";
import "./home.css";

const COMPARE_MODELS: CompareModel[] = ["OpenAI", "Claude", "CodeBert"];

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [model, setModel] = useState<ModelChoice>("OpenAI");
  const [apiData, setApiData] = useState<ApiSuccess | null>(null);
  const [comparisonData, setComparisonData] = useState<Record<CompareModel, ApiSuccess | null> | null>(null);
  const [comparisonErrors, setComparisonErrors] = useState<Record<CompareModel, string | null> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(true);

  const hasComparison = comparisonData !== null;
  const hasResults = !!apiData || hasComparison;
  const comparisonModeActive = hasComparison;

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setApiData(null);
    setComparisonData(null);
    setComparisonErrors(null);
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setFileContent(text);
    };
    reader.onerror = () => setError("Failed to read file.");
    reader.readAsText(f);
  }

  async function handleAnalyze() {
    if (!file || !fileContent) {
      setError("Please upload a file first.");
      return;
    }
    try {
      setIsLoading(true);
      setError(null);
      setApiData(null);
      setComparisonData(null);
      setComparisonErrors(null);
      const language = guessLanguageFromName(file.name);
      const payload = {
        file: { path: file.name, language, content: fileContent },
        model,
      };

      if (model === "Both") {
        const res = await fetch("/api/compare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file: payload.file }),
        });
        const json = (await res.json()) as ApiResponse;
        if (!json.ok && !("models" in json)) {
          setError(json.error);
          return;
        }
        if ("models" in json) {
          const normalizedData: Record<CompareModel, ApiSuccess | null> = {
            OpenAI: null,
            Claude: null,
            CodeBert: null,
          };
          const perModelErrors: Record<CompareModel, string | null> = {
            OpenAI: null,
            Claude: null,
            CodeBert: null,
          };

          COMPARE_MODELS.forEach((key) => {
            const result = json.models[key];
            if (result?.ok) {
              const normalizedFindings = normalizeFindings(fileContent, result.findings);
              normalizedData[key] = { ...result, findings: normalizedFindings };
            } else if (result) {
              perModelErrors[key] = result.error ?? "Model returned an unknown error.";
            } else {
              perModelErrors[key] = "No response from model.";
            }
          });

          setComparisonData(normalizedData);
          setComparisonErrors(perModelErrors);
          if (perModelErrors.OpenAI && perModelErrors.Claude && perModelErrors.CodeBert) {
            setError("All models failed to analyze the file.");
          } else {
            setError(null);
          }
          return;
        }
        setError("Unexpected response from comparison endpoint.");
        return;
      }

      let endpoint: string;
      switch (model) {
        case "Claude":
          endpoint = "/api/Claude";
          break;
        case "CodeBert":
          endpoint = "/api/CodeBert";
          break;
        default:
          endpoint = "/api/GPT";
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as ApiResponse;
      if (!json.ok) {
        setError(json.error);
        setApiData(null);
        return;
      }
      const success = json as ApiSuccess;
      const findings = normalizeFindings(fileContent, success.findings);
      setApiData({ ...success, findings });
    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      setApiData(null);
    } finally {
      setIsLoading(false);
    }
  }

  function handleExport() {
    if (!apiData || comparisonData) return;
    exportReportPdf({
      apiData,
      model,
      fileName: file?.name,
      fileContent,
    });
  }

  const exportDisabled = !apiData || isLoading || comparisonModeActive;

return (
  <div className="security-page">
    <div className="security-sidebar-column">
      <div className="sidebar-top-row">
        <Button
          onClick={() => setSidebarVisible((v) => !v)}
          className="sidebar-toggle-button"
        >
          {sidebarVisible ? "»" : "«"}
        </Button>
      </div>

      {sidebarVisible && (
        <aside className="security-sidebar">
          <Card>
            <CardContent>
              <h2 className="section-title">Upload Code</h2>
              <label className="upload-box">
                <Upload />
                <p className="upload-text">
                  {file ? `Selected: ${file.name}` : "Click to choose a file"}
                </p>
              <input type="file" className="upload-input" onChange={handleFileChange} />
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <h2 className="section-title">Choose Model</h2>
              <div className="model-options">
                {["OpenAI", "Claude", "CodeBert", "Both"].map((m) => (
                  <label key={m} className="model-option">
                    <input
                      type="radio"
                      name="model"
                      value={m}
                      checked={model === (m as ModelChoice)}
                      onChange={() => setModel(m as ModelChoice)}
                    />
                    <span>{m}</span>
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>

          <Button onClick={handleAnalyze} disabled={isLoading}>
            {isLoading ? "Analyzing..." : "Analyze Code"}
          </Button>

          {error && (
            <Card>
              <CardContent>
                <div className="error-panel">{error}</div>
              </CardContent>
            </Card>
          )}
        </aside>
      )}
    </div>
    <main className="security-main">
      <Card>
        <CardContent className="header-card-content">
          <div className="header-text">
            <h1 className="page-title">
              {comparisonModeActive ? "Model Comparison" : "AuditAI Code Security Analysis"}
            </h1>
            {comparisonModeActive && (
              <p className="page-subtitle">
                Comparing OpenAI, Claude, and CodeBert on the same file.
              </p>
            )}
          </div>
          <div className="header-actions">
            <Button onClick={handleExport} disabled={exportDisabled}>
              Export PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {comparisonData ? (
        <div className="comparison-container">
          {COMPARE_MODELS.map((modelKey) => {
            const data = comparisonData[modelKey];
            const modelError = comparisonErrors?.[modelKey] ?? null;
            return (
              <div key={modelKey} className="comparison-column">
                <Card>
                  <CardContent>
                    <div className="comparison-header">
                      <h2 className="section-title">{modelKey}</h2>
                        {modelError && <p className="comparison-error">{modelError}</p>}
                    </div>
                  </CardContent>
                </Card>
                {data ? (
                  <div className="results-grid">
                      <CodePanel fileName={file?.name} fileContent={fileContent} apiData={data} />
                    <SummaryPanel apiData={data} fileName={file?.name} />
                  </div>
                ) : (
                  <Card className="empty-card">
                    <CardContent className="empty-card-content">
                      <FileCode />
                      <p className="empty-text">
                        {modelError ?? "No findings reported for this model."}
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>
            );
          })}
        </div>
      ) : hasResults && apiData ? (
        <div className="results-grid">
            <CodePanel fileName={file?.name} fileContent={fileContent} apiData={apiData} />
          <SummaryPanel apiData={apiData} fileName={file?.name} />
        </div>
      ) : (
        <Card className="empty-card">
          <CardContent className="empty-card-content">
            <FileCode />
            <p className="empty-text">
              Upload a file and click &quot;Analyze Code&quot; to see results.
            </p>
          </CardContent>
        </Card>
      )}
    </main>
  </div>
  );
}
