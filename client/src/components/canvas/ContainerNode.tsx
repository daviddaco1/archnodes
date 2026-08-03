import { NodeResizer, type NodeProps } from "@xyflow/react";

export interface ContainerNodeData {
  props: { label: string };
  [key: string]: unknown;
}

export function ContainerNode({ data, selected }: NodeProps & { data: ContainerNodeData }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        border: "2px dashed var(--color-border)",
        borderRadius: "var(--radius-lg)",
        background: "var(--color-canvas-soft)",
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
          color: "var(--color-text-faint)",
        }}
      >
        {data.props.label || "Contenedor"}
      </div>
    </div>
  );
}
