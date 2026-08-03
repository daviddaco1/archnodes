import { describe, expect, it } from "vitest";
import {
  canConnect,
  validateRequiredFields,
  validateHierarchy,
  validateRefs,
  validateProjectGraph,
} from "./rules.js";
import type { AnyGraphNode, GraphEdge, ProjectGraph } from "../types/graph.js";

function node(id: string, type: AnyGraphNode["type"], props: Record<string, unknown> = {}): AnyGraphNode {
  return {
    id,
    type,
    label: id,
    position: { x: 0, y: 0 },
    props,
    createdAt: "now",
    updatedAt: "now",
  } as AnyGraphNode;
}

describe("canConnect", () => {
  it("allows domain -> route", () => {
    expect(canConnect("domain", "route")).toBe(true);
  });
  it("rejects domain -> service", () => {
    expect(canConnect("domain", "service")).toBe(false);
  });
});

describe("validateRequiredFields", () => {
  it("flags a missing required field", () => {
    const issues = validateRequiredFields(node("e1", "endpoint", { name: "Login" }));
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("MISSING_FIELD");
    expect(issues[0].field).toBe("method");
  });

  it("passes when all required fields are present", () => {
    const issues = validateRequiredFields(node("e1", "endpoint", { name: "Login", method: "POST" }));
    expect(issues).toHaveLength(0);
  });
});

describe("validateHierarchy", () => {
  it("flags an invalid hierarchy edge", () => {
    const nodes = [node("d1", "domain", { name: "Auth" }), node("s1", "service", { name: "AuthService" })];
    const edges: GraphEdge[] = [{ id: "e1", source: "d1", target: "s1", edgeType: "hierarchy" }];
    const issues = validateHierarchy(nodes, edges);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("INVALID_HIERARCHY");
  });

  it("passes a valid hierarchy edge", () => {
    const nodes = [node("d1", "domain", { name: "Auth" }), node("r1", "route", { path: "/login" })];
    const edges: GraphEdge[] = [{ id: "e1", source: "d1", target: "r1", edgeType: "hierarchy" }];
    expect(validateHierarchy(nodes, edges)).toHaveLength(0);
  });
});

describe("validateRefs", () => {
  it("flags a broken ref", () => {
    const nodes = [node("a1", "apiCall", { name: "getUser", endpointRef: "missing-id" })];
    const issues = validateRefs(nodes);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("BROKEN_REF");
  });

  it("flags a ref pointing to the wrong node type", () => {
    const nodes = [
      node("c1", "component", { name: "Button" }),
      node("a1", "apiCall", { name: "getUser", endpointRef: "c1" }),
    ];
    const issues = validateRefs(nodes);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("INVALID_REF_TYPE");
  });

  it("passes a valid ref", () => {
    const nodes = [
      node("e1", "endpoint", { name: "getUser", method: "GET" }),
      node("a1", "apiCall", { name: "getUser", endpointRef: "e1" }),
    ];
    expect(validateRefs(nodes)).toHaveLength(0);
  });
});

describe("validateProjectGraph", () => {
  it("returns valid:true for a clean graph", () => {
    const graph: ProjectGraph = {
      manifest: { projectName: "p", createdAt: "now", updatedAt: "now" },
      nodes: [
        node("d1", "domain", { name: "Auth" }),
        node("r1", "route", { path: "/login" }),
      ],
      edges: [{ id: "e1", source: "d1", target: "r1", edgeType: "hierarchy" }],
    };
    const result = validateProjectGraph(graph);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});
