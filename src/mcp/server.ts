import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { ProjectStore } from "../store/project-store.js";
import { ValidationError, HIERARCHY_RULES, REQUIRED_FIELDS, REF_FIELDS, SPECIAL_EDGES } from "../validation/rules.js";
import { exportMarkdown } from "../export/markdown.js";
import type { EdgeType, NodeType, ProjectScope } from "../types/graph.js";

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

export function createMcpServer(store: ProjectStore): McpServer {
  const server = new McpServer({ name: "project-visualizer", version: "0.1.0" });

  server.registerTool(
    "get_schema",
    { description: "Get node hierarchy rules, required fields, and ref field specs" },
    async () =>
      tryResult(() => ({
        hierarchyRules: HIERARCHY_RULES,
        requiredFields: REQUIRED_FIELDS,
        refFields: REF_FIELDS,
        specialEdges: SPECIAL_EDGES,
      })),
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
      inputSchema: { id: z.string(), resolveRefs: z.boolean().optional() },
    },
    async ({ id }) => tryResult(() => store.getNode(id)),
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
    async ({ type, props, parentId }) => tryResult(() => store.createNode(type as NodeType, props, parentId)),
  );

  server.registerTool(
    "update_node",
    {
      description: "Update a node's props",
      inputSchema: { id: z.string(), props: z.record(z.unknown()) },
    },
    async ({ id, props }) => tryResult(() => store.updateNode(id, props)),
  );

  server.registerTool(
    "delete_node",
    {
      description: "Delete a node, optionally cascading to its hierarchy children",
      inputSchema: { id: z.string(), cascade: z.boolean().optional() },
    },
    async ({ id, cascade }) => tryResult(() => store.deleteNode(id, cascade)),
  );

  server.registerTool(
    "connect_nodes",
    {
      description: "Connect two nodes with a hierarchy or invalidates edge",
      inputSchema: { sourceId: z.string(), targetId: z.string(), edgeType: edgeTypeSchema },
    },
    async ({ sourceId, targetId, edgeType }) =>
      tryResult(() => store.connectNodes(sourceId, targetId, edgeType as EdgeType | undefined)),
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
        store.importGraph(nodes as never, edges as never, mode);
        return { imported: true };
      }),
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
