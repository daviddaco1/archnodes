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
  type OnNodeDrag,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useGraph } from "../../context/GraphContext";
import { nodeSchemas } from "../../schema/nodeSchemas";
import type { AnyGraphNode, GraphEdge, NodeType } from "../../types/graph";
import * as api from "../../api/client";
import { edgeKind } from "./edgeValidation";
import { GenericNode, type GenericNodeData } from "./GenericNode";
import { ContainerNode, type ContainerNodeData } from "./ContainerNode";
import styles from "./GraphCanvas.module.css";

const nodeTypes = { generic: GenericNode, container: ContainerNode };

interface GraphCanvasProps {
  category: "backend" | "frontend";
}

function toRFNodes(nodes: AnyGraphNode[]): RFNode<GenericNodeData | ContainerNodeData>[] {
  const containers = nodes.filter((n) => n.type === "container");
  const rest = nodes.filter((n) => n.type !== "container");
  return [...containers, ...rest].map((n) => ({
    id: n.id,
    type: n.type === "container" ? "container" : "generic",
    position: n.position,
    parentId: n.containerId,
    extent: n.containerId ? ("parent" as const) : undefined,
    style: n.type === "container" ? { width: 320, height: 220, zIndex: -1 } : undefined,
    data: { nodeType: n.type, props: n.props as Record<string, unknown> },
  }));
}

function toRFEdges(edges: GraphEdge[]): RFEdge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    style: e.edgeType === "invalidates" ? { strokeDasharray: "4 4" } : undefined,
  }));
}

export function GraphCanvas({ category }: GraphCanvasProps) {
  const { nodes: graphNodes, edges: graphEdges, connectionRules, refetch, setSelectedNodeId } = useGraph();
  const { screenToFlowPosition } = useReactFlow();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const categoryNodes = useMemo(
    () => graphNodes.filter((n) => n.type === "container" || nodeSchemas[n.type].category === category),
    [graphNodes, category],
  );
  const categoryNodeIds = useMemo(() => new Set(categoryNodes.map((n) => n.id)), [categoryNodes]);
  const categoryEdges = useMemo(
    () => graphEdges.filter((e) => categoryNodeIds.has(e.source) && categoryNodeIds.has(e.target)),
    [graphEdges, categoryNodeIds],
  );
  const nodesById = useMemo(() => new Map(graphNodes.map((n) => [n.id, n])), [graphNodes]);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(toRFNodes(categoryNodes));
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(toRFEdges(categoryEdges));

  useEffect(() => {
    setRfNodes(toRFNodes(categoryNodes));
    setRfEdges(toRFEdges(categoryEdges));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryNodes, categoryEdges]);

  const isValidConnection = useCallback(
    (connection: Connection | RFEdge) => {
      const source = nodesById.get(connection.source ?? "");
      const target = nodesById.get(connection.target ?? "");
      if (!source || !target) return false;
      return edgeKind(connectionRules, source.type, target.type) !== undefined;
    },
    [connectionRules, nodesById],
  );

  const handleConnect = useCallback(
    async (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const source = nodesById.get(connection.source);
      const target = nodesById.get(connection.target);
      if (!source || !target) return;
      const kind = edgeKind(connectionRules, source.type, target.type);
      if (!kind) return;
      try {
        await api.createEdge(connection.source, connection.target, kind);
        await refetch();
      } catch (err) {
        console.error(err);
      }
    },
    [connectionRules, nodesById, refetch],
  );

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      setSelectedNodeId(node.id);
    },
    [setSelectedNodeId],
  );

  const handleNodeDragStop: OnNodeDrag<RFNode<GenericNodeData | ContainerNodeData>> = useCallback(
    (_event, node) => {
      void api.updateNodePosition(node.id, node.position).catch((err) => console.error(err));
      const graphNode = nodesById.get(node.id);
      const newContainerId = node.parentId;
      if (graphNode && graphNode.containerId !== newContainerId) {
        void api
          .setNodeContainer(node.id, newContainerId)
          .then(() => refetch())
          .catch((err) => console.error(err));
      }
    },
    [nodesById, refetch],
  );

  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/pv-node-type") as NodeType | "";
      if (!type) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const created = await api.createNode(type, {});
      await api.updateNodePosition(created.id, position);
      await refetch();
      setSelectedNodeId(created.id);
    },
    [screenToFlowPosition, refetch, setSelectedNodeId],
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
        console.error(err);
      } finally {
        setPendingDeleteId(null);
      }
    },
    [pendingDeleteId, refetch, setSelectedNodeId],
  );

  return (
    <div className={styles.wrapper} onDrop={handleDrop} onDragOver={handleDragOver}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        isValidConnection={isValidConnection}
        onNodeClick={handleNodeClick}
        onNodeDragStop={handleNodeDragStop}
        onPaneClick={() => setSelectedNodeId(null)}
        onNodesDelete={(deleted) => deleted[0] && setPendingDeleteId(deleted[0].id)}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
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
                setRfNodes(toRFNodes(categoryNodes));
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
