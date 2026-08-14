import type { AnyGraphNode, GraphEdge } from "@project-visualizer/shared/graph.js";

const NODE_WIDTH = 220;
const LAYER_HEIGHT = 180;

// Zero-dependency layered layout: BFS from hierarchy roots (nodes with no hierarchy parent in the
// given set), depth = row, order of appearance = column, fixed spacing. No cross-minimization —
// this is an occasional "tidy up" button, not a graph-drawing engine.
export function computeAutoLayout(nodes: AnyGraphNode[], edges: GraphEdge[]): Map<string, { x: number; y: number }> {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const childrenByParent = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const edge of edges) {
    if (edge.edgeType !== "hierarchy") continue;
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    const list = childrenByParent.get(edge.source) ?? [];
    list.push(edge.target);
    childrenByParent.set(edge.source, list);
    hasParent.add(edge.target);
  }

  const depthOf = new Map<string, number>();
  const visited = new Set<string>();
  let frontier = nodes.filter((n) => !hasParent.has(n.id)).map((n) => n.id);
  let depth = 0;
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      if (visited.has(id)) continue;
      visited.add(id);
      depthOf.set(id, depth);
      next.push(...(childrenByParent.get(id) ?? []));
    }
    frontier = next;
    depth += 1;
  }
  // Anything unreachable from a root (shouldn't happen for a valid hierarchy, but data can predate
  // a rule or be edited by hand) still gets a position instead of ending up at NaN.
  for (const n of nodes) if (!depthOf.has(n.id)) depthOf.set(n.id, 0);

  const columnByDepth = new Map<number, number>();
  const positions = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const d = depthOf.get(n.id) as number;
    const column = columnByDepth.get(d) ?? 0;
    columnByDepth.set(d, column + 1);
    positions.set(n.id, { x: column * NODE_WIDTH, y: d * LAYER_HEIGHT });
  }
  return positions;
}
