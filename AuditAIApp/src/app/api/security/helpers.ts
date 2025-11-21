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

const LINE_SPLIT = /\r?\n/;

function normalizeForMatch(value: string): string {
  return value.replace(/\r?\n/g, "").replace(/\s+/g, "").toLowerCase();
}

function includesLoosely(haystack: string, needle: string): boolean {
  if (!needle) return false;
  if (haystack.includes(needle)) return true;
  const compactHaystack = normalizeForMatch(haystack);
  const compactNeedle = normalizeForMatch(needle);
  if (!compactHaystack || !compactNeedle) return false;
  return compactHaystack.includes(compactNeedle);
}

function getExpectedLine(finding: Finding): number | null {
  const evidenceLines = Array.isArray(finding.evidence.lines)
    ? finding.evidence.lines
    : [];
  if (evidenceLines.length > 0 && typeof evidenceLines[0] === "number") {
    return evidenceLines[0];
  }
  const patchLine = finding.fix?.patch?.find(
    (p) => typeof p.line === "number"
  )?.line;
  return typeof patchLine === "number" ? patchLine : null;
}

function collectSnippetCandidates(
  fileLines: string[],
  snippetLines: string[]
): number[] {
  const meaningful = snippetLines.map((l) => l.trim()).filter(Boolean);
  if (meaningful.length === 0) return [];

  const candidates: number[] = [];

  if (meaningful.length > 1) {
    for (let i = 0; i <= fileLines.length - meaningful.length; i++) {
      let matches = true;
      for (let j = 0; j < meaningful.length; j++) {
        if (!includesLoosely(fileLines[i + j], meaningful[j])) {
          matches = false;
          break;
        }
      }
      if (matches) {
        candidates.push(i);
      }
    }
  }

  if (candidates.length === 0) {
    let signature = meaningful[0];
    for (const line of meaningful) {
      if (line.length > signature.length) {
        signature = line;
      }
    }
    for (let i = 0; i < fileLines.length; i++) {
      if (includesLoosely(fileLines[i], signature)) {
        candidates.push(i);
      }
    }
  }

  return candidates;
}

export type HighlightParts = {
  before: string;
  match: string | null;
  after: string;
  underlineClass: string | null;
};

export function normalizeFindingLines<T extends Finding>(
  fileContent: string,
  finding: T
): T {
  const normalizedFile = fileContent.replace(/\r\n/g, "\n");
  const fileLines = fileContent.split(LINE_SPLIT);
  const expectedLine = getExpectedLine(finding);
  const rawSnippet = finding.evidence?.snippet ?? "";
  let snippet = rawSnippet.trim();
  let workingFinding: T = finding;

  const directLines =
    findLinesByDirectMatch(normalizedFile, rawSnippet) ??
    findLinesByDirectMatch(normalizedFile, snippet);
  if (directLines && directLines.length > 0) {
    return {
      ...finding,
      evidence: {
        ...finding.evidence,
        lines: directLines,
      },
    } as T;
  }

  if (!snippet) {
    const derived = deriveSnippetFromLines(fileLines, finding);
    if (derived) {
      snippet = derived.trim();
      workingFinding = {
        ...finding,
        evidence: {
          ...finding.evidence,
          snippet: derived,
        },
      };
    } else if (typeof expectedLine === "number" && expectedLine > 0) {
      const fallbackSnippet = fileLines[expectedLine - 1] ?? "";
      return {
        ...workingFinding,
        evidence: {
          ...workingFinding.evidence,
          snippet: fallbackSnippet,
          lines: [expectedLine],
        },
      } as T;
    } else {
      return workingFinding;
    }
  }

  const snippetLines = snippet.split(LINE_SPLIT);
  const snippetCount = Math.max(
    snippetLines.map((line) => line.trim()).filter(Boolean).length,
    1
  );

  const candidates = collectSnippetCandidates(fileLines, snippetLines);

  if (candidates.length === 0) {
    if (typeof expectedLine === "number") {
      const fallbackLines: number[] = [];
      for (let i = 0; i < snippetCount; i++) {
        fallbackLines.push(expectedLine + i);
      }
      return {
        ...workingFinding,
        evidence: {
          ...workingFinding.evidence,
          lines: fallbackLines,
        },
      };
    }
    return workingFinding;
  }

  let baseIndex = candidates[0];
  if (typeof expectedLine === "number") {
    const expectedIdx = Math.max(expectedLine - 1, 0);
    let bestDiff = Math.abs(baseIndex - expectedIdx);
    for (const idx of candidates) {
      const diff = Math.abs(idx - expectedIdx);
      if (diff < bestDiff) {
        bestDiff = diff;
        baseIndex = idx;
      }
    }
  }

  const newLines: number[] = [];
  for (let i = 0; i < snippetCount; i++) {
    const ln = baseIndex + 1 + i;
    if (ln <= fileLines.length) {
      newLines.push(ln);
    }
  }

  return {
    ...workingFinding,
    evidence: {
      ...workingFinding.evidence,
      lines: newLines,
    },
  } as T;
}

export function normalizeFindings<T extends Finding>(
  fileContent: string,
  findings: T[]
): T[] {
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

function deriveSnippetFromLines<T extends Finding>(
  fileLines: string[],
  finding: T
): string | null {
  const lineNumbers = Array.isArray(finding.evidence.lines)
    ? finding.evidence.lines
    : [];
  if (lineNumbers.length === 0) return null;
  const collected = lineNumbers
    .map((ln) => fileLines[ln - 1] ?? "")
    .join("\n")
    .trim();
  return collected.length > 0 ? collected : null;
}

function findLinesByDirectMatch(fileContent: string, snippet: string): number[] | null {
  if (!snippet || snippet.length === 0) return null;
  const normalizedSnippet = snippet.replace(/\r\n/g, "\n");
  const idx = fileContent.indexOf(normalizedSnippet);
  if (idx === -1) return null;
  const prefix = fileContent.slice(0, idx);
  const startLine = prefix.length === 0 ? 1 : prefix.split("\n").length;
  const snippetLineCount = Math.max(normalizedSnippet.split("\n").length, 1);
  const lines: number[] = [];
  for (let i = 0; i < snippetLineCount; i++) {
    lines.push(startLine + i);
  }
  return lines;
}
