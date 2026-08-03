import type { AnyGraphNode, EdgeType, GraphEdge, NodeType, ProjectGraph } from "../types/graph.js";

// True parent-child hierarchy: only these pairs may produce an edgeType:"hierarchy" edge
// (and only these may be used as create_node's parentId).
export const HIERARCHY_RULES: Partial<Record<NodeType, NodeType[]>> = {
  domain: ["subdomain", "route"],
  subdomain: ["route"],
  route: ["route", "endpoint"],
  endpoint: ["middleware", "service"],
  middleware: ["middleware", "service"],
  service: ["service", "repository", "orm", "model", "table", "tool", "queue", "externalApi", "email", "redisKey"],
  page: ["layout", "component", "form", "modalDialog"],
  component: ["component", "apiCall", "hook", "form", "modalDialog"],
  form: ["apiCall"],
  navigationRouter: ["page"],
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
  orm: [{ field: "dbId", targetType: "db" }],
  db: [{ field: "ormId", targetType: "orm" }],
  repository: [{ field: "ormId", targetType: "orm" }],
  service: [{ field: "ormId", targetType: "orm" }],
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
  navigationRouter: [{ field: "routes[].pageId", targetType: "page", array: true }],
  endpoint: [{ field: "cacheable.invalidatedBy[]", targetType: ["redisKey", "endpoint"], array: true }],
  table: [{ field: "relations[].targetTableId", targetType: "table", array: true }],
};

export const REQUIRED_FIELDS: Record<NodeType, string[]> = {
  domain: ["name"],
  subdomain: ["name", "domainId"],
  route: [],
  endpoint: ["name", "method"],
  middleware: ["name"],
  service: ["name"],
  model: ["name", "schema"],
  table: ["name", "columns"],
  db: ["engine", "connectionType"],
  orm: ["name", "dbId"],
  repository: ["name", "entityRef", "ormId"],
  tool: ["name"],
  queue: ["name", "topicOrJobName", "toolId"],
  externalApi: ["name", "baseUrl"],
  scheduler: ["name", "cronExpression", "triggersServiceId"],
  errorHandler: ["name", "scope"],
  envConfig: ["domainId", "variables"],
  websocket: ["name", "event"],
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
};

export const SPECIAL_EDGES: Record<"invalidates", { from: NodeType[]; to: NodeType[] }> = {
  invalidates: { from: ["endpoint"], to: ["redisKey", "endpoint"] },
};

export interface ValidationIssue {
  level: "error" | "warning";
  code: "BROKEN_REF" | "MISSING_FIELD" | "INVALID_HIERARCHY" | "INVALID_REF_TYPE" | "INVALID_EDGE";
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

export function validateProjectGraph(graph: ProjectGraph): ValidationResult {
  const issues = [
    ...graph.nodes.flatMap(validateRequiredFields),
    ...validateHierarchy(graph.nodes, graph.edges),
    ...validateRefs(graph.nodes),
    ...validateSpecialEdges(graph.nodes, graph.edges),
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
