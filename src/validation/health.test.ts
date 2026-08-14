import { describe, expect, it } from "vitest";
import { checkProjectHealth, findOrphanNodes, findRefCycles, findUnusedNodes } from "./health.js";
import type { AnyGraphNode, GraphEdge, ProjectGraph } from "../types/graph.js";

const TS = "2024-01-01T00:00:00.000Z";

function mkNode(id: string, type: AnyGraphNode["type"], props: unknown, parentId?: string): AnyGraphNode {
  return { id, type, label: id, position: { x: 0, y: 0 }, parentId, props, createdAt: TS, updatedAt: TS } as AnyGraphNode;
}

function mkGraph(nodes: AnyGraphNode[], edges: GraphEdge[] = []): ProjectGraph {
  return { manifest: { projectName: "p", createdAt: TS, updatedAt: TS }, nodes, edges };
}

describe("findOrphanNodes", () => {
  // `container` never appears as a HIERARCHY_RULES child nor a REF_FIELDS targetType — the
  // algorithm treats it (and domain/page/etc. would-be-root types that genuinely aren't targeted
  // anywhere) as legitimately root. Note "domain" itself IS a REF_FIELDS target (subdomain.domainId,
  // envConfig.domainId, errorHandler.domainId) so it does NOT qualify as root-eligible here.
  it("does not flag a root-eligible type (container) that has no parent", () => {
    const container = mkNode("c1", "container", { label: "Box" });
    const issues = findOrphanNodes(mkGraph([container]));
    expect(issues).toEqual([]);
  });

  it("flags a non-root type with no parent and nothing referencing it", () => {
    const endpoint = mkNode("e1", "endpoint", { name: "x", methods: ["GET"] }); // no parentId
    const issues = findOrphanNodes(mkGraph([endpoint]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ level: "warning", code: "ORPHAN_NODE", nodeId: "e1" });
  });

  it("does not flag a non-root type that has a parent", () => {
    const domain = mkNode("d1", "domain", { name: "Auth" });
    const route = mkNode("r1", "route", { path: "/x" }, "d1");
    const edges: GraphEdge[] = [{ id: "h1", source: "d1", target: "r1", edgeType: "hierarchy" }];
    const issues = findOrphanNodes(mkGraph([domain, route], edges));
    expect(issues.some((i) => i.nodeId === "r1")).toBe(false);
  });
});

describe("findUnusedNodes", () => {
  it("flags a service with no dependents", () => {
    const service = mkNode("s1", "service", { name: "AuthService" });
    const issues = findUnusedNodes(mkGraph([service]));
    expect(issues).toEqual([{ level: "warning", code: "UNUSED_NODE", nodeId: "s1", message: expect.any(String) }]);
  });

  it("does not flag a service a scheduler triggers", () => {
    const service = mkNode("s1", "service", { name: "AuthService" });
    const scheduler = mkNode("sc1", "scheduler", { name: "nightly", cronExpression: "0 0 * * *", triggersServiceId: "s1" });
    expect(findUnusedNodes(mkGraph([service, scheduler]))).toEqual([]);
  });
});

describe("findRefCycles", () => {
  it("detects a cycle between two middlewares chaining to each other, without hanging", () => {
    const a = mkNode("mA", "middleware", { name: "A", returns: [{ status: 200, chainToId: "mB" }] });
    const b = mkNode("mB", "middleware", { name: "B", returns: [{ status: 200, chainToId: "mA" }] });
    const issues = findRefCycles(mkGraph([a, b]));
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("REF_CYCLE");
  });

  it("reports nothing for an acyclic ref chain", () => {
    const a = mkNode("mA", "middleware", { name: "A", returns: [{ status: 200, chainToId: "s1" }] });
    const s = mkNode("s1", "service", { name: "S" });
    expect(findRefCycles(mkGraph([a, s]))).toEqual([]);
  });
});

describe("checkProjectHealth", () => {
  it("buckets issues by level and includes both hard validation and soft diagnostics", () => {
    const domainMissingName = mkNode("d1", "domain", {}); // MISSING_FIELD (error)
    const orphanEndpoint = mkNode("e1", "endpoint", { name: "x", methods: ["GET"] }); // ORPHAN_NODE (warning)
    const health = checkProjectHealth(mkGraph([domainMissingName, orphanEndpoint]));

    expect(health.errors.some((i) => i.code === "MISSING_FIELD")).toBe(true);
    expect(health.warnings.some((i) => i.code === "ORPHAN_NODE")).toBe(true);
    expect(health.issues.length).toBe(health.errors.length + health.warnings.length + health.info.length);
  });
});
