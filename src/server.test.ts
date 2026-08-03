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
});
