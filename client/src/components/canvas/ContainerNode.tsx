import { NodeResizer, type NodeProps } from "@xyflow/react";

export interface ContainerNodeData {
  nodeType?: "container" | "boundary";
  props: { label: string; kind?: string };
  dimmed?: boolean;
  [key: string]: unknown;
}

const BOUNDARY_COLORS: Record<string, string> = {
  microservice: "#4c6ef5",
  "network-zone": "#dd6b20",
  module: "#805ad5",
  "bounded-context": "#2c7a7b",
};

export function ContainerNode({ data, selected }: NodeProps & { data: ContainerNodeData }) {
  const isBoundary = data.nodeType === "boundary";
  const borderColor = isBoundary ? BOUNDARY_COLORS[data.props.kind ?? "microservice"] ?? "var(--color-border)" : "var(--color-border)";

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        border: `2px dashed ${borderColor}`,
        borderRadius: "var(--radius-lg)",
        background: "var(--color-canvas-soft)",
        opacity: data.dimmed ? 0.15 : 1,
        pointerEvents: data.dimmed ? "none" : undefined,
        transition: "opacity 0.12s ease",
      }}
    >
      <NodeResizer isVisible={selected} minWidth={160} minHeight={120} lineStyle={{ borderColor: "var(--color-text)" }} />
      <div
        style={{
          padding: "6px 10px",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: isBoundary ? borderColor : "var(--color-text-faint)",
        }}
      >
        {data.props.label || (isBoundary ? "Boundary" : "Contenedor")}
        {isBoundary && data.props.kind && <span style={{ opacity: 0.7 }}> · {data.props.kind}</span>}
      </div>
    </div>
  );
}
