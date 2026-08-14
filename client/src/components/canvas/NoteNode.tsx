import { useState } from "react";
import type { NodeProps } from "@xyflow/react";
import * as api from "../../api/client";
import { useGraph } from "../../context/GraphContext";

export interface NoteNodeData {
  props: { text?: string; color?: "yellow" | "blue" | "pink" | "green" };
  dimmed?: boolean;
  [key: string]: unknown;
}

const NOTE_COLORS: Record<string, string> = {
  yellow: "#fefcbf",
  blue: "#bee3f8",
  pink: "#fed7e2",
  green: "#c6f6d5",
};

export function NoteNode({ data, id }: NodeProps & { data: NoteNodeData }) {
  const [text, setText] = useState(data.props.text ?? "");
  const background = NOTE_COLORS[data.props.color ?? "yellow"];
  const { notify } = useGraph();

  return (
    <div
      style={{
        width: 200,
        minHeight: 120,
        background,
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-soft)",
        padding: 10,
        opacity: data.dimmed ? 0.15 : 1,
        pointerEvents: data.dimmed ? "none" : undefined,
        transition: "opacity 0.12s ease",
      }}
    >
      <textarea
        className="nodrag"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void api.updateNode(id, { text }).catch((err) => notify(err instanceof Error ? err.message : String(err)))}
        placeholder="Nota..."
        style={{
          width: "100%",
          height: 100,
          resize: "both",
          border: "none",
          background: "transparent",
          font: "inherit",
          fontSize: 12.5,
          color: "#1a202c",
          outline: "none",
        }}
      />
    </div>
  );
}
