import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendAuditEntry, filterAuditLog, readAuditLog, type AuditEntry } from "./audit-log.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pv-audit-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function mkEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return { id: "e1", timestamp: "2024-01-01T00:00:00.000Z", transport: "http", operation: "GET /api/project", result: "SUCCESS", ...overrides };
}

describe("appendAuditEntry / readAuditLog", () => {
  it("creates the file (and parent dir) on first append, and returns [] before that", () => {
    const path = join(dir, ".audit", "audit.jsonl");
    expect(readAuditLog(path)).toEqual([]);
    appendAuditEntry(path, mkEntry());
    expect(readAuditLog(path)).toEqual([mkEntry()]);
  });

  it("appends without rewriting earlier entries", () => {
    const path = join(dir, ".audit", "audit.jsonl");
    appendAuditEntry(path, mkEntry({ id: "e1" }));
    appendAuditEntry(path, mkEntry({ id: "e2", operation: "POST /api/nodes" }));
    const entries = readAuditLog(path);
    expect(entries.map((e) => e.id)).toEqual(["e1", "e2"]);
  });
});

describe("filterAuditLog", () => {
  const entries: AuditEntry[] = [
    mkEntry({ id: "e1", timestamp: "2024-01-01T00:00:00.000Z" }),
    mkEntry({ id: "e2", timestamp: "2024-01-02T00:00:00.000Z" }),
    mkEntry({ id: "e3", timestamp: "2024-01-03T00:00:00.000Z" }),
  ];

  it("limits to the most recent N", () => {
    expect(filterAuditLog(entries, { limit: 2 }).map((e) => e.id)).toEqual(["e2", "e3"]);
  });

  it("filters to strictly-before a timestamp", () => {
    expect(filterAuditLog(entries, { before: "2024-01-03T00:00:00.000Z" }).map((e) => e.id)).toEqual(["e1", "e2"]);
  });
});
