import { describe, expect, it } from "vitest";
import {
  applyForwardDiff,
  applyReverseDiff,
  diffGraphs,
  filterHistory,
  replayToPosition,
  type HistoryEntry,
} from "./history.js";
import type { AnyGraphNode, ProjectGraph } from "../types/graph.js";

function node(id: string, name: string): AnyGraphNode {
  const timestamp = "2024-01-01T00:00:00.000Z";
  return {
    id,
    type: "domain",
    label: name,
    position: { x: 0, y: 0 },
    props: { name },
    createdAt: timestamp,
    updatedAt: timestamp,
  } as AnyGraphNode;
}

function graphOf(nodes: AnyGraphNode[]): ProjectGraph {
  return {
    manifest: { projectName: "p", createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z" },
    nodes,
    edges: [],
  };
}

describe("diffGraphs", () => {
  it("reports an added node with before undefined", () => {
    const before = graphOf([]);
    const after = graphOf([node("a", "Auth")]);
    const { nodesDiff } = diffGraphs(before, after);
    expect(nodesDiff).toEqual([{ id: "a", before: undefined, after: node("a", "Auth") }]);
  });

  it("reports a removed node with after undefined", () => {
    const before = graphOf([node("a", "Auth")]);
    const after = graphOf([]);
    const { nodesDiff } = diffGraphs(before, after);
    expect(nodesDiff).toEqual([{ id: "a", before: node("a", "Auth"), after: undefined }]);
  });

  it("reports a changed node with both sides present", () => {
    const before = graphOf([node("a", "Auth")]);
    const after = graphOf([node("a", "AuthRenamed")]);
    const { nodesDiff } = diffGraphs(before, after);
    expect(nodesDiff).toHaveLength(1);
    expect((nodesDiff[0].before?.props as { name: string }).name).toBe("Auth");
    expect((nodesDiff[0].after?.props as { name: string }).name).toBe("AuthRenamed");
  });

  it("reports nothing for identical graphs", () => {
    const g = graphOf([node("a", "Auth")]);
    const { nodesDiff, edgesDiff } = diffGraphs(g, structuredClone(g));
    expect(nodesDiff).toEqual([]);
    expect(edgesDiff).toEqual([]);
  });
});

describe("applyForwardDiff / applyReverseDiff", () => {
  it("round-trips an add: forward adds the node, reverse removes it again", () => {
    const before = graphOf([]);
    const after = graphOf([node("a", "Auth")]);
    const { nodesDiff, edgesDiff } = diffGraphs(before, after);
    const entry: HistoryEntry = { id: "e1", timestamp: "t", operation: "createNode", source: "system", nodesDiff, edgesDiff };

    const g = graphOf([]);
    applyForwardDiff(g, entry);
    expect(g.nodes).toHaveLength(1);
    applyReverseDiff(g, entry);
    expect(g.nodes).toHaveLength(0);
  });
});

describe("replayToPosition", () => {
  it("walks forward and backward across multiple entries and lands on the exact same state", () => {
    const g0 = graphOf([]);
    const g1 = graphOf([node("a", "Auth")]);
    const g2 = graphOf([node("a", "Auth"), node("b", "Billing")]);
    const entry1: HistoryEntry = { id: "e1", timestamp: "t1", operation: "createNode", source: "system", ...diffGraphs(g0, g1) };
    const entry2: HistoryEntry = { id: "e2", timestamp: "t2", operation: "createNode", source: "system", ...diffGraphs(g1, g2) };
    const entries = [entry1, entry2];

    const g = graphOf([node("a", "Auth"), node("b", "Billing")]); // start at position 2 (both applied)
    replayToPosition(g, entries, 2, 0);
    expect(g.nodes).toHaveLength(0);

    replayToPosition(g, entries, 0, 2);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);

    replayToPosition(g, entries, 2, 1);
    expect(g.nodes.map((n) => n.id)).toEqual(["a"]);
  });

  it("is a no-op when fromPos equals toPos", () => {
    const g = graphOf([node("a", "Auth")]);
    replayToPosition(g, [], 0, 0);
    expect(g.nodes).toHaveLength(1);
  });
});

describe("filterHistory", () => {
  const entries: HistoryEntry[] = [
    { id: "e1", timestamp: "2024-01-01T00:00:00.000Z", operation: "createNode", source: "system", nodesDiff: [], edgesDiff: [] },
    { id: "e2", timestamp: "2024-01-02T00:00:00.000Z", operation: "createNode", source: "system", nodesDiff: [], edgesDiff: [] },
    { id: "e3", timestamp: "2024-01-03T00:00:00.000Z", operation: "createNode", source: "system", nodesDiff: [], edgesDiff: [] },
  ];

  it("limits to the most recent N entries", () => {
    expect(filterHistory(entries, { limit: 2 }).map((e) => e.id)).toEqual(["e2", "e3"]);
  });

  it("filters to entries strictly before a timestamp", () => {
    expect(filterHistory(entries, { before: "2024-01-03T00:00:00.000Z" }).map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("returns everything when no options are given", () => {
    expect(filterHistory(entries)).toHaveLength(3);
  });
});
