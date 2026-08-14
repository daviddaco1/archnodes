import { getAffectedNodes, getTransitiveDependencies, type RelationKind } from "./dependencies.js";
import { ValidationError } from "../validation/rules.js";
import type { AnyGraphNode, NodeType } from "../types/graph.js";
import type { ProjectStore } from "../store/project-store.js";

// Hard clamps regardless of what the caller asks for — an agent requesting depth:9999 or
// maxNodes:100000 must not be able to pull the entire graph through this endpoint.
const MAX_DEPTH_CLAMP = 5;
const MAX_NODES_CLAMP = 200;
const DEFAULT_DEPTH = 2;
const DEFAULT_MAX_NODES = 50;

export interface ProjectContextRelated {
  nodeId: string;
  type: NodeType;
  label: string;
  depth: number;
  direction: "dependency" | "dependent";
  via: RelationKind;
}

export interface ProjectContextResult {
  focus: AnyGraphNode;
  related: ProjectContextRelated[];
  truncated: boolean;
  totalRelatedFound: number;
}

// The bounded alternative to get_project("all") for an agent working on one node: the full focus
// node plus a depth/count-limited neighborhood (ids/types/labels only — call get_node for detail
// on any specific related id). BFS-by-level means truncation always drops the farthest nodes first.
export function getProjectContext(
  store: ProjectStore,
  nodeId: string,
  opts?: { depth?: number; direction?: "dependencies" | "dependents" | "both"; maxNodes?: number },
): ProjectContextResult {
  const focus = store.getNode(nodeId);
  if (!focus) throw new ValidationError([{ level: "error", code: "BROKEN_REF", nodeId, message: `Node ${nodeId} not found` }]);

  const graph = store.getProject("all");
  const depth = Math.min(opts?.depth ?? DEFAULT_DEPTH, MAX_DEPTH_CLAMP);
  const maxNodes = Math.min(opts?.maxNodes ?? DEFAULT_MAX_NODES, MAX_NODES_CLAMP);
  const direction = opts?.direction ?? "both";

  const byId = new Map<string, ProjectContextRelated>();
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));

  function consider(relatedId: string, itemDepth: number, via: RelationKind, dir: "dependency" | "dependent"): void {
    const existing = byId.get(relatedId);
    if (existing && existing.depth <= itemDepth) return; // keep the smaller depth; a tie keeps whichever was inserted first
    const node = nodesById.get(relatedId);
    if (!node) return;
    byId.set(relatedId, { nodeId: relatedId, type: node.type, label: node.label, depth: itemDepth, direction: dir, via });
  }

  // Dependents considered first so a depth tie between the two directions resolves to "dependent" (documented, deterministic).
  if (direction === "dependents" || direction === "both") {
    for (const item of getAffectedNodes(nodeId, graph, { maxDepth: depth })) consider(item.nodeId, item.depth, item.via, "dependent");
  }
  if (direction === "dependencies" || direction === "both") {
    for (const item of getTransitiveDependencies(nodeId, graph, { maxDepth: depth })) consider(item.nodeId, item.depth, item.via, "dependency");
  }

  const all = [...byId.values()].sort((a, b) => a.depth - b.depth);
  const totalRelatedFound = all.length;
  const related = all.slice(0, maxNodes);

  return { focus, related, truncated: totalRelatedFound > maxNodes, totalRelatedFound };
}
