import type { RefFieldSpec, SchemaResponse } from "../../api/client";
import type { AnyGraphNode, NodeType } from "../../types/graph";

// Single-value ref fields (props.dbId, props.ormId, etc.) are a real relationship — the backend
// already validates them (REF_FIELDS) — but until now they were only visible/editable as a
// dropdown buried in the property panel, invisible on the canvas. This mirrors them as a real,
// draggable edge: a thin dashed "ref" line, distinct from hierarchy/invalidates.
// Array-valued ref fields (relations[].targetTableId, returns[].chainToId, ...) are left out —
// a single edge can't represent "one of many" without a lot more plumbing than the payoff justifies.

export interface RefEdgeSpec {
  field: string;
  targetType: NodeType;
}

export type RefEdgeRules = Map<string, RefEdgeSpec>; // key: `${fromType}->${toType}`

export function buildRefEdgeRules(refFields: SchemaResponse["refFields"] | undefined): RefEdgeRules {
  const map: RefEdgeRules = new Map();
  if (!refFields) return map;
  for (const [fromType, specs] of Object.entries(refFields) as [NodeType, RefFieldSpec[]][]) {
    for (const spec of specs) {
      if (spec.array) continue;
      const targetTypes = Array.isArray(spec.targetType) ? spec.targetType : [spec.targetType];
      for (const targetType of targetTypes) {
        map.set(`${fromType}->${targetType}`, { field: spec.field, targetType });
      }
    }
  }
  return map;
}

export function refEdgeSpec(rules: RefEdgeRules, sourceType: NodeType, targetType: NodeType): RefEdgeSpec | undefined {
  return rules.get(`${sourceType}->${targetType}`);
}

export function refEdgeTargetTypesFrom(rules: RefEdgeRules, sourceType: NodeType): NodeType[] {
  const prefix = `${sourceType}->`;
  const out: NodeType[] = [];
  for (const key of rules.keys()) if (key.startsWith(prefix)) out.push(key.slice(prefix.length) as NodeType);
  return out;
}

export function refEdgeSourceTypesTo(rules: RefEdgeRules, targetType: NodeType): NodeType[] {
  const suffix = `->${targetType}`;
  const out: NodeType[] = [];
  for (const key of rules.keys()) if (key.endsWith(suffix)) out.push(key.slice(0, -suffix.length) as NodeType);
  return out;
}

const REF_EDGE_PREFIX = "ref__";

export function refEdgeId(nodeId: string, field: string): string {
  return `${REF_EDGE_PREFIX}${nodeId}__${field}`;
}

export function parseRefEdgeId(id: string): { nodeId: string; field: string } | undefined {
  if (!id.startsWith(REF_EDGE_PREFIX)) return undefined;
  const [nodeId, field] = id.slice(REF_EDGE_PREFIX.length).split("__");
  if (!nodeId || !field) return undefined;
  return { nodeId, field };
}

export interface SyntheticRefEdge {
  id: string;
  source: string;
  target: string;
  field: string;
}

// Synthesizes one edge per single-value ref field that currently points at an existing node in
// this same tab — purely derived from current prop values, never stored in graph.edges itself.
export function synthesizeRefEdges(nodes: AnyGraphNode[], refFields: SchemaResponse["refFields"] | undefined): SyntheticRefEdge[] {
  if (!refFields) return [];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: SyntheticRefEdge[] = [];
  for (const node of nodes) {
    const specs = refFields[node.type as NodeType];
    if (!specs) continue;
    const props = node.props as Record<string, unknown>;
    for (const spec of specs) {
      if (spec.array) continue;
      const value = props[spec.field];
      if (typeof value === "string" && value && nodeIds.has(value)) {
        edges.push({ id: refEdgeId(node.id, spec.field), source: node.id, target: value, field: spec.field });
      }
    }
  }
  return edges;
}
