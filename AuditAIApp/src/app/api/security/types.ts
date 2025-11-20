export type FindingSeverity = "Low" | "Medium" | "High" | "Critical";
export type Finding = {
  id: string;
  severity: FindingSeverity;
  confidence: number;
  cwe?: string;
  owasp?: string;
  evidence: {
    lines: number[];
    snippet: string;
  };
  explanation: string;
  fix: {
    patch: {
      line?: number;
      insert_before?: string;
      replace_with?: string;
    }[];
      notes?: string;
  };
};

export type SummaryCounts = {
  total: number;
  high: number;
  medium: number;
  low: number;
};

export type Summary = {
  file: string;
  counts: SummaryCounts;
};

export type ApiSuccess = {
  ok: true;
  findings: Finding[];
  summary: Summary;
};

export type ApiError = {
  ok: false;
  error: string;
  issues?: unknown;
  raw?: string;
};

export type ApiResponse = ApiSuccess | ApiError;

export type ModelChoice = "OpenAI" | "Claude" | "Other";
