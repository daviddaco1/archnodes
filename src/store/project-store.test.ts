import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
    expect(() => store.createNode("endpoint", { name: "x", methods: ["GET"] }, domain.id)).toThrow(ValidationError);
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
    const endpoint = store.createNode("endpoint", { name: "login", methods: ["POST"] });
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

  it("does not duplicate an edge already connecting the same pair with the same type", () => {
    const domain = store.createNode("domain", { name: "Auth" });
    const route = store.createNode("route", { path: "/login" });
    const first = store.connectNodes(domain.id, route.id);
    const second = store.connectNodes(domain.id, route.id);
    expect(second.id).toBe(first.id);
    expect(store.getProject("all").edges).toHaveLength(1);
  });

  it("reparenting a child drops its old hierarchy edge", () => {
    const domainA = store.createNode("domain", { name: "A" });
    const domainB = store.createNode("domain", { name: "B" });
    const route = store.createNode("route", { path: "/x" });
    store.connectNodes(domainA.id, route.id);
    store.connectNodes(domainB.id, route.id);

    const hierarchyEdges = store.getProject("all").edges.filter((e) => e.edgeType === "hierarchy" && e.target === route.id);
    expect(hierarchyEdges).toHaveLength(1);
    expect(hierarchyEdges[0].source).toBe(domainB.id);
    expect(store.getNode(route.id)?.parentId).toBe(domainB.id);
  });
});

describe("deleteEdge", () => {
  it("removes the edge and clears the denormalized parentId", () => {
    const domain = store.createNode("domain", { name: "Auth" });
    const route = store.createNode("route", { path: "/login" });
    const edge = store.connectNodes(domain.id, route.id);
    expect(store.getNode(route.id)?.parentId).toBe(domain.id);

    store.deleteEdge(edge.id);

    expect(store.getProject("all").edges).toHaveLength(0);
    expect(store.getNode(route.id)?.parentId).toBeUndefined();
  });

  it("is a no-op for an unknown edge id", () => {
    expect(() => store.deleteEdge("does-not-exist")).not.toThrow();
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
  it("clears a ref to a deleted node instead of leaving it dangling", () => {
    const domain = store.createNode("domain", { name: "Auth" });
    const route = store.createNode("route", { path: "/login" }, domain.id);
    const endpoint = store.createNode("endpoint", { name: "login", methods: ["POST"] }, route.id);
    const page = store.createNode("page", { name: "LoginPage", path: "/login" });
    const form = store.createNode("form", { name: "LoginForm", fields: [{ name: "email", type: "string" }] }, page.id);
    const apiCall = store.createNode("apiCall", { name: "loginCall", endpointRef: endpoint.id }, form.id);

    store.deleteNode(endpoint.id);
    expect((store.getNode(apiCall.id)?.props as Record<string, unknown>).endpointRef).toBeUndefined();
    const result = store.validateProject();
    expect(result.issues.some((i) => i.code === "BROKEN_REF")).toBe(false);
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
    const endpoint = store.createNode("endpoint", { name: "login", methods: ["POST"] }, route.id);
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

describe("getProject scoping", () => {
  it("keeps structural nodes (container/boundary/note) in backend and frontend scopes", () => {
    const container = store.createNode("container", { label: "Docker" });
    const boundary = store.createNode("boundary", { label: "Trust boundary" });
    const note = store.createNode("note", { text: "todo" });

    for (const scope of ["backend", "frontend"] as const) {
      const ids = store.getProject(scope).nodes.map((n) => n.id);
      expect(ids).toEqual(expect.arrayContaining([container.id, boundary.id, note.id]));
    }
  });
});

describe("operation method rules", () => {
  function buildEndpoint(methods: string[]) {
    const domain = store.createNode("domain", { name: "Auth" });
    const route = store.createNode("route", { path: "/users" }, domain.id);
    return store.createNode("endpoint", { name: "users", methods }, route.id);
  }

  it("rejects an operation method not declared on the parent endpoint", () => {
    const endpoint = buildEndpoint(["GET", "POST"]);
    expect(() => store.createNode("operation", { method: "DELETE" }, endpoint.id)).toThrow(ValidationError);
  });

  it("rejects a duplicate operation method under the same endpoint", () => {
    const endpoint = buildEndpoint(["GET", "POST"]);
    store.createNode("operation", { method: "GET" }, endpoint.id);
    expect(() => store.createNode("operation", { method: "GET" }, endpoint.id)).toThrow(ValidationError);
  });

  it("allows distinct declared methods across sibling operations", () => {
    const endpoint = buildEndpoint(["GET", "POST"]);
    const get = store.createNode("operation", { method: "GET" }, endpoint.id);
    const post = store.createNode("operation", { method: "POST" }, endpoint.id);
    expect(get.id).toBeTruthy();
    expect(post.id).toBeTruthy();
  });

  it("rejects updating an operation's method into a collision with a sibling", () => {
    const endpoint = buildEndpoint(["GET", "POST"]);
    store.createNode("operation", { method: "GET" }, endpoint.id);
    const post = store.createNode("operation", { method: "POST" }, endpoint.id);
    expect(() => store.updateNode(post.id, { method: "GET" })).toThrow(ValidationError);
  });

  it("validates the operation method when reparenting via connectNodes", () => {
    const endpoint = buildEndpoint(["GET"]);
    const orphanOp = store.createNode("operation", { method: "POST" });
    expect(() => store.connectNodes(endpoint.id, orphanOp.id)).toThrow(ValidationError);
  });

  it("rejects a duplicate operation method when reparenting via connectNodes", () => {
    const endpoint = buildEndpoint(["GET", "POST"]);
    store.createNode("operation", { method: "GET" }, endpoint.id);
    const orphanOp = store.createNode("operation", { method: "GET" });
    expect(() => store.connectNodes(endpoint.id, orphanOp.id)).toThrow(ValidationError);
  });

  it("rejects narrowing endpoint.methods when an existing operation child would be orphaned", () => {
    const endpoint = buildEndpoint(["GET", "POST"]);
    store.createNode("operation", { method: "POST" }, endpoint.id);
    expect(() => store.updateNode(endpoint.id, { methods: ["GET"] })).toThrow(ValidationError);
  });

  it("allows widening endpoint.methods without touching existing operation children", () => {
    const endpoint = buildEndpoint(["GET", "POST"]);
    store.createNode("operation", { method: "GET" }, endpoint.id);
    expect(() => store.updateNode(endpoint.id, { methods: ["GET", "DELETE"] })).not.toThrow();
  });
});

describe("hierarchy cycle detection", () => {
  it("rejects a hierarchy edge that would create a cycle", () => {
    const page = store.createNode("page", { name: "P", path: "/" });
    const c1 = store.createNode("component", { name: "C1", kind: "presentational" }, page.id);
    const c2 = store.createNode("component", { name: "C2", kind: "presentational" }, c1.id);
    expect(() => store.connectNodes(c2.id, c1.id)).toThrow(ValidationError);
  });

  it("rejects a self-referencing hierarchy edge", () => {
    const page = store.createNode("page", { name: "P", path: "/" });
    const c1 = store.createNode("component", { name: "C1", kind: "presentational" }, page.id);
    expect(() => store.connectNodes(c1.id, c1.id)).toThrow(ValidationError);
  });

  it("rejects setContainer pointing at a non-existent node", () => {
    const domain = store.createNode("domain", { name: "Auth" });
    expect(() => store.setContainer(domain.id, "does-not-exist")).toThrow(ValidationError);
  });

  it("rejects a container cycle via setContainer", () => {
    const a = store.createNode("container", { label: "A" });
    const b = store.createNode("container", { label: "B" });
    store.setContainer(a.id, b.id);
    expect(() => store.setContainer(b.id, a.id)).toThrow(ValidationError);
  });

  it("rejects a self-referencing containerId", () => {
    const a = store.createNode("container", { label: "A" });
    expect(() => store.setContainer(a.id, a.id)).toThrow(ValidationError);
  });
});

describe("containerId cleanup", () => {
  it("clears containerId on surviving nodes when the container they point at is deleted", () => {
    const container = store.createNode("container", { label: "Docker" });
    const domain = store.createNode("domain", { name: "Auth" });
    store.setContainer(domain.id, container.id);

    store.deleteNode(container.id);

    expect(store.getNode(domain.id)?.containerId).toBeUndefined();
  });

  it("clears containerId on nodes pointing at a node swept up by cascade delete (not just the direct target)", () => {
    const domain = store.createNode("domain", { name: "Auth" });
    const route = store.createNode("route", { path: "/x" }, domain.id);
    const note = store.createNode("note", { text: "grouped under route" });
    store.setContainer(note.id, route.id);

    store.deleteNode(domain.id, true);

    expect(store.getNode(route.id)).toBeUndefined();
    expect(store.getNode(note.id)?.containerId).toBeUndefined();
  });
});

describe("importGraph via REST parity", () => {
  it("merges nodes/edges without clobbering existing ones", () => {
    const domain = store.createNode("domain", { name: "Auth" });
    store.importGraph([{ ...domain, props: { name: "Auth2" } } as never], [], "merge");
    expect((store.getNode(domain.id)?.props as Record<string, unknown>).name).toBe("Auth2");
  });
});

describe("process lock", () => {
  it("reclaims a stale lock left by a dead process", () => {
    const projectName = `test-${randomUUID()}`;
    const path = join(baseDir, projectName, "project.json");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.lock`, "999999999"); // essentially guaranteed not to be a live pid
    expect(() => createProjectStore(projectName, { baseDir })).not.toThrow();
  });

  it("rejects opening a project a genuinely live process already holds", async () => {
    const projectName = `test-${randomUUID()}`;
    createProjectStore(projectName, { baseDir });
    const path = join(baseDir, projectName, "project.json");
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 5000)"]);
    await new Promise((resolve) => child.once("spawn", resolve));
    try {
      writeFileSync(`${path}.lock`, String(child.pid));
      expect(() => createProjectStore(projectName, { baseDir })).toThrow(/already open in another process/);
    } finally {
      child.kill();
    }
  });
});

describe("snapshot before destructive bulk writes", () => {
  it("snapshots the file before import replace", () => {
    const projectName = `test-${randomUUID()}`;
    const localStore = createProjectStore(projectName, { baseDir });
    localStore.createNode("domain", { name: "Auth" });
    const snapshotDir = join(baseDir, projectName, ".snapshots");
    expect(existsSync(snapshotDir)).toBe(false);

    localStore.importGraph([], [], "replace");

    expect(existsSync(snapshotDir)).toBe(true);
    expect(readdirSync(snapshotDir).length).toBeGreaterThan(0);
  });

  it("snapshots the file before a cascade delete above the threshold, but not below it", () => {
    const projectName = `test-${randomUUID()}`;
    const localStore = createProjectStore(projectName, { baseDir });
    const domain = localStore.createNode("domain", { name: "Auth" });
    const route = localStore.createNode("route", { path: "/x" }, domain.id);
    const snapshotDir = join(baseDir, projectName, ".snapshots");

    localStore.deleteNode(route.id); // 1 node — below the threshold
    expect(existsSync(snapshotDir)).toBe(false);

    let parent = domain.id;
    for (let i = 0; i < 6; i++) {
      const r = localStore.createNode("route", { path: `/r${i}` }, parent);
      parent = r.id;
    }
    localStore.deleteNode(domain.id, true); // domain + 6 nested routes — above the threshold

    expect(existsSync(snapshotDir)).toBe(true);
  });
});
