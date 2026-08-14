import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Node as RFNode,
  type Edge as RFEdge,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  type OnNodeDrag,
  type OnConnectStart,
  type OnConnectEnd,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGraph } from "../../context/GraphContext";
import { nodeSchemas } from "../../schema/nodeSchemas";
import { defaultCompanionProps } from "../../schema/companionDefaults";
import type { AnyGraphNode, GraphEdge, NodeType } from "../../types/graph";
import * as api from "../../api/client";
import type { SchemaResponse } from "../../api/client";
import { compatibleSources, compatibleTargets, edgeKind, type ConnectionRules } from "./edgeValidation";
import {
  chainPortHandle,
  clearChainEdgeItem,
  parseRefEdgeId,
  refInputPort,
  synthesizeChainEdges,
  synthesizeRefEdges,
  CHAIN_INPUT_HANDLE,
  REF_OUTPUT_HANDLE,
  type ArrayRefSpec,
  type RefPortRules,
} from "./refEdges";
import { GenericNode, type GenericNodeData, type ChainOutputPortData, type RefInputPortData, type RefOutputOptionData } from "./GenericNode";
import { ContainerNode, type ContainerNodeData } from "./ContainerNode";
import { NoteNode, type NoteNodeData } from "./NoteNode";
import styles from "./GraphCanvas.module.css";

const nodeTypes = { generic: GenericNode, container: ContainerNode, boundary: ContainerNode, note: NoteNode };
const STRUCTURAL_PARENT_TYPES = new Set(["container", "boundary"]);

interface GraphCanvasProps {
  category: "backend" | "frontend";
}

interface ConnectingState {
  nodeId: string;
  nodeType: NodeType;
  handleType: "source" | "target";
}

interface EdgeMenuState {
  edgeId: string;
  sourceId: string;
  targetId: string;
  x: number;
  y: number;
}

interface NodeMenuState {
  nodeId: string;
  x: number;
  y: number;
}

function isHierarchyConnectable(connectionRules: ConnectionRules, sourceType: NodeType, targetType: NodeType): boolean {
  return edgeKind(connectionRules, sourceType, targetType) !== undefined;
}

function chainPortLabel(item: unknown): string {
  const props = (item ?? {}) as Record<string, unknown>;
  const status = props.status !== undefined && props.status !== "" ? String(props.status) : "?";
  const description = typeof props.description === "string" && props.description ? `: ${props.description}` : "";
  return `${status}${description}`;
}

function toRFNodes(
  nodes: AnyGraphNode[],
  connectionRules: ConnectionRules,
  refPortRules: RefPortRules,
  arrayRefPorts: Map<NodeType, ArrayRefSpec[]>,
  chainTargetTypes: Set<NodeType>,
  onQuickAdd: (sourceId: string, targetType: NodeType) => void,
  onQuickAddIncoming: (targetId: string, sourceType: NodeType) => void,
  onRefInputQuickAdd: (nodeId: string, field: string, targetType: NodeType) => void,
  onRefOutputQuickAdd: (nodeId: string, holderType: NodeType, field: string) => void,
  connecting: ConnectingState | null,
): RFNode<GenericNodeData | ContainerNodeData | NoteNodeData>[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const parents = nodes.filter((n) => STRUCTURAL_PARENT_TYPES.has(n.type));
  const rest = nodes.filter((n) => !STRUCTURAL_PARENT_TYPES.has(n.type));
  return [...parents, ...rest].map((n) => {
    if (STRUCTURAL_PARENT_TYPES.has(n.type)) {
      return {
        id: n.id,
        type: n.type as "container" | "boundary",
        position: n.position,
        parentId: n.containerId,
        extent: n.containerId ? ("parent" as const) : undefined,
        style: { width: 320, height: 220, zIndex: -1 },
        data: { nodeType: n.type as "container" | "boundary", props: n.props as { label: string; kind?: string } },
      };
    }
    if (n.type === "note") {
      return {
        id: n.id,
        type: "note" as const,
        position: n.position,
        parentId: n.containerId,
        extent: n.containerId ? ("parent" as const) : undefined,
        data: { props: n.props as { text?: string; color?: "yellow" | "blue" | "pink" | "green" } },
      };
    }
    let highlight: "valid" | "invalid" | undefined;
    if (connecting && n.id !== connecting.nodeId) {
      const isValid =
        connecting.handleType === "source"
          ? isHierarchyConnectable(connectionRules, connecting.nodeType, n.type)
          : isHierarchyConnectable(connectionRules, n.type, connecting.nodeType);
      highlight = isValid ? "valid" : "invalid";
    }
    const outgoingTypes = compatibleTargets(connectionRules, n.type);
    const incomingTypes = compatibleSources(connectionRules, n.type);
    const refInputPorts: RefInputPortData[] = (refPortRules.inputs.get(n.type) ?? []).map((port) => ({
      field: port.field,
      label: nodeSchemas[n.type].fields.find((f) => f.key === port.field)?.label ?? port.field,
      targetTypes: port.targetTypes,
    }));
    const refOutputOptions: RefOutputOptionData[] = refPortRules.outputs.get(n.type) ?? [];
    const chainOutputPorts: ChainOutputPortData[] = (arrayRefPorts.get(n.type) ?? []).flatMap((spec) => {
      const items = (n.props as Record<string, unknown>)[spec.arrayField];
      if (!Array.isArray(items)) return [];
      return items.map((item, index) => ({ handleId: chainPortHandle(spec.arrayField, index), label: chainPortLabel(item) }));
    });
    const hasChainInput = chainTargetTypes.has(n.type);

    let resolvedTitle: string | undefined;
    if (n.type === "subdomain") {
      const props = n.props as { subdomain?: string; domainId?: string };
      const domainNode = props.domainId ? nodesById.get(props.domainId) : undefined;
      const domainValue = domainNode ? (domainNode.props as { domain?: string }).domain : undefined;
      if (props.subdomain && domainValue) resolvedTitle = `${props.subdomain}.${domainValue}`;
    }
    if (n.type === "operation") {
      const method = (n.props as { method?: string }).method;
      if (method) resolvedTitle = method;
    }

    return {
      id: n.id,
      type: "generic" as const,
      position: n.position,
      parentId: n.containerId,
      extent: n.containerId ? ("parent" as const) : undefined,
      data: {
        nodeType: n.type,
        props: n.props as Record<string, unknown>,
        resolvedTitle,
        highlight,
        compatibleTypes: outgoingTypes,
        incomingCompatibleTypes: incomingTypes,
        canReceiveConnection: incomingTypes.length > 0,
        onQuickAdd: (targetType: NodeType) => onQuickAdd(n.id, targetType),
        onQuickAddIncoming: (sourceType: NodeType) => onQuickAddIncoming(n.id, sourceType),
        refInputPorts,
        refOutputOptions,
        onRefInputQuickAdd: (field: string, targetType: NodeType) => onRefInputQuickAdd(n.id, field, targetType),
        onRefOutputQuickAdd: (holderType: NodeType, field: string) => onRefOutputQuickAdd(n.id, holderType, field),
        chainOutputPorts,
        hasChainInput,
      },
    };
  });
}

function toRFEdges(edges: GraphEdge[]): RFEdge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    style: e.edgeType === "invalidates" ? { strokeDasharray: "4 4" } : undefined,
  }));
}

// A ref field pointing at the same node a hierarchy/invalidates edge already connects (e.g.
// subdomain.domainId mirroring the domain -> subdomain hierarchy edge) would draw a redundant
// second line — skip those, the real edge already shows the relationship.
function toSyntheticRefRFEdges(nodes: AnyGraphNode[], refFields: SchemaResponse["refFields"] | undefined, existingEdges: GraphEdge[]): RFEdge[] {
  const connectedPairs = new Set(existingEdges.map((e) => [e.source, e.target].sort().join("::")));
  return synthesizeRefEdges(nodes, refFields)
    .filter((e) => !connectedPairs.has([e.source, e.target].sort().join("::")))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: REF_OUTPUT_HANDLE,
      targetHandle: e.field,
      style: { stroke: "var(--color-preview)", strokeDasharray: "2 3" },
      data: { isRef: true, field: e.field },
    }));
}

// Same dedup as toSyntheticRefRFEdges — a chain target that's also a real hierarchy/invalidates
// parent of the same pair would otherwise draw a redundant second line.
function toChainRFEdges(nodes: AnyGraphNode[], refFields: SchemaResponse["refFields"] | undefined, existingEdges: GraphEdge[]): RFEdge[] {
  const connectedPairs = new Set(existingEdges.map((e) => [e.source, e.target].sort().join("::")));
  return synthesizeChainEdges(nodes, refFields)
    .filter((e) => !connectedPairs.has([e.source, e.target].sort().join("::")))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: CHAIN_INPUT_HANDLE,
      style: { stroke: "var(--color-preview)", strokeDasharray: "2 3" },
      data: { isRef: true },
    }));
}

export function GraphCanvas({ category }: GraphCanvasProps) {
  const {
    nodes: graphNodes,
    edges: graphEdges,
    connectionRules,
    refPortRules,
    arrayRefPorts,
    chainTargetTypes,
    schema,
    refetch,
    setSelectedNodeId,
    notify,
  } = useGraph();
  const { screenToFlowPosition } = useReactFlow();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<ConnectingState | null>(null);
  const [edgeMenu, setEdgeMenu] = useState<EdgeMenuState | null>(null);
  const [nodeMenu, setNodeMenu] = useState<NodeMenuState | null>(null);

  const categoryNodes = useMemo(
    () => graphNodes.filter((n) => nodeSchemas[n.type].category === "structure" || nodeSchemas[n.type].category === category),
    [graphNodes, category],
  );
  const availableContainers = useMemo(() => categoryNodes.filter((n) => STRUCTURAL_PARENT_TYPES.has(n.type)), [categoryNodes]);
  const categoryNodeIds = useMemo(() => new Set(categoryNodes.map((n) => n.id)), [categoryNodes]);
  const categoryEdges = useMemo(
    () => graphEdges.filter((e) => categoryNodeIds.has(e.source) && categoryNodeIds.has(e.target)),
    [graphEdges, categoryNodeIds],
  );
  const nodesById = useMemo(() => new Map(graphNodes.map((n) => [n.id, n])), [graphNodes]);

  const handleQuickAdd = useCallback(
    async (sourceId: string, targetType: NodeType) => {
      const source = nodesById.get(sourceId);
      if (!source) return;
      try {
        const kind = edgeKind(connectionRules, source.type, targetType);
        if (!kind) return;
        const created = await api.createNode(targetType, defaultCompanionProps(targetType, graphNodes));
        await api.updateNodePosition(created.id, { x: source.position.x + 40, y: source.position.y + 160 });
        await api.createEdge(sourceId, created.id, kind);
        await refetch();
        setSelectedNodeId(created.id);
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err));
      }
    },
    [nodesById, graphNodes, connectionRules, refetch, setSelectedNodeId, notify],
  );

  const handleQuickAddIncoming = useCallback(
    async (targetId: string, sourceType: NodeType) => {
      const target = nodesById.get(targetId);
      if (!target) return;
      try {
        const kind = edgeKind(connectionRules, sourceType, target.type);
        if (!kind) return;
        const created = await api.createNode(sourceType, defaultCompanionProps(sourceType, graphNodes));
        await api.updateNodePosition(created.id, { x: target.position.x + 40, y: target.position.y - 160 });
        await api.createEdge(created.id, targetId, kind);
        await refetch();
        setSelectedNodeId(created.id);
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err));
      }
    },
    [nodesById, graphNodes, connectionRules, refetch, setSelectedNodeId, notify],
  );

  const handleRefInputQuickAdd = useCallback(
    async (nodeId: string, field: string, targetType: NodeType) => {
      const node = nodesById.get(nodeId);
      if (!node) return;
      try {
        const created = await api.createNode(targetType, defaultCompanionProps(targetType, graphNodes));
        await api.updateNodePosition(created.id, { x: node.position.x - 220, y: node.position.y });
        await api.updateNode(nodeId, { [field]: created.id });
        await refetch();
        setSelectedNodeId(created.id);
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err));
      }
    },
    [nodesById, graphNodes, refetch, setSelectedNodeId, notify],
  );

  const handleRefOutputQuickAdd = useCallback(
    async (nodeId: string, holderType: NodeType, field: string) => {
      const node = nodesById.get(nodeId);
      if (!node) return;
      try {
        const created = await api.createNode(holderType, defaultCompanionProps(holderType, graphNodes));
        await api.updateNodePosition(created.id, { x: node.position.x + 220, y: node.position.y });
        await api.updateNode(created.id, { [field]: nodeId });
        await refetch();
        setSelectedNodeId(created.id);
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err));
      }
    },
    [nodesById, graphNodes, refetch, setSelectedNodeId, notify],
  );

  const edgeMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!edgeMenu) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (edgeMenuRef.current?.contains(event.target as Node)) return;
      setEdgeMenu(null);
    };
    document.addEventListener("mousedown", closeOnOutsideClick, { capture: true });
    return () => document.removeEventListener("mousedown", closeOnOutsideClick, { capture: true });
  }, [edgeMenu]);

  const nodeMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!nodeMenu) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (nodeMenuRef.current?.contains(event.target as Node)) return;
      setNodeMenu(null);
    };
    document.addEventListener("mousedown", closeOnOutsideClick, { capture: true });
    return () => document.removeEventListener("mousedown", closeOnOutsideClick, { capture: true });
  }, [nodeMenu]);

  const handleNodeContextMenu: NodeMouseHandler = useCallback((event, node) => {
    event.preventDefault();
    setNodeMenu({ nodeId: node.id, x: event.clientX, y: event.clientY });
  }, []);

  const handleDuplicateNode = useCallback(async () => {
    if (!nodeMenu) return;
    const original = nodesById.get(nodeMenu.nodeId);
    setNodeMenu(null);
    if (!original) return;
    try {
      const created = await api.createNode(original.type, { ...(original.props as Record<string, unknown>) });
      await api.updateNodePosition(created.id, { x: original.position.x + 40, y: original.position.y + 40 });
      const parentEdge = graphEdges.find((e) => e.edgeType === "hierarchy" && e.target === original.id);
      if (parentEdge) {
        const kind = edgeKind(connectionRules, nodesById.get(parentEdge.source)?.type ?? original.type, original.type);
        if (kind) await api.createEdge(parentEdge.source, created.id, kind);
      }
      if (original.containerId) await api.setNodeContainer(created.id, original.containerId);
      await refetch();
      setSelectedNodeId(created.id);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    }
  }, [nodeMenu, nodesById, graphEdges, connectionRules, refetch, setSelectedNodeId, notify]);

  const handleCopyNodeId = useCallback(() => {
    if (!nodeMenu) return;
    const id = nodeMenu.nodeId;
    setNodeMenu(null);
    void navigator.clipboard?.writeText(id).catch(() => {});
  }, [nodeMenu]);

  const handleMoveToContainer = useCallback(
    async (containerId: string | undefined) => {
      if (!nodeMenu) return;
      const nodeId = nodeMenu.nodeId;
      setNodeMenu(null);
      try {
        await api.setNodeContainer(nodeId, containerId);
        await refetch();
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err));
      }
    },
    [nodeMenu, refetch, notify],
  );

  const handleDeleteFromNodeMenu = useCallback(() => {
    if (!nodeMenu) return;
    setPendingDeleteId(nodeMenu.nodeId);
    setNodeMenu(null);
  }, [nodeMenu]);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<RFNode<GenericNodeData | ContainerNodeData | NoteNodeData>>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<RFEdge>([]);

  useEffect(() => {
    setRfNodes(
      toRFNodes(
        categoryNodes,
        connectionRules,
        refPortRules,
        arrayRefPorts,
        chainTargetTypes,
        handleQuickAdd,
        handleQuickAddIncoming,
        handleRefInputQuickAdd,
        handleRefOutputQuickAdd,
        connecting,
      ),
    );
    setRfEdges([
      ...toRFEdges(categoryEdges),
      ...toSyntheticRefRFEdges(categoryNodes, schema?.refFields, categoryEdges),
      ...toChainRFEdges(categoryNodes, schema?.refFields, categoryEdges),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    categoryNodes,
    categoryEdges,
    connectionRules,
    refPortRules,
    arrayRefPorts,
    chainTargetTypes,
    schema,
    handleQuickAdd,
    handleQuickAddIncoming,
    handleRefInputQuickAdd,
    handleRefOutputQuickAdd,
    connecting,
  ]);

  const chainSpecForHandle = useCallback(
    (sourceType: NodeType, sourceHandle: string): ArrayRefSpec | undefined => {
      if (!sourceHandle.startsWith("chain__")) return undefined;
      const [, arrayField] = sourceHandle.split("__");
      return (arrayRefPorts.get(sourceType) ?? []).find((s) => s.arrayField === arrayField);
    },
    [arrayRefPorts],
  );

  const isValidConnection = useCallback(
    (connection: Connection | RFEdge) => {
      const source = nodesById.get(connection.source ?? "");
      const target = nodesById.get(connection.target ?? "");
      if (!source || !target) return false;
      const sourceHandle = connection.sourceHandle ?? undefined;
      if (connection.targetHandle === CHAIN_INPUT_HANDLE) {
        const spec = sourceHandle ? chainSpecForHandle(source.type, sourceHandle) : undefined;
        return Boolean(spec && spec.targetTypes.includes(target.type));
      }
      if (connection.targetHandle) {
        // A ref-input port only accepts the generic ref-out handle, not a chain output port.
        if (sourceHandle && sourceHandle !== REF_OUTPUT_HANDLE) return false;
        const port = refInputPort(refPortRules, target.type, connection.targetHandle);
        return Boolean(port && port.targetTypes.includes(source.type));
      }
      // A plain hierarchy connection can't originate from a ref-out or chain output port.
      if (sourceHandle) return false;
      return edgeKind(connectionRules, source.type, target.type) !== undefined;
    },
    [connectionRules, refPortRules, chainSpecForHandle, nodesById],
  );

  const handleConnect = useCallback(
    async (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const source = nodesById.get(connection.source);
      const target = nodesById.get(connection.target);
      if (!source || !target) return;
      try {
        if (connection.targetHandle === CHAIN_INPUT_HANDLE && connection.sourceHandle) {
          const spec = chainSpecForHandle(source.type, connection.sourceHandle);
          if (!spec || !spec.targetTypes.includes(target.type)) return;
          const index = Number(connection.sourceHandle.split("__")[2]);
          const items = [...(((source.props as Record<string, unknown>)[spec.arrayField] as Record<string, unknown>[]) ?? [])];
          if (!items[index]) return;
          items[index] = { ...items[index], [spec.itemField]: connection.target };
          await api.updateNode(connection.source, { [spec.arrayField]: items });
        } else if (connection.targetHandle) {
          if (connection.sourceHandle && connection.sourceHandle !== REF_OUTPUT_HANDLE) return;
          const port = refInputPort(refPortRules, target.type, connection.targetHandle);
          if (!port || !port.targetTypes.includes(source.type)) return;
          await api.updateNode(connection.target, { [connection.targetHandle]: connection.source });
        } else {
          if (connection.sourceHandle) return;
          const kind = edgeKind(connectionRules, source.type, target.type);
          if (!kind) return;
          await api.createEdge(connection.source, connection.target, kind);
        }
        await refetch();
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err));
      }
    },
    [connectionRules, refPortRules, chainSpecForHandle, nodesById, refetch, notify],
  );

  const handleConnectStart: OnConnectStart = useCallback(
    (_event, params) => {
      if (!params.nodeId) return;
      const node = nodesById.get(params.nodeId);
      if (!node) return;
      setConnecting({ nodeId: params.nodeId, nodeType: node.type, handleType: params.handleType === "target" ? "target" : "source" });
    },
    [nodesById],
  );

  const handleConnectEnd: OnConnectEnd = useCallback(() => {
    setConnecting(null);
  }, []);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      setSelectedNodeId(node.id);
      setEdgeMenu(null);
      setNodeMenu(null);
    },
    [setSelectedNodeId],
  );

  const handleNodeDragStop: OnNodeDrag<RFNode<GenericNodeData | ContainerNodeData | NoteNodeData>> = useCallback(
    (_event, node) => {
      void api.updateNodePosition(node.id, node.position).catch((err) => notify(err instanceof Error ? err.message : String(err)));
      const graphNode = nodesById.get(node.id);
      const newContainerId = node.parentId;
      if (graphNode && graphNode.containerId !== newContainerId) {
        void api
          .setNodeContainer(node.id, newContainerId)
          .then(() => refetch())
          .catch((err) => notify(err instanceof Error ? err.message : String(err)));
      }
    },
    [nodesById, refetch, notify],
  );

  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/pv-node-type") as NodeType | "";
      if (!type) return;
      try {
        const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
        const created = await api.createNode(type, {});
        await api.updateNodePosition(created.id, position);
        await refetch();
        setSelectedNodeId(created.id);
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err));
      }
    },
    [screenToFlowPosition, refetch, setSelectedNodeId, notify],
  );

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
  }, []);

  const confirmDelete = useCallback(
    async (cascade: boolean) => {
      if (!pendingDeleteId) return;
      try {
        await api.deleteNode(pendingDeleteId, cascade);
        setSelectedNodeId(null);
        await refetch();
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err));
      } finally {
        setPendingDeleteId(null);
      }
    },
    [pendingDeleteId, refetch, setSelectedNodeId, notify],
  );

  const handleEdgeContextMenu: EdgeMouseHandler = useCallback((event, edge) => {
    event.preventDefault();
    setEdgeMenu({ edgeId: edge.id, sourceId: edge.source, targetId: edge.target, x: event.clientX, y: event.clientY });
  }, []);

  const handleDeleteEdge = useCallback(async () => {
    if (!edgeMenu) return;
    try {
      const ref = parseRefEdgeId(edgeMenu.edgeId);
      if (ref?.kind === "simple") {
        await api.updateNode(ref.nodeId, { [ref.field]: null });
      } else if (ref?.kind === "chain") {
        const node = nodesById.get(ref.nodeId);
        const patch = node && clearChainEdgeItem(node, ref.arrayField, ref.index);
        if (patch) await api.updateNode(ref.nodeId, patch);
      } else {
        await api.deleteEdge(edgeMenu.edgeId);
      }
      await refetch();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      setEdgeMenu(null);
    }
  }, [edgeMenu, nodesById, refetch, notify]);

  const handleSelectFromMenu = useCallback(
    (nodeId: string) => {
      setSelectedNodeId(nodeId);
      setEdgeMenu(null);
    },
    [setSelectedNodeId],
  );

  return (
    <div className={styles.wrapper} onDrop={handleDrop} onDragOver={handleDragOver}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={{ type: "smoothstep" }}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        isValidConnection={isValidConnection}
        onNodeClick={handleNodeClick}
        onNodeDragStop={handleNodeDragStop}
        onNodeContextMenu={handleNodeContextMenu}
        onEdgeContextMenu={handleEdgeContextMenu}
        onPaneClick={() => {
          setSelectedNodeId(null);
          setEdgeMenu(null);
          setNodeMenu(null);
        }}
        onMoveStart={() => {
          setEdgeMenu(null);
          setNodeMenu(null);
        }}
        onNodesDelete={(deleted) => deleted[0] && setPendingDeleteId(deleted[0].id)}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
      {edgeMenu && (
        <div
          ref={edgeMenuRef}
          className="card"
          style={{ position: "fixed", top: edgeMenu.y, left: edgeMenu.x, padding: 4, zIndex: 40, minWidth: 190 }}
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" className={styles.menuItem} onClick={() => handleSelectFromMenu(edgeMenu.sourceId)}>
            Seleccionar nodo origen
          </button>
          <button type="button" className={styles.menuItem} onClick={() => handleSelectFromMenu(edgeMenu.targetId)}>
            Seleccionar nodo destino
          </button>
          <button type="button" className={`${styles.menuItem} ${styles.menuItemDanger}`} onClick={() => void handleDeleteEdge()}>
            Eliminar conexión
          </button>
        </div>
      )}
      {nodeMenu &&
        (() => {
          const menuNode = nodesById.get(nodeMenu.nodeId);
          const otherContainers = availableContainers.filter((c) => c.id !== nodeMenu.nodeId);
          return (
            <div
              ref={nodeMenuRef}
              className="card"
              style={{ position: "fixed", top: nodeMenu.y, left: nodeMenu.x, padding: 4, zIndex: 40, minWidth: 210 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button type="button" className={styles.menuItem} onClick={() => void handleDuplicateNode()}>
                Duplicar nodo
              </button>
              <button type="button" className={styles.menuItem} onClick={handleCopyNodeId}>
                Copiar ID
              </button>
              {otherContainers.length > 0 &&
                otherContainers.map((c) => (
                  <button key={c.id} type="button" className={styles.menuItem} onClick={() => void handleMoveToContainer(c.id)}>
                    Agregar a: {(c.props as { label?: string }).label || c.type}
                  </button>
                ))}
              {menuNode?.containerId && (
                <button type="button" className={styles.menuItem} onClick={() => void handleMoveToContainer(undefined)}>
                  Quitar de contenedor
                </button>
              )}
              <button type="button" className={`${styles.menuItem} ${styles.menuItemDanger}`} onClick={handleDeleteFromNodeMenu}>
                Eliminar nodo
              </button>
            </div>
          );
        })()}
      {pendingDeleteId && (
        <div className="card" style={{ position: "absolute", top: 16, right: 16, padding: 16, zIndex: 10, width: 260 }}>
          <div style={{ marginBottom: 10, fontSize: 13, fontWeight: 500 }}>¿Eliminar este nodo?</div>
          <label style={{ display: "block", marginBottom: 12 }}>
            <input type="checkbox" id="cascade-checkbox" /> Eliminar también sus hijos (cascade)
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn-danger"
              onClick={() => {
                const checkbox = document.getElementById("cascade-checkbox") as HTMLInputElement | null;
                void confirmDelete(Boolean(checkbox?.checked));
              }}
            >
              Eliminar
            </button>
            <button
              className="btn-secondary"
              onClick={() => {
                setPendingDeleteId(null);
                setRfNodes(
                  toRFNodes(
                    categoryNodes,
                    connectionRules,
                    refPortRules,
                    arrayRefPorts,
                    chainTargetTypes,
                    handleQuickAdd,
                    handleQuickAddIncoming,
                    handleRefInputQuickAdd,
                    handleRefOutputQuickAdd,
                    null,
                  ),
                );
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
