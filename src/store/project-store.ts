import { randomUUID } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
  AnyGraphNode,
  BackendNodeType,
  EdgeType,
  FrontendNodeType,
  GraphEdge,
  NodeType,
  ProjectGraph,
  ProjectScope,
} from "../types/graph.js";
import { BACKEND_NODE_TYPES, FRONTEND_NODE_TYPES } from "../types/graph.js";
import {
  ValidationError,
  canConnectSpecial,
  clearDanglingRefs,
  validateProjectGraph,
  validateRefs,
  type ValidationIssue,
  type ValidationResult,
} from "../validation/rules.js";

// Below this many nodes, a cascade delete is cheap to redo by hand; above it, snapshot first.
const CASCADE_SNAPSHOT_THRESHOLD = 5;

const BACKEND_SET = new Set<NodeType>(BACKEND_NODE_TYPES);
const FRONTEND_SET = new Set<NodeType>(FRONTEND_NODE_TYPES);
// Visual-only structural types have no scope of their own — they belong in every scoped view.
const STRUCTURAL_SET = new Set<NodeType>(["container", "boundary", "note"]);

export interface ProjectStoreOptions {
  baseDir?: string;
}

export interface DeleteResult {
  deletedIds: string[];
}

export interface ProjectStore {
  getProject(scope?: ProjectScope): ProjectGraph;
  listNodes(type?: NodeType, filters?: Record<string, unknown>): AnyGraphNode[];
  getNode(id: string): AnyGraphNode | undefined;
  createNode(type: NodeType, props: unknown, parentId?: string): AnyGraphNode;
  updateNode(id: string, props: unknown): AnyGraphNode;
  setPosition(id: string, position: { x: number; y: number }): AnyGraphNode;
  setContainer(id: string, containerId: string | undefined): AnyGraphNode;
  updateManifest(patch: Partial<Omit<ProjectGraph["manifest"], "projectName" | "createdAt">>): void;
  deleteNode(id: string, cascade?: boolean): DeleteResult;
  connectNodes(sourceId: string, targetId: string, edgeType?: EdgeType): GraphEdge;
  deleteEdge(id: string): void;
  importGraph(nodes: AnyGraphNode[], edges: GraphEdge[], mode: "merge" | "replace"): void;
  validateProject(): ValidationResult;
}

function now(): string {
  return new Date().toISOString();
}

function projectPath(projectName: string, baseDir?: string): string {
  const root = baseDir ?? join(homedir(), ".project-visualizer", "projects");
  return join(root, projectName, "project.json");
}

function loadOrInit(projectName: string, path: string): ProjectGraph {
  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, "utf-8")) as ProjectGraph;
  }
  const timestamp = now();
  return {
    manifest: { projectName, createdAt: timestamp, updatedAt: timestamp },
    nodes: [],
    edges: [],
  };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but is owned by someone else — still counts as alive.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

// One process-level exit hook releases every lock this process holds, instead of one
// `process.once` listener per store — createProjectStore can be called many times per process
// (e.g. across a test suite) without tripping Node's max-listeners warning.
const activeLocks = new Set<string>();
let exitHandlersRegistered = false;

function releaseAllLocks(): void {
  for (const lockPath of activeLocks) {
    try {
      if (readFileSync(lockPath, "utf-8").trim() === String(process.pid)) unlinkSync(lockPath);
    } catch {
      // already gone — nothing to release
    }
  }
  activeLocks.clear();
}

function registerExitHandlersOnce(): void {
  if (exitHandlersRegistered) return;
  exitHandlersRegistered = true;
  process.once("exit", releaseAllLocks);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      releaseAllLocks();
      process.exit(0);
    });
  }
}

// Guards against the exact failure mode two servers sharing one project.json are prone to:
// each process holds its own in-memory copy, and whichever persists last silently wins. A stale
// lock (owner process no longer alive) is reclaimed rather than treated as a conflict.
function acquireLock(lockPath: string): void {
  if (existsSync(lockPath)) {
    const ownerPid = Number(readFileSync(lockPath, "utf-8").trim());
    if (Number.isFinite(ownerPid) && ownerPid !== process.pid && isProcessAlive(ownerPid)) {
      throw new Error(
        `Project is already open in another process (pid ${ownerPid}). Close it before starting a new one — ` +
          `running two at once against the same project.json silently overwrites whichever one saves last.`,
      );
    }
  }
  writeFileSync(lockPath, String(process.pid));
  activeLocks.add(lockPath);
  registerExitHandlersOnce();
}

// Lightweight safety net for destructive bulk writes (import replace, large cascade deletes) —
// a single best-effort copy of the current file, not a history/versioning feature. No retention
// or pruning: add that (Fase 8, per the audit roadmap) if snapshots need to become a real feature.
function snapshotIfExists(filePath: string): void {
  if (!existsSync(filePath)) return;
  const snapshotDir = join(dirname(filePath), ".snapshots");
  mkdirSync(snapshotDir, { recursive: true });
  writeFileSync(join(snapshotDir, `project.${Date.now()}.json`), readFileSync(filePath));
}

export function createProjectStore(projectName: string, opts: ProjectStoreOptions = {}): ProjectStore {
  const filePath = projectPath(projectName, opts.baseDir);
  mkdirSync(join(filePath, ".."), { recursive: true });
  acquireLock(`${filePath}.lock`);
  let graph = loadOrInit(projectName, filePath);

  function persist(): void {
    graph.manifest.updatedAt = now();
    const tmpPath = `${filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(graph, null, 2));
    renameSync(tmpPath, filePath);
  }

  function findNode(id: string): AnyGraphNode | undefined {
    return graph.nodes.find((n) => n.id === id);
  }

  function requireNode(id: string): AnyGraphNode {
    const node = findNode(id);
    if (!node) throw new ValidationError([{ level: "error", code: "BROKEN_REF", nodeId: id, message: `Node ${id} not found` }]);
    return node;
  }

  function assertValidNode(candidate: AnyGraphNode, allNodes: AnyGraphNode[]): void {
    // Only refs (broken id / wrong target type) are hard-rejected at write time — a bad
    // reference actively corrupts data. Missing required fields are NOT rejected here: a visual
    // editor drops a bare node first and fills it in afterwards, so treat that as a diagnostic
    // (surfaced by validate_project(), same as import_graph's already-documented partial-data path)
    // rather than blocking node creation entirely.
    const issues = validateRefs(allNodes).filter((i) => i.nodeId === candidate.id);
    if (issues.length > 0) throw new ValidationError(issues);
  }

  // Same "actively corrupts data" bar as assertValidNode: a method outside the endpoint's
  // declared list, or a method that collides with a sibling operation, is rejected outright.
  function assertValidOperationMethod(candidate: AnyGraphNode, allNodes: AnyGraphNode[], parentIdOverride?: string): void {
    if (candidate.type !== "operation") return;
    const parentId = parentIdOverride ?? candidate.parentId;
    const method = (candidate.props as unknown as Record<string, unknown>).method as string | undefined;
    if (!parentId || !method) return;

    const issues: ValidationIssue[] = [];
    const endpoint = allNodes.find((n) => n.id === parentId);
    const allowedMethods =
      endpoint?.type === "endpoint"
        ? ((endpoint.props as unknown as Record<string, unknown>).methods as string[] | undefined)
        : undefined;
    if (allowedMethods && !allowedMethods.includes(method)) {
      issues.push({
        level: "error",
        code: "INVALID_OPERATION_METHOD",
        nodeId: candidate.id,
        field: "method",
        message: `Method "${method}" is not declared in the parent endpoint's methods [${allowedMethods.join(", ")}]`,
      });
    }
    const collides = allNodes.some(
      (n) =>
        n.type === "operation" &&
        n.id !== candidate.id &&
        n.parentId === parentId &&
        (n.props as unknown as Record<string, unknown>).method === method,
    );
    if (collides) {
      issues.push({
        level: "error",
        code: "DUPLICATE_OPERATION_METHOD",
        nodeId: candidate.id,
        field: "method",
        message: `Another operation under the same endpoint already uses method "${method}"`,
      });
    }
    if (issues.length > 0) throw new ValidationError(issues);
  }

  // Walks from `startId` via `next()` looking for `targetId`, stopping (false) if it runs off the
  // graph or loops back on itself first — the visited-set makes this safe even if the data already
  // contains a cycle from before this check existed.
  function walksTo(startId: string, targetId: string, next: (n: AnyGraphNode) => string | undefined): boolean {
    const visited = new Set<string>();
    let currentId: string | undefined = startId;
    while (currentId) {
      if (currentId === targetId) return true;
      if (visited.has(currentId)) return false;
      visited.add(currentId);
      const node = findNode(currentId);
      if (!node) return false;
      currentId = next(node);
    }
    return false;
  }

  function assertNoHierarchyCycle(parentId: string, childId: string): void {
    // childId becoming an ancestor of its own would-be parent (or parentId===childId) forms a loop.
    if (walksTo(parentId, childId, (n) => n.parentId)) {
      throw new ValidationError([
        {
          level: "error",
          code: "CYCLE_DETECTED",
          nodeId: childId,
          message: `Cannot set ${childId} as a child of ${parentId}: would create a hierarchy cycle`,
        },
      ]);
    }
  }

  function linkHierarchy(parentId: string, childId: string): GraphEdge {
    const parent = requireNode(parentId);
    const child = requireNode(childId);
    if (!canConnectSpecial("hierarchy", parent.type, child.type)) {
      throw new ValidationError([
        {
          level: "error",
          code: "INVALID_HIERARCHY",
          nodeId: childId,
          message: `Invalid hierarchy: ${parent.type} cannot be parent of ${child.type}`,
        },
      ]);
    }
    assertNoHierarchyCycle(parentId, childId);
    const edge: GraphEdge = { id: randomUUID(), source: parentId, target: childId, edgeType: "hierarchy" };
    graph.edges.push(edge);
    child.parentId = parentId;
    child.updatedAt = now();
    return edge;
  }

  const store: ProjectStore = {
    getProject(scope: ProjectScope = "all") {
      if (scope === "all") return graph;
      const set = scope === "backend" ? BACKEND_SET : FRONTEND_SET;
      const nodes = graph.nodes.filter((n) => set.has(n.type) || STRUCTURAL_SET.has(n.type));
      const nodeIds = new Set(nodes.map((n) => n.id));
      const edges = graph.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
      return { manifest: graph.manifest, nodes, edges };
    },

    listNodes(type?: NodeType, filters?: Record<string, unknown>) {
      let nodes = graph.nodes;
      if (type) nodes = nodes.filter((n) => n.type === type);
      if (filters) {
        nodes = nodes.filter((n) =>
          Object.entries(filters).every(([key, value]) => (n.props as Record<string, unknown>)[key] === value),
        );
      }
      return nodes;
    },

    getNode(id: string) {
      return findNode(id);
    },

    createNode(type: NodeType, props: unknown, parentId?: string) {
      const timestamp = now();
      const node = {
        id: randomUUID(),
        type,
        label: (props as Record<string, unknown>)?.name ?? (props as Record<string, unknown>)?.label ?? type,
        position: { x: 0, y: 0 },
        props: props ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
      } as AnyGraphNode;

      assertValidNode(node, [...graph.nodes, node]);
      if (parentId) assertValidOperationMethod(node, [...graph.nodes, node], parentId);
      graph.nodes.push(node);
      if (parentId) {
        try {
          linkHierarchy(parentId, node.id);
        } catch (err) {
          graph.nodes.pop();
          throw err;
        }
      }
      persist();
      return node;
    },

    updateManifest(patch) {
      Object.assign(graph.manifest, patch);
      persist();
    },

    updateNode(id: string, props: unknown) {
      const node = requireNode(id);
      const merged = { ...(node.props as Record<string, unknown>), ...(props as Record<string, unknown>) };
      const candidate = { ...node, props: merged } as AnyGraphNode;
      const allNodes = graph.nodes.map((n) => (n.id === id ? candidate : n));
      assertValidNode(candidate, allNodes);
      assertValidOperationMethod(candidate, allNodes);
      if (candidate.type === "endpoint") {
        // Editing methods must not silently orphan an existing operation child's method.
        const children = graph.edges
          .filter((e) => e.edgeType === "hierarchy" && e.source === id)
          .map((e) => allNodes.find((n) => n.id === e.target))
          .filter((n): n is AnyGraphNode => Boolean(n && n.type === "operation"));
        for (const child of children) assertValidOperationMethod(child, allNodes);
      }
      node.props = merged as never;
      node.updatedAt = now();
      if (typeof merged.name === "string") node.label = merged.name;
      persist();
      return node;
    },

    setPosition(id: string, position: { x: number; y: number }) {
      const node = requireNode(id);
      node.position = position;
      node.updatedAt = now();
      persist();
      return node;
    },

    setContainer(id: string, containerId: string | undefined) {
      // Visual-only grouping (React Flow subflow), not a hierarchy edge — no connection-rule check,
      // but it still must resolve to a real node and can't nest a container inside itself.
      const node = requireNode(id);
      if (containerId !== undefined) {
        requireNode(containerId);
        if (walksTo(containerId, id, (n) => n.containerId)) {
          throw new ValidationError([
            {
              level: "error",
              code: "CYCLE_DETECTED",
              nodeId: id,
              message: `Cannot set ${id}'s container to ${containerId}: would create a container cycle`,
            },
          ]);
        }
      }
      node.containerId = containerId;
      node.updatedAt = now();
      persist();
      return node;
    },

    deleteNode(id: string, cascade = false) {
      requireNode(id);
      const childrenEdges = graph.edges.filter((e) => e.edgeType === "hierarchy" && e.source === id);
      if (childrenEdges.length > 0 && !cascade) {
        throw new ValidationError([
          { level: "error", code: "INVALID_HIERARCHY", nodeId: id, message: `Node ${id} has children; pass cascade:true to delete them too` },
        ]);
      }

      const toDelete = new Set<string>([id]);
      if (cascade) {
        const stack = [id];
        while (stack.length > 0) {
          const current = stack.pop()!;
          for (const edge of graph.edges) {
            if (edge.edgeType === "hierarchy" && edge.source === current && !toDelete.has(edge.target)) {
              toDelete.add(edge.target);
              stack.push(edge.target);
            }
          }
        }
      }

      if (toDelete.size > CASCADE_SNAPSHOT_THRESHOLD) snapshotIfExists(filePath);

      graph.nodes = graph.nodes.filter((n) => !toDelete.has(n.id));
      graph.edges = graph.edges.filter((e) => !toDelete.has(e.source) && !toDelete.has(e.target));
      clearDanglingRefs(graph.nodes, toDelete);
      // containerId is visual-only grouping, not a REF_FIELDS ref — clearDanglingRefs doesn't touch it.
      for (const n of graph.nodes) {
        if (n.containerId && toDelete.has(n.containerId)) n.containerId = undefined;
      }
      persist();
      return { deletedIds: [...toDelete] };
    },

    connectNodes(sourceId: string, targetId: string, edgeType: EdgeType = "hierarchy") {
      const source = requireNode(sourceId);
      const target = requireNode(targetId);
      if (!canConnectSpecial(edgeType, source.type, target.type)) {
        throw new ValidationError([
          {
            level: "error",
            code: edgeType === "hierarchy" ? "INVALID_HIERARCHY" : "INVALID_EDGE",
            nodeId: targetId,
            message: `Invalid ${edgeType} edge: ${source.type} -> ${target.type}`,
          },
        ]);
      }
      const existing = graph.edges.find(
        (e) => e.source === sourceId && e.target === targetId && e.edgeType === edgeType,
      );
      if (existing) return existing;
      if (edgeType === "hierarchy") {
        assertNoHierarchyCycle(sourceId, targetId);
        if (target.type === "operation") assertValidOperationMethod(target, graph.nodes, sourceId);
        // A child has at most one live hierarchy parent — reparenting replaces the old edge.
        graph.edges = graph.edges.filter((e) => !(e.edgeType === "hierarchy" && e.target === targetId));
      }
      const edge: GraphEdge = { id: randomUUID(), source: sourceId, target: targetId, edgeType };
      graph.edges.push(edge);
      if (edgeType === "hierarchy") {
        target.parentId = sourceId;
        target.updatedAt = now();
      }
      persist();
      return edge;
    },

    deleteEdge(id: string) {
      const edge = graph.edges.find((e) => e.id === id);
      if (!edge) return;
      graph.edges = graph.edges.filter((e) => e.id !== id);
      if (edge.edgeType === "hierarchy") {
        const target = findNode(edge.target);
        if (target && target.parentId === edge.source) {
          target.parentId = undefined;
          target.updatedAt = now();
        }
      }
      persist();
    },

    importGraph(nodes: AnyGraphNode[], edges: GraphEdge[], mode: "merge" | "replace") {
      if (mode === "replace") {
        snapshotIfExists(filePath);
        graph.nodes = nodes;
        graph.edges = edges;
      } else {
        const nodeIds = new Map(graph.nodes.map((n) => [n.id, n]));
        for (const node of nodes) nodeIds.set(node.id, node);
        graph.nodes = [...nodeIds.values()];

        const edgeIds = new Map(graph.edges.map((e) => [e.id, e]));
        for (const edge of edges) edgeIds.set(edge.id, edge);
        graph.edges = [...edgeIds.values()];
      }
      persist();
    },

    validateProject() {
      return validateProjectGraph(graph);
    },
  };

  return store;
}

export type { BackendNodeType, FrontendNodeType };
