import { describe, expect, it } from "vitest";
import {
  canConnect,
  validateRequiredFields,
  validateHierarchy,
  validateRefs,
  validateOperationMethods,
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
  it("allows websocket -> websocketEvent -> websocketEmit", () => {
    expect(canConnect("websocket", "websocketEvent")).toBe(true);
    expect(canConnect("websocketEvent", "websocketEmit")).toBe(true);
    expect(canConnect("websocketEvent", "service")).toBe(true);
  });
  it("allows endpoint -> operation -> middleware/service", () => {
    expect(canConnect("endpoint", "operation")).toBe(true);
    expect(canConnect("operation", "middleware")).toBe(true);
    expect(canConnect("operation", "service")).toBe(true);
  });
});

describe("validateOperationMethods", () => {
  function operation(id: string, parentId: string, method: string): AnyGraphNode {
    const n = node(id, "operation", { method });
    n.parentId = parentId;
    return n;
  }

  it("flags a method not declared on the parent endpoint", () => {
    const endpoint = node("e1", "endpoint", { name: "users", methods: ["GET", "POST"] });
    const op = operation("op1", "e1", "DELETE");
    const issues = validateOperationMethods([endpoint, op]);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("INVALID_OPERATION_METHOD");
  });

  it("flags two sibling operations sharing the same method", () => {
    const endpoint = node("e1", "endpoint", { name: "users", methods: ["GET", "POST"] });
    const op1 = operation("op1", "e1", "GET");
    const op2 = operation("op2", "e1", "GET");
    const issues = validateOperationMethods([endpoint, op1, op2]);
    expect(issues.some((i) => i.code === "DUPLICATE_OPERATION_METHOD")).toBe(true);
  });

  it("passes distinct declared methods", () => {
    const endpoint = node("e1", "endpoint", { name: "users", methods: ["GET", "POST"] });
    const op1 = operation("op1", "e1", "GET");
    const op2 = operation("op2", "e1", "POST");
    expect(validateOperationMethods([endpoint, op1, op2])).toHaveLength(0);
  });
});

describe("validateRequiredFields", () => {
  it("flags a missing required field", () => {
    const issues = validateRequiredFields(node("e1", "endpoint", { name: "Login" }));
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("MISSING_FIELD");
    expect(issues[0].field).toBe("methods");
  });

  it("passes when all required fields are present", () => {
    const issues = validateRequiredFields(node("e1", "endpoint", { name: "Login", methods: ["POST"] }));
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
      node("e1", "endpoint", { name: "getUser", methods: ["GET"] }),
      node("a1", "apiCall", { name: "getUser", endpointRef: "e1" }),
    ];
    expect(validateRefs(nodes)).toHaveLength(0);
  });

  it("validates table.dbId", () => {
    const badNodes = [node("t1", "table", { name: "users", columns: [], dbId: "missing" })];
    expect(validateRefs(badNodes)[0].code).toBe("BROKEN_REF");

    const goodNodes = [
      node("d1", "db", { engine: "PostgreSQL", connectionType: "native" }),
      node("t1", "table", { name: "users", columns: [], dbId: "d1" }),
    ];
    expect(validateRefs(goodNodes)).toHaveLength(0);
  });

  it("validates model.tableId, and lets several models point at the same table", () => {
    const badNodes = [node("m1", "model", { name: "UserSummary", schema: [], tableId: "missing" })];
    expect(validateRefs(badNodes)[0].code).toBe("BROKEN_REF");

    const goodNodes = [
      node("t1", "table", { name: "users", columns: [] }),
      node("m1", "model", { name: "UserSummary", schema: [], tableId: "t1" }),
      node("m2", "model", { name: "UserDetail", schema: [], tableId: "t1" }),
    ];
    expect(validateRefs(goodNodes)).toHaveLength(0);
  });

  it("validates chainToId inside middleware.returns[]", () => {
    const badNodes = [node("m1", "middleware", { name: "auth", returns: [{ status: 401, chainToId: "missing" }] })];
    expect(validateRefs(badNodes)[0].code).toBe("BROKEN_REF");

    const goodNodes = [
      node("eh1", "errorHandler", { name: "GlobalHandler", scope: "global" }),
      node("m1", "middleware", { name: "auth", returns: [{ status: 401, chainToId: "eh1" }] }),
    ];
    expect(validateRefs(goodNodes)).toHaveLength(0);
  });

  it("validates repository.entityRef", () => {
    const badNodes = [node("rp1", "repository", { name: "UserRepo", entityRef: "missing", ormId: "o1" })];
    expect(validateRefs(badNodes).some((i) => i.code === "BROKEN_REF" && i.field === "entityRef")).toBe(true);

    const goodNodes = [
      node("o1", "orm", { name: "prisma" }),
      node("t1", "table", { name: "users", columns: [] }),
      node("rp1", "repository", { name: "UserRepo", entityRef: "t1", ormId: "o1" }),
    ];
    expect(validateRefs(goodNodes)).toHaveLength(0);
  });

  it("validates layout.slots[].componentId", () => {
    const badNodes = [
      node("l1", "layout", { name: "MainLayout", slots: [{ name: "header", componentId: "missing" }] }),
    ];
    expect(validateRefs(badNodes)[0].code).toBe("BROKEN_REF");

    const goodNodes = [
      node("c1", "component", { name: "Header", kind: "presentational" }),
      node("l1", "layout", { name: "MainLayout", slots: [{ name: "header", componentId: "c1" }] }),
    ];
    expect(validateRefs(goodNodes)).toHaveLength(0);
  });

  it("validates chainToId inside service.errors[] and email.errors[]", () => {
    const badService = [node("s1", "service", { name: "Billing", errors: [{ status: "fail", chainToId: "missing" }] })];
    expect(validateRefs(badService)[0].code).toBe("BROKEN_REF");

    const goodService = [
      node("eh1", "errorHandler", { name: "GlobalHandler", scope: "global" }),
      node("s1", "service", { name: "Billing", errors: [{ status: "fail", chainToId: "eh1" }] }),
    ];
    expect(validateRefs(goodService)).toHaveLength(0);

    const badEmail = [node("em1", "email", { trigger: "signup", errors: [{ status: "fail", chainToId: "missing" }] })];
    expect(validateRefs(badEmail)[0].code).toBe("BROKEN_REF");
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
