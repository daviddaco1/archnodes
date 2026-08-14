import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AnyGraphNode, GraphEdge, ProjectGraph } from "../types/graph.js";

export type HistorySource = "ui" | "api" | "mcp" | "import" | "sync" | "system";

export interface NodeDiffEntry {
  id: string;
  before?: AnyGraphNode;
  after?: AnyGraphNode;
}

export interface EdgeDiffEntry {
  id: string;
  before?: GraphEdge;
  after?: GraphEdge;
}

export interface HistoryEntry {
  id: string;
  timestamp: string;
  operation: string;
  source: HistorySource;
  author?: string;
  // Kept as a plain string here (not importing security/permissions' Role) — history.ts has no
  // other dependency on the security module, and this is just an audit-trail label.
  role?: string;
  description?: string;
  nodesDiff: NodeDiffEntry[];
  edgesDiff: EdgeDiffEntry[];
}

// Diffs by id, not by array position — a reorder alone (which never happens today, but nothing
// relies on array order being meaningful) shouldn't read as every node changing.
export function diffGraphs(before: ProjectGraph, after: ProjectGraph): { nodesDiff: NodeDiffEntry[]; edgesDiff: EdgeDiffEntry[] } {
  const nodesDiff: NodeDiffEntry[] = [];
  const beforeNodes = new Map(before.nodes.map((n) => [n.id, n]));
  const afterNodes = new Map(after.nodes.map((n) => [n.id, n]));
  for (const id of new Set([...beforeNodes.keys(), ...afterNodes.keys()])) {
    const b = beforeNodes.get(id);
    const a = afterNodes.get(id);
    if (JSON.stringify(b) !== JSON.stringify(a)) nodesDiff.push({ id, before: b, after: a });
  }

  const edgesDiff: EdgeDiffEntry[] = [];
  const beforeEdges = new Map(before.edges.map((e) => [e.id, e]));
  const afterEdges = new Map(after.edges.map((e) => [e.id, e]));
  for (const id of new Set([...beforeEdges.keys(), ...afterEdges.keys()])) {
    const b = beforeEdges.get(id);
    const a = afterEdges.get(id);
    if (JSON.stringify(b) !== JSON.stringify(a)) edgesDiff.push({ id, before: b, after: a });
  }

  return { nodesDiff, edgesDiff };
}

export function readHistory(historyPath: string): HistoryEntry[] {
  if (!existsSync(historyPath)) return [];
  const raw = readFileSync(historyPath, "utf-8");
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as HistoryEntry);
}

export function appendHistoryEntry(historyPath: string, entry: HistoryEntry): void {
  mkdirSync(dirname(historyPath), { recursive: true });
  appendFileSync(historyPath, `${JSON.stringify(entry)}\n`);
}

// Only used when history is rewritten wholesale (truncating the "redo-able future" after a fresh
// edit lands mid-timeline) — the common append path never rewrites the whole file.
export function writeHistoryFile(historyPath: string, entries: HistoryEntry[]): void {
  mkdirSync(dirname(historyPath), { recursive: true });
  writeFileSync(historyPath, entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length > 0 ? "\n" : ""));
}

export function filterHistory(entries: HistoryEntry[], opts?: { limit?: number; before?: string }): HistoryEntry[] {
  let result = entries;
  if (opts?.before) result = result.filter((e) => e.timestamp < opts.before!);
  if (opts?.limit) result = result.slice(-opts.limit);
  return result;
}

function applyNodeSide(graph: ProjectGraph, id: string, node: AnyGraphNode | undefined): void {
  if (node) {
    const idx = graph.nodes.findIndex((n) => n.id === id);
    if (idx >= 0) graph.nodes[idx] = node;
    else graph.nodes.push(node);
  } else {
    graph.nodes = graph.nodes.filter((n) => n.id !== id);
  }
}

function applyEdgeSide(graph: ProjectGraph, id: string, edge: GraphEdge | undefined): void {
  if (edge) {
    const idx = graph.edges.findIndex((e) => e.id === id);
    if (idx >= 0) graph.edges[idx] = edge;
    else graph.edges.push(edge);
  } else {
    graph.edges = graph.edges.filter((e) => e.id !== id);
  }
}

// Moves `graph` one step forward in time (re-applies what the entry recorded as "after").
export function applyForwardDiff(graph: ProjectGraph, entry: HistoryEntry): void {
  for (const nd of entry.nodesDiff) applyNodeSide(graph, nd.id, nd.after);
  for (const ed of entry.edgesDiff) applyEdgeSide(graph, ed.id, ed.after);
}

// Moves `graph` one step backward in time (restores what the entry recorded as "before").
export function applyReverseDiff(graph: ProjectGraph, entry: HistoryEntry): void {
  for (const nd of entry.nodesDiff) applyNodeSide(graph, nd.id, nd.before);
  for (const ed of entry.edgesDiff) applyEdgeSide(graph, ed.id, ed.before);
}

// Walks `graph` from `fromPos` entries-applied to `toPos` entries-applied, mutating it in place.
// entries[i] is the transition from position i to position i+1.
export function replayToPosition(graph: ProjectGraph, entries: HistoryEntry[], fromPos: number, toPos: number): void {
  if (toPos === fromPos) return;
  if (toPos < fromPos) {
    for (let i = fromPos - 1; i >= toPos; i--) applyReverseDiff(graph, entries[i]);
  } else {
    for (let i = fromPos; i < toPos; i++) applyForwardDiff(graph, entries[i]);
  }
}
