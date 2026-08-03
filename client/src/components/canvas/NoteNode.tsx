import { useState } from "react";
import type { NodeProps } from "@xyflow/react";
import * as api from "../../api/client";

export interface NoteNodeData {
  props: { text?: string; color?: "yellow" | "blue" | "pink" | "green" };
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

  return (
    <div
      className="nodrag"
      style={{
        width: 200,
        minHeight: 120,
        background,
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-soft)",
        padding: 10,
      }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void api.updateNode(id, { text }).catch((err) => console.error(err))}
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
