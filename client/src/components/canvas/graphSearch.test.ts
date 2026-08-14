import { describe, expect, it } from "vitest";
import { matchesQuery, filterByTypes } from "./graphSearch";
import type { AnyGraphNode } from "@project-visualizer/shared/graph.js";

const TS = "2024-01-01T00:00:00.000Z";

function mkNode(id: string, type: AnyGraphNode["type"], props: unknown): AnyGraphNode {
  return { id, type, label: id, position: { x: 0, y: 0 }, props, createdAt: TS, updatedAt: TS } as AnyGraphNode;
}

describe("matchesQuery", () => {
  const domain = mkNode("d1", "domain", { name: "Auth" });

  it("matches everything for an empty/blank query", () => {
    expect(matchesQuery(domain, "")).toBe(true);
    expect(matchesQuery(domain, "   ")).toBe(true);
  });

  it("matches the resolved title case-insensitively", () => {
    expect(matchesQuery(domain, "auth")).toBe(true);
    expect(matchesQuery(domain, "AUTH")).toBe(true);
  });

  it("matches the node id", () => {
    expect(matchesQuery(domain, "d1")).toBe(true);
  });

  it("does not match unrelated text", () => {
    expect(matchesQuery(domain, "billing")).toBe(false);
  });

  it("falls back to summary fields when the title doesn't match", () => {
    const endpoint = mkNode("e1", "endpoint", { name: "x", methods: ["POST"] });
    expect(matchesQuery(endpoint, "post")).toBe(true);
  });
});

describe("filterByTypes", () => {
  const nodes = [mkNode("d1", "domain", {}), mkNode("r1", "route", {})];

  it("returns everything when allowed is null (no filter)", () => {
    expect(filterByTypes(nodes, null)).toEqual(nodes);
  });

  it("filters to only the allowed types", () => {
    expect(filterByTypes(nodes, new Set(["route"]))).toEqual([nodes[1]]);
  });
});
