import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../server.js";
import { createProjectStore } from "../store/project-store.js";

// End-to-end walk of the flow described in the project's own objective:
//   IMPORT -> VALIDATE -> VISUALIZE -> MODIFY GRAPH -> ANALYZE IMPACT -> PLAN CHANGE -> SYNC
//   -> VALIDATE -> TEST
// plus a deliberately-triggered graph<->code conflict.
//
// VISUALIZE is not automatable here — it needs a real browser rendering the React Flow canvas;
// see CLAUDE.md's Performance section for the manual checklist that covers it at scale.
// TEST is not duplicated here either — running a generated codebase's own test suite is
// project-scaffold.md's/project-sync.md's responsibility, not this backend's.
//
// Everything else below hits the real REST API against a real (temp-dir) project, exactly like
// src/server.test.ts's pattern: a live server on an ephemeral port + fetch.

let baseDir: string;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  baseDir = mkdtempSync(join(tmpdir(), "pv-e2e-test-"));
  const store = createProjectStore(`e2e-${randomUUID()}`, { baseDir });
  const app = createServer(store);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(baseDir, { recursive: true, force: true });
});

async function post(path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
async function patch(path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
async function get(path: string) {
  return fetch(`${baseUrl}${path}`);
}

// Fixture: a full backend chain (domain -> route -> endpoint -> middleware -> service ->
// repository, wired to db/orm/table/model via real REF_FIELDS) plus a frontend chain
// (page -> component -> apiCall, page -> form, plus an unattached stateStore) — ~15 nodes,
// interconnected enough that impact analysis on the model/repository isn't trivially empty.
const db = { id: "db1", type: "db", props: { engine: "postgres", connectionType: "native" } };
const orm = { id: "orm1", type: "orm", props: { name: "prisma" } };
const domain = { id: "domain1", type: "domain", props: { name: "Auth" } };
const route = { id: "route1", type: "route", props: { path: "/users" }, parentId: "domain1" };
const endpoint = { id: "endpoint1", type: "endpoint", props: { name: "getUser", methods: ["GET"] }, parentId: "route1" };
const middleware = { id: "middleware1", type: "middleware", props: { name: "authGuard" }, parentId: "endpoint1" };
const service = { id: "service1", type: "service", props: { name: "UserService", ormId: "orm1" }, parentId: "middleware1" };
const table = { id: "table1", type: "table", props: { name: "users", columns: [{ name: "id", type: "uuid" }], dbId: "db1" } };
const model = { id: "model1", type: "model", props: { name: "User", schema: [{ name: "id", type: "string" }], tableId: "table1" } };
const repository = { id: "repository1", type: "repository", props: { name: "UserRepository", entityRef: "model1", ormId: "orm1" }, parentId: "service1" };
const page = { id: "page1", type: "page", props: { name: "UserPage", path: "/user" } };
const component = { id: "component1", type: "component", props: { name: "UserCard", kind: "presentational" }, parentId: "page1" };
const apiCall = { id: "apiCall1", type: "apiCall", props: { name: "fetchUser", endpointRef: "endpoint1" }, parentId: "component1" };
const form = { id: "form1", type: "form", props: { name: "UserForm", fields: [{ name: "name", type: "string" }] }, parentId: "page1" };
const stateStore = { id: "stateStore1", type: "stateStore", props: { name: "userStore", library: "zustand" } };

const fixtureNodes = [db, orm, domain, route, endpoint, middleware, service, table, model, repository, page, component, apiCall, form, stateStore];
const fixtureEdges = [
  { id: "h1", source: "domain1", target: "route1", edgeType: "hierarchy" },
  { id: "h2", source: "route1", target: "endpoint1", edgeType: "hierarchy" },
  { id: "h3", source: "endpoint1", target: "middleware1", edgeType: "hierarchy" },
  { id: "h4", source: "middleware1", target: "service1", edgeType: "hierarchy" },
  { id: "h5", source: "service1", target: "repository1", edgeType: "hierarchy" },
  { id: "h6", source: "page1", target: "component1", edgeType: "hierarchy" },
  { id: "h7", source: "component1", target: "apiCall1", edgeType: "hierarchy" },
  { id: "h8", source: "page1", target: "form1", edgeType: "hierarchy" },
];

describe("end-to-end: import -> validate -> modify -> analyze -> plan -> sync -> validate", () => {
  it("walks the full flow against a real fixture", async () => {
    // IMPORT
    const importRes = await post("/api/import", { nodes: fixtureNodes, edges: fixtureEdges, mode: "replace" });
    expect(importRes.status).toBe(200);

    // VALIDATE
    const validation1 = await get("/api/validate").then((r) => r.json());
    expect(validation1.valid).toBe(true);

    // MODIFY GRAPH — rename the model
    const patchRes = await patch("/api/nodes/model1", { name: "UserAccount" });
    expect(patchRes.status).toBe(200);
    expect((await patchRes.json()).props.name).toBe("UserAccount");

    // ANALYZE IMPACT — deleting the model should show the repository (entityRef) as a dependent
    const impact = await post("/api/analyze-change", { nodeId: "model1", changeType: "delete" }).then((r) => r.json());
    expect(impact.dependents).toContainEqual(expect.objectContaining({ nodeId: "repository1", kind: "ref" }));
    expect(impact.affected.length).toBeGreaterThan(0);

    // PLAN CHANGE — builds on the same analysis, adds a human-readable plan
    const plan = await post("/api/plan-change", { nodeId: "model1", changeType: "delete" }).then((r) => r.json());
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.summary).toContain("model");

    // SYNC — a node that's genuinely in sync
    await post("/api/nodes/repository1/sync", { sourceHash: "hash-abc", sourcePath: "src/repositories/user.ts" });
    const inSyncStatus = await get("/api/nodes/repository1/sync-status?hash=hash-abc").then((r) => r.json());
    expect(inSyncStatus.status).toBe("in_sync");

    // VALIDATE again — the rename didn't break anything
    const validation2 = await get("/api/validate").then((r) => r.json());
    expect(validation2.valid).toBe(true);

    // Bonus: undo back past the sync stamp (most recent entry) and the rename before it, and
    // confirm the graph is back to its pre-modify state.
    expect((await post("/api/history/undo", {})).status).toBe(200); // reverts record_sync on repository1
    expect((await post("/api/history/undo", {})).status).toBe(200); // reverts the model1 rename
    const modelAfterUndo = await get("/api/nodes/model1").then((r) => r.json());
    expect(modelAfterUndo.props.name).toBe("User");
  });

  it("detects a deliberate graph<->code conflict instead of silently picking a side", async () => {
    await post("/api/import", { nodes: fixtureNodes, edges: fixtureEdges, mode: "replace" });

    // Last known-good sync: the graph and the (simulated) source file agreed on this hash.
    await post("/api/nodes/model1/sync", { sourceHash: "hash-v1", sourcePath: "src/models/user.ts" });

    // The graph changes (a real edit, after the sync above)...
    await patch("/api/nodes/model1", { name: "UserAccount" });

    // ...and, independently, the source file also changed since the last sync (simulated: the
    // agent doing the sync would compute this from the real file — a different hash than v1).
    const conflictStatus = await get("/api/nodes/model1/sync-status?hash=hash-v2").then((r) => r.json());
    expect(conflictStatus.status).toBe("conflict");

    // The conflict must be reported, never resolved by silently deleting or overwriting either side.
    const stillThere = await get("/api/nodes/model1");
    expect(stillThere.status).toBe(200);
    expect((await stillThere.json()).props.name).toBe("UserAccount");
  });
});
