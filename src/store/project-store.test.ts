import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

describe("transaction", () => {
  it("defers persistence until commit — mid-transaction, disk still reflects the pre-transaction state", () => {
    const projectName = `test-${randomUUID()}`;
    const localStore = createProjectStore(projectName, { baseDir });
    localStore.updateManifest({}); // force an initial persist so project.json exists on disk
    const projectFile = join(baseDir, projectName, "project.json");

    let midTxNodeCount = -1;
    localStore.transaction((tx) => {
      tx.createNode("domain", { name: "Auth" });
      tx.createNode("domain", { name: "Billing" });
      midTxNodeCount = (JSON.parse(readFileSync(projectFile, "utf-8")) as { nodes: unknown[] }).nodes.length;
    });

    expect(midTxNodeCount).toBe(0);
    const final = JSON.parse(readFileSync(projectFile, "utf-8")) as { nodes: unknown[] };
    expect(final.nodes).toHaveLength(2);
  });

  it("rolls back in memory and never touches disk if an operation inside fails", () => {
    const projectName = `test-${randomUUID()}`;
    const localStore = createProjectStore(projectName, { baseDir });
    localStore.updateManifest({}); // force an initial persist so project.json exists on disk
    const projectFile = join(baseDir, projectName, "project.json");
    const before = readFileSync(projectFile, "utf-8");

    expect(() =>
      localStore.transaction((tx) => {
        tx.createNode("domain", { name: "Auth" });
        tx.createNode("endpoint", { name: "x", methods: ["GET"] }, "not-a-real-parent-id"); // throws
      }),
    ).toThrow(ValidationError);

    expect(readFileSync(projectFile, "utf-8")).toBe(before);
    expect(localStore.getProject("all").nodes).toHaveLength(0);
  });

  it("does not double-commit a nested transaction — the outer call owns commit/rollback", () => {
    const projectName = `test-${randomUUID()}`;
    const localStore = createProjectStore(projectName, { baseDir });
    const projectFile = join(baseDir, projectName, "project.json");

    localStore.transaction((tx) => {
      tx.createNode("domain", { name: "Auth" });
      tx.transaction((inner) => {
        inner.createNode("domain", { name: "Billing" });
      });
    });

    const final = JSON.parse(readFileSync(projectFile, "utf-8")) as { nodes: unknown[] };
    expect(final.nodes).toHaveLength(2);
  });
});

describe("applyBatch", () => {
  it("rejects a method outside the whitelist before mutating anything", () => {
    const projectName = `test-${randomUUID()}`;
    const localStore = createProjectStore(projectName, { baseDir });

    expect(() =>
      localStore.applyBatch([{ method: "validateProject" as never, args: [] }]),
    ).toThrow(ValidationError);
    expect(localStore.getProject("all").nodes).toHaveLength(0);
  });

  it("commits every operation together, in order, as a single transaction", () => {
    const projectName = `test-${randomUUID()}`;
    const localStore = createProjectStore(projectName, { baseDir });

    const results = localStore.applyBatch([
      { method: "createNode", args: ["domain", { name: "Auth" }] },
      { method: "createNode", args: ["route", { path: "/login" }] },
    ]);

    expect(results).toHaveLength(2);
    const [domain, route] = results as [{ id: string }, { id: string }];
    localStore.connectNodes(domain.id, route.id);
    expect(localStore.getNode(route.id)?.parentId).toBe(domain.id);
  });

  it("rolls back every operation if one fails partway through", () => {
    const projectName = `test-${randomUUID()}`;
    const localStore = createProjectStore(projectName, { baseDir });
    localStore.updateManifest({}); // force an initial persist so project.json exists on disk
    const projectFile = join(baseDir, projectName, "project.json");
    const before = readFileSync(projectFile, "utf-8");

    expect(() =>
      localStore.applyBatch([
        { method: "createNode", args: ["domain", { name: "Auth" }] },
        { method: "createNode", args: ["endpoint", { name: "x", methods: ["GET"] }, "not-a-real-parent-id"] },
      ]),
    ).toThrow(ValidationError);

    expect(readFileSync(projectFile, "utf-8")).toBe(before);
    expect(localStore.getProject("all").nodes).toHaveLength(0);
  });
});

describe("project name validation", () => {
  it("rejects a path-traversal project name before touching the filesystem", () => {
    expect(() => createProjectStore("../../etc/passwd", { baseDir })).toThrow(/Invalid project name/);
  });
});

describe("PersistenceAdapter injection", () => {
  it("works entirely against an in-memory fake adapter — the store makes no filesystem assumptions", () => {
    let saved: unknown = null;
    let snapshotCount = 0;
    const fakeAdapter = {
      load: () => ({
        manifest: { projectName: "fake", createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z" },
        nodes: [],
        edges: [],
      }),
      save: (graph: unknown) => {
        saved = graph;
      },
      acquireLock: () => {},
      releaseLock: () => {},
      snapshot: () => {
        snapshotCount += 1;
      },
    };

    // baseDir is still passed so the (unrelated, filesystem-based) history log lands in the test's
    // tmp dir rather than the real ~/.project-visualizer — only graph storage itself is faked here.
    const memStore = createProjectStore("fake", { baseDir, persistence: fakeAdapter });
    const domain = memStore.createNode("domain", { name: "Auth" });
    expect((saved as { nodes: unknown[] }).nodes).toHaveLength(1);
    expect(memStore.getNode(domain.id)).toBeTruthy();

    memStore.importGraph([], [], "replace"); // exercises the snapshot() hook
    expect(snapshotCount).toBe(1);
  });
});

describe("recordSync / getSyncStatus / getBulkSyncStatus", () => {
  it("stamps sourceHash/sourcePath/lastSyncedAt without bumping updatedAt", () => {
    const node = store.createNode("domain", { name: "Auth" });
    const before = store.getNode(node.id)!.updatedAt;
    const synced = store.recordSync(node.id, { sourceHash: "abc123", sourcePath: "src/domains/auth.ts" });
    expect(synced.sourceHash).toBe("abc123");
    expect(synced.sourcePath).toBe("src/domains/auth.ts");
    expect(synced.lastSyncedAt).toBeTruthy();
    expect(synced.updatedAt).toBe(before);
  });

  it("getSyncStatus reflects in_sync right after a sync, then graph_changed after a later edit", () => {
    const node = store.createNode("domain", { name: "Auth" });
    store.recordSync(node.id, { sourceHash: "abc123" });
    expect(store.getSyncStatus(node.id, "abc123")).toBe("in_sync");

    store.updateNode(node.id, { name: "AuthRenamed" });
    expect(store.getSyncStatus(node.id, "abc123")).toBe("graph_changed");
  });

  it("getBulkSyncStatus reports per-node status across the whole project in one call", () => {
    const a = store.createNode("domain", { name: "Auth" });
    const b = store.createNode("domain", { name: "Billing" });
    store.recordSync(a.id, { sourceHash: "hashA" });
    const statuses = store.getBulkSyncStatus({ [a.id]: "hashA", [b.id]: "hashB" });
    expect(statuses[a.id]).toBe("in_sync");
    expect(statuses[b.id]).toBe("unknown"); // b was never synced
  });
});

describe("recordAudit / listAuditLog", () => {
  it("appends and lists entries independent of history", () => {
    const before = store.listHistory().length;
    store.recordAudit({ transport: "http", operation: "GET /api/project", result: "SUCCESS" });
    expect(store.listHistory().length).toBe(before); // audit log is separate from the graph history
    const log = store.listAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0].operation).toBe("GET /api/project");
    expect(log[0].id).toBeTruthy();
    expect(log[0].timestamp).toBeTruthy();
  });

  it("supports limit/before filtering", () => {
    store.recordAudit({ transport: "mcp", operation: "create_node", result: "SUCCESS" });
    store.recordAudit({ transport: "mcp", operation: "delete_node", result: "FAILURE", errorMessage: "not found" });
    expect(store.listAuditLog({ limit: 1 })[0].operation).toBe("delete_node");
  });
});

describe("history / undo / redo / restore", () => {
  it("records one entry per committed transaction, tagged with the given source", () => {
    store.createNode("domain", { name: "Auth" }, undefined, { source: "import" });
    store.createNode("route", { path: "/login" }, undefined, { source: "ui" });
    const history = store.listHistory();
    expect(history).toHaveLength(2);
    expect(history[0].source).toBe("import");
    expect(history[0].operation).toBe("createNode");
    expect(history[1].source).toBe("ui");
  });

  it("undo() reverts the most recent entry; redo() re-applies it", () => {
    const domain = store.createNode("domain", { name: "Auth" });
    store.undo();
    expect(store.getNode(domain.id)).toBeUndefined();
    store.redo();
    expect(store.getNode(domain.id)).toBeTruthy();
  });

  it("undo() throws when there is nothing to undo, redo() throws when there is nothing to redo", () => {
    expect(() => store.undo()).toThrow(/nothing to undo/i);
    store.createNode("domain", { name: "Auth" });
    expect(() => store.redo()).toThrow(/nothing to redo/i);
  });

  it("a fresh commit after undo() drops the redo-able future", () => {
    const a = store.createNode("domain", { name: "Auth" });
    store.createNode("domain", { name: "Billing" });
    store.undo(); // back to just `a`
    store.createNode("domain", { name: "Support" }); // new branch — "Billing" redo is gone
    expect(() => store.redo()).toThrow(/nothing to redo/i);
    expect(store.getNode(a.id)).toBeTruthy();
    expect(store.listNodes("domain").map((n) => (n.props as { name: string }).name).sort()).toEqual(["Auth", "Support"]);
  });

  it("a whole batch commits as exactly one history entry", () => {
    store.applyBatch([
      { method: "createNode", args: ["domain", { name: "Auth" }] },
      { method: "createNode", args: ["route", { path: "/login" }] },
    ]);
    const history = store.listHistory();
    expect(history).toHaveLength(1);
    expect(history[0].operation).toBe("applyBatch");
    expect(history[0].nodesDiff).toHaveLength(2);
  });

  it("restoreVersion() moves the graph to the state right after that entry was applied", () => {
    store.createNode("domain", { name: "Auth" });
    const billing = store.createNode("domain", { name: "Billing" });
    store.createNode("domain", { name: "Support" });
    const history = store.listHistory();

    store.restoreVersion(history[0].id); // right after "Auth" alone was created
    expect(store.listNodes("domain")).toHaveLength(1);

    store.restoreVersion(history[2].id); // forward again, to the full state
    expect(store.listNodes("domain")).toHaveLength(3);
    expect(store.getNode(billing.id)).toBeTruthy();
  });

  it("compareVersions() diffs two points in the timeline without mutating the live graph", () => {
    store.createNode("domain", { name: "Auth" });
    const billing = store.createNode("domain", { name: "Billing" });
    const history = store.listHistory();

    const diff = store.compareVersions(history[0].id, history[1].id);
    expect(diff.nodesDiff.some((d) => d.id === billing.id && d.before === undefined && d.after)).toBe(true);
    // compareVersions must not have touched the real, live graph
    expect(store.listNodes("domain")).toHaveLength(2);
  });
});
