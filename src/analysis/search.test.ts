import { describe, expect, it } from "vitest";
import { searchGraph } from "./search.js";
import type { AnyGraphNode, ProjectGraph } from "../types/graph.js";

const TS = "2024-01-01T00:00:00.000Z";

function mkNode(id: string, type: AnyGraphNode["type"], label: string, props: unknown): AnyGraphNode {
  return { id, type, label, position: { x: 0, y: 0 }, props, createdAt: TS, updatedAt: TS } as AnyGraphNode;
}

function mkGraph(nodes: AnyGraphNode[]): ProjectGraph {
  return { manifest: { projectName: "p", createdAt: TS, updatedAt: TS }, nodes, edges: [] };
}

describe("searchGraph", () => {
  const graph = mkGraph([
    mkNode("d1", "domain", "Auth", { name: "Auth", description: "handles login" }),
    mkNode("d2", "domain", "Billing", { name: "Billing" }),
    mkNode("r1", "route", "login-route", { path: "/login" }),
  ]);

  it("matches on label, case-insensitive", () => {
    const results = searchGraph(graph, "auth");
    expect(results.map((r) => r.nodeId)).toEqual(["d1"]);
    expect(results[0].matchedIn).toBe("label");
  });

  it("falls back to matching inside props when the label doesn't match", () => {
    const results = searchGraph(graph, "login");
    expect(results.map((r) => r.nodeId).sort()).toEqual(["d1", "r1"]); // d1 via props.description, r1 via label
  });

  it("returns nothing for an unmatched query", () => {
    expect(searchGraph(graph, "does-not-exist-anywhere")).toEqual([]);
  });

  it("respects a type filter", () => {
    const results = searchGraph(graph, "", { types: ["route"] });
    expect(results.every((r) => r.type === "route")).toBe(true);
  });

  it("respects limit", () => {
    const results = searchGraph(graph, "", { limit: 1 });
    expect(results).toHaveLength(1);
  });
});
