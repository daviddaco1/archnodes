import type { AnyGraphNode } from "../types/graph.js";

// The server never reads the user's source tree — an agent doing a sync computes the hash of the
// relevant file on its own side and passes it in here. Without a hash to compare (either the node
// was never synced, or the caller didn't provide one), the answer is honestly "unknown", not a
// guess dressed up as "in_sync".
export type SyncStatus = "unknown" | "in_sync" | "code_changed" | "graph_changed" | "conflict";

export function determineSyncStatus(node: AnyGraphNode, currentHash?: string): SyncStatus {
  if (!node.sourceHash || !currentHash) return "unknown";
  const codeChanged = currentHash !== node.sourceHash;
  // recordSync() deliberately never bumps updatedAt (see project-store.ts), so any updatedAt
  // strictly after lastSyncedAt means a real graph edit happened since the last sync.
  const graphChanged = !node.lastSyncedAt || node.updatedAt > node.lastSyncedAt;
  if (!codeChanged && !graphChanged) return "in_sync";
  if (codeChanged && !graphChanged) return "code_changed";
  if (!codeChanged && graphChanged) return "graph_changed";
  return "conflict";
}
