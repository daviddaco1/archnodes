import { determineSyncStatus, type SyncStatus } from "../sync/conflict.js";
import type { NodeType, ProjectGraph } from "../types/graph.js";
import type { ProjectStore } from "../store/project-store.js";

export interface ConflictBucket {
  nodeId: string;
  type: NodeType;
  label: string;
  sourcePath?: string;
}

export interface ConflictReport {
  inSync: ConflictBucket[];
  codeChanged: ConflictBucket[];
  graphChanged: ConflictBucket[];
  conflict: ConflictBucket[];
  codeDeleted: ConflictBucket[];
  unknown: ConflictBucket[];
}

const BUCKET_BY_STATUS: Record<SyncStatus, keyof ConflictReport> = {
  in_sync: "inSync",
  code_changed: "codeChanged",
  graph_changed: "graphChanged",
  conflict: "conflict",
  code_deleted: "codeDeleted",
  unknown: "unknown",
};

// Groups store.getBulkSyncStatus()'s per-node result into a report an agent (or a human) can act
// on bucket by bucket — never resolves anything, just presents it. `scope` narrows which node ids
// to include; nodes with no `sourcePath` are excluded by default since they're never tracked for sync.
export function detectConflicts(store: ProjectStore, hashes: Record<string, string | null>, scope?: string[]): ConflictReport {
  const graph: ProjectGraph = store.getProject("all");
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const candidateIds = scope ?? graph.nodes.filter((n) => n.sourcePath).map((n) => n.id);

  const report: ConflictReport = { inSync: [], codeChanged: [], graphChanged: [], conflict: [], codeDeleted: [], unknown: [] };
  for (const nodeId of candidateIds) {
    const node = nodesById.get(nodeId);
    if (!node) continue;
    const status = determineSyncStatus(node, Object.prototype.hasOwnProperty.call(hashes, nodeId) ? hashes[nodeId] : undefined);
    report[BUCKET_BY_STATUS[status]].push({ nodeId: node.id, type: node.type, label: node.label, sourcePath: node.sourcePath });
  }
  return report;
}
