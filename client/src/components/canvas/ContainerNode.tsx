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
        borderRadius: 8,
        background: "rgba(128,128,128,0.06)",
      }}
    >
      <NodeResizer isVisible={selected} minWidth={160} minHeight={120} />
      <div style={{ padding: 6, fontSize: 12, fontWeight: 600, color: "var(--color-text-muted)" }}>
        {data.props.label || "Contenedor"}
      </div>
    </div>
  );
}
