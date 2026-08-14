import { REF_FIELDS, collectRefValues } from "../validation/rules.js";
import type { ProjectGraph } from "../types/graph.js";

// Unifies the three relationship mechanisms the data model deliberately keeps distinct (hierarchy
// edges, invalidates edges, REF_FIELDS-by-id) into one queryable view, without merging them
// conceptually — every result still says which kind of relationship it came from.
export type RelationKind = "hierarchy-parent" | "hierarchy-child" | "ref" | "invalidates-out" | "invalidates-in";

export interface RelatedNode {
  nodeId: string;
  kind: RelationKind;
  field?: string;
}

export interface AffectedNode {
  nodeId: string;
  depth: number;
  via: RelationKind;
}

// What `nodeId` points at / needs to exist: its hierarchy parent, anything its REF_FIELDS
// reference, and anything it invalidates.
export function getDependencies(nodeId: string, graph: ProjectGraph): RelatedNode[] {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return [];
  const result: RelatedNode[] = [];

  if (node.parentId) result.push({ nodeId: node.parentId, kind: "hierarchy-parent" });

  const specs = REF_FIELDS[node.type] ?? [];
  const props = (node.props ?? {}) as Record<string, unknown>;
  for (const spec of specs) {
    for (const refId of collectRefValues(props, spec)) {
      result.push({ nodeId: refId, kind: "ref", field: spec.field });
    }
  }

  for (const edge of graph.edges) {
    if (edge.edgeType === "invalidates" && edge.source === nodeId) {
      result.push({ nodeId: edge.target, kind: "invalidates-out" });
    }
  }

  return result;
}

// What points at `nodeId`: its hierarchy children, anything that invalidates it, and — the one
// mechanism with no dedicated index in the store — every node whose REF_FIELDS reference it,
// found by scanning (O(nodes × specs), no reverse index maintained; fine at the node counts a
// single project graph holds today).
export function getDependents(nodeId: string, graph: ProjectGraph): RelatedNode[] {
  const result: RelatedNode[] = [];

  for (const edge of graph.edges) {
    if (edge.edgeType === "hierarchy" && edge.source === nodeId) {
      result.push({ nodeId: edge.target, kind: "hierarchy-child" });
    }
    if (edge.edgeType === "invalidates" && edge.target === nodeId) {
      result.push({ nodeId: edge.source, kind: "invalidates-in" });
    }
  }

  for (const other of graph.nodes) {
    if (other.id === nodeId) continue;
    const specs = REF_FIELDS[other.type] ?? [];
    if (specs.length === 0) continue;
    const props = (other.props ?? {}) as Record<string, unknown>;
    for (const spec of specs) {
      if (collectRefValues(props, spec).includes(nodeId)) {
        result.push({ nodeId: other.id, kind: "ref", field: spec.field });
      }
    }
  }

  return result;
}

// Transitive closure of getDependents — everything that would need a second look if `nodeId`
// changed or disappeared. Visited-set guards against a cycle in REF_FIELDS (hierarchy/containerId
// cycles are already rejected at write time, but ref-field cycles are not — see health.ts).
export function getAffectedNodes(nodeId: string, graph: ProjectGraph): AffectedNode[] {
  const result: AffectedNode[] = [];
  const visited = new Set<string>([nodeId]);
  let frontier = getDependents(nodeId, graph).map((r) => ({ nodeId: r.nodeId, via: r.kind }));
  let depth = 1;

  while (frontier.length > 0) {
    const next: { nodeId: string; via: RelationKind }[] = [];
    for (const item of frontier) {
      if (visited.has(item.nodeId)) continue;
      visited.add(item.nodeId);
      result.push({ nodeId: item.nodeId, depth, via: item.via });
      next.push(...getDependents(item.nodeId, graph).map((r) => ({ nodeId: r.nodeId, via: r.kind })));
    }
    frontier = next;
    depth += 1;
  }

  return result;
}
