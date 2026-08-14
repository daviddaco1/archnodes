import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProjectStore, type ProjectStore } from "../store/project-store.js";
import { detectConflicts } from "./sync-report.js";

let baseDir: string;
let store: ProjectStore;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "pv-sync-report-test-"));
  store = createProjectStore(`test-${randomUUID()}`, { baseDir });
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

describe("detectConflicts", () => {
  it("groups nodes by sync status across the whole tracked project by default", () => {
    const inSync = store.createNode("domain", { name: "Auth" });
    store.recordSync(inSync.id, { sourceHash: "hashA", sourcePath: "src/domains/auth.ts" });

    const changed = store.createNode("domain", { name: "Billing" });
    store.recordSync(changed.id, { sourceHash: "hashB", sourcePath: "src/domains/billing.ts" });

    const untracked = store.createNode("domain", { name: "Support" }); // no sourcePath — excluded by default

    const report = detectConflicts(store, { [inSync.id]: "hashA", [changed.id]: "hashB-different" });

    expect(report.inSync.map((b) => b.nodeId)).toEqual([inSync.id]);
    expect(report.codeChanged.map((b) => b.nodeId)).toEqual([changed.id]);
    expect(report.inSync.concat(report.codeChanged, report.graphChanged, report.conflict, report.codeDeleted, report.unknown).some((b) => b.nodeId === untracked.id)).toBe(false);
  });

  it("respects an explicit scope, including nodes without a sourcePath", () => {
    const untracked = store.createNode("domain", { name: "Support" });
    const report = detectConflicts(store, {}, [untracked.id]);
    expect(report.unknown.map((b) => b.nodeId)).toEqual([untracked.id]);
  });

  it("buckets code_deleted for a null hash", () => {
    const node = store.createNode("domain", { name: "Auth" });
    store.recordSync(node.id, { sourceHash: "hashA", sourcePath: "src/domains/auth.ts" });
    const report = detectConflicts(store, { [node.id]: null });
    expect(report.codeDeleted.map((b) => b.nodeId)).toEqual([node.id]);
  });
});
