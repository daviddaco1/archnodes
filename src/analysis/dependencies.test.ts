import { describe, expect, it } from "vitest";
import { buildDependentsIndex, getAffectedNodes, getDependencies, getDependents, getTransitiveDependencies } from "./dependencies.js";
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

describe("buildDependentsIndex", () => {
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

  it("passing a precomputed index gives the exact same result as no index", () => {
    const index = buildDependentsIndex(graph);
    for (const node of graph.nodes) {
      expect(getDependents(node.id, graph, index)).toEqual(getDependents(node.id, graph));
    }
  });

  it("excludes a node from its own dependents when a ref field points at itself", () => {
    const selfRef = mkNode("s1", "middleware", { name: "loop", returns: [{ status: 200, chainToId: "s1" }] });
    const index = buildDependentsIndex(mkGraph([selfRef], []));
    expect(index.byTarget.get("s1")).toBeUndefined();
  });

  it("getAffectedNodes with a shared index matches the non-indexed result", () => {
    const index = buildDependentsIndex(graph);
    expect(getAffectedNodes("rk1", graph, { index })).toEqual(getAffectedNodes("rk1", graph));
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

describe("getAffectedNodes maxDepth", () => {
  // d1 -> d2 -> d3 -> d4 (hierarchy chain, each the previous one's parent)
  const d1 = mkNode("d1", "domain", { name: "d1" });
  const d2 = mkNode("d2", "route", { path: "/2" }, "d1");
  const d3 = mkNode("d3", "route", { path: "/3" }, "d2");
  const d4 = mkNode("d4", "endpoint", { name: "e", methods: ["GET"] }, "d3");
  const edges: GraphEdge[] = [
    { id: "h1", source: "d1", target: "d2", edgeType: "hierarchy" },
    { id: "h2", source: "d2", target: "d3", edgeType: "hierarchy" },
    { id: "h3", source: "d3", target: "d4", edgeType: "hierarchy" },
  ];
  const graph = mkGraph([d1, d2, d3, d4], edges);

  it("stops the BFS at maxDepth instead of walking the whole graph", () => {
    const affected = getAffectedNodes("d1", graph, { maxDepth: 2 });
    expect(affected.map((a) => a.nodeId)).toEqual(["d2", "d3"]);
  });

  it("returns everything when maxDepth is omitted", () => {
    const affected = getAffectedNodes("d1", graph);
    expect(affected.map((a) => a.nodeId)).toEqual(["d2", "d3", "d4"]);
  });
});

describe("getTransitiveDependencies", () => {
  it("walks the opposite direction of getAffectedNodes (what a node needs, not what needs it)", () => {
    const domain = mkNode("d1", "domain", { name: "Auth" });
    const route = mkNode("r1", "route", { path: "/x" }, "d1");
    const endpoint = mkNode("e1", "endpoint", { name: "e", methods: ["GET"] }, "r1");
    const edges: GraphEdge[] = [
      { id: "h1", source: "d1", target: "r1", edgeType: "hierarchy" },
      { id: "h2", source: "r1", target: "e1", edgeType: "hierarchy" },
    ];
    const graph = mkGraph([domain, route, endpoint], edges);

    const deps = getTransitiveDependencies("e1", graph);
    expect(deps.map((d) => d.nodeId)).toEqual(["r1", "d1"]);
  });

  it("survives a ref-field cycle without hanging, same as getAffectedNodes", () => {
    const middlewareA = mkNode("mA", "middleware", { name: "A", returns: [{ status: 200, chainToId: "mB" }] });
    const middlewareB = mkNode("mB", "middleware", { name: "B", returns: [{ status: 200, chainToId: "mA" }] });
    const graph = mkGraph([middlewareA, middlewareB], []);
    const deps = getTransitiveDependencies("mA", graph);
    expect(deps.map((d) => d.nodeId)).toEqual(["mB"]);
  });
});
