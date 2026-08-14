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

// Reverse lookup (targetId -> everything that points at it), built once in a single O(nodes +
// edges) pass. A single getDependents() call is O(1) here in the whole graph. The point of this
// isn't the single-call cost (a full scan was already only O(nodes) for one call) — it's that
// getAffectedNodes/findUnusedNodes/summarizeProject used to call getDependents() once per node in
// a loop, each doing its own full scan, making those callers O(nodes²). Building this index once
// and passing it through turns that back into O(nodes).
export interface DependentsIndex {
  byTarget: Map<string, RelatedNode[]>;
}

export function buildDependentsIndex(graph: ProjectGraph): DependentsIndex {
  const byTarget = new Map<string, RelatedNode[]>();
  const push = (targetId: string, related: RelatedNode) => {
    const list = byTarget.get(targetId);
    if (list) list.push(related);
    else byTarget.set(targetId, [related]);
  };

  for (const edge of graph.edges) {
    if (edge.edgeType === "hierarchy") push(edge.source, { nodeId: edge.target, kind: "hierarchy-child" });
    else if (edge.edgeType === "invalidates") push(edge.target, { nodeId: edge.source, kind: "invalidates-in" });
  }

  for (const other of graph.nodes) {
    const specs = REF_FIELDS[other.type] ?? [];
    if (specs.length === 0) continue;
    const props = (other.props ?? {}) as Record<string, unknown>;
    for (const spec of specs) {
      for (const refId of collectRefValues(props, spec)) {
        if (refId === other.id) continue; // exclude self-reference, same as the old scan did
        push(refId, { nodeId: other.id, kind: "ref", field: spec.field });
      }
    }
  }

  return { byTarget };
}

// What points at `nodeId`: its hierarchy children, anything that invalidates it, and every node
// whose REF_FIELDS reference it. Pass a precomputed `index` (buildDependentsIndex) when calling
// this for many nodes against the same graph — omit it for a one-off lookup, where building a
// throwaway index is no more expensive than the old inline scan was.
export function getDependents(nodeId: string, graph: ProjectGraph, index?: DependentsIndex): RelatedNode[] {
  const { byTarget } = index ?? buildDependentsIndex(graph);
  return byTarget.get(nodeId) ?? [];
}

function bfsTransitive(
  nodeId: string,
  graph: ProjectGraph,
  neighbors: (id: string, graph: ProjectGraph) => RelatedNode[],
  opts?: { maxDepth?: number },
): AffectedNode[] {
  const result: AffectedNode[] = [];
  const visited = new Set<string>([nodeId]);
  let frontier = neighbors(nodeId, graph).map((r) => ({ nodeId: r.nodeId, via: r.kind }));
  let depth = 1;

  while (frontier.length > 0) {
    if (opts?.maxDepth !== undefined && depth > opts.maxDepth) break;
    const next: { nodeId: string; via: RelationKind }[] = [];
    for (const item of frontier) {
      if (visited.has(item.nodeId)) continue;
      visited.add(item.nodeId);
      result.push({ nodeId: item.nodeId, depth, via: item.via });
      next.push(...neighbors(item.nodeId, graph).map((r) => ({ nodeId: r.nodeId, via: r.kind })));
    }
    frontier = next;
    depth += 1;
  }

  return result;
}

// Transitive closure of getDependents — everything that would need a second look if `nodeId`
// changed or disappeared. Visited-set guards against a cycle in REF_FIELDS (hierarchy/containerId
// cycles are already rejected at write time, but ref-field cycles are not — see health.ts).
// `maxDepth` stops the BFS early instead of walking the whole graph and discarding — cheaper for
// callers (like get_project_context) that only ever want a bounded neighborhood. Pass `index`
// (buildDependentsIndex) when calling this for many nodes against the same graph (e.g.
// summarizeProject's topConnected) — each BFS hop is then an O(1) lookup instead of a full rescan.
export function getAffectedNodes(nodeId: string, graph: ProjectGraph, opts?: { maxDepth?: number; index?: DependentsIndex }): AffectedNode[] {
  const index = opts?.index ?? buildDependentsIndex(graph);
  return bfsTransitive(nodeId, graph, (id, g) => getDependents(id, g, index), opts);
}

// Same BFS shape as getAffectedNodes, but walking "what this node needs" (getDependencies)
// instead of "what needs this node" (getDependents) — the other direction of the same relation graph.
export function getTransitiveDependencies(nodeId: string, graph: ProjectGraph, opts?: { maxDepth?: number }): AffectedNode[] {
  return bfsTransitive(nodeId, graph, getDependencies, opts);
}
