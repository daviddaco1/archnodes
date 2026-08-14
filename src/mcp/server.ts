import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { BatchOp, ProjectStore } from "../store/project-store.js";
import { ValidationError } from "../validation/rules.js";
import { buildSchemaResponse } from "../schema.js";
import { exportMarkdown } from "../export/markdown.js";
import type { EdgeType, NodeType, ProjectScope } from "../types/graph.js";
import { getAffectedNodes, getDependencies, getDependents } from "../analysis/dependencies.js";
import { analyzeChange, planChange } from "../analysis/change.js";

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(err: unknown) {
  if (err instanceof ValidationError) {
    return { content: [{ type: "text" as const, text: JSON.stringify({ issues: err.issues }, null, 2) }], isError: true };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function tryResult<T>(fn: () => T) {
  try {
    return textResult(fn());
  } catch (err) {
    return errorResult(err);
  }
}

const scopeSchema = z.enum(["backend", "frontend", "all"]).optional();
const edgeTypeSchema = z.enum(["hierarchy", "invalidates"]).optional();
const batchMutatorMethodSchema = z.enum([
  "createNode",
  "updateNode",
  "setPosition",
  "setContainer",
  "deleteNode",
  "connectNodes",
  "deleteEdge",
  "importGraph",
  "updateManifest",
]);
const batchOpSchema = z.object({ method: batchMutatorMethodSchema, args: z.array(z.unknown()) });

export function createMcpServer(store: ProjectStore): McpServer {
  const server = new McpServer({ name: "project-visualizer", version: "0.1.0" });

  server.registerTool(
    "get_schema",
    { description: "Get node hierarchy rules, required fields, and ref field specs" },
    async () => tryResult(() => buildSchemaResponse()),
  );

  server.registerTool(
    "get_project",
    { description: "Get the full project graph, optionally filtered by scope", inputSchema: { scope: scopeSchema } },
    async ({ scope }) => tryResult(() => store.getProject(scope as ProjectScope | undefined)),
  );

  server.registerTool(
    "list_nodes",
    {
      description: "List nodes, optionally filtered by type and prop filters",
      inputSchema: { type: z.string().optional(), filters: z.record(z.unknown()).optional() },
    },
    async ({ type, filters }) => tryResult(() => store.listNodes(type as NodeType | undefined, filters)),
  );

  server.registerTool(
    "get_node",
    {
      description: "Get a single node by id",
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      tryResult(() => {
        const node = store.getNode(id);
        if (!node) throw new ValidationError([{ level: "error", code: "BROKEN_REF", nodeId: id, message: `Node ${id} not found` }]);
        return node;
      }),
  );

  server.registerTool(
    "get_dependencies",
    {
      description: "What a node points at: its hierarchy parent, its ref fields, and what it invalidates",
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      tryResult(() => {
        if (!store.getNode(id)) throw new ValidationError([{ level: "error", code: "BROKEN_REF", nodeId: id, message: `Node ${id} not found` }]);
        return getDependencies(id, store.getProject("all"));
      }),
  );

  server.registerTool(
    "get_dependents",
    {
      description: "What points at a node: its hierarchy children, what invalidates it, and ref fields referencing it",
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      tryResult(() => {
        if (!store.getNode(id)) throw new ValidationError([{ level: "error", code: "BROKEN_REF", nodeId: id, message: `Node ${id} not found` }]);
        return getDependents(id, store.getProject("all"));
      }),
  );

  server.registerTool(
    "get_affected_nodes",
    {
      description: "Transitive closure of get_dependents — everything that would need a second look if this node changed or disappeared",
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      tryResult(() => {
        if (!store.getNode(id)) throw new ValidationError([{ level: "error", code: "BROKEN_REF", nodeId: id, message: `Node ${id} not found` }]);
        return getAffectedNodes(id, store.getProject("all"));
      }),
  );

  server.registerTool(
    "validate_project",
    { description: "Validate the project graph and return issues" },
    async () => tryResult(() => store.validateProject()),
  );

  server.registerTool(
    "create_node",
    {
      description: "Create a node",
      inputSchema: { type: z.string(), props: z.record(z.unknown()), parentId: z.string().optional() },
    },
    async ({ type, props, parentId }) => tryResult(() => store.createNode(type as NodeType, props, parentId, { source: "mcp" })),
  );

  server.registerTool(
    "update_node",
    {
      description: "Update a node's props",
      inputSchema: { id: z.string(), props: z.record(z.unknown()) },
    },
    async ({ id, props }) => tryResult(() => store.updateNode(id, props, { source: "mcp" })),
  );

  server.registerTool(
    "set_position",
    {
      description: "Move a node on the canvas",
      inputSchema: { id: z.string(), position: z.object({ x: z.number(), y: z.number() }) },
    },
    async ({ id, position }) => tryResult(() => store.setPosition(id, position, { source: "mcp" })),
  );

  server.registerTool(
    "set_container",
    {
      description: "Set or clear a node's visual container grouping (not a hierarchy edge)",
      inputSchema: { id: z.string(), containerId: z.string().optional() },
    },
    async ({ id, containerId }) => tryResult(() => store.setContainer(id, containerId, { source: "mcp" })),
  );

  server.registerTool(
    "delete_node",
    {
      description: "Delete a node, optionally cascading to its hierarchy children",
      inputSchema: { id: z.string(), cascade: z.boolean().optional() },
    },
    async ({ id, cascade }) => tryResult(() => store.deleteNode(id, cascade, { source: "mcp" })),
  );

  server.registerTool(
    "connect_nodes",
    {
      description: "Connect two nodes with a hierarchy or invalidates edge",
      inputSchema: { sourceId: z.string(), targetId: z.string(), edgeType: edgeTypeSchema },
    },
    async ({ sourceId, targetId, edgeType }) =>
      tryResult(() => store.connectNodes(sourceId, targetId, edgeType as EdgeType | undefined, { source: "mcp" })),
  );

  server.registerTool(
    "delete_edge",
    {
      description: "Delete an edge by id",
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      tryResult(() => {
        store.deleteEdge(id, { source: "mcp" });
        return { deleted: true };
      }),
  );

  server.registerTool(
    "import_graph",
    {
      description: "Bulk import nodes and edges",
      inputSchema: {
        nodes: z.array(z.record(z.unknown())),
        edges: z.array(z.record(z.unknown())),
        mode: z.enum(["merge", "replace"]),
      },
    },
    async ({ nodes, edges, mode }) =>
      tryResult(() => {
        store.importGraph(nodes as never, edges as never, mode, { source: "import" });
        return { imported: true };
      }),
  );

  server.registerTool(
    "batch_operations",
    {
      description:
        "Run a sequence of mutating operations as a single transaction: all commit together, or " +
        "none do if any operation fails (the graph is rolled back and no partial write happens).",
      inputSchema: { operations: z.array(batchOpSchema) },
    },
    async ({ operations }) => tryResult(() => store.applyBatch(operations as BatchOp[], { source: "mcp" })),
  );

  server.registerTool(
    "analyze_change",
    {
      description:
        "Read-only impact analysis for a proposed delete or modify: dependents, transitively affected " +
        "nodes, and (for modify) what new validation issues the patch would introduce. Never mutates the project.",
      inputSchema: {
        nodeId: z.string(),
        changeType: z.enum(["delete", "modify"]),
        propsPatch: z.record(z.unknown()).optional(),
      },
    },
    async ({ nodeId, changeType, propsPatch }) => tryResult(() => analyzeChange(store, nodeId, changeType, { propsPatch })),
  );

  server.registerTool(
    "plan_change",
    {
      description:
        "Builds on analyze_change: a structured, human-readable plan of graph operations for a proposed " +
        "delete or modify, without executing anything.",
      inputSchema: {
        nodeId: z.string(),
        changeType: z.enum(["delete", "modify"]),
        propsPatch: z.record(z.unknown()).optional(),
      },
    },
    async ({ nodeId, changeType, propsPatch }) => tryResult(() => planChange(store, nodeId, changeType, { propsPatch })),
  );

  server.registerTool(
    "analyze_health",
    { description: "Structural validation plus quality diagnostics (orphan nodes, unused nodes, ref-field cycles) — never write-blocking" },
    async () => tryResult(() => store.checkHealth()),
  );

  server.registerTool(
    "record_sync",
    {
      description:
        "Stamp a node with the hash of the source file an agent just synced against, so future " +
        "get_sync_status calls can tell in_sync from code_changed/graph_changed/conflict.",
      inputSchema: { id: z.string(), sourceHash: z.string().optional(), sourcePath: z.string().optional() },
    },
    async ({ id, sourceHash, sourcePath }) => tryResult(() => store.recordSync(id, { sourceHash, sourcePath }, { source: "sync" })),
  );

  server.registerTool(
    "get_sync_status",
    {
      description: "Compare a node's recorded source hash against a freshly computed one: in_sync | code_changed | graph_changed | conflict | unknown",
      inputSchema: { id: z.string(), currentHash: z.string().optional() },
    },
    async ({ id, currentHash }) =>
      tryResult(() => {
        if (!store.getNode(id)) throw new ValidationError([{ level: "error", code: "BROKEN_REF", nodeId: id, message: `Node ${id} not found` }]);
        return { status: store.getSyncStatus(id, currentHash) };
      }),
  );

  server.registerTool(
    "get_bulk_sync_status",
    {
      description: "Same as get_sync_status, for every node in the project at once — one call for a full-project sync check",
      inputSchema: { hashes: z.record(z.string()) },
    },
    async ({ hashes }) => tryResult(() => store.getBulkSyncStatus(hashes)),
  );

  server.registerTool(
    "undo",
    { description: "Revert the most recently committed history entry" },
    async () => tryResult(() => store.undo()),
  );

  server.registerTool(
    "redo",
    { description: "Re-apply the most recently undone history entry" },
    async () => tryResult(() => store.redo()),
  );

  server.registerTool(
    "list_history",
    {
      description: "List recorded history entries, optionally limited or filtered to before a timestamp",
      inputSchema: { limit: z.number().optional(), before: z.string().optional() },
    },
    async ({ limit, before }) => tryResult(() => store.listHistory({ limit, before })),
  );

  server.registerTool(
    "restore_version",
    {
      description: "Move the graph to the state right after the given history entry was originally applied",
      inputSchema: { entryId: z.string() },
    },
    async ({ entryId }) => tryResult(() => store.restoreVersion(entryId)),
  );

  server.registerTool(
    "compare_versions",
    {
      description: "Diff the graph state at two points in the history timeline, without changing the live graph",
      inputSchema: { entryIdA: z.string(), entryIdB: z.string() },
    },
    async ({ entryIdA, entryIdB }) => tryResult(() => store.compareVersions(entryIdA, entryIdB)),
  );

  server.registerTool(
    "export_markdown",
    {
      description: "Export the project as a markdown context document",
      inputSchema: { scope: scopeSchema, domainId: z.string().optional() },
    },
    async ({ scope, domainId }) =>
      tryResult(() =>
        exportMarkdown(store.getProject(scope as ProjectScope | undefined), store.validateProject(), domainId),
      ),
  );

  return server;
}

export async function startMcpServer(store: ProjectStore): Promise<void> {
  const server = createMcpServer(store);
  await server.connect(new StdioServerTransport());
}
