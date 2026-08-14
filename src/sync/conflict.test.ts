import { describe, expect, it } from "vitest";
import { determineSyncStatus } from "./conflict.js";
import type { AnyGraphNode } from "../types/graph.js";

function mkNode(overrides: Partial<AnyGraphNode>): AnyGraphNode {
  return {
    id: "n1",
    type: "domain",
    label: "Auth",
    position: { x: 0, y: 0 },
    props: { name: "Auth" },
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  } as AnyGraphNode;
}

describe("determineSyncStatus", () => {
  it("is unknown when the node has never been synced (no sourceHash)", () => {
    const node = mkNode({});
    expect(determineSyncStatus(node, "abc")).toBe("unknown");
  });

  it("is unknown when no current hash is supplied", () => {
    const node = mkNode({ sourceHash: "abc", lastSyncedAt: "2024-01-01T00:00:00.000Z" });
    expect(determineSyncStatus(node, undefined)).toBe("unknown");
  });

  it("is in_sync when neither the code nor the graph changed since the last sync", () => {
    const node = mkNode({ sourceHash: "abc", lastSyncedAt: "2024-01-02T00:00:00.000Z", updatedAt: "2024-01-02T00:00:00.000Z" });
    expect(determineSyncStatus(node, "abc")).toBe("in_sync");
  });

  it("is code_changed when the hash differs but the graph wasn't touched since the last sync", () => {
    const node = mkNode({ sourceHash: "abc", lastSyncedAt: "2024-01-02T00:00:00.000Z", updatedAt: "2024-01-02T00:00:00.000Z" });
    expect(determineSyncStatus(node, "different-hash")).toBe("code_changed");
  });

  it("is graph_changed when the hash matches but the node was edited after the last sync", () => {
    const node = mkNode({ sourceHash: "abc", lastSyncedAt: "2024-01-02T00:00:00.000Z", updatedAt: "2024-01-03T00:00:00.000Z" });
    expect(determineSyncStatus(node, "abc")).toBe("graph_changed");
  });

  it("is conflict when both the code and the graph changed since the last sync", () => {
    const node = mkNode({ sourceHash: "abc", lastSyncedAt: "2024-01-02T00:00:00.000Z", updatedAt: "2024-01-03T00:00:00.000Z" });
    expect(determineSyncStatus(node, "different-hash")).toBe("conflict");
  });

  it("is code_deleted when currentHash is explicitly null and the node has a sourcePath", () => {
    const node = mkNode({ sourcePath: "src/domains/auth.ts", sourceHash: "abc", lastSyncedAt: "2024-01-01T00:00:00.000Z" });
    expect(determineSyncStatus(node, null)).toBe("code_deleted");
  });

  it("is unknown (not code_deleted) when currentHash is null but the node has no sourcePath", () => {
    const node = mkNode({});
    expect(determineSyncStatus(node, null)).toBe("unknown");
  });

  it("omitting currentHash (undefined) still means 'not checked', not code_deleted", () => {
    const node = mkNode({ sourcePath: "src/domains/auth.ts", sourceHash: "abc" });
    expect(determineSyncStatus(node, undefined)).toBe("unknown");
  });
});
