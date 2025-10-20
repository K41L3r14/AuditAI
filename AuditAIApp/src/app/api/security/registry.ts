// security/registry.ts
import fs from "fs/promises";
import path from "node:path";
import { FindingRegistry, TFindingItem, TFindingRegistry } from "../security/schema";

let cache: TFindingRegistry | null = null;

export async function loadRegistry(): Promise<TFindingRegistry> {
  if (cache) return cache;
  const p = path.join(process.cwd(), "security", "allowed_findings.json");
  const raw = await fs.readFile(p, "utf8");
  const json = JSON.parse(raw);
  cache = FindingRegistry.parse(json);
  return cache!;
}

export async function selectFindings(opts: {
  language: string;            // e.g., "ts", "js", "py"
  include?: string[];          // optional whitelist of IDs
  exclude?: string[];          // optional blacklist of IDs
  max?: number;                // cap to control token use
}): Promise<TFindingItem[]> {
  const reg = await loadRegistry();
  let items = reg.items.filter(f =>
    f.languages.includes("*") || f.languages.includes(opts.language)
  );
  if (opts.include?.length) items = items.filter(f => opts.include!.includes(f.id));
  if (opts.exclude?.length) items = items.filter(f => !opts.exclude!.includes(f.id));
  if (typeof opts.max === "number") items = items.slice(0, opts.max);
  return items;
}
