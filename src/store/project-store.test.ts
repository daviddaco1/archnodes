import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProjectStore, type ProjectStore } from "./project-store.js";
import { ValidationError } from "../validation/rules.js";

let baseDir: string;
let store: ProjectStore;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "pv-test-"));
  store = createProjectStore(`test-${randomUUID()}`, { baseDir });
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

describe("createNode", () => {
  it("creates a valid node", () => {
    const node = store.createNode("domain", { name: "Auth" });
    expect(node.id).toBeTruthy();
    expect(node.createdAt).toBeTruthy();
  });

  it("rejects an invalid hierarchy on create", () => {
    const domain = store.createNode("domain", { name: "Auth" });
    expect(() => store.createNode("endpoint", { name: "x", method: "GET" }, domain.id)).toThrow(ValidationError);
  });

  it("allows a bare node with missing required fields (a visual editor drops nodes before filling them in)", () => {
    const node = store.createNode("domain", {});
    expect(node.id).toBeTruthy();
    const result = store.validateProject();
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "MISSING_FIELD" && i.nodeId === node.id)).toBe(true);
  });
});

describe("connectNodes", () => {
  it("connects a valid hierarchy pair and sets parentId", () => {
    const domain = store.createNode("domain", { name: "Auth" });
    const route = store.createNode("route", { path: "/login" });
    store.connectNodes(domain.id, route.id);
    expect(store.getNode(route.id)?.parentId).toBe(domain.id);
  });

  it("rejects an invalid hierarchy pair", () => {
    const domain = store.createNode("domain", { name: "Auth" });
    const service = store.createNode("service", { name: "AuthService" });
    expect(() => store.connectNodes(domain.id, service.id)).toThrow(ValidationError);
  });

  it("accepts a valid invalidates edge", () => {
    const endpoint = store.createNode("endpoint", { name: "login", method: "POST" });
    const tool = store.createNode("tool", { name: "redis" });
    const redisKey = store.createNode("redisKey", { keyPattern: "session:*", operation: "SET", toolId: tool.id });
    expect(() => store.connectNodes(endpoint.id, redisKey.id, "invalidates")).not.toThrow();
  });

  it("rejects an invalid invalidates edge", () => {
    const page = store.createNode("page", { name: "Login", path: "/login" });
    const tool = store.createNode("tool", { name: "redis" });
    const redisKey = store.createNode("redisKey", { keyPattern: "session:*", operation: "SET", toolId: tool.id });
    expect(() => store.connectNodes(page.id, redisKey.id, "invalidates")).toThrow(ValidationError);
  });
});

describe("setPosition / setContainer", () => {
  it("updates position without touching props", () => {
    const domain = store.createNode("domain", { name: "Auth" });
    const updated = store.setPosition(domain.id, { x: 10, y: 20 });
    expect(updated.position).toEqual({ x: 10, y: 20 });
    expect(updated.props).toEqual({ name: "Auth" });
  });

  it("sets and clears containerId without validating it as a hierarchy edge", () => {
    const container = store.createNode("container", { label: "Docker" });
    const domain = store.createNode("domain", { name: "Auth" });
    const grouped = store.setContainer(domain.id, container.id);
    expect(grouped.containerId).toBe(container.id);
    const ungrouped = store.setContainer(domain.id, undefined);
    expect(ungrouped.containerId).toBeUndefined();
  });
});

describe("validateProject", () => {
  it("flags a broken ref end to end", () => {
    const domain = store.createNode("domain", { name: "Auth" });
    const route = store.createNode("route", { path: "/login" }, domain.id);
    const endpoint = store.createNode("endpoint", { name: "login", method: "POST" }, route.id);
    const page = store.createNode("page", { name: "LoginPage", path: "/login" });
    const form = store.createNode("form", { name: "LoginForm", fields: [{ name: "email", type: "string" }] }, page.id);
    const apiCall = store.createNode("apiCall", { name: "loginCall", endpointRef: endpoint.id }, form.id);
    void apiCall;

    store.deleteNode(endpoint.id);
    const result = store.validateProject();
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "BROKEN_REF")).toBe(true);
  });
});

describe("deleteNode", () => {
  it("refuses to delete a node with children unless cascade is set", () => {
    const domain = store.createNode("domain", { name: "Auth" });
    store.createNode("route", { path: "/login" }, domain.id);
    expect(() => store.deleteNode(domain.id)).toThrow(ValidationError);
  });

  it("cascades delete through hierarchy descendants", () => {
    const domain = store.createNode("domain", { name: "Auth" });
    const route = store.createNode("route", { path: "/login" }, domain.id);
    const endpoint = store.createNode("endpoint", { name: "login", method: "POST" }, route.id);
    const middleware = store.createNode("middleware", { name: "validateBody" }, endpoint.id);
    void middleware;

    const result = store.deleteNode(domain.id, true);
    expect(result.deletedIds).toEqual(
      expect.arrayContaining([domain.id, route.id, endpoint.id]),
    );
    expect(store.getNode(domain.id)).toBeUndefined();
    expect(store.getNode(route.id)).toBeUndefined();

    const validation = store.validateProject();
    expect(validation.issues.some((i) => i.code === "INVALID_HIERARCHY")).toBe(false);
  });
});
