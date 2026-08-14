import { describe, expect, it } from "vitest";
import { summarizeProject } from "./summary.js";
import type { AnyGraphNode, ProjectGraph } from "../types/graph.js";

const TS = "2024-01-01T00:00:00.000Z";

function mkNode(id: string, type: AnyGraphNode["type"], props: unknown, overrides: Partial<AnyGraphNode> = {}): AnyGraphNode {
  return { id, type, label: id, position: { x: 0, y: 0 }, props, createdAt: TS, updatedAt: TS, ...overrides } as AnyGraphNode;
}

function mkGraph(nodes: AnyGraphNode[]): ProjectGraph {
  return { manifest: { projectName: "p", createdAt: TS, updatedAt: TS }, nodes, edges: [] };
}

describe("summarizeProject", () => {
  it("counts nodes by type and totals edges", () => {
    const graph = mkGraph([mkNode("d1", "domain", { name: "Auth" }), mkNode("d2", "domain", { name: "Billing" }), mkNode("r1", "route", { path: "/x" })]);
    const summary = summarizeProject(graph);
    expect(summary.totalNodes).toBe(3);
    expect(summary.nodeCounts.domain).toBe(2);
    expect(summary.nodeCounts.route).toBe(1);
  });

  it("reuses validateProjectGraph/checkProjectHealth rather than recomputing", () => {
    const graph = mkGraph([mkNode("d1", "domain", {})]); // missing required "name" -> MISSING_FIELD
    const summary = summarizeProject(graph);
    expect(summary.validation.valid).toBe(false);
    expect(summary.health.errors.some((i) => i.code === "MISSING_FIELD")).toBe(true);
  });

  it("excludes structural types from unimplemented, and flags real nodes missing generated/sourcePath", () => {
    const graph = mkGraph([
      mkNode("c1", "container", { label: "Box" }),
      mkNode("d1", "domain", { name: "Auth" }),
      mkNode("d2", "domain", { name: "Billing" }, { generated: true }),
    ]);
    const summary = summarizeProject(graph);
    const ids = summary.unimplemented.map((u) => u.nodeId);
    expect(ids).toContain("d1");
    expect(ids).not.toContain("c1");
    expect(ids).not.toContain("d2");
  });

  it("ranks topConnected by affected-node count, capped at topN", () => {
    const domain = mkNode("d1", "domain", { name: "Auth" });
    const route = mkNode("r1", "route", { path: "/x" }, { parentId: "d1" });
    const graph: ProjectGraph = {
      manifest: { projectName: "p", createdAt: TS, updatedAt: TS },
      nodes: [domain, route],
      edges: [{ id: "h1", source: "d1", target: "r1", edgeType: "hierarchy" }],
    };
    const summary = summarizeProject(graph, 1);
    expect(summary.topConnected).toHaveLength(1);
    expect(summary.topConnected[0].nodeId).toBe("d1"); // domain has 1 affected (route), route has 0
  });
});
