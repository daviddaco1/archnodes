import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

// Deliberately separate from src/history/history.ts: history is replayable (undo/redo/restore
// walk it forward and backward) and only records transactions that actually changed the graph.
// An audit log is append-only, records EVERY operation (including reads and failures), and is
// never replayed — mixing the two would force the replay code to filter out entries it can't
// apply, a correctness risk for a purely cosmetic gain.
export interface AuditEntry {
  id: string;
  timestamp: string;
  transport: "http" | "mcp";
  operation: string;
  identity?: { name?: string; role?: string };
  // Summary only — never the node's full props, so the audit log itself is safe to expose broadly.
  target?: { nodeId?: string; nodeType?: string };
  result: "SUCCESS" | "FAILURE" | "CONFLICT";
  errorMessage?: string;
  durationMs?: number;
}

export function appendAuditEntry(path: string, entry: AuditEntry): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`);
}

export function readAuditLog(path: string): AuditEntry[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as AuditEntry);
}

export function filterAuditLog(entries: AuditEntry[], opts?: { limit?: number; before?: string }): AuditEntry[] {
  let result = entries;
  if (opts?.before) result = result.filter((e) => e.timestamp < opts.before!);
  if (opts?.limit) result = result.slice(-opts.limit);
  return result;
}
