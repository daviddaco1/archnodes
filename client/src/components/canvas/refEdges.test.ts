import { describe, expect, it } from "vitest";
import {
  buildArrayRefPorts,
  buildChainTargetTypes,
  buildRefPortRules,
  chainPortHandle,
  clearChainEdgeItem,
  parseRefEdgeId,
  refEdgeId,
  synthesizeChainEdges,
  synthesizeRefEdges,
} from "./refEdges";
import type { RefFieldSpec, SchemaResponse } from "../../api/client";
import type { AnyGraphNode } from "@project-visualizer/shared/graph.js";

const TS = "2024-01-01T00:00:00.000Z";

function mkNode(id: string, type: AnyGraphNode["type"], props: unknown): AnyGraphNode {
  return { id, type, label: id, position: { x: 0, y: 0 }, props, createdAt: TS, updatedAt: TS } as AnyGraphNode;
}

const refFields: SchemaResponse["refFields"] = {
  table: [{ field: "dbId", targetType: "db" } as RefFieldSpec],
  operation: [{ field: "returns[].chainToId", targetType: ["middleware", "service"], array: true } as RefFieldSpec],
  navigationRouter: [{ field: "routes[].pageId", targetType: "page", array: true } as RefFieldSpec], // not a chainToId — no ports
};

describe("buildRefPortRules", () => {
  it("gives the holder type an input port and the target type an output option", () => {
    const rules = buildRefPortRules(refFields);
    expect(rules.inputs.get("table")).toEqual([{ field: "dbId", targetTypes: ["db"] }]);
    expect(rules.outputs.get("db")).toEqual([{ holderType: "table", field: "dbId" }]);
  });

  it("skips array-shaped specs entirely (not a plain input/output port)", () => {
    const rules = buildRefPortRules(refFields);
    expect(rules.inputs.get("operation")).toBeUndefined();
  });

  it("returns empty maps when refFields is undefined", () => {
    const rules = buildRefPortRules(undefined);
    expect(rules.inputs.size).toBe(0);
    expect(rules.outputs.size).toBe(0);
  });
});

describe("buildArrayRefPorts / buildChainTargetTypes", () => {
  it("only creates array ports for chainToId item fields, not other array refs", () => {
    const ports = buildArrayRefPorts(refFields);
    expect(ports.get("operation")).toEqual([{ arrayField: "returns", itemField: "chainToId", targetTypes: ["middleware", "service"] }]);
    expect(ports.get("navigationRouter")).toBeUndefined();
  });

  it("collects every type any chain port can target", () => {
    expect(buildChainTargetTypes(refFields)).toEqual(new Set(["middleware", "service"]));
  });
});

describe("synthesizeRefEdges", () => {
  it("creates one synthetic edge per single-value ref field pointing at an existing node", () => {
    const db = mkNode("db1", "db", { engine: "postgres", connectionType: "native" });
    const table = mkNode("t1", "table", { name: "users", columns: [], dbId: "db1" });
    const edges = synthesizeRefEdges([db, table], refFields);
    expect(edges).toEqual([{ id: refEdgeId("t1", "dbId"), source: "db1", target: "t1", field: "dbId" }]);
  });

  it("does not synthesize an edge when the referenced id doesn't exist in this node set", () => {
    const table = mkNode("t1", "table", { name: "users", columns: [], dbId: "missing" });
    expect(synthesizeRefEdges([table], refFields)).toEqual([]);
  });
});

describe("synthesizeChainEdges", () => {
  it("creates one edge per array item with a resolved chainToId", () => {
    const middleware = mkNode("m1", "middleware", { name: "auth" });
    const operation = mkNode("o1", "operation", { method: "GET", returns: [{ status: 200, chainToId: "m1" }] });
    const edges = synthesizeChainEdges([middleware, operation], refFields);
    expect(edges).toEqual([{ id: `${refEdgeId("o1", "returns")}__0`, source: "o1", target: "m1", sourceHandle: chainPortHandle("returns", 0) }]);
  });
});

describe("parseRefEdgeId", () => {
  it("parses a simple ref edge id (2 segments)", () => {
    expect(parseRefEdgeId(refEdgeId("n1", "dbId"))).toEqual({ kind: "simple", nodeId: "n1", field: "dbId" });
  });

  it("parses a chain edge id (3 segments) with the index intact", () => {
    expect(parseRefEdgeId(`${refEdgeId("n1", "returns")}__2`)).toEqual({ kind: "chain", nodeId: "n1", arrayField: "returns", index: 2 });
  });

  it("returns undefined for a malformed or unrelated id", () => {
    expect(parseRefEdgeId("not-a-ref-edge")).toBeUndefined();
    expect(parseRefEdgeId("ref__onlyonepart")).toBeUndefined();
  });
});

describe("clearChainEdgeItem", () => {
  it("clears only the targeted item's chainToId, leaving siblings intact", () => {
    const node = mkNode("o1", "operation", { method: "GET", returns: [{ status: 200, chainToId: "m1" }, { status: 404, chainToId: "m2" }] });
    const patch = clearChainEdgeItem(node, "returns", 0);
    expect(patch).toEqual({ returns: [{ status: 200, chainToId: undefined }, { status: 404, chainToId: "m2" }] });
  });

  it("returns undefined if the array/index no longer matches (item removed since render)", () => {
    const node = mkNode("o1", "operation", { method: "GET", returns: [] });
    expect(clearChainEdgeItem(node, "returns", 0)).toBeUndefined();
  });
});
