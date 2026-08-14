import { describe, expect, it } from "vitest";
import { getAffectedNodes, getDependencies, getDependents } from "./dependencies.js";
import type { AnyGraphNode, GraphEdge, ProjectGraph } from "../types/graph.js";

const TS = "2024-01-01T00:00:00.000Z";

function mkNode<T extends AnyGraphNode["type"]>(id: string, type: T, props: unknown, parentId?: string): AnyGraphNode {
  return {
    id,
    type,
    label: id,
    position: { x: 0, y: 0 },
    parentId,
    props,
    createdAt: TS,
    updatedAt: TS,
  } as AnyGraphNode;
}

function mkGraph(nodes: AnyGraphNode[], edges: GraphEdge[]): ProjectGraph {
  return { manifest: { projectName: "p", createdAt: TS, updatedAt: TS }, nodes, edges };
}

describe("getDependencies / getDependents", () => {
  const domain = mkNode("d1", "domain", { name: "Auth" });
  const route = mkNode("r1", "route", { path: "/login" }, "d1");
  const endpoint = mkNode("e1", "endpoint", {
    name: "login",
    methods: ["POST"],
    cacheable: { enabled: true, invalidatedBy: ["rk1"] },
  }, "r1");
  const redisKey = mkNode("rk1", "redisKey", { keyPattern: "session:*", operation: "SET", toolId: "t1" });

  const edges: GraphEdge[] = [
    { id: "h1", source: "d1", target: "r1", edgeType: "hierarchy" },
    { id: "h2", source: "r1", target: "e1", edgeType: "hierarchy" },
    { id: "inv1", source: "e1", target: "rk1", edgeType: "invalidates" },
  ];
  const graph = mkGraph([domain, route, endpoint, redisKey], edges);

  it("getDependencies covers hierarchy parent, ref fields, and invalidates-out on the same node", () => {
    const deps = getDependencies("e1", graph);
    expect(deps).toContainEqual({ nodeId: "r1", kind: "hierarchy-parent" });
    expect(deps).toContainEqual({ nodeId: "rk1", kind: "ref", field: "cacheable.invalidatedBy[]" });
    expect(deps).toContainEqual({ nodeId: "rk1", kind: "invalidates-out" });
  });

  it("getDependents finds hierarchy children, invalidates-in, and reverse ref-field scans", () => {
    expect(getDependents("r1", graph)).toContainEqual({ nodeId: "e1", kind: "hierarchy-child" });

    const rkDependents = getDependents("rk1", graph);
    expect(rkDependents).toContainEqual({ nodeId: "e1", kind: "invalidates-in" });
    expect(rkDependents).toContainEqual({ nodeId: "e1", kind: "ref", field: "cacheable.invalidatedBy[]" });
  });

  it("getDependencies/getDependents return [] for an unknown node", () => {
    expect(getDependencies("does-not-exist", graph)).toEqual([]);
    expect(getDependents("does-not-exist", graph)).toEqual([]);
  });

  it("getAffectedNodes is the transitive closure of getDependents", () => {
    const affected = getAffectedNodes("rk1", graph);
    expect(affected.map((a) => a.nodeId)).toEqual(["e1"]);
    expect(affected[0].depth).toBe(1);
  });
});

describe("getAffectedNodes with a ref-field cycle", () => {
  // middleware.returns[].chainToId is a REF_FIELDS array spec — nothing in validation/rules.ts
  // stops two middlewares from chaining to each other, so getAffectedNodes must survive that.
  const middlewareA = mkNode("mA", "middleware", { name: "A", returns: [{ status: 200, chainToId: "mB" }] });
  const middlewareB = mkNode("mB", "middleware", { name: "B", returns: [{ status: 200, chainToId: "mA" }] });
  const graph = mkGraph([middlewareA, middlewareB], []);

  it("does not hang, and reports the one real neighbor exactly once", () => {
    const affected = getAffectedNodes("mA", graph);
    expect(affected.map((a) => a.nodeId)).toEqual(["mB"]);
  });
});
