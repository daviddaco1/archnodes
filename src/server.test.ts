import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "./server.js";
import { createProjectStore } from "./store/project-store.js";
import type { Server } from "node:http";

let baseDir: string;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  baseDir = mkdtempSync(join(tmpdir(), "pv-server-test-"));
  const store = createProjectStore(`test-${randomUUID()}`, { baseDir });
  const app = createServer(store);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://localhost:${port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(baseDir, { recursive: true, force: true });
});

describe("REST API", () => {
  it("creates a valid node", async () => {
    const res = await fetch(`${baseUrl}/api/nodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "domain", props: { name: "Auth" } }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeTruthy();
  });

  it("rejects a node creation missing type or props", async () => {
    const res = await fetch(`${baseUrl}/api/nodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ props: { name: "Auth" } }),
    });
    expect(res.status).toBe(400);
  });

  it("filters nodes by type and props via /api/nodes", async () => {
    await fetch(`${baseUrl}/api/nodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "domain", props: { name: "Auth" } }),
    });
    await fetch(`${baseUrl}/api/nodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "domain", props: { name: "Billing" } }),
    });

    const filters = encodeURIComponent(JSON.stringify({ name: "Billing" }));
    const res = await fetch(`${baseUrl}/api/nodes?type=domain&filters=${filters}`);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].props.name).toBe("Billing");
  });

  it("rejects a node with an invalid hierarchy", async () => {
    const domainRes = await fetch(`${baseUrl}/api/nodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "domain", props: { name: "Auth" } }),
    });
    const domain = await domainRes.json();

    const res = await fetch(`${baseUrl}/api/nodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "service", props: { name: "x" }, parentId: domain.id }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.issues[0].code).toBe("INVALID_HIERARCHY");
  });

  it("connects and validates edges", async () => {
    const domain = await (
      await fetch(`${baseUrl}/api/nodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "domain", props: { name: "Auth" } }),
      })
    ).json();
    const route = await (
      await fetch(`${baseUrl}/api/nodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "route", props: { path: "/login" } }),
      })
    ).json();

    const validEdge = await fetch(`${baseUrl}/api/edges`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceId: domain.id, targetId: route.id }),
    });
    expect(validEdge.status).toBe(201);

    const invalidEdge = await fetch(`${baseUrl}/api/edges`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceId: route.id, targetId: domain.id }),
    });
    expect(invalidEdge.status).toBe(400);
  });

  it("PATCH with position and flat props together keeps both (not just position)", async () => {
    const domain = await (
      await fetch(`${baseUrl}/api/nodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "domain", props: { name: "Auth" } }),
      })
    ).json();

    const res = await fetch(`${baseUrl}/api/nodes/${domain.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position: { x: 1, y: 2 }, name: "Auth2" }),
    });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.position).toEqual({ x: 1, y: 2 });
    expect(updated.props.name).toBe("Auth2");
  });

  it("returns 404 (not 400) deleting a node that doesn't exist", async () => {
    const res = await fetch(`${baseUrl}/api/nodes/does-not-exist`, { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("returns 404 (not 400) connecting an edge with a missing source/target", async () => {
    const domain = await (
      await fetch(`${baseUrl}/api/nodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "domain", props: { name: "Auth" } }),
      })
    ).json();

    const res = await fetch(`${baseUrl}/api/edges`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceId: domain.id, targetId: "does-not-exist" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400, not 500, for malformed JSON bodies", async () => {
    const res = await fetch(`${baseUrl}/api/nodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not valid json",
    });
    expect(res.status).toBe(400);
  });

  it("deletes an edge and clears the target's parentId", async () => {
    const domain = await (
      await fetch(`${baseUrl}/api/nodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "domain", props: { name: "Auth" } }),
      })
    ).json();
    const route = await (
      await fetch(`${baseUrl}/api/nodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "route", props: { path: "/login" } }),
      })
    ).json();
    const edge = await (
      await fetch(`${baseUrl}/api/edges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: domain.id, targetId: route.id }),
      })
    ).json();

    const del = await fetch(`${baseUrl}/api/edges/${edge.id}`, { method: "DELETE" });
    expect(del.status).toBe(204);

    const project = await (await fetch(`${baseUrl}/api/project`)).json();
    expect(project.edges).toHaveLength(0);
    expect(project.nodes.find((n: { id: string }) => n.id === route.id).parentId).toBeUndefined();
  });

  it("cascade-deletes descendants", async () => {
    const domain = await (
      await fetch(`${baseUrl}/api/nodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "domain", props: { name: "Auth" } }),
      })
    ).json();
    const route = await (
      await fetch(`${baseUrl}/api/nodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "route", props: { path: "/login" }, parentId: domain.id }),
      })
    ).json();

    const del = await fetch(`${baseUrl}/api/nodes/${domain.id}?cascade=true`, { method: "DELETE" });
    expect(del.status).toBe(200);

    const getRoute = await fetch(`${baseUrl}/api/nodes/${route.id}`);
    expect(getRoute.status).toBe(404);
  });

  it("returns validation issues", async () => {
    const res = await fetch(`${baseUrl}/api/validate`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
  });

  it("exports markdown", async () => {
    const res = await fetch(`${baseUrl}/api/export/markdown`);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const text = await res.text();
    expect(text).toContain("# Project Context:");
  });

  it("exposes the connection schema", async () => {
    const res = await fetch(`${baseUrl}/api/schema`);
    const body = await res.json();
    expect(Array.isArray(body.connections)).toBe(true);
    expect(body.connections.length).toBeGreaterThan(0);
  });

  it("lists templates and applies one", async () => {
    const list = await fetch(`${baseUrl}/api/templates`);
    const templates = await list.json();
    expect(templates.length).toBeGreaterThan(0);

    const apply = await fetch(`${baseUrl}/api/templates/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId: templates[0].id }),
    });
    expect(apply.status).toBe(200);
    const graph = await apply.json();
    expect(graph.manifest.framework).toBe(templates[0].framework);
  });

  it("rejects an unknown template id", async () => {
    const res = await fetch(`${baseUrl}/api/templates/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId: "does-not-exist" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns suggested frameworks and stack", async () => {
    const frameworks = await (await fetch(`${baseUrl}/api/suggestions/frameworks?language=TypeScript`)).json();
    expect(frameworks.frameworks).toContain("Express");

    const stack = await (await fetch(`${baseUrl}/api/suggestions/stack?framework=NestJS`)).json();
    expect(stack).toEqual({ orm: "TypeORM", database: "PostgreSQL" });
  });

  it("imports a graph in merge mode via POST /api/import", async () => {
    const domain = await (
      await fetch(`${baseUrl}/api/nodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "domain", props: { name: "Auth" } }),
      })
    ).json();

    const res = await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodes: [{ ...domain, props: { name: "Auth2" } }], edges: [], mode: "merge" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ imported: true });

    const project = await (await fetch(`${baseUrl}/api/project`)).json();
    expect(project.nodes.find((n: { id: string }) => n.id === domain.id).props.name).toBe("Auth2");
  });

  it("rejects an import with an invalid mode", async () => {
    const res = await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodes: [], edges: [], mode: "bogus" }),
    });
    expect(res.status).toBe(400);
  });

  it("applies wizard answers", async () => {
    const res = await fetch(`${baseUrl}/api/wizard/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "TypeScript", framework: "Express", database: "PostgreSQL", architecture: "monolith", domains: ["Auth"] }),
    });
    expect(res.status).toBe(200);
    const graph = await res.json();
    expect(graph.manifest.framework).toBe("Express");
    expect(graph.nodes.some((n: { type: string }) => n.type === "domain")).toBe(true);
  });

  it("commits a batch of operations as a single transaction", async () => {
    const res = await fetch(`${baseUrl}/api/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operations: [
          { method: "createNode", args: ["domain", { name: "Auth" }] },
          { method: "createNode", args: ["route", { path: "/login" }] },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const { results } = await res.json();
    expect(results).toHaveLength(2);
  });

  it("rolls back the whole batch (and never persists) if one operation fails", async () => {
    const res = await fetch(`${baseUrl}/api/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operations: [
          { method: "createNode", args: ["domain", { name: "Auth" }] },
          { method: "createNode", args: ["endpoint", { name: "x", methods: ["GET"] }, "not-a-real-id"] },
        ],
      }),
    });
    expect(res.status).toBe(400);
    const project = await fetch(`${baseUrl}/api/project`).then((r) => r.json());
    expect(project.nodes).toHaveLength(0);
  });

  it("records history and supports undo/redo", async () => {
    const created = await fetch(`${baseUrl}/api/nodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "domain", props: { name: "Auth" } }),
    }).then((r) => r.json());

    const history = await fetch(`${baseUrl}/api/history`).then((r) => r.json());
    expect(history).toHaveLength(1);

    const undone = await fetch(`${baseUrl}/api/history/undo`, { method: "POST" });
    expect(undone.status).toBe(200);
    let node = await fetch(`${baseUrl}/api/nodes/${created.id}`);
    expect(node.status).toBe(404);

    const redone = await fetch(`${baseUrl}/api/history/redo`, { method: "POST" });
    expect(redone.status).toBe(200);
    node = await fetch(`${baseUrl}/api/nodes/${created.id}`);
    expect(node.status).toBe(200);
  });

  it("returns 400 when there is nothing to undo", async () => {
    const res = await fetch(`${baseUrl}/api/history/undo`, { method: "POST" });
    expect(res.status).toBe(400);
  });

  it("exposes read-only change impact analysis and planning", async () => {
    const domain = await fetch(`${baseUrl}/api/nodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "domain", props: { name: "Auth" } }),
    }).then((r) => r.json());
    await fetch(`${baseUrl}/api/nodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "route", props: { path: "/login" }, parentId: domain.id }),
    });

    const analysis = await fetch(`${baseUrl}/api/analyze-change`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeId: domain.id, changeType: "delete" }),
    }).then((r) => r.json());
    expect(analysis.wouldCascade).toBe(true);

    const plan = await fetch(`${baseUrl}/api/plan-change`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeId: domain.id, changeType: "delete" }),
    }).then((r) => r.json());
    expect(plan.summary).toContain("cascade");

    // read-only: the project must be unchanged after both calls
    const project = await fetch(`${baseUrl}/api/project`).then((r) => r.json());
    expect(project.nodes).toHaveLength(2);

    expect((await fetch(`${baseUrl}/api/analyze-change`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nodeId: "does-not-exist", changeType: "delete" }) })).status).toBe(404);
  });

  it("exposes conflict detection via record_sync / sync-status", async () => {
    const domain = await fetch(`${baseUrl}/api/nodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "domain", props: { name: "Auth" } }),
    }).then((r) => r.json());

    await fetch(`${baseUrl}/api/nodes/${domain.id}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceHash: "abc123", sourcePath: "src/domains/auth.ts" }),
    });

    const status = await fetch(`${baseUrl}/api/nodes/${domain.id}/sync-status?hash=abc123`).then((r) => r.json());
    expect(status.status).toBe("in_sync");

    const bulk = await fetch(`${baseUrl}/api/sync-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hashes: { [domain.id]: "different-hash" } }),
    }).then((r) => r.json());
    expect(bulk[domain.id]).toBe("code_changed");

    expect((await fetch(`${baseUrl}/api/nodes/does-not-exist/sync-status`)).status).toBe(404);
  });

  it("tags history entries with source: api for REST-driven mutations", async () => {
    await fetch(`${baseUrl}/api/nodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "domain", props: { name: "Auth" } }),
    });
    const history = await fetch(`${baseUrl}/api/history`).then((r) => r.json());
    expect(history[0].source).toBe("api");
  });

  it("exposes project health diagnostics separate from /api/validate", async () => {
    await fetch(`${baseUrl}/api/nodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "endpoint", props: { name: "x", methods: ["GET"] } }), // no parent, nothing refs it
    });
    const health = await fetch(`${baseUrl}/api/health`).then((r) => r.json());
    expect(health.warnings.some((i: { code: string }) => i.code === "ORPHAN_NODE")).toBe(true);
    expect(health.issues.length).toBe(health.errors.length + health.warnings.length + health.info.length);
  });

  it("exposes dependency analysis", async () => {
    const domain = await fetch(`${baseUrl}/api/nodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "domain", props: { name: "Auth" } }),
    }).then((r) => r.json());
    const route = await fetch(`${baseUrl}/api/nodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "route", props: { path: "/login" }, parentId: domain.id }),
    }).then((r) => r.json());

    const deps = await fetch(`${baseUrl}/api/nodes/${route.id}/dependencies`).then((r) => r.json());
    expect(deps).toContainEqual({ nodeId: domain.id, kind: "hierarchy-parent" });

    const dependents = await fetch(`${baseUrl}/api/nodes/${domain.id}/dependents`).then((r) => r.json());
    expect(dependents).toContainEqual({ nodeId: route.id, kind: "hierarchy-child" });

    const affected = await fetch(`${baseUrl}/api/nodes/${domain.id}/affected`).then((r) => r.json());
    expect(affected).toContainEqual({ nodeId: route.id, depth: 1, via: "hierarchy-child" });

    expect((await fetch(`${baseUrl}/api/nodes/does-not-exist/dependencies`)).status).toBe(404);
  });
});
