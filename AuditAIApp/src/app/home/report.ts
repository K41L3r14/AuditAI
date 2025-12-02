"use client";
import jsPDF from "jspdf";
import type { ApiSuccess, ModelChoice } from "../api/security/types";

export function exportReportPdf(options: {
  apiData: ApiSuccess;
  model: ModelChoice;
  fileName?: string;
  fileContent?: string;
}) {
  const { apiData, model, fileName, fileContent } = options;

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const maxWidth = pageWidth - margin * 2;
  const lineHeight = 16;
  let y = margin;
  function addLine(
    text: string,
    opts?: { bold?: boolean; size?: number; indent?: number }
  ) {
    const indent = opts?.indent ? opts.indent * 20 : 0; 
    const x = margin + indent;

    if (opts?.size) doc.setFontSize(opts.size);
    else doc.setFontSize(11);

    if (opts?.bold) doc.setFont("helvetica", "bold");
    else doc.setFont("helvetica", "normal");

    const lines = doc.splitTextToSize(text, maxWidth - indent);
    for (const line of lines) {
      if (y > pageHeight - margin) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, x, y);
      y += lineHeight;
    }
  }

  function addSpacer(multiplier = 1) {
    y += lineHeight * multiplier;
  }

  const safeName = (apiData.summary.file || fileName || "unknown").replace(
    /[^\w.-]+/g,
    "_"
  );

  addLine("Audit AI Report", { bold: true, size: 18 });
  addSpacer(0.5);

  const exportedAt = new Date().toLocaleString();
  addLine(`File: ${apiData.summary.file || fileName || "unknown"}`);
  addLine(`Model: ${model}`);
  addLine(`Exported: ${exportedAt}`);
  addSpacer(1);

  const { counts } = apiData.summary;
  addLine("Summary", { bold: true, size: 14 });
  addSpacer(0.25);
  addLine(`Total findings: ${counts.total}`, { indent: 1 });
  addLine(`High/Critical: ${counts.high}`, { indent: 1 });
  addLine(`Medium: ${counts.medium}`, { indent: 1 });
  addLine(`Low: ${counts.low}`, { indent: 1 });
  addSpacer(1);

  addLine("Findings", { bold: true, size: 14 });
  addSpacer(0.25);

  if (apiData.findings.length === 0) {
    addLine("No findings reported by the model.", { indent: 1 });
  } else {
    apiData.findings.forEach((f, index) => {
      addSpacer(0.5);

      addLine(
        `${index + 1}. ${f.id}${f.cwe ? " • " + f.cwe : ""}`,
        { bold: true }
      );

      addLine(`Severity: ${f.severity}`, { indent: 1 });
      addLine(`Confidence: ${(f.confidence * 100).toFixed(0)}%`, {
        indent: 1,
      });
      addLine(`Lines: ${f.evidence.lines.join(", ")}`, { indent: 1 });

      addSpacer(0.25);
      addLine("Explanation:", { bold: true, indent: 1 });
      addLine(f.explanation, { indent: 2 });

      addSpacer(0.25);
      addLine("Evidence snippet:", { bold: true, indent: 1 });
      addLine(f.evidence.snippet, { indent: 2 });

      if (f.fix?.notes) {
        addSpacer(0.25);
        addLine("Fix notes:", { bold: true, indent: 1 });
        addLine(f.fix.notes, { indent: 2 });
      }

      if (f.fix?.patch && f.fix.patch.length > 0) {
        addSpacer(0.25);
        addLine("Patch suggestion(s):", { bold: true, indent: 1 });
        f.fix.patch.forEach((p) => {
          const changeText = p.replace_with ?? p.insert_before ?? "";
          if (changeText) {
            addLine(changeText, { indent: 2 });
          }
        });
      }
    });
  }

  if (fileContent) {
    addSpacer(1);
    addLine("Original Code (truncated)", { bold: true, size: 14 });

    const maxCodeChars = 4000;
    const codeToPrint =
      fileContent.length > maxCodeChars
        ? fileContent.slice(0, maxCodeChars) + "\n\n[...truncated...]"
        : fileContent;

    const codeLines = codeToPrint.split("\n");
    codeLines.forEach((line, i) => {
      addLine(`${(i + 1).toString().padStart(4, " ")}  ${line}`, {
        indent: 1,
      });
    });
  }

  doc.save(`security-report-${safeName}.pdf`);
}
