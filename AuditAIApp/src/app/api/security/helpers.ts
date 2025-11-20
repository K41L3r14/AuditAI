import type { ApiSuccess, Finding, FindingSeverity } from "./types";

export function guessLanguageFromName(name: string): string {
  if (name.endsWith(".ts") || name.endsWith(".tsx")) return "ts";
  if (name.endsWith(".js") || name.endsWith(".jsx")) return "js";
  if (name.endsWith(".py")) return "py";
  if (name.endsWith(".java")) return "java";
  return "unknown";
}

export function severityColor(sev: FindingSeverity): string {
  switch (sev) {
    case "Critical":
    case "High":
      return "severity-high";
    case "Medium":
      return "severity-medium";
    case "Low":
    default:
      return "severity-low";
  }
}

export function severityUnderline(sev: FindingSeverity): string {
  switch (sev) {
    case "Critical":
    case "High":
      return "underline-high";
    case "Medium":
      return "underline-medium";
    case "Low":
    default:
      return "underline-low";
  }
}

export type HighlightParts = {
  before: string;
  match: string | null;
  after: string;
  underlineClass: string | null;
};

export function normalizeFindingLines(
  fileContent: string,
  finding: Finding
): Finding {
  const rawSnippet = finding.evidence?.snippet ?? "";
  const snippet = rawSnippet.trim();
  if (!snippet) return finding;

  const fileLines = fileContent.split(/\r?\n/);
  const snippetLines = snippet.split(/\r?\n/);

  const sig = snippetLines.find((l) => l.trim().length > 0);
  if (!sig) return finding;

  const sigTrimmed = sig.trim();
  let baseIndex = -1; 
  for (let i = 0; i < fileLines.length; i++) {
    if (fileLines[i].includes(sigTrimmed)) {
      baseIndex = i;
      break;
    }
  }

  if (baseIndex === -1) {
    return finding;
  }

  const newLines: number[] = [];
  for (let i = 0; i < snippetLines.length; i++) {
    const ln = baseIndex + 1 + i;
    if (ln <= fileLines.length) {
      newLines.push(ln);
    }
  }

  return {
    ...finding,
    evidence: {
      ...finding.evidence,
      lines: newLines,
    },
  };
}

export function normalizeFindings(
  fileContent: string,
  findings: Finding[]
): Finding[] {
  return findings.map((f) => normalizeFindingLines(fileContent, f));
}

export function computeHighlightForLine(
  lineText: string,
  finding: Finding,
  lineNumber: number
): HighlightParts {
  const underlineClass = severityUnderline(finding.severity);
  const snippetRaw = finding.evidence.snippet ?? "";
  const snippet = snippetRaw.trim();
  if (!snippet) {
    return {
      before: lineText,
      match: null,
      after: "",
      underlineClass: null,
    };
  }

  const snippetLines = snippet.split(/\r?\n/);
  const linesArr = Array.isArray(finding.evidence.lines)
    ? finding.evidence.lines
    : [];

  let segment: string | null = null;
  if (
    linesArr.length === snippetLines.length &&
    linesArr.includes(lineNumber)
  ) {
    const idxInLines = linesArr.indexOf(lineNumber);
    segment = snippetLines[idxInLines].trim();
  } else {
    for (const s of snippetLines) {
      const trimmed = s.trim();
      if (!trimmed) continue;
      if (lineText.includes(trimmed)) {
        segment = trimmed;
        break;
      }
    }
  }
  if (!segment) {
    return {
      before: "",
      match: lineText,
      after: "",
      underlineClass,
    };
  }

  const idx = lineText.indexOf(segment);
  if (idx === -1) {
    return {
      before: "",
      match: lineText,
      after: "",
      underlineClass,
    };
  }

  const before = lineText.slice(0, idx);
  const match = lineText.slice(idx, idx + segment.length);
  const after = lineText.slice(idx + segment.length);

  return {
    before,
    match,
    after,
    underlineClass,
  };
}

export function findingsForLine(
  apiData: ApiSuccess | null,
  fileContent: string,
  lineNumber: number
): Finding[] {
  if (!apiData) return [];

  const lines = fileContent.split(/\r?\n/);
  const rawLine = lines[lineNumber - 1] ?? "";

  return apiData.findings.filter((f) => {
    const linesArr = Array.isArray(f.evidence.lines) ? f.evidence.lines : [];

    if (linesArr.length > 0) {
      return linesArr.includes(lineNumber);
    }

    const snippetRaw = f.evidence.snippet ?? "";
    const snippet = snippetRaw.trim();
    if (!snippet) return false;

    const snippetLines = snippet.split(/\r?\n/);
    return snippetLines.some((s) => {
      const trimmed = s.trim();
      return trimmed.length >= 2 && rawLine.includes(trimmed);
    });
  });
}
