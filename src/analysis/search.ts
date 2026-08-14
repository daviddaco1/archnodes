import type { NodeType, ProjectGraph } from "../types/graph.js";

export interface SearchResult {
  nodeId: string;
  type: NodeType;
  label: string;
  matchedIn: "label" | "props";
  snippet: string;
}

const SNIPPET_LENGTH = 200;
const DEFAULT_LIMIT = 50;

// Linear substring filter, no index — a project-visualizer graph runs to the low thousands of
// nodes at most, where Array.filter is milliseconds; revisit only if that assumption stops holding.
export function searchGraph(graph: ProjectGraph, query: string, opts?: { types?: NodeType[]; limit?: number }): SearchResult[] {
  const q = query.toLowerCase();
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  const typeFilter = opts?.types ? new Set(opts.types) : undefined;
  const results: SearchResult[] = [];

  for (const node of graph.nodes) {
    if (typeFilter && !typeFilter.has(node.type)) continue;
    if (node.label.toLowerCase().includes(q)) {
      results.push({ nodeId: node.id, type: node.type, label: node.label, matchedIn: "label", snippet: node.label });
    } else {
      const propsStr = JSON.stringify(node.props ?? {});
      if (propsStr.toLowerCase().includes(q)) {
        results.push({ nodeId: node.id, type: node.type, label: node.label, matchedIn: "props", snippet: propsStr.slice(0, SNIPPET_LENGTH) });
      } else {
        continue;
      }
    }
    if (results.length >= limit) break;
  }
  return results;
}
