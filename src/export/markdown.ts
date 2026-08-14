import {
  BACKEND_NODE_TYPES,
  type AnyGraphNode,
  type ApiCallProps,
  type EndpointProps,
  type FormProps,
  type GraphEdge,
  type MiddlewareProps,
  type ModelField,
  type NavigationRouterProps,
  type OperationProps,
  type PageProps,
  type ProjectGraph,
  type ReturnSpec,
  type RouteProps,
  type ServiceProps,
  type WebSocketEmitProps,
  type WebSocketEventProps,
} from "../types/graph.js";

const BACKEND_TYPE_SET = new Set<string>(BACKEND_NODE_TYPES);
import { validateProjectGraph, type ValidationIssue, type ValidationResult } from "../validation/rules.js";

// ---- graph traversal helpers ----

function hierarchyChildren(nodeId: string, edges: GraphEdge[], nodesById: Map<string, AnyGraphNode>): AnyGraphNode[] {
  return edges
    .filter((e) => e.edgeType === "hierarchy" && e.source === nodeId)
    .map((e) => nodesById.get(e.target))
    .filter((n): n is AnyGraphNode => Boolean(n));
}

// The store rejects hierarchy cycles at write time, but this guards data written before that
// check existed (or edited by hand) — without it a cycle would hang export forever.
function collectDescendants(nodeId: string, edges: GraphEdge[], nodesById: Map<string, AnyGraphNode>): AnyGraphNode[] {
  const result: AnyGraphNode[] = [];
  const visited = new Set<string>([nodeId]);
  const stack = [...hierarchyChildren(nodeId, edges, nodesById)];
  while (stack.length > 0) {
    const node = stack.shift()!;
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    result.push(node);
    stack.push(...hierarchyChildren(node.id, edges, nodesById));
  }
  return result;
}

function computeFullPath(node: AnyGraphNode, nodesById: Map<string, AnyGraphNode>): string {
  const segments: string[] = [];
  const visited = new Set<string>([node.id]);
  let current = node.parentId ? nodesById.get(node.parentId) : undefined;
  while (current && current.type === "route" && !visited.has(current.id)) {
    visited.add(current.id);
    const path = (current.props as RouteProps).path;
    if (path) segments.unshift(path);
    current = current.parentId ? nodesById.get(current.parentId) : undefined;
  }
  return segments.join("").replace(/\/{2,}/g, "/") || "/";
}

interface ResolvedChain {
  middlewares: AnyGraphNode[];
  service?: AnyGraphNode;
}

function resolveChain(endpointId: string, edges: GraphEdge[], nodesById: Map<string, AnyGraphNode>): ResolvedChain {
  const middlewares: AnyGraphNode[] = [];
  let service: AnyGraphNode | undefined;
  let currentId = endpointId;

  // safety bound: a real graph can't have more hierarchy hops than total nodes
  for (let i = 0; i < nodesById.size; i++) {
    const children = hierarchyChildren(currentId, edges, nodesById);
    const middleware = children.find((c) => c.type === "middleware");
    const svc = children.find((c) => c.type === "service");
    // A service sibling next to a middleware is still recorded — the middleware descent below
    // doesn't get to silently drop it just because it's not the branch we're walking into.
    if (svc && !service) service = svc;
    if (middleware) {
      middlewares.push(middleware);
      currentId = middleware.id;
      continue;
    }
    break;
  }
  return { middlewares, service };
}

// ---- manifest ----

function renderManifest(graph: ProjectGraph): string {
  const { manifest, nodes } = graph;
  const domains = nodes.filter((n) => n.type === "domain").length;
  const lines = [
    `# Project Context: ${manifest.projectName}`,
    "",
    "## Manifest",
    `- Language: ${manifest.language ?? "_unset_"}`,
    `- Framework: ${manifest.framework ?? "_unset_"}`,
    `- Architecture: ${manifest.architecture ?? "_unset_"}`,
    `- Databases: ${manifest.databases?.join(", ") || "_unset_"}`,
    `- Domains: ${domains}`,
    `- Generated: ${new Date().toISOString()}`,
    "",
  ];
  return lines.join("\n");
}

// ---- backend: domain -> route -> endpoint ----

function renderReturnsTable(rows: { status: string | number; source: string; description: string }[]): string {
  if (rows.length === 0) return "";
  const header = "| Status | Source | Description |\n|---|---|---|\n";
  const body = rows.map((r) => `| ${r.status} | ${r.source} | ${r.description || "-"} |`).join("\n");
  return `**Returns (aggregated)**\n\n${header}${body}\n\n`;
}

function renderParamTable(title: string, fields: ModelField[] | undefined): string {
  if (!fields || fields.length === 0) return "";
  const header = "| Name | Type | Required |\n|---|---|---|\n";
  const body = fields.map((f) => `| ${f.name} | ${f.type} | ${f.required ? "yes" : "no"} |`).join("\n");
  return `**${title}**\n\n${header}${body}\n\n`;
}

interface ReturnRow {
  status: string | number;
  source: string;
  description: string;
}

// Shared by the endpoint's own (implicit) chain and by each explicit operation child — walks
// middleware/service starting at `startId` and renders the chain + aggregated returns table.
function renderChain(
  startId: string,
  ownReturns: ReturnSpec[] | undefined,
  sourceLabel: string,
  edges: GraphEdge[],
  nodesById: Map<string, AnyGraphNode>,
): string {
  const parts: string[] = [];
  const { middlewares, service } = resolveChain(startId, edges, nodesById);

  if (middlewares.length > 0) {
    parts.push("**Middleware chain**", "");
    middlewares.forEach((mw, i) => {
      const mwProps = mw.props as MiddlewareProps;
      const returns = mwProps.returns?.map((r) => `${r.status}${r.description ? `: ${r.description}` : ""}`).join(", ");
      parts.push(`${i + 1}. \`${mwProps.name}\`${returns ? ` — returns: ${returns}` : ""}`);
    });
    parts.push("");
  }

  if (service) {
    const svcProps = service.props as ServiceProps;
    parts.push("**Service**", "", `- ${svcProps.name}${svcProps.description ? ` — ${svcProps.description}` : ""}`, "");
  }

  const returnRows: ReturnRow[] = [];
  for (const r of ownReturns ?? [])
    returnRows.push({ status: r.status, source: sourceLabel, description: `${r.description ?? ""}${r.chainToId ? ` → chains to \`${r.chainToId}\`` : ""}`.trim() });
  for (const mw of middlewares) {
    const mwProps = mw.props as MiddlewareProps;
    for (const r of mwProps.returns ?? [])
      returnRows.push({
        status: r.status,
        source: `middleware:${mwProps.name}`,
        description: `${r.description ?? ""}${r.chainToId ? ` → chains to \`${r.chainToId}\`` : ""}`.trim(),
      });
  }
  if (service) {
    const svcProps = service.props as ServiceProps;
    for (const r of svcProps.errors ?? []) returnRows.push({ status: r.status, source: `service:${svcProps.name}`, description: r.description ?? "" });
  }
  parts.push(renderReturnsTable(returnRows));

  return parts.join("\n");
}

function renderOperation(node: AnyGraphNode, edges: GraphEdge[], nodesById: Map<string, AnyGraphNode>): string {
  const props = node.props as OperationProps;
  const parts: string[] = [`**Operation: ${props.method}** (\`${node.id}\`)`, ""];
  if (props.description) parts.push(props.description, "");
  parts.push(renderParamTable("Query", props.query));
  parts.push(renderParamTable("Path params", props.params));
  parts.push(renderParamTable("Body", props.body));
  parts.push(renderChain(node.id, props.returns, "operation", edges, nodesById));
  return parts.join("\n") + "\n";
}

function renderEndpoint(node: AnyGraphNode, headerLevel: number, edges: GraphEdge[], nodesById: Map<string, AnyGraphNode>): string {
  const props = node.props as EndpointProps;
  const fullPath = computeFullPath(node, nodesById);
  const hashes = "#".repeat(headerLevel);
  const methods = (props.methods ?? []).join("/") || "?";
  const parts: string[] = [`${hashes} Endpoint: ${methods} ${fullPath} (\`${node.id}\`)`, ""];

  if (props.description) parts.push(props.description, "");
  parts.push(
    props.isPublic === true
      ? "**Acceso**: Pública"
      : `**Acceso**: Privada — ${props.authMethods && props.authMethods.length > 0 ? props.authMethods.join(", ") : "(sin método de seguridad definido)"}`,
    "",
  );
  parts.push(renderParamTable("Headers", props.headers));

  const operations = hierarchyChildren(node.id, edges, nodesById).filter((c) => c.type === "operation");
  // An endpoint with operation children delegates its middleware/service chain rendering to
  // each operation's own chain — rendering it here too would show the same chain twice.
  if (operations.length === 0) parts.push(renderChain(node.id, undefined, "endpoint", edges, nodesById));

  if (props.cacheable?.enabled) {
    parts.push(
      "**Cache**",
      "",
      `- Key pattern: \`${props.cacheable.keyPattern ?? ""}\``,
      `- TTL: ${props.cacheable.ttl ?? "-"}`,
      `- Invalidation: ${props.cacheable.invalidation ?? "-"}`,
      `- Invalidated by: ${props.cacheable.invalidatedBy?.join(", ") || "-"}`,
      "",
    );
  }

  for (const op of operations) parts.push(renderOperation(op, edges, nodesById));

  return parts.join("\n") + "\n";
}

function renderRoute(
  node: AnyGraphNode,
  headerLevel: number,
  edges: GraphEdge[],
  nodesById: Map<string, AnyGraphNode>,
  visited: Set<string> = new Set(),
): string {
  const props = node.props as RouteProps;
  const hashes = "#".repeat(headerLevel);
  const parts: string[] = [`${hashes} Route: ${props.path ?? ""} (\`${node.id}\`)`, ""];
  if (props.description) parts.push(props.description, "");
  if (visited.has(node.id)) return parts.join("\n");
  visited.add(node.id);

  for (const child of hierarchyChildren(node.id, edges, nodesById)) {
    if (child.type === "route") parts.push(renderRoute(child, headerLevel + 1, edges, nodesById, visited));
    if (child.type === "endpoint") parts.push(renderEndpoint(child, headerLevel + 1, edges, nodesById));
  }
  return parts.join("\n");
}

function renderDomain(node: AnyGraphNode, edges: GraphEdge[], nodesById: Map<string, AnyGraphNode>): string {
  const props = node.props as { name: string; domain?: string; ipPort?: string; description?: string };
  const parts: string[] = [`### Domain: ${props.name} (\`${node.id}\`)`, ""];
  if (props.domain) parts.push(`- Domain: \`${props.domain}\``);
  if (props.ipPort) parts.push(`- IP:Port: \`${props.ipPort}\``);
  if (props.description) parts.push("", props.description);
  parts.push("");

  for (const child of hierarchyChildren(node.id, edges, nodesById)) {
    if (child.type === "subdomain") {
      const subProps = child.props as { name: string; subdomain?: string };
      const fullHost = subProps.subdomain && props.domain ? ` — \`${subProps.subdomain}.${props.domain}\`` : "";
      parts.push(`#### Subdomain: ${subProps.name}${fullHost} (\`${child.id}\`)`, "");
      for (const grandchild of hierarchyChildren(child.id, edges, nodesById)) {
        if (grandchild.type === "route") parts.push(renderRoute(grandchild, 5, edges, nodesById));
      }
    }
    if (child.type === "route") parts.push(renderRoute(child, 4, edges, nodesById));
  }
  return parts.join("\n");
}

// ---- backend: floating infra sections ----

function renderList(title: string, items: string[]): string {
  if (items.length === 0) return "";
  return `### ${title}\n\n${items.map((i) => `- ${i}`).join("\n")}\n\n`;
}

function renderWebsockets(nodes: AnyGraphNode[], edges: GraphEdge[], nodesById: Map<string, AnyGraphNode>): string {
  const sockets = nodes.filter((n) => n.type === "websocket");
  if (sockets.length === 0) return "";
  const parts: string[] = ["### WebSockets", ""];
  for (const socket of sockets) {
    const socketProps = socket.props as { name: string; namespace?: string };
    parts.push(`- ${socketProps.name}${socketProps.namespace ? ` (\`${socketProps.namespace}\`)` : ""} (\`${socket.id}\`)`);
    for (const event of hierarchyChildren(socket.id, edges, nodesById)) {
      if (event.type !== "websocketEvent") continue;
      const eventProps = event.props as WebSocketEventProps;
      parts.push(`  - on \`${eventProps.event}\` (\`${event.id}\`)`);
      for (const emit of hierarchyChildren(event.id, edges, nodesById)) {
        if (emit.type !== "websocketEmit") continue;
        const emitProps = emit.props as WebSocketEmitProps;
        const target =
          emitProps.target === "room" ? `room via \`${emitProps.roomParam ?? "?"}\`` : emitProps.target === "broadcast" ? "all clients" : "sender";
        parts.push(`    - emits \`${emitProps.event}\` → ${target} (\`${emit.id}\`)`);
      }
    }
  }
  parts.push("");
  return parts.join("\n");
}

function renderInfraSections(nodes: AnyGraphNode[], edges: GraphEdge[], nodesById: Map<string, AnyGraphNode>): string {
  const models = nodes.filter((n) => n.type === "model").map((n) => `${(n.props as { name: string }).name} (\`${n.id}\`)`);
  const tables = nodes.filter((n) => n.type === "table").map((n) => `${(n.props as { name: string }).name} (\`${n.id}\`)`);
  const tools = nodes
    .filter((n) => n.type === "tool" || n.type === "queue" || n.type === "scheduler" || n.type === "errorHandler" || n.type === "envConfig")
    .map((n) => `${n.type}: ${(n.props as { name?: string }).name ?? n.label} (\`${n.id}\`)`);
  const externalApis = nodes.filter((n) => n.type === "externalApi").map((n) => `${(n.props as { name: string; baseUrl: string }).name} — ${(n.props as { baseUrl: string }).baseUrl} (\`${n.id}\`)`);
  const emails = nodes.filter((n) => n.type === "email").map((n) => `${(n.props as { trigger: string }).trigger} (\`${n.id}\`)`);

  return [
    renderList("Models", models),
    renderList("Tables", tables),
    renderList("Tools & Infra", tools),
    renderWebsockets(nodes, edges, nodesById),
    renderList("External APIs", externalApis),
    renderList("Emails", emails),
  ].join("");
}

// ---- frontend ----

function renderFrontend(nodes: AnyGraphNode[], edges: GraphEdge[], nodesById: Map<string, AnyGraphNode>): string {
  const parts: string[] = ["## Frontend", ""];

  const navRouters = nodes.filter((n) => n.type === "navigationRouter");
  if (navRouters.length > 0) {
    parts.push("### Navigation", "");
    for (const nav of navRouters) {
      const props = nav.props as NavigationRouterProps;
      parts.push(`- Library: ${props.library}`);
      for (const route of props.routes ?? []) {
        const page = nodesById.get(route.pageId);
        parts.push(`  - ${route.path ?? "/"} → ${page ? (page.props as PageProps).name : route.pageId}`);
      }
    }
    parts.push("");
  }

  const pages = nodes.filter((n) => n.type === "page");
  for (const page of pages) {
    const props = page.props as PageProps;
    parts.push(`### Page: ${props.name} (\`${page.id}\`)`, "");
    const descendants = collectDescendants(page.id, edges, nodesById);

    const components = descendants.filter((n) => n.type === "component");
    if (components.length > 0) {
      parts.push(
        "**Components**",
        "",
        ...components.map((c) => `- ${(c.props as { name: string }).name} (\`${c.id}\`)`),
        "",
      );
    }

    const apiCalls = descendants.filter((n) => n.type === "apiCall");
    if (apiCalls.length > 0) {
      parts.push(
        "**API Calls**",
        "",
        ...apiCalls.map((a) => {
          const apiProps = a.props as ApiCallProps;
          return `- ${apiProps.name} → consumes \`${apiProps.endpointRef}\``;
        }),
        "",
      );
    }

    const forms = descendants.filter((n) => n.type === "form");
    if (forms.length > 0) {
      parts.push(
        "**Forms**",
        "",
        ...forms.map((f) => {
          const formProps = f.props as FormProps;
          return `- ${formProps.name}${formProps.modelRef ? ` → modelRef \`${formProps.modelRef}\`` : ""}`;
        }),
        "",
      );
    }
  }

  const stores = nodes.filter((n) => n.type === "stateStore");
  if (stores.length > 0) {
    parts.push("### Stores", "", ...stores.map((s) => `- ${(s.props as { name: string; library: string }).name} (${(s.props as { library: string }).library})`), "");
  }

  return parts.join("\n");
}

// ---- validation warnings ----

const CODE_LABELS: Record<ValidationIssue["code"], string> = {
  BROKEN_REF: "BROKEN REF",
  MISSING_FIELD: "MISSING FIELD",
  INVALID_HIERARCHY: "INVALID HIERARCHY",
  INVALID_REF_TYPE: "INVALID REF TYPE",
  INVALID_EDGE: "INVALID EDGE",
  INVALID_OPERATION_METHOD: "INVALID OPERATION METHOD",
  DUPLICATE_OPERATION_METHOD: "DUPLICATE OPERATION METHOD",
  CYCLE_DETECTED: "CYCLE DETECTED",
  INVALID_BATCH_OPERATION: "INVALID BATCH OPERATION",
  ORPHAN_NODE: "ORPHAN NODE",
  UNUSED_NODE: "UNUSED NODE",
  REF_CYCLE: "REF CYCLE",
};

function renderValidationWarnings(validation: ValidationResult): string {
  if (validation.issues.length === 0) return "## Validation Warnings\n\n_(none)_\n";
  const lines = validation.issues.map((issue) => `- [${CODE_LABELS[issue.code]}] ${issue.message}`);
  return `## Validation Warnings\n\n${lines.join("\n")}\n`;
}

// ---- entry point ----

export function exportMarkdown(graph: ProjectGraph, validation?: ValidationResult, domainId?: string): string {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const resolvedValidation = validation ?? validateProjectGraph(graph);

  const parts: string[] = [renderManifest(graph)];

  const domains = graph.nodes.filter((n) => n.type === "domain" && (!domainId || n.id === domainId));
  const hasBackend = domains.length > 0 || graph.nodes.some((n) => BACKEND_TYPE_SET.has(n.type));
  if (hasBackend) {
    parts.push("## Backend", "");
    for (const domain of domains) parts.push(renderDomain(domain, graph.edges, nodesById));

    let infraNodes = graph.nodes;
    if (domainId) {
      const scopedIds = new Set(domains.map((d) => d.id));
      for (const domain of domains) {
        for (const descendant of collectDescendants(domain.id, graph.edges, nodesById)) scopedIds.add(descendant.id);
      }
      infraNodes = graph.nodes.filter((n) => scopedIds.has(n.id));
    }
    parts.push(renderInfraSections(infraNodes, graph.edges, nodesById));
  }

  const hasFrontend = graph.nodes.some((n) => n.type === "page" || n.type === "navigationRouter" || n.type === "stateStore");
  if (hasFrontend) parts.push(renderFrontend(graph.nodes, graph.edges, nodesById));

  parts.push(renderValidationWarnings(resolvedValidation));

  return parts.join("\n");
}
