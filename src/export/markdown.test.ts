import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProjectStore, type ProjectStore } from "../store/project-store.js";
import { exportMarkdown, toYamlBlock } from "./markdown.js";

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
  const domain = store.createNode("domain", { name: "Auth" });
  const route = store.createNode("route", { path: "/login" }, domain.id);
  const endpoint = store.createNode(
    "endpoint",
    {
      name: "login",
      method: "POST",
      input: { body: { email: "string", password: "string" } },
      output: { statusCode: 200, body: { token: "string" } },
      returns: [{ status: 200, description: "OK" }],
      cacheable: { enabled: true, keyPattern: "session:*", ttl: 3600, invalidation: "manual" },
    },
    route.id,
  );
  const middleware = store.createNode(
    "middleware",
    { name: "validateBody", returns: [{ status: 400, description: "Invalid body" }] },
    endpoint.id,
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

  return { domain, route, endpoint, middleware, service, page, form, apiCall };
}

describe("exportMarkdown", () => {
  it("renders the full login fixture", () => {
    buildLoginFixture();
    const graph = store.getProject("all");
    const md = exportMarkdown(graph, store.validateProject());

    expect(md).toContain("# Project Context:");
    expect(md).toContain("### Domain: Auth");
    expect(md).toMatch(/##### Endpoint: POST \/login/);
    expect(md).toContain("**Returns (aggregated)**");
    expect(md).toContain("| 401 |");
    expect(md).toContain("**Cache**");
    expect(md).toContain("session:*");
    expect(md).toMatch(/loginCall → consumes `.*`/);
    expect(md).toContain("## Validation Warnings");
    expect(md).toContain("_(none)_");
  });

  it("reports a broken ref as a warning", () => {
    const { endpoint } = buildLoginFixture();
    store.deleteNode(endpoint.id, true);
    const graph = store.getProject("all");
    const md = exportMarkdown(graph, store.validateProject());
    expect(md).toContain("[BROKEN REF]");
  });
});

describe("toYamlBlock", () => {
  it("renders a flat object", () => {
    expect(toYamlBlock({ a: 1, b: "x" })).toBe("a: 1\nb: x\n");
  });
  it("renders a nested object", () => {
    expect(toYamlBlock({ a: { b: 1 } })).toBe("a:\n  b: 1\n");
  });
  it("renders an array of primitives", () => {
    expect(toYamlBlock(["a", "b"])).toBe("- a\n- b\n");
  });
  it("renders an array of objects", () => {
    expect(toYamlBlock([{ a: 1 }, { a: 2 }])).toBe("- a: 1\n- a: 2\n");
  });
});
