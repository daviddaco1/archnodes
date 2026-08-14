import type { GraphEdge } from "@project-visualizer/shared/graph.js";

// BFS over hierarchy edges only — everything under `nodeId` in the parent/child tree, however
// deep. Used to hide a collapsed subtree's nodes/edges from the canvas render.
export function getDescendantIds(nodeId: string, hierarchyEdges: GraphEdge[]): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const edge of hierarchyEdges) {
    if (edge.edgeType !== "hierarchy") continue;
    const list = childrenByParent.get(edge.source) ?? [];
    list.push(edge.target);
    childrenByParent.set(edge.source, list);
  }

  const result = new Set<string>();
  const stack = [...(childrenByParent.get(nodeId) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (result.has(current)) continue; // guards against a pre-existing cycle in the data
    result.add(current);
    stack.push(...(childrenByParent.get(current) ?? []));
  }
  return result;
}
