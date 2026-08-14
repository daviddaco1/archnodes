import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProjectStore, type ProjectStore } from "../store/project-store.js";
import { importProject } from "./import.js";

let baseDir: string;
let store: ProjectStore;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "pv-import-test-"));
  store = createProjectStore(`test-${randomUUID()}`, { baseDir });
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

describe("importProject", () => {
  it("creates nodes and remaps tempId in parentId/edges to real ids", () => {
    const result = importProject(
      store,
      [
        { tempId: "d1", type: "domain", props: { name: "Auth" }, sourcePath: "src/domains/auth.ts" },
        { tempId: "r1", type: "route", props: { path: "/login" }, parentId: "d1", sourcePath: "src/routes/login.ts" },
      ],
      [],
    );
    expect(result.created).toHaveLength(2);
    const domainId = result.created.find((c) => c.tempId === "d1")!.id;
    const routeId = result.created.find((c) => c.tempId === "r1")!.id;
    expect(store.getNode(routeId)?.parentId).toBe(domainId);
  });

  it("updates an existing node matched by sourcePath instead of creating a duplicate", () => {
    const domain = store.createNode("domain", { name: "Auth" }, undefined, { source: "import" });
    store.recordSync(domain.id, { sourcePath: "src/domains/auth.ts" });

    const result = importProject(store, [
      { tempId: "d1", type: "domain", props: { name: "AuthRenamed" }, sourcePath: "src/domains/auth.ts" },
    ], []);

    expect(result.created).toHaveLength(0);
    expect(result.updated).toEqual([{ tempId: "d1", id: domain.id }]);
    expect(store.listNodes("domain")).toHaveLength(1);
    expect((store.getNode(domain.id)?.props as { name: string }).name).toBe("AuthRenamed");
  });

  it("reports a type mismatch on the same sourcePath as a conflict, without touching the existing node", () => {
    const domain = store.createNode("domain", { name: "Auth" });
    store.recordSync(domain.id, { sourcePath: "src/domains/auth.ts" });

    const result = importProject(store, [
      { tempId: "x1", type: "route", props: { path: "/x" }, sourcePath: "src/domains/auth.ts" },
    ], []);

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].existingId).toBe(domain.id);
    expect(store.getNode(domain.id)?.type).toBe("domain"); // untouched
  });

  it("reports orphaned nodes present before the batch but absent from it", () => {
    const domain = store.createNode("domain", { name: "Auth" });
    store.recordSync(domain.id, { sourcePath: "src/domains/auth.ts" });

    const result = importProject(store, [
      { tempId: "b1", type: "domain", props: { name: "Billing" }, sourcePath: "src/domains/billing.ts" },
    ], []);

    expect(result.orphaned).toEqual([{ id: domain.id, sourcePath: "src/domains/auth.ts" }]);
    expect(store.getNode(domain.id)).toBeTruthy(); // never deleted
  });

  it("connects edges between candidates via tempId remapping", () => {
    const tool = store.createNode("tool", { name: "redis" });
    const result = importProject(
      store,
      [
        { tempId: "e1", type: "endpoint", props: { name: "login", methods: ["POST"] } },
        { tempId: "rk1", type: "redisKey", props: { keyPattern: "session:*", operation: "SET", toolId: tool.id } },
      ],
      [{ sourceId: "e1", targetId: "rk1", edgeType: "invalidates" }],
    );
    const endpointId = result.created.find((c) => c.tempId === "e1")!.id;
    const redisKeyId = result.created.find((c) => c.tempId === "rk1")!.id;
    const edges = store.getProject("all").edges;
    expect(edges).toContainEqual(expect.objectContaining({ source: endpointId, target: redisKeyId, edgeType: "invalidates" }));
  });

  it("calls recordSync when sourceHash is provided, leaving the node in_sync", () => {
    const result = importProject(store, [
      { tempId: "d1", type: "domain", props: { name: "Auth" }, sourcePath: "src/domains/auth.ts", sourceHash: "abc123" },
    ], []);
    const id = result.created[0].id;
    expect(store.getSyncStatus(id, "abc123")).toBe("in_sync");
  });

  it("never marks generated:true", () => {
    const result = importProject(store, [
      { tempId: "d1", type: "domain", props: { name: "Auth" } },
    ], []);
    expect(store.getNode(result.created[0].id)?.generated).toBeFalsy();
  });

  it("is atomic — a failure partway through rolls back the whole batch", () => {
    expect(() =>
      importProject(store, [
        { tempId: "d1", type: "domain", props: { name: "Auth" } },
        { tempId: "r1", type: "endpoint", props: { name: "x", methods: ["GET"] }, parentId: "not-a-real-tempid-or-id" },
      ], []),
    ).toThrow();
    expect(store.getProject("all").nodes).toHaveLength(0);
  });
});
