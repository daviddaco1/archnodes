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
  "get_dependencies",
  "get_dependents",
  "get_affected_nodes",
  "get_project_context",
  "validate_project",
  "analyze_change",
  "plan_change",
  "analyze_project",
  "search_graph",
  "analyze_health",
  "get_audit_log",
  "record_sync",
  "get_sync_status",
  "get_bulk_sync_status",
  "detect_conflicts",
  "create_node",
  "update_node",
  "set_position",
  "set_container",
  "delete_node",
  "connect_nodes",
  "delete_edge",
  "import_graph",
  "import_project",
  "export_markdown",
  "batch_operations",
  "undo",
  "redo",
  "list_history",
  "restore_version",
  "compare_versions",
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

  it("tags history entries with source: mcp for MCP-driven mutations", async () => {
    const server = createMcpServer(store);
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<{ content: { text: string }[] }> }> })._registeredTools;
    await tools.create_node.handler({ type: "domain", props: { name: "Auth" } }, {});
    expect(store.listHistory()[0].source).toBe("mcp");
  });

  it("record_sync / get_sync_status round-trip through the store", async () => {
    const server = createMcpServer(store);
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }> }> })._registeredTools;
    const domain = JSON.parse((await tools.create_node.handler({ type: "domain", props: { name: "Auth" } }, {})).content[0].text);

    const synced = await tools.record_sync.handler({ id: domain.id, sourceHash: "abc123" }, {});
    expect(synced.isError).toBeFalsy();

    const status = JSON.parse((await tools.get_sync_status.handler({ id: domain.id, currentHash: "abc123" }, {})).content[0].text);
    expect(status.status).toBe("in_sync");
  });

  it("a viewer-role MCP server rejects write tools but allows read tools", async () => {
    const server = createMcpServer(store, { role: "viewer" });
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }> }> })._registeredTools;

    const created = await tools.create_node.handler({ type: "domain", props: { name: "Auth" } }, {});
    expect(created.isError).toBe(true);
    expect(created.content[0].text).toMatch(/cannot perform write operations/);

    const validated = await tools.validate_project.handler({}, {});
    expect(validated.isError).toBeFalsy();
  });

  it("audits every tool call, success and failure alike", async () => {
    const server = createMcpServer(store);
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }> }> })._registeredTools;

    await tools.create_node.handler({ type: "domain", props: { name: "Auth" } }, {});
    await tools.get_node.handler({ id: "does-not-exist" }, {});

    const log = store.listAuditLog();
    expect(log.some((e) => e.operation === "create_node" && e.result === "SUCCESS")).toBe(true);
    expect(log.some((e) => e.operation === "get_node" && e.result === "FAILURE")).toBe(true);
  });

  it("get_node returns a proper error (not a stringified undefined) for a missing id", async () => {
    const server = createMcpServer(store);
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }> }> })._registeredTools;
    const result = await tools.get_node.handler({ id: "does-not-exist" }, {});
    expect(result.isError).toBe(true);
    expect(typeof result.content[0].text).toBe("string");
    expect(result.content[0].text).not.toBe("undefined");
  });
});
