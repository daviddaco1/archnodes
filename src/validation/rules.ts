import type { AnyGraphNode, EdgeType, GraphEdge, NodeType, ProjectGraph } from "../types/graph.js";

// True parent-child hierarchy: only these pairs may produce an edgeType:"hierarchy" edge
// (and only these may be used as create_node's parentId).
export const HIERARCHY_RULES: Partial<Record<NodeType, NodeType[]>> = {
  domain: ["subdomain", "route"],
  subdomain: ["route"],
  route: ["route", "endpoint"],
  endpoint: ["operation", "middleware", "service"],
  operation: ["middleware", "service"],
  middleware: ["middleware", "service"],
  service: ["service", "repository", "orm", "model", "table", "tool", "queue", "externalApi", "email", "redisKey"],
  page: ["layout", "component", "form", "modalDialog"],
  component: ["component", "apiCall", "hook", "form", "modalDialog"],
  form: ["apiCall"],
  navigationRouter: ["page"],
  websocket: ["websocketEvent"],
  websocketEvent: ["websocketEmit", "service"],
};

export function canConnect(parentType: NodeType, childType: NodeType): boolean {
  return (HIERARCHY_RULES[parentType] ?? []).includes(childType);
}

export interface RefFieldSpec {
  field: string;
  targetType: NodeType | NodeType[];
  array?: boolean;
}

// Fields inside `props` that reference another node by id (not a hierarchy edge).
export const REF_FIELDS: Partial<Record<NodeType, RefFieldSpec[]>> = {
  subdomain: [{ field: "domainId", targetType: "domain" }],
  // Canonical direction is db -> orm (orm.dbId would just be the same relationship reversed).
  db: [{ field: "ormId", targetType: "orm" }],
  repository: [
    { field: "ormId", targetType: "orm" },
    { field: "entityRef", targetType: ["model", "table"] },
  ],
  service: [
    { field: "ormId", targetType: "orm" },
    { field: "errors[].chainToId", targetType: ["middleware", "service", "errorHandler"], array: true },
  ],
  model: [{ field: "tableId", targetType: "table" }],
  queue: [
    { field: "toolId", targetType: "tool" },
    { field: "consumerServiceId", targetType: "service" },
  ],
  redisKey: [{ field: "toolId", targetType: "tool" }],
  scheduler: [{ field: "triggersServiceId", targetType: "service" }],
  envConfig: [{ field: "domainId", targetType: "domain" }],
  email: [
    { field: "providerId", targetType: "tool" },
    { field: "queueId", targetType: "queue" },
    { field: "errors[].chainToId", targetType: ["middleware", "service", "errorHandler"], array: true },
  ],
  page: [
    { field: "guardId", targetType: "guard" },
    { field: "layoutId", targetType: "layout" },
  ],
  form: [
    { field: "modelRef", targetType: "model" },
    { field: "apiCallId", targetType: "apiCall" },
  ],
  apiCall: [
    { field: "endpointRef", targetType: "endpoint" },
    { field: "storeId", targetType: "stateStore" },
  ],
  modalDialog: [{ field: "contentComponentId", targetType: "component" }],
  layout: [{ field: "slots[].componentId", targetType: "component", array: true }],
  navigationRouter: [{ field: "routes[].pageId", targetType: "page", array: true }],
  endpoint: [{ field: "cacheable.invalidatedBy[]", targetType: ["redisKey", "endpoint"], array: true }],
  operation: [{ field: "returns[].chainToId", targetType: ["middleware", "service", "errorHandler"], array: true }],
  middleware: [{ field: "returns[].chainToId", targetType: ["middleware", "service", "errorHandler"], array: true }],
  table: [
    { field: "relations[].targetTableId", targetType: "table", array: true },
    { field: "dbId", targetType: "db" },
  ],
};

export const REQUIRED_FIELDS: Record<NodeType, string[]> = {
  domain: ["name"],
  subdomain: ["name", "domainId"],
  route: [],
  endpoint: ["name", "methods"],
  operation: ["method"],
  middleware: ["name"],
  service: ["name"],
  model: ["name", "schema"],
  table: ["name", "columns"],
  db: ["engine", "connectionType"],
  orm: ["name"],
  repository: ["name", "entityRef", "ormId"],
  tool: ["name"],
  queue: ["name", "topicOrJobName", "toolId"],
  externalApi: ["name", "baseUrl"],
  scheduler: ["name", "cronExpression", "triggersServiceId"],
  errorHandler: ["name", "scope"],
  envConfig: ["domainId", "variables"],
  websocket: ["name"],
  websocketEvent: ["event"],
  websocketEmit: ["event", "target"],
  email: ["trigger"],
  redisKey: ["keyPattern", "operation", "toolId"],
  page: ["name", "path"],
  layout: ["name", "slots"],
  component: ["name", "kind"],
  form: ["name", "fields"],
  stateStore: ["name", "library"],
  apiCall: ["name", "endpointRef"],
  hook: ["name"],
  navigationRouter: ["library", "routes"],
  guard: ["name", "condition"],
  modalDialog: ["name"],
  themeToken: [],
  asset: ["name", "kind", "path"],
  container: ["label"],
  boundary: ["label"],
  note: ["text"],
};

export const SPECIAL_EDGES: Record<"invalidates", { from: NodeType[]; to: NodeType[] }> = {
  invalidates: { from: ["endpoint"], to: ["redisKey", "endpoint"] },
};

export interface ValidationIssue {
  level: "error" | "warning";
  code:
    | "BROKEN_REF"
    | "MISSING_FIELD"
    | "INVALID_HIERARCHY"
    | "INVALID_REF_TYPE"
    | "INVALID_EDGE"
    | "INVALID_OPERATION_METHOD"
    | "DUPLICATE_OPERATION_METHOD";
  nodeId?: string;
  edgeId?: string;
  field?: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

function getByPath(obj: unknown, path: string): unknown {
  if (obj == null) return undefined;
  return (obj as Record<string, unknown>)[path];
}

export function validateRequiredFields(node: AnyGraphNode): ValidationIssue[] {
  const required = REQUIRED_FIELDS[node.type] ?? [];
  const issues: ValidationIssue[] = [];
  const props = (node.props ?? {}) as Record<string, unknown>;
  for (const field of required) {
    const value = props[field];
    const missing =
      value === undefined ||
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0);
    if (missing) {
      issues.push({
        level: "error",
        code: "MISSING_FIELD",
        nodeId: node.id,
        field,
        message: `Node ${node.id} (${node.type}) is missing required field "${field}"`,
      });
    }
  }
  return issues;
}

export function validateHierarchy(nodes: AnyGraphNode[], edges: GraphEdge[]): ValidationIssue[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const issues: ValidationIssue[] = [];
  for (const edge of edges) {
    if (edge.edgeType !== "hierarchy") continue;
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) {
      issues.push({
        level: "error",
        code: "BROKEN_REF",
        edgeId: edge.id,
        message: `Hierarchy edge ${edge.id} references a missing node (${edge.source} -> ${edge.target})`,
      });
      continue;
    }
    if (!canConnect(source.type, target.type)) {
      issues.push({
        level: "error",
        code: "INVALID_HIERARCHY",
        edgeId: edge.id,
        nodeId: target.id,
        message: `Invalid hierarchy: ${source.type} (${source.id}) cannot be parent of ${target.type} (${target.id})`,
      });
    }
  }
  return issues;
}

function collectRefValues(props: Record<string, unknown>, spec: RefFieldSpec): string[] {
  if (!spec.array) {
    const value = getByPath(props, spec.field);
    return typeof value === "string" && value ? [value] : [];
  }
  // array specs use a "a.b[].c" / "a[]" convention resolved case-by-case below
  if (spec.field.includes("[].")) {
    const [arrayField, itemField] = spec.field.split("[].");
    const container = arrayField.includes(".")
      ? arrayField.split(".").reduce<unknown>((acc, key) => getByPath(acc, key), props)
      : getByPath(props, arrayField);
    if (!Array.isArray(container)) return [];
    return container
      .map((item) => getByPath(item, itemField))
      .filter((v): v is string => typeof v === "string" && v.length > 0);
  }
  if (spec.field.endsWith("[]")) {
    const path = spec.field.slice(0, -2);
    const container = path.includes(".")
      ? path.split(".").reduce<unknown>((acc, key) => getByPath(acc, key), props)
      : getByPath(props, path);
    if (!Array.isArray(container)) return [];
    return container.filter((v): v is string => typeof v === "string" && v.length > 0);
  }
  return [];
}

// Strips any REF_FIELDS value pointing at a deleted id, so a delete never leaves a dangling ref
// behind for validate_project to catch later. Mutates props in place.
export function clearDanglingRefs(nodes: AnyGraphNode[], deletedIds: Set<string>): void {
  for (const node of nodes) {
    const specs = REF_FIELDS[node.type] ?? [];
    if (specs.length === 0) continue;
    const props = node.props as Record<string, unknown>;
    for (const spec of specs) {
      if (!spec.array) {
        const value = getByPath(props, spec.field);
        if (typeof value === "string" && deletedIds.has(value)) delete props[spec.field];
        continue;
      }
      if (spec.field.includes("[].")) {
        const [arrayField, itemField] = spec.field.split("[].");
        const container = arrayField.includes(".")
          ? arrayField.split(".").reduce<unknown>((acc, key) => getByPath(acc, key), props)
          : getByPath(props, arrayField);
        if (!Array.isArray(container)) continue;
        for (const item of container) {
          if (!item || typeof item !== "object") continue;
          const value = (item as Record<string, unknown>)[itemField];
          if (typeof value === "string" && deletedIds.has(value)) delete (item as Record<string, unknown>)[itemField];
        }
        continue;
      }
      if (spec.field.endsWith("[]")) {
        const path = spec.field.slice(0, -2);
        const keys = path.split(".");
        const lastKey = keys[keys.length - 1];
        const parent = keys.length > 1 ? keys.slice(0, -1).reduce<unknown>((acc, key) => getByPath(acc, key), props) : props;
        if (!parent || typeof parent !== "object") continue;
        const container = (parent as Record<string, unknown>)[lastKey];
        if (!Array.isArray(container)) continue;
        (parent as Record<string, unknown>)[lastKey] = container.filter(
          (v) => !(typeof v === "string" && deletedIds.has(v)),
        );
      }
    }
  }
}

export function validateRefs(nodes: AnyGraphNode[]): ValidationIssue[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const issues: ValidationIssue[] = [];
  for (const node of nodes) {
    const specs = REF_FIELDS[node.type] ?? [];
    const props = (node.props ?? {}) as Record<string, unknown>;
    for (const spec of specs) {
      const refIds = collectRefValues(props, spec);
      for (const refId of refIds) {
        const target = byId.get(refId);
        if (!target) {
          issues.push({
            level: "error",
            code: "BROKEN_REF",
            nodeId: node.id,
            field: spec.field,
            message: `Node ${node.id} (${node.type}) field "${spec.field}" references missing id "${refId}"`,
          });
          continue;
        }
        const allowedTypes = Array.isArray(spec.targetType) ? spec.targetType : [spec.targetType];
        if (!allowedTypes.includes(target.type)) {
          issues.push({
            level: "error",
            code: "INVALID_REF_TYPE",
            nodeId: node.id,
            field: spec.field,
            message: `Node ${node.id} (${node.type}) field "${spec.field}" must reference [${allowedTypes.join(
              ", ",
            )}] but points to ${target.type} (${refId})`,
          });
        }
      }
    }
  }
  return issues;
}

export function validateSpecialEdges(nodes: AnyGraphNode[], edges: GraphEdge[]): ValidationIssue[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const issues: ValidationIssue[] = [];
  for (const edge of edges) {
    if (edge.edgeType !== "invalidates") continue;
    const rule = SPECIAL_EDGES.invalidates;
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) {
      issues.push({
        level: "error",
        code: "BROKEN_REF",
        edgeId: edge.id,
        message: `Invalidates edge ${edge.id} references a missing node (${edge.source} -> ${edge.target})`,
      });
      continue;
    }
    if (!rule.from.includes(source.type) || !rule.to.includes(target.type)) {
      issues.push({
        level: "error",
        code: "INVALID_EDGE",
        edgeId: edge.id,
        message: `Invalid "invalidates" edge: ${source.type} -> ${target.type}`,
      });
    }
  }
  return issues;
}

// An operation's method must be one the parent endpoint actually declares, and no two
// operations under the same endpoint may share a method (that's what "one node per method" avoids).
export function validateOperationMethods(nodes: AnyGraphNode[]): ValidationIssue[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const issues: ValidationIssue[] = [];
  const byParent = new Map<string, AnyGraphNode[]>();
  for (const node of nodes) {
    if (node.type !== "operation" || !node.parentId) continue;
    const list = byParent.get(node.parentId) ?? [];
    list.push(node);
    byParent.set(node.parentId, list);
  }
  for (const [parentId, operations] of byParent) {
    const endpoint = byId.get(parentId);
    const allowedMethods =
      endpoint?.type === "endpoint"
        ? ((endpoint.props as unknown as Record<string, unknown>).methods as string[] | undefined)
        : undefined;
    const seen = new Set<string>();
    for (const op of operations) {
      const method = (op.props as Record<string, unknown>).method as string | undefined;
      if (!method) continue;
      if (allowedMethods && !allowedMethods.includes(method)) {
        issues.push({
          level: "error",
          code: "INVALID_OPERATION_METHOD",
          nodeId: op.id,
          field: "method",
          message: `Operation ${op.id} uses method "${method}" which is not declared in endpoint.methods [${allowedMethods.join(", ")}]`,
        });
      }
      if (seen.has(method)) {
        issues.push({
          level: "error",
          code: "DUPLICATE_OPERATION_METHOD",
          nodeId: op.id,
          field: "method",
          message: `Duplicate operation method "${method}" under the same endpoint (${parentId})`,
        });
      }
      seen.add(method);
    }
  }
  return issues;
}

export function validateProjectGraph(graph: ProjectGraph): ValidationResult {
  const issues = [
    ...graph.nodes.flatMap(validateRequiredFields),
    ...validateHierarchy(graph.nodes, graph.edges),
    ...validateRefs(graph.nodes),
    ...validateSpecialEdges(graph.nodes, graph.edges),
    ...validateOperationMethods(graph.nodes),
  ];
  return { valid: issues.every((i) => i.level !== "error"), issues };
}

export function canConnectSpecial(edgeType: EdgeType, sourceType: NodeType, targetType: NodeType): boolean {
  if (edgeType === "hierarchy") return canConnect(sourceType, targetType);
  const rule = SPECIAL_EDGES[edgeType];
  return rule.from.includes(sourceType) && rule.to.includes(targetType);
}

export class ValidationError extends Error {
  issues: ValidationIssue[];
  constructor(issues: ValidationIssue[]) {
    super(issues.map((i) => i.message).join("; "));
    this.name = "ValidationError";
    this.issues = issues;
  }
}
