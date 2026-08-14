import { describe, expect, it } from "vitest";
import { getDescendantIds } from "./hierarchy";
import type { GraphEdge } from "@project-visualizer/shared/graph.js";

function h(source: string, target: string): GraphEdge {
  return { id: `${source}-${target}`, source, target, edgeType: "hierarchy" };
}

describe("getDescendantIds", () => {
  it("returns all nested hierarchy descendants, not just direct children", () => {
    const edges = [h("d1", "r1"), h("r1", "e1"), h("e1", "s1")];
    expect(getDescendantIds("d1", edges)).toEqual(new Set(["r1", "e1", "s1"]));
  });

  it("returns an empty set for a leaf node", () => {
    const edges = [h("d1", "r1")];
    expect(getDescendantIds("r1", edges)).toEqual(new Set());
  });

  it("ignores non-hierarchy edges", () => {
    const edges: GraphEdge[] = [h("d1", "r1"), { id: "inv", source: "d1", target: "rk1", edgeType: "invalidates" }];
    expect(getDescendantIds("d1", edges)).toEqual(new Set(["r1"]));
  });

  it("survives a cycle in the data without hanging", () => {
    const edges = [h("a", "b"), h("b", "a")];
    expect(getDescendantIds("a", edges)).toEqual(new Set(["b", "a"]));
  });
});
