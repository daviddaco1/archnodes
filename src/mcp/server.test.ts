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
  "delete_node",
  "connect_nodes",
  "import_graph",
  "export_markdown",
];

describe("createMcpServer", () => {
  it("registers exactly the 11 documented tools", () => {
    const server = createMcpServer(store);
    // _registeredTools is a private implementation detail of the SDK's McpServer,
    // but there's no public introspection API — this is the only way to assert wiring.
    const registered = Object.keys((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools);
    expect(registered.sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("get_schema returns the hierarchy rules", async () => {
    const server = createMcpServer(store);
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<{ content: { text: string }[] }> }> })._registeredTools;
    const result = await tools.get_schema.handler({}, {});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.hierarchyRules.domain).toContain("route");
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
