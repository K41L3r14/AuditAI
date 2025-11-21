"use client";
import React, { useState } from "react";
import { Card, CardContent } from "../components/card";
import { Info, ShieldCheck, AlertTriangle, XCircle, BarChart } from "../components/icons";
import type { ApiSuccess, Finding } from "../api/security/types";
import { severityColor, findingsForLine, computeHighlightForLine } from "../api/security/helpers";

export function PatchSuggestions({ fix }: { fix: Finding["fix"] }) {
  if (!fix?.patch || fix.patch.length === 0) return null;
  return (
    <div className="finding-patch">
      <p className="finding-patch-label">Fix Suggestion(s):</p>
      <pre className="finding-patch-code">
        {fix.patch.map((p, i) => {
          const changeText = p.replace_with ?? p.insert_before ?? "";
          if (!changeText) return null;
          return <div key={i}>{changeText}</div>;
        })}
      </pre>
    </div>
  );
}

export function FindingTooltip({ finding }: { finding: Finding }) {
  return (
    <div className="tooltip">
      <div className="tooltip-header">
        <Info />
        <span className="tooltip-title">
          {finding.id} – <span className={severityColor(finding.severity)}>{finding.severity}</span>
        </span>
      </div>
      <p className="tooltip-body">{finding.explanation}</p>
      <p className="tooltip-label">Evidence snippet:</p>
      <pre className="tooltip-snippet">{finding.evidence.snippet}</pre>
      {finding.fix?.patch && finding.fix.patch.length > 0 && (
        <>
          <p className="tooltip-label">Patch suggestion(s):</p>
          <pre className="tooltip-snippet">
            {finding.fix.patch.map((p, i) => {
              const changeText = p.replace_with ?? p.insert_before ?? "";
              if (!changeText) return null;
              return <div key={i}>{changeText}</div>;
            })}
          </pre>
        </>
      )}
      {finding.fix?.notes && <p className="tooltip-fix">Suggested fix: {finding.fix.notes}</p>}
    </div>
  );
}

type CodePanelProps = { fileName: string | undefined; fileContent: string; apiData: ApiSuccess };

export function CodePanel({ fileName, fileContent, apiData }: CodePanelProps) {
  const [tooltipData, setTooltipData] = useState<{
    findings: Finding[];
    top: number;
    left: number;
    locked: boolean;
  } | null>(null);
  const codeLines = fileContent ? fileContent.split("\n") : [];

  function computePosition(element: HTMLDivElement) {
    const rect = element.getBoundingClientRect();
    const offsetY = 8;
    const offsetX = 4;
    let top = rect.bottom + offsetY;
    let left = rect.left + offsetX;
    const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 0;
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 0;
    if (viewportWidth) {
      const maxLeft = Math.max(8, viewportWidth - 460);
      left = Math.min(maxLeft, Math.max(8, left));
    }
    if (viewportHeight) {
      top = Math.min(viewportHeight - 40, Math.max(rect.top + offsetY, top));
    }
    return { top, left };
  }

  function handleLineHover(
    findings: Finding[],
    element: HTMLDivElement
  ) {
    if (tooltipData?.locked) {
      return;
    }
    if (!findings || findings.length === 0) {
      setTooltipData(null);
      return;
    }
    const pos = computePosition(element);
    setTooltipData({ findings, ...pos, locked: false });
  }

  function handleLineClick(
    findings: Finding[],
    element: HTMLDivElement
  ) {
    if (!findings || findings.length === 0) return;
    const pos = computePosition(element);
    setTooltipData({ findings, ...pos, locked: true });
  }

  function handleLineLeave() {
    if (!tooltipData?.locked) setTooltipData(null);
  }

  function handleTooltipLeave() {
    setTooltipData(null);
  }

  return (
    <Card className="code-card">
      <CardContent className="code-card-content">
        <h2 className="section-title">{apiData.summary.file || fileName || "Original Input File"}</h2>
        <pre className="code-block">
          {codeLines.length === 0 && (
            <p className="code-empty">Upload a file and run analysis to see annotated code.</p>
          )}
          {codeLines.map((text, idx) => {
            const lineNo = idx + 1;
            const lineFindings = findingsForLine(apiData, fileContent, lineNo);
            const primaryFinding: Finding | undefined = lineFindings[0];

            const { before, match, after, underlineClass } = primaryFinding
              ? computeHighlightForLine(text, primaryFinding, lineNo)
              : {
                  before: text,
                  match: null,
                  after: "",
                  underlineClass: null,
                };

            return (
              <div
                key={idx}
                className="code-line"
                onMouseEnter={(event) => handleLineHover(lineFindings, event.currentTarget)}
                onMouseMove={(event) => handleLineHover(lineFindings, event.currentTarget)}
                onMouseLeave={handleLineLeave}
                onClick={(event) => handleLineClick(lineFindings, event.currentTarget)}
              >
                <span className="code-line-number">{lineNo}</span>
                <code className="code-line-text">
                  {match === null ? (
                    before
                  ) : (
                    <>
                      {before}
                      <span className={underlineClass ?? ""}>{match}</span>
                      {after}
                    </>
                  )}
                </code>
              </div>
            );
          })}
        </pre>
        {tooltipData && (
          <div
            className="tooltip-wrapper"
            style={{ top: tooltipData.top, left: tooltipData.left }}
            onMouseLeave={handleTooltipLeave}
          >
            {tooltipData.findings.map((finding, idx) => (
              <FindingTooltip key={`${finding.id}-${idx}`} finding={finding} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type SummaryPanelProps = { apiData: ApiSuccess; fileName: string | undefined };

export function SummaryPanel({ apiData, fileName }: SummaryPanelProps) {
  const {
    summary: { counts },
  } = apiData;
  const metrics = [
    { label: "Total Findings", value: counts.total, icon: BarChart, className: "" },
    { label: "High/Critical", value: counts.high, icon: XCircle, className: "severity-high" },
    { label: "Medium", value: counts.medium, icon: AlertTriangle, className: "severity-medium" },
    { label: "Low", value: counts.low, icon: ShieldCheck, className: "severity-low" },
  ];

  return (
    <Card className="summary-card">
      <CardContent className="summary-card-content">
        <div className="summary-header">
          <ShieldCheck />
          <h2 className="summary-title">Security Summary</h2>
        </div>
        <p className="summary-file">
          File: <span className="summary-file-name">{apiData.summary.file || fileName || "unknown"}</span>
        </p>

        <div className="metrics-section">
          <h3 className="section-title">Metrics</h3>
          <div className="metrics-grid">
            {metrics.map(({ label, value, icon: Icon, className }, i) => (
              <Card key={i} className="metric-card">
                <CardContent>
                  <Icon />
                  <p className={`metric-value ${className}`}>{value}</p>
                  <p className="metric-label">{label}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <div className="findings-section">
          <h3 className="section-title">Findings</h3>
          {apiData.findings.length === 0 && <p className="no-findings">No findings reported by the model.</p>}
          <div className="findings-list">
            {apiData.findings.map((f, idx) => (
              <Card key={idx} className="finding-card">
                <CardContent>
                  <div className="finding-header">
                    <span className="finding-id">
                      {f.id}
                      {f.cwe && ` • ${f.cwe}`}
                    </span>
                    <span className={`finding-pill ${severityColor(f.severity)}`}>
                      {f.severity} • {(f.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="finding-lines">Lines: {f.evidence.lines.join(", ")}</p>
                  <p className="finding-text">{f.explanation}</p>
                  <PatchSuggestions fix={f.fix} />
                  {f.fix?.notes && <p className="finding-fix">Fix notes: {f.fix.notes}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
