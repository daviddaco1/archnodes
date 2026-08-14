import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProjectStore, type ProjectStore } from "../store/project-store.js";
import { exportMarkdown } from "./markdown.js";
import type { AnyGraphNode, GraphEdge, ProjectGraph } from "../types/graph.js";

function rawNode(id: string, type: AnyGraphNode["type"], props: Record<string, unknown>, parentId?: string): AnyGraphNode {
  return { id, type, label: id, position: { x: 0, y: 0 }, props, parentId, createdAt: "now", updatedAt: "now" } as AnyGraphNode;
}

let baseDir: string;
let store: ProjectStore;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "pv-md-test-"));
  store = createProjectStore(`test-${randomUUID()}`, { baseDir });
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

function buildLoginFixture() {
  const domain = store.createNode("domain", { name: "Auth", domain: "andresodev.com" });
  const subdomain = store.createNode("subdomain", { name: "API", subdomain: "api", domainId: domain.id }, domain.id);
  const route = store.createNode("route", { path: "/login" }, subdomain.id);
  const endpoint = store.createNode(
    "endpoint",
    {
      name: "login",
      methods: ["POST"],
      headers: [{ name: "Authorization", type: "string" }],
      cacheable: { enabled: true, keyPattern: "session:*", ttl: 3600, invalidation: "manual" },
    },
    route.id,
  );
  const operation = store.createNode(
    "operation",
    {
      method: "POST",
      body: [{ name: "email", type: "string", required: true }],
      returns: [{ status: 200, description: "OK" }],
    },
    endpoint.id,
  );
  const middleware = store.createNode(
    "middleware",
    { name: "validateBody", returns: [{ status: 400, description: "Invalid body" }] },
    operation.id,
  );
  const service = store.createNode(
    "service",
    { name: "AuthService", errors: [{ status: 401, description: "Invalid credentials" }] },
    middleware.id,
  );
  const tool = store.createNode("tool", { name: "redis" });
  const redisKey = store.createNode("redisKey", { keyPattern: "session:*", operation: "SET", toolId: tool.id });
  store.connectNodes(service.id, redisKey.id, "hierarchy");

  const page = store.createNode("page", { name: "LoginPage", path: "/login" });
  const model = store.createNode("model", { name: "LoginModel", schema: [{ name: "email", type: "string" }] });
  const form = store.createNode(
    "form",
    { name: "LoginForm", fields: [{ name: "email", type: "string" }], modelRef: model.id },
    page.id,
  );
  const apiCall = store.createNode("apiCall", { name: "loginCall", endpointRef: endpoint.id }, form.id);

  return { domain, subdomain, route, endpoint, middleware, service, page, form, apiCall };
}

describe("exportMarkdown", () => {
  it("renders the full login fixture", () => {
    buildLoginFixture();
    const graph = store.getProject("all");
    const md = exportMarkdown(graph, store.validateProject());

    expect(md).toContain("# Project Context:");
    expect(md).toContain("### Domain: Auth");
    expect(md).toContain("`andresodev.com`");
    expect(md).toContain("`api.andresodev.com`");
    expect(md).toMatch(/###### Endpoint: POST \/login/);
    expect(md).toContain("**Body**");
    expect(md).toContain("| email | string | yes |");
    expect(md).toContain("**Headers**");
    expect(md).toContain("| Authorization |");
    expect(md).toContain("**Returns (aggregated)**");
    expect(md).toContain("| 401 |");
    expect(md).toContain("**Cache**");
    expect(md).toContain("session:*");
    expect(md).toMatch(/loginCall → consumes `.*`/);
    expect(md).toContain("## Validation Warnings");
    expect(md).toContain("_(none)_");
  });

  it("shows a chainToId hint in the aggregated returns table", () => {
    const domain = store.createNode("domain", { name: "Auth" });
    const route = store.createNode("route", { path: "/x" }, domain.id);
    const endpoint = store.createNode("endpoint", { name: "x", methods: ["GET"] }, route.id);
    const errorHandler = store.createNode("errorHandler", { name: "GlobalHandler", scope: "global" });
    const middleware = store.createNode(
      "middleware",
      { name: "auth", returns: [{ status: 401, description: "Unauthorized", chainToId: errorHandler.id }] },
      endpoint.id,
    );
    void middleware;
    const graph = store.getProject("all");
    const md = exportMarkdown(graph, store.validateProject());
    expect(md).toContain(`chains to \`${errorHandler.id}\``);
  });

  it("nests websocket events and emits", () => {
    const socket = store.createNode("websocket", { name: "ChatSocket", namespace: "/chat" });
    const event = store.createNode("websocketEvent", { event: "message" }, socket.id);
    store.createNode("websocketEmit", { event: "message_received", target: "room", roomParam: "roomId" }, event.id);
    const graph = store.getProject("all");
    const md = exportMarkdown(graph, store.validateProject());
    expect(md).toContain("### WebSockets");
    expect(md).toContain("ChatSocket");
    expect(md).toContain("on `message`");
    expect(md).toContain("emits `message_received` → room via `roomId`");
  });

  it("treats an endpoint as private by default and public only when explicitly marked", () => {
    const domain = store.createNode("domain", { name: "Auth" });
    const route = store.createNode("route", { path: "/unset" }, domain.id);
    const unsetEndpoint = store.createNode("endpoint", { name: "unset", methods: ["GET"] }, route.id);
    const route2 = store.createNode("route", { path: "/secure" }, domain.id);
    const secureEndpoint = store.createNode(
      "endpoint",
      { name: "secure", methods: ["GET"], isPublic: false, authMethods: ["JWT / Bearer Token", "API Key"] },
      route2.id,
    );
    const route3 = store.createNode("route", { path: "/open" }, domain.id);
    const openEndpoint = store.createNode("endpoint", { name: "open", methods: ["GET"], isPublic: true }, route3.id);

    const graph = store.getProject("all");
    const md = exportMarkdown(graph, store.validateProject());

    expect(md).toMatch(/Endpoint: GET \/unset[\s\S]*?\*\*Acceso\*\*: Privada — \(sin método de seguridad definido\)/);
    expect(md).toMatch(/Endpoint: GET \/secure[\s\S]*?\*\*Acceso\*\*: Privada — JWT \/ Bearer Token, API Key/);
    expect(md).toMatch(/Endpoint: GET \/open[\s\S]*?\*\*Acceso\*\*: Pública/);
    void unsetEndpoint;
    void secureEndpoint;
    void openEndpoint;
  });

  it("does not render the endpoint's own chain when it has operation children", () => {
    const domain = store.createNode("domain", { name: "Auth" });
    const route = store.createNode("route", { path: "/x" }, domain.id);
    const endpoint = store.createNode("endpoint", { name: "x", methods: ["GET"] }, route.id);
    store.createNode("middleware", { name: "authGuard" }, endpoint.id);
    store.createNode("operation", { method: "GET" }, endpoint.id);

    const graph = store.getProject("all");
    const md = exportMarkdown(graph, store.validateProject());
    expect(md).not.toContain("**Middleware chain**");
  });

  it("labels an operation's own returns as coming from the operation, not the endpoint", () => {
    buildLoginFixture();
    const graph = store.getProject("all");
    const md = exportMarkdown(graph, store.validateProject());
    expect(md).toContain("| 200 | operation | OK |");
    expect(md).not.toContain("| 200 | endpoint | OK |");
  });

  it("keeps a service sibling next to a middleware sibling instead of dropping it", () => {
    const domain = store.createNode("domain", { name: "Auth" });
    const route = store.createNode("route", { path: "/x" }, domain.id);
    const endpoint = store.createNode("endpoint", { name: "x", methods: ["GET"] }, route.id);
    store.createNode("middleware", { name: "authGuard" }, endpoint.id);
    store.createNode("service", { name: "XService" }, endpoint.id);

    const graph = store.getProject("all");
    const md = exportMarkdown(graph, store.validateProject());
    expect(md).toContain("**Service**");
    expect(md).toContain("- XService");
  });

  it("scopes floating infra sections to the requested domainId", () => {
    const domainA = store.createNode("domain", { name: "A" });
    const routeA = store.createNode("route", { path: "/a" }, domainA.id);
    const endpointA = store.createNode("endpoint", { name: "a", methods: ["GET"] }, routeA.id);
    const serviceA = store.createNode("service", { name: "ServiceA" }, endpointA.id);
    store.createNode("tool", { name: "ToolA" }, serviceA.id);

    const domainB = store.createNode("domain", { name: "B" });
    const routeB = store.createNode("route", { path: "/b" }, domainB.id);
    const endpointB = store.createNode("endpoint", { name: "b", methods: ["GET"] }, routeB.id);
    const serviceB = store.createNode("service", { name: "ServiceB" }, endpointB.id);
    store.createNode("tool", { name: "ToolB" }, serviceB.id);

    const graph = store.getProject("all");
    const md = exportMarkdown(graph, store.validateProject(), domainA.id);
    expect(md).toContain("ToolA");
    expect(md).not.toContain("ToolB");
  });

  it("renders each operation child with its own params and chain", () => {
    const domain = store.createNode("domain", { name: "Auth" });
    const route = store.createNode("route", { path: "/users" }, domain.id);
    const endpoint = store.createNode("endpoint", { name: "users", methods: ["GET", "POST"] }, route.id);
    const getOp = store.createNode("operation", { method: "GET", query: [{ name: "page", type: "number" }] }, endpoint.id);
    const postOp = store.createNode(
      "operation",
      { method: "POST", body: [{ name: "email", type: "string", required: true }] },
      endpoint.id,
    );
    const service = store.createNode("service", { name: "CreateUser", errors: [{ status: 409, description: "Duplicate" }] }, postOp.id);
    void service;
    void getOp;

    const graph = store.getProject("all");
    const md = exportMarkdown(graph, store.validateProject());

    expect(md).toContain("**Operation: GET**");
    expect(md).toContain("| page | number |");
    expect(md).toContain("**Operation: POST**");
    expect(md).toContain("| email | string | yes |");
    expect(md).toContain("- CreateUser");
    expect(md).toContain("| 409 |");
  });

  it("reports a missing field left behind by a cleared ref as a warning", () => {
    const { endpoint } = buildLoginFixture();
    store.deleteNode(endpoint.id, true);
    const graph = store.getProject("all");
    const md = exportMarkdown(graph, store.validateProject());
    expect(md).toContain("[MISSING FIELD]");
    expect(md).not.toContain("[BROKEN REF]");
  });
});

// The store rejects hierarchy cycles at write time (see project-store.test.ts), but export must
// not hang or stack-overflow on data written before that check existed, or edited by hand.
describe("cycle safety (hand-built cyclic graph, bypassing the store)", () => {
  it("terminates on a component hierarchy cycle under a page", () => {
    const page = rawNode("p1", "page", { name: "Home", path: "/" });
    const c1 = rawNode("c1", "component", { name: "C1", kind: "presentational" }, "p1");
    const c2 = rawNode("c2", "component", { name: "C2", kind: "presentational" }, "c1");
    const graph: ProjectGraph = {
      manifest: { projectName: "p", createdAt: "now", updatedAt: "now" },
      nodes: [page, c1, c2],
      edges: [
        { id: "e1", source: "p1", target: "c1", edgeType: "hierarchy" },
        { id: "e2", source: "c1", target: "c2", edgeType: "hierarchy" },
        { id: "e3", source: "c2", target: "c1", edgeType: "hierarchy" },
      ] as GraphEdge[],
    };
    const md = exportMarkdown(graph);
    expect(md).toContain("Page: Home");
    expect(md).toContain("C1");
  });

  it("terminates on a route hierarchy cycle under a domain", () => {
    const domain = rawNode("d1", "domain", { name: "Auth" });
    const r1 = rawNode("r1", "route", { path: "/a" }, "d1");
    const r2 = rawNode("r2", "route", { path: "/b" }, "r1");
    const endpoint = rawNode("e1", "endpoint", { name: "x", methods: ["GET"] }, "r1");
    const graph: ProjectGraph = {
      manifest: { projectName: "p", createdAt: "now", updatedAt: "now" },
      nodes: [domain, r1, r2, endpoint],
      edges: [
        { id: "e1", source: "d1", target: "r1", edgeType: "hierarchy" },
        { id: "e2", source: "r1", target: "r2", edgeType: "hierarchy" },
        { id: "e3", source: "r2", target: "r1", edgeType: "hierarchy" },
        { id: "e4", source: "r1", target: "e1", edgeType: "hierarchy" },
      ] as GraphEdge[],
    };
    const md = exportMarkdown(graph);
    expect(typeof md).toBe("string");
    expect(md).toContain("Domain: Auth");
  });
});
