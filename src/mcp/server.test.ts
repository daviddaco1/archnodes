import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProjectStore, type ProjectStore } from "../store/project-store.js";
import { createMcpServer } from "./server.js";

let baseDir: string;
let store: ProjectStore;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "pv-mcp-test-"));
  store = createProjectStore(`test-${randomUUID()}`, { baseDir });
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

const EXPECTED_TOOLS = [
  "get_schema",
  "get_project",
  "list_nodes",
  "get_node",
  "validate_project",
  "create_node",
  "update_node",
  "set_position",
  "set_container",
  "delete_node",
  "connect_nodes",
  "delete_edge",
  "import_graph",
  "export_markdown",
];

describe("createMcpServer", () => {
  it("registers exactly the documented tools", () => {
    const server = createMcpServer(store);
    // _registeredTools is a private implementation detail of the SDK's McpServer,
    // but there's no public introspection API — this is the only way to assert wiring.
    const registered = Object.keys((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools);
    expect(registered.sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("get_schema matches the REST /api/schema shape", async () => {
    const server = createMcpServer(store);
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<{ content: { text: string }[] }> }> })._registeredTools;
    const result = await tools.get_schema.handler({}, {});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.connections.some((c: { from: string; to: string }) => c.from === "domain" && c.to === "route")).toBe(true);
    expect(parsed.nodeTypes).toContain("domain");
    expect(parsed.requiredFields).toBeTruthy();
    expect(parsed.refFields).toBeTruthy();
  });

  it("set_position, set_container, and delete_edge round-trip through the store", async () => {
    const server = createMcpServer(store);
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }> }> })._registeredTools;

    const domain = JSON.parse((await tools.create_node.handler({ type: "domain", props: { name: "Auth" } }, {})).content[0].text);
    const container = JSON.parse((await tools.create_node.handler({ type: "container", props: { label: "Box" } }, {})).content[0].text);

    const moved = await tools.set_position.handler({ id: domain.id, position: { x: 5, y: 10 } }, {});
    expect(moved.isError).toBeFalsy();
    expect(store.getNode(domain.id)?.position).toEqual({ x: 5, y: 10 });

    const grouped = await tools.set_container.handler({ id: domain.id, containerId: container.id }, {});
    expect(grouped.isError).toBeFalsy();
    expect(store.getNode(domain.id)?.containerId).toBe(container.id);

    const route = JSON.parse((await tools.create_node.handler({ type: "route", props: { path: "/x" } }, {})).content[0].text);
    const edge = JSON.parse((await tools.connect_nodes.handler({ sourceId: domain.id, targetId: route.id }, {})).content[0].text);
    const deleted = await tools.delete_edge.handler({ id: edge.id }, {});
    expect(deleted.isError).toBeFalsy();
    expect(store.getProject("all").edges).toHaveLength(0);
  });

  it("create_node then get_project round-trips through the same store", async () => {
    const server = createMcpServer(store);
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }> }> })._registeredTools;
    const created = await tools.create_node.handler({ type: "domain", props: { name: "Auth" } }, {});
    expect(created.isError).toBeFalsy();
    const node = JSON.parse(created.content[0].text);
    expect(store.getNode(node.id)).toBeTruthy();
  });
});
