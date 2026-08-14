import { describe, expect, it } from "vitest";
import { computeAutoLayout } from "./layout";
import type { AnyGraphNode, GraphEdge } from "@project-visualizer/shared/graph.js";

const TS = "2024-01-01T00:00:00.000Z";

function mkNode(id: string): AnyGraphNode {
  return { id, type: "domain", label: id, position: { x: 0, y: 0 }, props: {}, createdAt: TS, updatedAt: TS } as AnyGraphNode;
}

function h(source: string, target: string): GraphEdge {
  return { id: `${source}-${target}`, source, target, edgeType: "hierarchy" };
}

describe("computeAutoLayout", () => {
  it("never produces NaN positions", () => {
    const nodes = [mkNode("a"), mkNode("b"), mkNode("c")];
    const edges = [h("a", "b"), h("a", "c")];
    const positions = computeAutoLayout(nodes, edges);
    for (const pos of positions.values()) {
      expect(Number.isNaN(pos.x)).toBe(false);
      expect(Number.isNaN(pos.y)).toBe(false);
    }
  });

  it("places nodes at the same hierarchy depth on the same row (same y)", () => {
    const nodes = [mkNode("root"), mkNode("a"), mkNode("b")];
    const edges = [h("root", "a"), h("root", "b")];
    const positions = computeAutoLayout(nodes, edges);
    expect(positions.get("a")!.y).toBe(positions.get("b")!.y);
    expect(positions.get("root")!.y).not.toBe(positions.get("a")!.y);
  });

  it("gives every node a distinct position within the same row", () => {
    const nodes = [mkNode("root"), mkNode("a"), mkNode("b")];
    const edges = [h("root", "a"), h("root", "b")];
    const positions = computeAutoLayout(nodes, edges);
    expect(positions.get("a")!.x).not.toBe(positions.get("b")!.x);
  });

  it("assigns every node a position even without any hierarchy edges", () => {
    const nodes = [mkNode("a"), mkNode("b")];
    const positions = computeAutoLayout(nodes, []);
    expect(positions.size).toBe(2);
  });
});
