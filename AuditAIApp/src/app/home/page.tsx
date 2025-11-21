"use client";
import React, { useState } from "react";
import { Card, CardContent } from "../components/card";
import { Button } from "../components/button";
import { Upload, FileCode } from "../components/icons";
import { ApiResponse, ApiSuccess, ModelChoice } from "../api/security/types";
import { guessLanguageFromName, normalizeFindings } from "../api/security/helpers";
import { CodePanel, SummaryPanel } from "./panels";
import { exportReportPdf } from "./report";
import "./home.css";
export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [model, setModel] = useState<ModelChoice>("OpenAI");
  const [apiData, setApiData] = useState<ApiSuccess | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasResults = !!apiData;

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setApiData(null);
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
      const language = guessLanguageFromName(file.name);
      const endpoint = model === "Claude" ? "/api/Claude" : "/api/GPT";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file: { path: file.name, language, content: fileContent },
          model,
        }),
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
    if (!apiData) return;
    exportReportPdf({
      apiData,
      model,
      fileName: file?.name,
      fileContent,
    });
  }

  return (
    <div className="security-page">
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
              {["OpenAI", "Claude", "Other"].map((m) => (
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

      <main className="security-main">
        <Card>
          <CardContent className="header-card-content">
            <div className="header-text">
              <h1 className="page-title">Security Assistant</h1>
            </div>
            <Button onClick={handleExport} disabled={!hasResults || isLoading}>
              Export PDF
            </Button>
          </CardContent>
        </Card>

        {hasResults && apiData ? (
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
