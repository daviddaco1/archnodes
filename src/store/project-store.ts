import { randomUUID } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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
  validateProjectGraph,
  validateRefs,
  type ValidationResult,
} from "../validation/rules.js";

const BACKEND_SET = new Set<NodeType>(BACKEND_NODE_TYPES);
const FRONTEND_SET = new Set<NodeType>(FRONTEND_NODE_TYPES);

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

export function createProjectStore(projectName: string, opts: ProjectStoreOptions = {}): ProjectStore {
  const filePath = projectPath(projectName, opts.baseDir);
  mkdirSync(join(filePath, ".."), { recursive: true });
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
      const nodes = graph.nodes.filter((n) => set.has(n.type));
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
      assertValidNode(candidate, graph.nodes.map((n) => (n.id === id ? candidate : n)));
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
      // Visual-only grouping (React Flow subflow), not a hierarchy edge — no connection-rule check.
      const node = requireNode(id);
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

      graph.nodes = graph.nodes.filter((n) => !toDelete.has(n.id));
      graph.edges = graph.edges.filter((e) => !toDelete.has(e.source) && !toDelete.has(e.target));
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
      const edge: GraphEdge = { id: randomUUID(), source: sourceId, target: targetId, edgeType };
      graph.edges.push(edge);
      if (edgeType === "hierarchy") {
        target.parentId = sourceId;
        target.updatedAt = now();
      }
      persist();
      return edge;
    },

    importGraph(nodes: AnyGraphNode[], edges: GraphEdge[], mode: "merge" | "replace") {
      if (mode === "replace") {
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
